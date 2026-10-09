import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { Process } from '@/engine/cmd/shell/process';
import { ProcessStdin, terminalProcessBridge } from '@/engine/cmd/terminalProcessBridge';

describe('ProcessStdin', () => {
  it('removes only its own source listeners when its session ends', async () => {
    const parentInput = new PassThrough();
    const first = new ProcessStdin(parentInput, false);
    const second = new ProcessStdin(parentInput, false);
    const firstData = vi.fn();
    const secondData = vi.fn();
    const firstEnd = vi.fn();
    const secondEnd = vi.fn();
    first.on('data', firstData);
    first.on('end', firstEnd);
    second.on('data', secondData);
    second.on('end', secondEnd);
    const ended = new Promise<void>(resolve => second.once('end', resolve));

    parentInput.write('before');
    first.endSession();
    expect(parentInput.writableEnded).toBe(false);
    parentInput.write('after');

    expect(firstData).toHaveBeenCalledOnce();
    expect(secondData).toHaveBeenCalledTimes(2);
    parentInput.end();
    await ended;

    expect(firstEnd).not.toHaveBeenCalled();
    expect(secondEnd).toHaveBeenCalledOnce();
  });

  it('delivers raw input to each active data listener', () => {
    const stdin = new ProcessStdin();
    const first = vi.fn();
    const second = vi.fn();
    stdin._active = true;
    stdin.setRawMode(true);
    stdin.on('data', first);
    stdin.on('data', second);

    stdin.submitData('\x1b[A');

    expect(stdin.isRaw).toBe(true);
    expect(first).toHaveBeenCalledWith(Buffer.from('\x1b[A'));
    expect(second).toHaveBeenCalledWith(Buffer.from('\x1b[A'));
  });

  it('returns to canonical mode when input ends', () => {
    const stdin = new ProcessStdin();
    stdin.setRawMode(true);

    stdin.eof();

    expect(stdin.isRaw).toBe(false);
    expect(stdin._active).toBe(false);
  });

  it('rejects raw mode for redirected input', () => {
    const stdin = new ProcessStdin(new PassThrough());

    expect(() => stdin.setRawMode(true)).toThrow('non-TTY');
  });

  it('changes the input session version when the session or raw mode changes', () => {
    const stdin = new ProcessStdin();
    const initialVersion = stdin.sessionVersion;

    stdin.beginSession();
    expect(stdin.sessionVersion).toBeGreaterThan(initialVersion);
    const canonicalVersion = stdin.sessionVersion;
    stdin.setRawMode(true);
    expect(stdin.sessionVersion).toBeGreaterThan(canonicalVersion);
    const rawVersion = stdin.sessionVersion;
    stdin.setRawMode(true);
    expect(stdin.sessionVersion).toBe(rawVersion);
    stdin.setRawMode(false);
    expect(stdin.sessionVersion).toBeGreaterThan(rawVersion);
  });

  it('forwards interrupts to subscribed runtime executions', () => {
    const stdin = new ProcessStdin();
    const handler = vi.fn();
    stdin.subscribeInterrupt(handler);

    stdin.interrupt();

    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('Process signals', () => {
  it('exits on SIGINT when only an observer listens for the signal', async () => {
    const process = new Process();
    const observer = vi.fn();
    process.on('signal', observer);

    process.kill('SIGINT');

    expect(observer).toHaveBeenCalledWith('SIGINT');
    expect(await process.wait()).toEqual({ code: null, signal: 'SIGINT' });
    expect(process.stdin.writableEnded).toBe(true);
    expect(process.hasExited).toBe(true);
  });

  it('does not auto-exit when a signal handler unsubscribes during dispatch', () => {
    const process = new Process();
    let unsubscribe = () => {};
    const handler = vi.fn(() => unsubscribe());
    unsubscribe = process.handleSignal(handler);

    process.kill('SIGINT');

    expect(handler).toHaveBeenCalledOnce();
    expect(process.hasExited).toBe(false);
    expect(process.stdin.writableEnded).toBe(false);
    process.exit();
  });

  it('lets a signal handler choose the exit code', async () => {
    const process = new Process();
    let unsubscribe = () => {};
    unsubscribe = process.handleSignal(() => {
      unsubscribe();
      process.exit(130);
    });

    process.kill('SIGINT');

    expect(await process.wait()).toEqual({ code: 130, signal: null });
    expect(process.stdin.writableEnded).toBe(true);
  });

  it('filters named signals and aborts execution with the terminating signal', async () => {
    const process = new Process();
    const handler = vi.fn();
    const executionSignal = process.executionSignal();
    process.handleSignal(handler, ['SIGINT']);

    process.kill('SIGTERM');

    expect(handler).not.toHaveBeenCalled();
    expect(await process.wait()).toEqual({ code: null, signal: 'SIGTERM' });
    expect(executionSignal.aborted).toBe(true);
    expect(executionSignal.reason).toBe('SIGTERM');
  });

  it('combines a parent abort signal without exiting the process', () => {
    const process = new Process();
    const parentAbort = new AbortController();
    const executionSignal = process.executionSignal(parentAbort.signal);

    parentAbort.abort('host interrupted');

    expect(executionSignal.aborted).toBe(true);
    expect(executionSignal.reason).toBe('host interrupted');
    expect(process.hasExited).toBe(false);
    process.exit();
  });
});

describe('terminalProcessBridge', () => {
  it('changes the session version when terminal ownership changes', () => {
    const first = new ProcessStdin();
    const second = new ProcessStdin();
    const firstLease = terminalProcessBridge.activate(first);
    const firstVersion = terminalProcessBridge.sessionVersion;

    const secondLease = terminalProcessBridge.activate(second);

    expect(terminalProcessBridge.sessionVersion).not.toBe(firstVersion);
    secondLease.release();
    firstLease.release();
  });

  it('keeps the current process input active when an earlier process exits', () => {
    const firstProcess = new Process();
    const secondProcess = new Process();
    firstProcess.stdinIsTTY = true;
    secondProcess.stdinIsTTY = true;
    const firstStdin = firstProcess.processStdin;
    const secondStdin = secondProcess.processStdin;
    const firstLease = terminalProcessBridge.activate(firstStdin);
    const secondLease = terminalProcessBridge.activate(secondStdin);

    secondStdin.setRawMode(true);
    firstProcess.exit();
    firstLease.release();

    expect(terminalProcessBridge.stdin).toBe(secondStdin);
    expect(secondStdin._active).toBe(true);
    expect(secondStdin.isRaw).toBe(true);
    expect(secondProcess.stdinStream.readableEnded).toBe(false);

    secondLease.release();
    secondProcess.exit();
  });

  it('routes submitted lines to the current process and EOF ends its reader', async () => {
    const process = new Process();
    process.stdinIsTTY = true;
    const lease = terminalProcessBridge.activate(process.processStdin);
    const received = new Promise<Buffer>(resolve => {
      process.stdinStream.once('data', chunk => resolve(Buffer.from(chunk)));
    });
    const ended = new Promise<void>(resolve => process.stdinStream.once('end', resolve));

    terminalProcessBridge.submitLine('hello');
    expect(await received).toEqual(Buffer.from('hello\n'));

    process.processStdin.eof();
    await ended;
    expect(process.stdinStream.readableEnded).toBe(true);
    lease.release();
    process.exit();
  });

  it('does not close inherited input when a child lease is released', () => {
    const parent = new Process();
    const child = new Process();
    child.setInputSource(parent.stdinStream, parent.stdinDestination);
    child.stdinIsTTY = true;
    const lease = terminalProcessBridge.activate(child.processStdin);

    lease.release();

    expect(parent.stdinDestination.writableEnded).toBe(false);
    child.exit();
    expect(parent.stdinDestination.writableEnded).toBe(false);

    child.processStdin.eof();
    expect(parent.stdinDestination.writableEnded).toBe(true);
    parent.exit();
  });
});
