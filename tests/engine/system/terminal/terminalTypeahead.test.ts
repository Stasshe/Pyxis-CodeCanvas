import { describe, expect, it } from 'vitest';
import { TerminalTypeahead } from '@/engine/system/terminal/terminalTypeahead';

describe('TerminalTypeahead', () => {
  it('holds data during interrupt and foreground completion, then replays in order', () => {
    let interruptPending = true;
    let foregroundBusy = false;
    const delivered: string[] = [];
    const queue = new TerminalTypeahead(
      () => interruptPending,
      () => false,
      () => foregroundBusy
    );
    queue.begin();
    const handleInput = (data: string) => {
      delivered.push(data);
      if (data === '\r') foregroundBusy = true;
    };
    queue.route('echo $? ', handleInput);
    queue.route('\r', handleInput);
    queue.route('echo after', handleInput);
    queue.route('\r', handleInput);
    queue.drain(data => delivered.push(data));
    expect(delivered).toEqual([]);

    interruptPending = false;
    queue.drain(handleInput);
    expect(delivered).toEqual(['echo $? ', '\r']);

    foregroundBusy = false;
    queue.drain(handleInput);
    expect(delivered).toEqual(['echo $? ', '\r', 'echo after', '\r']);

    foregroundBusy = false;
    queue.drain(handleInput);
    expect(delivered).toEqual(['echo $? ', '\r', 'echo after', '\r']);
    expect(queue.isActive).toBe(false);
  });

  it('flushes earlier typeahead on another interrupt and preserves later data', () => {
    let ready = false;
    const delivered: string[] = [];
    const queue = new TerminalTypeahead(
      () => !ready,
      () => false,
      () => false
    );
    queue.begin();
    queue.route('discard me', data => delivered.push(data));
    queue.route('\x03', data => delivered.push(data));
    queue.route('keep me', data => delivered.push(data));

    ready = true;
    queue.drain(data => delivered.push(data));

    expect(delivered).toEqual(['\x03', 'keep me']);
  });

  it('routes queued bytes to a reader that remains active after an interrupt', () => {
    let interruptPending = true;
    const readerActive = true;
    const foregroundBusy = true;
    const delivered: string[] = [];
    const queue = new TerminalTypeahead(
      () => interruptPending,
      () => readerActive,
      () => foregroundBusy
    );
    queue.begin();
    queue.route('after-signal', data => delivered.push(data));

    interruptPending = false;
    queue.drain(data => delivered.push(data));

    expect(delivered).toEqual(['after-signal']);
    expect(queue.isActive).toBe(false);
  });

  it('discards queued input when the terminal is disposed', () => {
    let foregroundBusy = true;
    const delivered: string[] = [];
    const queue = new TerminalTypeahead(
      () => false,
      () => false,
      () => foregroundBusy
    );
    queue.begin();
    queue.route('discard me', data => delivered.push(data));
    queue.dispose();
    foregroundBusy = false;
    queue.drain(data => delivered.push(data));
    queue.route('also discard', data => delivered.push(data));

    expect(delivered).toEqual([]);
    expect(queue.isActive).toBe(false);
  });
});
