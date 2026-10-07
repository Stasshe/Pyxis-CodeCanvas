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

  it('honors explicit SVG encodings and buffer directory names', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    await fs.promises.writeFile(`${root}/icon.svg`, new TextEncoder().encode(svg));
    expect(fs.readFileSync(`${root}/icon.svg`, 'base64')).toBe(Buffer.from(svg).toString('base64'));
    expect(Buffer.isBuffer(fs.readFileSync(`${root}/icon.svg`))).toBe(true);
    expect(fs.readFileSync(`${root}/icon.svg`, 'utf8')).toBe(svg);

    const names = await fs.promises.readdir(root, { encoding: 'buffer' });
    expect(names.every(name => Buffer.isBuffer(name))).toBe(true);
    expect(names.map(name => name.toString())).toContain('icon.svg');
  });

  it('preserves binary subviews across sync, promise, callback, and append operations', async () => {
    const backing = Buffer.from([9, 0, 255, 128, 9]);
    const view = backing.subarray(1, 4);
    await fs.promises.writeFile('binary.svg', view, 'utf8');
    expect(fs.readFileSync('binary.svg')).toEqual(Buffer.from([0, 255, 128]));
    await new Promise<void>((resolve, reject) => {
      fs.writeFile('callback.bin', view, error => {
        if (error) reject(error);
        else resolve();
      });
    });
    expect(await fs.promises.readFile('callback.bin')).toEqual(view);
    fs.writeFileSync('sync.bin', view);
    fs.appendFileSync('sync.bin', view);
    await fs.promises.appendFile('sync.bin', view);
    expect(await fs.promises.readFile('sync.bin')).toEqual(Buffer.concat([view, view, view]));
  });

  it('honors string write and append encodings in every existing API form', async () => {
    const expected = Buffer.from([0, 255, 128]);
    await fs.promises.writeFile('promise.bin', '00ff80', 'hex');
    fs.writeFileSync('sync.bin', 'AP+A', { encoding: 'base64' });
    await new Promise<void>((resolve, reject) => {
      fs.writeFile('callback.bin', '00ff80', { encoding: 'hex' }, error => {
        if (error) reject(error);
        else resolve();
      });
    });
    for (const path of ['promise.bin', 'sync.bin', 'callback.bin']) {
      expect(await fs.promises.readFile(path)).toEqual(expected);
    }
    fs.appendFileSync('sync.bin', '00ff80', 'hex');
    await fs.promises.appendFile('promise.bin', 'AP+A', { encoding: 'base64' });
    await new Promise<void>((resolve, reject) => {
      fs.appendFile('callback.bin', '00ff80', 'hex', error => {
        if (error) reject(error);
        else resolve();
      });
    });
    for (const path of ['promise.bin', 'sync.bin', 'callback.bin']) {
      expect(await fs.promises.readFile(path)).toEqual(Buffer.concat([expected, expected]));
    }
  });

  it('preserves filesystem error codes for encoded writes and callbacks', async () => {
    const failure = Object.assign(new Error('Access denied'), { code: 'EACCES' });
    vi.spyOn(fixture.filesystem, 'setFile').mockRejectedValue(failure);
    await expect(fs.promises.writeFile('denied.bin', 'ff', 'hex')).rejects.toBe(failure);
    const result = await new Promise<Error | null>(resolve => {
      fs.writeFile('denied.bin', 'ff', 'hex', resolve);
    });
    expect(result).toBe(failure);
  });

  it('reads and preserves partial synchronous stdin data', () => {
    const sync = vi
      .spyOn(fixture.bridge, 'sync')
      .mockReturnValueOnce([...Buffer.from('input line\n')]);
    const target = Buffer.alloc(5);
    expect(fs.readSync(0, target)).toBe(5);
    expect(target.toString()).toBe('input');
    expect(fs.readFileSync(0, 'utf8')).toBe(' line\n');
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
