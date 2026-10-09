import { describe, expect, it } from 'vitest';
import { SortCommand } from '@/engine/system/commands/unix/sort';

describe('sort', () => {
  const command = new SortCommand('/tmp/sort', '/tmp/sort');

  it('uses byte order for the default comparison', async () => {
    command.setStdin('a\nA\n_\n2\n10\n');

    await expect(command.execute()).resolves.toBe('10\n2\nA\n_\na\n');
  });

  it('uses the numeric key for -u while retaining the first equal input line', async () => {
    command.setStdin('2\n02\n10\n');

    await expect(command.execute(['-nu'])).resolves.toBe('2\n10\n');
  });

  it('compares decimal numeric keys without floating point rounding', async () => {
    command.setStdin('9007199254740993\n9007199254740992\n');

    await expect(command.execute(['-n'])).resolves.toBe('9007199254740992\n9007199254740993\n');
  });

  it('preserves carriage returns as record content', async () => {
    command.setStdin('a\r\nb\n');

    await expect(command.execute()).resolves.toBe('a\r\nb\n');
  });

  it('treats a leading plus as nonnumeric and sorts decimals in reverse order', async () => {
    command.setStdin('+2\n1\n');
    await expect(command.execute(['-n'])).resolves.toBe('+2\n1\n');

    command.setStdin('-.25\n1.2\n-.3\n.15\n');
    await expect(command.execute(['-nr'])).resolves.toBe('1.2\n.15\n-.25\n-.3\n');
  });

  it('recognizes only spaces and tabs as leading numeric blanks', async () => {
    command.setStdin('\u00a02\n\u000b2\n\r2\n\t2\n1\n');

    await expect(command.execute(['-n'])).resolves.toBe('\u000b2\n\r2\n\u00a02\n1\n\t2\n');
  });
});
