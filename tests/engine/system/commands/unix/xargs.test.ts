import { describe, expect, it } from 'vitest';
import { formatXargsTrace, XargsCommand } from '@/engine/system/commands/unix/xargs';

describe('xargs planning', () => {
  const command = new XargsCommand('/tmp/xargs', '/tmp/xargs');

  it('groups input words according to -n', () => {
    const plan = command.expand(['-n', '1', 'echo'], 'first second');

    expect(plan).toEqual({
      invocations: [
        { command: 'echo', args: ['first'] },
        { command: 'echo', args: ['second'] },
      ],
      maxParallelism: 1,
      trace: false,
    });
  });

  it('splits NUL-delimited input without breaking spaces inside arguments', () => {
    const plan = command.expand(['-0t', '-P2', 'printf', '%s'], 'first item\0second\0');

    expect(plan.invocations).toEqual([{ command: 'printf', args: ['%s', 'first item', 'second'] }]);
    expect(plan.maxParallelism).toBe(2);
    expect(plan.trace).toBe(true);
  });

  it('quotes display-only trace text without changing argv', () => {
    expect(formatXargsTrace({ command: 'printf', args: ['%s', "it's ready"] })).toBe(
      "printf %s 'it'\\''s ready'"
    );
  });

  it('honors -r for empty input and keeps the default empty-input invocation', () => {
    expect(command.expand(['-r', 'echo'], '').invocations).toEqual([]);
    expect(command.expand(['echo'], '').invocations).toEqual([{ command: 'echo', args: [] }]);
    expect(command.expand(['-I', '{}', 'echo'], '').invocations).toEqual([]);
  });

  it('accepts dash-prefixed replacement strings and attached long replacements', () => {
    expect(command.expand(['-I', '-', 'echo', 'x-'], 'item\n').invocations).toEqual([
      { command: 'echo', args: ['xitem'] },
    ]);
    expect(command.expand(['--replace={}', 'echo', '{}'], 'item\n').invocations).toEqual([
      { command: 'echo', args: ['item'] },
    ]);
    expect(() => command.expand(['-I'], 'item\n')).toThrow(
      "xargs: option '-I' requires an argument"
    );
  });

  it('rejects unsupported options instead of treating them as a command', () => {
    expect(() => command.expand(['-x', 'echo'], 'input')).toThrow("xargs: unknown option '-x'");
  });
});
