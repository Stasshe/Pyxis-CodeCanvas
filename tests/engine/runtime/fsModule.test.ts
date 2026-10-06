import { Buffer } from 'buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFSModule } from '@/engine/runtime/nodejs/modules/fsModule';
import { createNodeRuntimeFixture, type NodeRuntimeFixture } from '../../_helpers/nodeRuntime';

describe('fsModule', () => {
  let fixture: NodeRuntimeFixture;
  let fs: ReturnType<typeof createFSModule>;
  const root = '/tmp/fs-tests';

  beforeEach(async () => {
    fixture = await createNodeRuntimeFixture(root);
    fs = createFSModule({
      filesystem: fixture.filesystem,
      bridge: fixture.bridge,
      getCwd: () => root,
    });
  });

  afterEach(() => fixture.close());

  it('returns Node-style missing-file and missing-stat errors', async () => {
    await expect(fs.readFile('/missing.txt')).rejects.toMatchObject({
      code: 'ENOENT',
      syscall: 'open',
      path: '/missing.txt',
    });
    await expect(fs.stat('/missing.txt')).rejects.toMatchObject({
      code: 'ENOENT',
      syscall: 'stat',
      path: '/missing.txt',
    });
  });

  it('supports callback reads without leaving a rejected promise', async () => {
    const result = await new Promise<{ error: Error | null; data?: string | Buffer }>(resolve => {
      fs.readFile('/absent.txt', (error, data) => resolve({ error, data }));
    });
    expect(result.data).toBeUndefined();
    expect(result.error).toMatchObject({ code: 'ENOENT', syscall: 'open' });
  });

  it('returns buffers unless a read encoding is requested', async () => {
    await fs.promises.writeFile(`${root}/buffer.txt`, 'héllo');

    const values = [
      await fs.promises.readFile(`${root}/buffer.txt`),
      fs.readFileSync(`${root}/buffer.txt`),
      await fs.promises.readFile(`${root}/buffer.txt`, 'utf8'),
    ];
    expect(Buffer.isBuffer(values[0])).toBe(true);
    expect(Buffer.isBuffer(values[1])).toBe(true);
    expect(values[0].toString()).toBe('héllo');
    expect(values[1].toString()).toBe('héllo');
    expect(values[2]).toBe('héllo');
  });

  it('performs synchronous filesystem mutations through the sync bridge', async () => {
    fs.mkdirSync(`${root}/nested`, { recursive: true });
    fs.writeFileSync(`${root}/nested/one.txt`, 'one');
    expect(fs.readFileSync(`${root}/nested/one.txt`, 'utf8')).toBe('one');
    expect(fs.readdirSync(`${root}/nested`)).toEqual(['one.txt']);
    expect(fs.statSync(`${root}/nested/one.txt`)?.isFile()).toBe(true);

    fs.renameSync(`${root}/nested/one.txt`, `${root}/nested/two.txt`);
    expect(fs.existsSync(`${root}/nested/two.txt`)).toBe(true);
    fs.rmSync(`${root}/nested`, { recursive: true });
    expect(fs.existsSync(`${root}/nested`)).toBe(false);
  });

  it('preserves SVG UTF-8 decoding and buffer directory names', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    await fs.promises.writeFile(`${root}/icon.svg`, new TextEncoder().encode(svg));
    expect(fs.readFileSync(`${root}/icon.svg`, 'base64')).toBe(svg);

    const names = await fs.promises.readdir(root, { encoding: 'buffer' });
    expect(names.every(name => Buffer.isBuffer(name))).toBe(true);
    expect(names.map(name => name.toString())).toContain('icon.svg');
  });

  it('reads and preserves partial synchronous stdin data', () => {
    const sync = vi.spyOn(fixture.bridge, 'sync').mockReturnValueOnce('input line\n');
    const target = Buffer.alloc(5);
    expect(fs.readSync(0, target)).toBe(5);
    expect(target.toString()).toBe('input');
    expect(fs.readFileSync(0, 'utf8')).toBe(' line\n');
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
