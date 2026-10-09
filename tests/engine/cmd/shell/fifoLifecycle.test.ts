import { Buffer } from 'buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellOutputHandler } from '@/engine/cmd/shell/outputHandler';
import { runPipeline } from '@/engine/cmd/shell/pipeline';
import { Process } from '@/engine/cmd/shell/process';
import type { Segment } from '@/engine/cmd/shell/types';
import { FSError, FsCore } from '@/engine/core/fs/core';

describe('shell FIFO lifecycle', () => {
  let core: FsCore;
  let outputHandler: ShellOutputHandler;
  const processes: Process[] = [];

  beforeEach(() => {
    core = new FsCore();
    outputHandler = new ShellOutputHandler(core, async () => '/tmp');
  });

  afterEach(() => {
    for (const process of processes.splice(0)) process.kill('SIGTERM');
    vi.restoreAllMocks();
  });

  function createProcess(): Promise<Process> {
    const process = new Process();
    processes.push(process);
    return Promise.resolve(process);
  }

  function producer(path = '/tmp/pipe'): Segment {
    return {
      raw: 'producer',
      tokens: ['producer'],
      redirections: [{ kind: 'output', fd: 1, path, append: false }],
    };
  }

  async function readAll(endpointId: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    while (true) {
      const bytes = await core.readFifo(endpointId, 65536);
      if (bytes.length === 0) return Buffer.concat(chunks);
      chunks.push(Buffer.from(bytes));
    }
  }

  it('blocks producer side effects until its named FIFO reader opens', async () => {
    await core.mkfifo('/tmp/pipe');
    const open = vi.spyOn(core, 'openFifo');
    const start = vi.fn((process: Process) => {
      process.writeStdout('payload');
      process.exit(0);
    });
    const completion = runPipeline([producer()], {
      createProcess,
      startProcess: start,
      outputHandler,
      pipefail: false,
    });

    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(start).not.toHaveBeenCalled();
    await core.openFifo('/tmp/pipe', 'read', 'reader', 'test');
    const bytes = await readAll('reader');
    expect(bytes.toString()).toBe('payload');
    expect((await completion).code).toBe(0);
    await core.closeFifo('reader');
  });

  it('starts runnable siblings while another stage is waiting for its reader', async () => {
    await core.mkfifo('/tmp/pipe');
    const readerStarted = deferred();
    let consumption: Promise<Uint8Array> | undefined;
    const completion = runPipeline([producer(), { raw: 'reader', tokens: ['reader'] }], {
      createProcess,
      startProcess(process, segment) {
        if (segment.raw === 'reader') {
          readerStarted.resolve();
          consumption = core.readFile('/tmp/pipe');
          void consumption.then(bytes => {
            process.writeStdout(bytes);
            process.exit(0);
          });
          return;
        }
        process.writeStdout('payload');
        process.exit(0);
      },
      outputHandler,
      pipefail: false,
    });

    await readerStarted.promise;
    expect((await completion).stdout).toBe('payload');
    expect(consumption).toBeDefined();
  });

  it('drains ordered binary writes after normal program exit before closing its writer', async () => {
    await core.mkfifo('/tmp/pipe');
    const gate = deferred();
    const writeStarted = deferred();
    const write = core.writeFifo.bind(core);
    vi.spyOn(core, 'writeFifo').mockImplementation(async (endpointId, bytes) => {
      writeStarted.resolve();
      await gate.promise;
      return write(endpointId, bytes);
    });
    const close = vi.spyOn(core, 'closeFifo');
    const open = vi.spyOn(core, 'openFifo');
    const process = await createProcess();
    const segment = producer();
    segment.redirections?.push({ kind: 'duplicate', fd: 2, target: 1 });
    const [preparation] = outputHandler.preparePipeline([segment], [process]);
    const opening = core.openFifo('/tmp/pipe', 'read', 'reader', 'test');
    const [plan] = await Promise.all([preparation, opening]);
    const watch = outputHandler.watch(process, plan, undefined, { stdout: [], stderr: [] });
    const writerCall = open.mock.calls.find(call => call[1] === 'write');
    if (!writerCall) throw new Error('Writer endpoint was not opened.');
    const writerId = writerCall[2];
    process.writeStdout(new Uint8Array([0, 255]));
    process.writeStderr(new Uint8Array([128]));
    process.writeStdout(new Uint8Array([7]));
    process.exit(0);
    await writeStarted.promise;
    expect(process.hasExited).toBe(true);
    expect(close).not.toHaveBeenCalledWith(writerId);
    gate.resolve();
    const bytes = await readAll('reader');
    await watch;
    expect([...bytes]).toEqual([0, 255, 128, 7]);
    expect(close).toHaveBeenCalledWith(writerId);
    await core.closeFifo('reader');
  });

  it.each(['read', 'write'] as const)('cancels a pending named FIFO %s open', async mode => {
    await core.mkfifo('/tmp/pipe');
    const segment = producer();
    if (mode === 'read') segment.redirections = [{ kind: 'input', fd: 0, path: '/tmp/pipe' }];
    const open = vi.spyOn(core, 'openFifo');
    const start = vi.fn();
    const completion = runPipeline([segment], {
      createProcess,
      startProcess: start,
      outputHandler,
      pipefail: false,
      foreground: (_last, stages) => {
        void vi
          .waitFor(() => expect(open).toHaveBeenCalled())
          .then(() => {
            for (const process of stages) process.kill('SIGINT');
          });
      },
    });

    expect((await completion).code).toBe(130);
    expect(start).not.toHaveBeenCalled();
  });

  it('cancels other blocked opens when one stage fails during startup', async () => {
    await core.mkfifo('/tmp/failure');
    await core.mkfifo('/tmp/blocked');
    const open = core.openFifo.bind(core);
    vi.spyOn(core, 'openFifo').mockImplementation((path, mode, endpointId, ownerId, options) => {
      if (path === '/tmp/failure') return Promise.reject(new FSError('EACCES', path));
      return open(path, mode, endpointId, ownerId, options);
    });
    const start = vi.fn();
    const completion = runPipeline([producer('/tmp/failure'), producer('/tmp/blocked')], {
      createProcess,
      startProcess: start,
      outputHandler,
      pipefail: false,
    });

    await expect(completion).rejects.toMatchObject({ code: 'EACCES' });
    expect(start).not.toHaveBeenCalled();
    expect(processes.every(process => process.hasExited)).toBe(true);
  });

  it('reports writer cleanup errors instead of silently ignoring them', async () => {
    const pipe = await core.createPipe('reader-owner', 'writer-owner');
    const close = core.closeFifo.bind(core);
    vi.spyOn(core, 'closeFifo').mockImplementation(async endpointId => {
      await close(endpointId);
      throw new Error('FIFO cleanup failed');
    });
    const completion = runPipeline([producer(pipe.writePath)], {
      createProcess,
      startProcess: process => process.exit(0),
      outputHandler,
      pipefail: false,
    });

    await expect(completion).rejects.toThrow('FIFO cleanup failed');
    await core.closeFifos('reader-owner');
    await core.closeFifos('writer-owner');
  });

  it('keeps independently created shell endpoint identities distinct', async () => {
    await core.mkfifo('/tmp/pipe');
    const readerHandler = new ShellOutputHandler(core, async () => '/tmp');
    const writerProcess = await createProcess();
    const readerProcess = await createProcess();
    const chunks: Buffer[] = [];
    readerProcess.stdinStream.on('data', (bytes: Buffer) => chunks.push(bytes));
    const [writerPreparation] = outputHandler.preparePipeline([producer()], [writerProcess]);
    const [readerPreparation] = readerHandler.preparePipeline(
      [
        {
          raw: 'reader',
          tokens: ['reader'],
          redirections: [{ kind: 'input', fd: 0, path: '/tmp/pipe' }],
        },
      ],
      [readerProcess]
    );
    const [writerPlan, readerPlan] = await Promise.all([writerPreparation, readerPreparation]);
    const readerWatch = readerHandler.watchInput(readerProcess, readerPlan);
    if (!readerWatch) throw new Error('Reader watcher was not created.');
    const writerWatch = outputHandler.watch(writerProcess, writerPlan, undefined, {
      stdout: [],
      stderr: [],
    });

    writerProcess.writeStdout('payload');
    writerProcess.exit(0);
    await Promise.all([writerWatch, readerWatch]);
    expect(Buffer.concat(chunks).toString()).toBe('payload');
    readerProcess.exit(0);
  });

  it('returns SIGPIPE when a reader closes after the program exits but before its write drains', async () => {
    await core.mkfifo('/tmp/pipe');
    const writeStarted = deferred();
    const readerClosed = deferred();
    const write = core.writeFifo.bind(core);
    vi.spyOn(core, 'writeFifo').mockImplementation(async (endpointId, bytes) => {
      writeStarted.resolve();
      await readerClosed.promise;
      return write(endpointId, bytes);
    });
    const opening = core.openFifo('/tmp/pipe', 'read', 'reader', 'test');
    const completion = runPipeline([producer()], {
      createProcess,
      startProcess(process) {
        process.writeStdout('payload');
        process.exit(0);
      },
      outputHandler,
      pipefail: false,
    });

    await Promise.all([opening, writeStarted.promise]);
    expect(processes[0].hasExited).toBe(true);
    await core.closeFifo('reader');
    readerClosed.resolve();
    expect((await completion).code).toBe(141);
  });

  it('opens an overridden FIFO before truncating a later output file', async () => {
    await core.mkfifo('/tmp/pipe');
    await core.writeFile('/tmp/later', 'retained');
    const open = vi.spyOn(core, 'openFifo');
    const start = vi.fn((process: Process) => {
      process.writeStdout('payload');
      process.exit(0);
    });
    const segment = producer();
    segment.redirections?.push({ kind: 'output', fd: 1, path: '/tmp/later', append: false });
    const completion = runPipeline([segment], {
      createProcess,
      startProcess: start,
      outputHandler,
      pipefail: false,
    });

    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(await core.readText('/tmp/later')).toBe('retained');
    expect(start).not.toHaveBeenCalled();
    await core.openFifo('/tmp/pipe', 'read', 'reader', 'test');
    expect(await readAll('reader')).toEqual(Buffer.alloc(0));
    expect((await completion).code).toBe(0);
    expect(await core.readText('/tmp/later')).toBe('payload');
    await core.closeFifo('reader');
  });

  it('keeps a duplicated FIFO descriptor open when its original descriptor is replaced', async () => {
    await core.mkfifo('/tmp/pipe');
    const segment = producer();
    segment.redirections?.push(
      { kind: 'duplicate', fd: 3, target: 1 },
      { kind: 'output', fd: 1, path: '/tmp/later', append: false }
    );
    const opening = core.openFifo('/tmp/pipe', 'read', 'reader', 'test');
    const completion = runPipeline([segment], {
      createProcess,
      startProcess(process) {
        process.getFdWrite(3).write('fifo-data');
        process.writeStdout('file-data');
        process.exit(0);
      },
      outputHandler,
      pipefail: false,
    });

    await opening;
    expect((await readAll('reader')).toString()).toBe('fifo-data');
    expect((await completion).code).toBe(0);
    expect(await core.readText('/tmp/later')).toBe('file-data');
    await core.closeFifo('reader');
  });

  it('cancels a capacity-blocked output queue after program exit and permits the next command', async () => {
    await core.mkfifo('/tmp/pipe');
    const blockedWrite = deferred();
    const write = core.writeFifo.bind(core);
    let writeCount = 0;
    vi.spyOn(core, 'writeFifo').mockImplementation((endpointId, bytes) => {
      writeCount += 1;
      if (writeCount === 2) blockedWrite.resolve();
      return write(endpointId, bytes);
    });
    const opening = core.openFifo('/tmp/pipe', 'read', 'reader', 'test');
    const completion = runPipeline([producer()], {
      createProcess,
      startProcess(process) {
        process.writeStdout(new Uint8Array(65536));
        process.writeStdout(new Uint8Array([1]));
        process.exit(0);
      },
      outputHandler,
      pipefail: false,
    });

    await Promise.all([opening, blockedWrite.promise]);
    expect(processes[0].hasExited).toBe(true);
    processes[0].kill('SIGINT');
    const result = await completion;
    expect(result.code).toBe(130);
    expect(result.interrupted).toBe(true);
    await core.closeFifo('reader');
    await expect(
      core.openFifo('/tmp/pipe', 'write', 'probe', 'test', { nonblocking: true })
    ).rejects.toMatchObject({ code: 'ENXIO' });
    const next = await runPipeline([{ raw: 'ready', tokens: ['ready'] }], {
      createProcess,
      startProcess(process) {
        process.writeStdout('ready');
        process.exit(0);
      },
      outputHandler,
      pipefail: false,
    });
    expect(next.code).toBe(0);
    expect(next.stdout).toBe('ready');
  });
});

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolvePromise = () => {};
  const promise = new Promise<void>(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
