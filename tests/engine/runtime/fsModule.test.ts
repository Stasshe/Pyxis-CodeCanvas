import { promisify } from 'node:util';
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
      writeStdout: () => {},
      writeStderr: () => {},
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

  it('supports symbolic links across sync, promise, callback, and dirent APIs', async () => {
    const target = `${root}/target.txt`;
    const link = `${root}/target-link`;
    await fs.promises.writeFile(target, 'target');
    await fs.promises.symlink('target.txt', link);

    expect(fs.lstatSync(link)?.isSymbolicLink()).toBe(true);
    expect(fs.statSync(link)?.isFile()).toBe(true);
    expect(fs.readlinkSync(link)).toBe('target.txt');
    expect(fs.realpathSync.native(link)).toBe(target);
    expect(await fs.promises.readFile(link, 'utf8')).toBe('target');
    expect(await fs.promises.realpath(link)).toBe(target);
    expect(await fs.promises.lstat(link)).toMatchObject({ type: 'symlink' });

    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    const linkEntry = entries.find(entry => entry.name === 'target-link');
    expect(linkEntry?.isSymbolicLink()).toBe(true);
    expect(linkEntry?.isFile()).toBe(false);

    const callbackTarget = await new Promise<string>((resolve, reject) => {
      fs.realpath.native(link, (error, value) => {
        if (error) reject(error);
        else resolve(String(value));
      });
    });
    expect(callbackTarget).toBe(target);
  });

  it('supports callback filesystem methods through util.promisify', async () => {
    const mkdir = promisify(fs.mkdir);
    const rename = promisify(fs.rename);
    const unlink = promisify(fs.unlink);
    const remove = promisify(fs.rm);
    const access = promisify(fs.access);
    const directory = `${root}/callback-api`;
    const source = `${directory}/source.txt`;
    const destination = `${directory}/destination.txt`;

    await mkdir(directory, { recursive: true });
    await fs.promises.writeFile(source, 'contents');
    await fs.promises.access(source, fs.constants.R_OK);
    await access(source, fs.constants.R_OK);
    await rename(source, destination);
    await unlink(destination);
    await remove(directory, { recursive: true });
    await expect(fs.promises.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns BigInt numeric fields for bigint stat options', async () => {
    const path = `${root}/bigint.txt`;
    await fs.promises.writeFile(path, 'data');

    const promiseStat = await fs.promises.stat(path, { bigint: true });
    const callbackStat = await promisify(fs.stat)(path, { bigint: true });
    const syncStat = fs.statSync(path, { bigint: true });
    const promiseLstat = await fs.promises.lstat(path, { bigint: true });

    expect(typeof promiseStat.size).toBe('bigint');
    expect(typeof promiseStat.mode).toBe('bigint');
    expect(typeof promiseStat.mtimeMs).toBe('bigint');
    expect(promiseStat.mtime).toBeInstanceOf(Date);
    expect(promiseStat.isFile()).toBe(true);
    expect(callbackStat.size).toBe(4n);
    expect(typeof syncStat?.size).toBe('bigint');
    expect(typeof promiseLstat.size).toBe('bigint');
  });

  it('tracks open descriptors, positions, truncation, append, and close', async () => {
    const path = `${root}/descriptor.txt`;
    await fs.promises.writeFile(path, 'abcdef');
    const descriptor = fs.openSync(path, 'r+');
    const prefix = Buffer.alloc(2);

    expect(fs.readSync(descriptor, prefix, 0, prefix.byteLength)).toBe(2);
    expect(prefix.toString()).toBe('ab');
    expect(fs.writeSync(descriptor, Buffer.from('Z'), 0, 1, 0)).toBe(1);
    expect(fs.writeSync(descriptor, 'XY')).toBe(2);
    const subview = Buffer.from('xYZx');
    expect(fs.writeSync(descriptor, subview, 1, 2, 6)).toBe(2);
    expect(fs.fstatSync(descriptor).size).toBe(8);
    fs.closeSync(descriptor);
    expect(fs.readFileSync(path, 'utf8')).toBe('ZbXYefYZ');
    expect(() => fs.readSync(descriptor, prefix)).toThrow(
      expect.objectContaining({ code: 'EBADF' })
    );

    const truncateDescriptor = fs.openSync(path, 'w');
    expect(fs.readFileSync(path)).toEqual(Buffer.alloc(0));
    fs.writeSync(truncateDescriptor, 'start');
    fs.closeSync(truncateDescriptor);
    const appendDescriptor = fs.openSync(path, 'a');
    fs.writeSync(appendDescriptor, '!');
    fs.closeSync(appendDescriptor);
    expect(fs.readFileSync(path, 'utf8')).toBe('start!');

    const exclusive = fs.openSync(`${root}/created.txt`, 'wx');
    fs.closeSync(exclusive);
    expect(() => fs.openSync(`${root}/created.txt`, 'wx')).toThrow(
      expect.objectContaining({ code: 'EEXIST' })
    );
  });

  it('opens symlinks against their canonical target and writes stdout bytes', async () => {
    const target = `${root}/opened-target.txt`;
    const link = `${root}/opened-link`;
    await fs.promises.writeFile(target, 'target');
    await fs.promises.symlink('opened-target.txt', link);
    const descriptor = fs.openSync(link, 'r+');
    fs.writeSync(descriptor, 'T', 0);
    fs.closeSync(descriptor);
    expect(fs.readFileSync(target, 'utf8')).toBe('Target');

    const stdout = vi.fn();
    const stderr = vi.fn();
    fs = createFSModule({
      filesystem: fixture.filesystem,
      bridge: fixture.bridge,
      getCwd: () => root,
      writeStdout: stdout,
      writeStderr: stderr,
    });
    expect(fs.writeSync(1, Buffer.from([0, 255]))).toBe(2);
    expect(fs.writeSync(2, 'error')).toBe(5);
    expect(stdout).toHaveBeenCalledWith(Buffer.from([0, 255]));
    expect(stderr).toHaveBeenCalledWith(Buffer.from('error'));
  });

  it('matches numeric open flag behavior and the forty-link limit', async () => {
    const target = `${root}/open-flags.txt`;
    await fs.promises.writeFile(target, 'ok');
    const exclusiveOnly = fs.openSync(target, fs.constants.O_EXCL);
    fs.closeSync(exclusiveOnly);
    expect(() => fs.openSync(target, fs.constants.O_DIRECTORY)).toThrow(
      expect.objectContaining({ code: 'ENOTDIR' })
    );

    let next = 'open-flags.txt';
    for (let index = 39; index >= 0; index -= 1) {
      const link = `link-${index}`;
      await fs.promises.symlink(next, `${root}/${link}`);
      next = link;
    }
    const descriptor = fs.openSync(`${root}/${next}`, 'r');
    fs.closeSync(descriptor);

    await fs.promises.symlink(next, `${root}/link-40`);
    expect(() => fs.openSync(`${root}/link-40`, 'r')).toThrow(
      expect.objectContaining({ code: 'ELOOP' })
    );
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
