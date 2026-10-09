import { promisify } from 'node:util';
import { Buffer } from 'buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFSModule, type FsDirent } from '@/engine/runtime/nodejs/modules/fsModule';
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

  it('reports missing paths as false through the callback exists API', async () => {
    await fs.promises.writeFile(`${root}/present.txt`, 'present');

    const present = await new Promise<boolean>(resolve =>
      fs.exists(`${root}/present.txt`, resolve)
    );
    const missing = await new Promise<boolean>(resolve =>
      fs.exists(`${root}/missing.txt`, resolve)
    );

    expect(present).toBe(true);
    expect(missing).toBe(false);
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

  it('normalizes Buffer and file URL paths and exposes common filesystem operations', async () => {
    const source = `${root}/source.txt`;
    const copied = `${root}/copied.txt`;
    const directory = `${root}/empty-directory`;
    await fs.promises.writeFile(source, 'copied');
    await fs.promises.copyFile(Buffer.from(source), new URL(`file://${copied}`));
    expect(fs.readFileSync(copied, 'utf8')).toBe('copied');
    fs.writeFileSync(`${root}/exclusive.txt`, 'keep');
    expect(() =>
      fs.copyFileSync(source, `${root}/exclusive.txt`, fs.constants.COPYFILE_EXCL)
    ).toThrow(expect.objectContaining({ code: 'EEXIST' }));
    expect(fs.readFileSync(`${root}/exclusive.txt`, 'utf8')).toBe('keep');

    const raceDestination = `${root}/exclusive-race.txt`;
    const raceResults = await Promise.allSettled([
      fs.promises.copyFile(source, raceDestination, fs.constants.COPYFILE_EXCL),
      fs.promises.copyFile(source, raceDestination, fs.constants.COPYFILE_EXCL),
    ]);
    expect(raceResults.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(raceResults.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(fs.readFileSync(raceDestination, 'utf8')).toBe('copied');

    await fs.promises.mkdir(directory);
    await fs.promises.rmdir(directory);
    const temporary = fs.mkdtempSync(`${root}/tmp-`);
    expect(fs.statSync(temporary)?.isDirectory()).toBe(true);
    fs.rmdirSync(temporary);
  });

  it('supports callback descriptor operations', async () => {
    const path = `${root}/callback-descriptor.txt`;
    const descriptor = await promisify(fs.open)(path, 'w+');
    const data = Buffer.from('callback');
    await new Promise<void>((resolve, reject) => {
      fs.write(descriptor, data, 0, data.length, 0, error => {
        if (error) reject(error);
        else resolve();
      });
    });
    await promisify(fs.close)(descriptor);
    expect(fs.readFileSync(path, 'utf8')).toBe('callback');
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
    expect(promiseStat.mode).toBe(BigInt(fs.statSync(path)?.mode ?? 0));
    expect(typeof promiseStat.mtimeMs).toBe('bigint');
    expect(promiseStat.mtime).toBeInstanceOf(Date);
    expect(promiseStat.isFile()).toBe(true);
    expect(callbackStat.size).toBe(4n);
    expect(typeof syncStat?.size).toBe('bigint');
    expect(typeof promiseLstat.size).toBe('bigint');
  });

  it('changes file permissions through chmod APIs and follows symbolic links', async () => {
    const path = `${root}/permissions.txt`;
    const link = `${root}/permissions-link`;
    await fs.promises.writeFile(path, 'permissions');
    await fs.promises.symlink('permissions.txt', link);

    expect(() => fs.accessSync(path, fs.constants.X_OK)).toThrow(
      expect.objectContaining({ code: 'EACCES', errno: -13, syscall: 'access', path })
    );
    fs.chmodSync(path, 0o100755);
    expect(fs.statSync(path)?.mode).toBe(0o100755);
    fs.accessSync(path, fs.constants.X_OK);

    await fs.promises.chmod(link, '0640');
    expect(fs.statSync(path)?.mode).toBe(0o100640);
    expect(fs.lstatSync(link)?.mode).toBe(0o120777);
    await expect(fs.promises.chmod(path, -1)).rejects.toMatchObject({
      code: 'ERR_OUT_OF_RANGE',
    });
    expect(() => Reflect.apply(fs.chmod, fs, [path, null, () => {}])).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
    expect(() => Reflect.apply(fs.chmod, fs, [path, 0o600])).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
  });

  it('supports descriptor chmod, callback errors, and creation modes', async () => {
    const path = `${root}/descriptor-permissions.txt`;
    fs.writeFileSync(path, 'permissions', { mode: 0o777 });
    expect(fs.statSync(path)?.mode).toBe(0o100755);
    const descriptor = fs.openSync(path, 'r');
    fs.fchmodSync(descriptor, 0o640);
    expect(fs.fstatSync(descriptor).mode).toBe(0o100640);
    await promisify(fs.fchmod)(descriptor, 0o600);
    expect(fs.fstatSync(descriptor).mode).toBe(0o100600);
    fs.closeSync(descriptor);
    expect(() => fs.fchmodSync(descriptor, 0o644)).toThrow(
      expect.objectContaining({ code: 'EBADF', syscall: 'fchmod' })
    );
    await expect(promisify(fs.fchmod)(descriptor, 0o644)).rejects.toMatchObject({
      code: 'EBADF',
      errno: -9,
      syscall: 'fchmod',
    });

    const directory = `${root}/mode-directory`;
    await fs.promises.mkdir(directory, { mode: '0777' });
    expect(fs.statSync(directory)?.mode).toBe(0o40755);

    const callbackError = await new Promise<Error | null>(resolve => {
      fs.chmod(`${root}/missing-permissions.txt`, 0o600, error => resolve(error));
    });
    expect(callbackError).toMatchObject({
      code: 'ENOENT',
      syscall: 'chmod',
      path: `${root}/missing-permissions.txt`,
    });

    const openedPath = `${root}/mode-open.txt`;
    const openedDescriptor = fs.openSync(openedPath, 'wx', 0o777);
    expect(fs.fstatSync(openedDescriptor).mode).toBe(0o100755);
    fs.closeSync(openedDescriptor);

    const appendedPath = `${root}/mode-append.txt`;
    await fs.promises.appendFile(appendedPath, 'created', { mode: 0o777 });
    expect(fs.statSync(appendedPath)?.mode).toBe(0o100755);
    await fs.promises.chmod(appendedPath, 0o600);
    await fs.promises.appendFile(appendedPath, 'updated', { mode: 0o777 });
    expect(fs.statSync(appendedPath)?.mode).toBe(0o100600);

    const streamPath = `${root}/mode-stream.txt`;
    const stream = fs.createWriteStream(streamPath, { mode: '0750' });
    await new Promise<void>((resolve, reject) => {
      stream.once('error', reject);
      stream.end(resolve);
    });
    expect(fs.statSync(streamPath)?.mode).toBe(0o100750);
  });

  it('supports directory handles, Dirent reads, and iterator closure', async () => {
    const directory = `${root}/directory-handle`;
    await fs.promises.mkdir(directory);
    await fs.promises.writeFile(`${directory}/first`, 'first');
    await fs.promises.mkdir(`${directory}/nested`);

    const syncDirectory = fs.opendirSync(directory);
    const firstEntry = syncDirectory.readSync();
    expect(firstEntry?.parentPath).toBe(directory);
    expect(firstEntry?.isFile()).toBe(true);
    expect(syncDirectory.readSync()?.isDirectory()).toBe(true);
    expect(syncDirectory.readSync()).toBeNull();
    syncDirectory.closeSync();
    expect(() => syncDirectory.readSync()).toThrow(
      expect.objectContaining({ code: 'ERR_DIR_CLOSED' })
    );
    expect(() => syncDirectory.closeSync()).toThrow(
      expect.objectContaining({ code: 'ERR_DIR_CLOSED' })
    );

    const bufferDirectory = fs.opendirSync(directory, { encoding: 'buffer' });
    expect(Buffer.isBuffer(bufferDirectory.readSync()?.name)).toBe(true);
    bufferDirectory.closeSync();

    const pendingDirectory = await fs.promises.opendir(directory);
    const pendingRead = pendingDirectory.read();
    const nextPendingRead = pendingDirectory.read();
    expect(() => pendingDirectory.readSync()).toThrow(
      expect.objectContaining({ code: 'ERR_DIR_CONCURRENT_OPERATION' })
    );
    await pendingDirectory.close();
    const pendingEntries = await Promise.all([pendingRead, nextPendingRead]);
    expect(pendingEntries.every(entry => entry !== null)).toBe(true);
    expect(new Set(pendingEntries.map(entry => String(entry?.name))).size).toBe(2);
    await expect(pendingDirectory.read()).rejects.toMatchObject({ code: 'ERR_DIR_CLOSED' });

    const callbackDirectory = await new Promise<Awaited<ReturnType<typeof fs.promises.opendir>>>(
      (resolve, reject) => {
        fs.opendir(directory, (error, value) => {
          if (error) reject(error);
          else if (value) resolve(value);
          else reject(new Error('opendir callback returned no directory'));
        });
      }
    );
    const callbackEntry = await new Promise<FsDirent | null>(resolve => {
      callbackDirectory.read((error, value) => resolve(error ? null : (value ?? null)));
    });
    expect(callbackEntry?.isFile()).toBe(true);
    await new Promise<void>((resolve, reject) => {
      callbackDirectory.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });

    const iteratorDirectory = await fs.promises.opendir(directory);
    const names: string[] = [];
    for await (const entry of iteratorDirectory) {
      names.push(String(entry.name));
      break;
    }
    expect(names).toContain('first');
    expect(names).toHaveLength(1);
    await expect(iteratorDirectory.read()).rejects.toMatchObject({ code: 'ERR_DIR_CLOSED' });

    expect(() => Reflect.apply(fs.opendir, fs, [directory])).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
  });

  it('treats /dev/null as a character device for file and descriptor operations', async () => {
    const path = '/dev/null';
    const stat = fs.statSync(path);

    expect(stat?.isCharacterDevice()).toBe(true);
    expect(stat?.isFile()).toBe(false);
    expect(stat?.mode).toBe(0o20666);
    const nullEntry = fs
      .readdirSync('/dev', { withFileTypes: true })
      .find(entry => typeof entry !== 'string' && !Buffer.isBuffer(entry) && entry.name === 'null');
    expect(nullEntry?.isCharacterDevice()).toBe(true);
    expect(nullEntry?.isFile()).toBe(false);
    expect(fs.readFileSync(path)).toEqual(Buffer.alloc(0));
    await fs.promises.writeFile(path, 'discarded');
    fs.writeFileSync(path, 'also discarded');
    expect(fs.readFileSync(path)).toEqual(Buffer.alloc(0));

    const setFile = vi.spyOn(fixture.filesystem, 'setFileSync');
    const writeRange = vi.spyOn(fixture.filesystem, 'writeRangeSync');
    const writeOnly = fs.openSync(path, 'w');
    expect(setFile).not.toHaveBeenCalled();
    expect(fs.fstatSync(writeOnly).isCharacterDevice()).toBe(true);
    expect(fs.writeSync(writeOnly, 'discarded')).toBe('discarded'.length);
    expect(writeRange).toHaveBeenLastCalledWith(path, expect.any(Uint8Array), null, false);
    const buffer = Buffer.alloc(8);
    expect(() => fs.readSync(writeOnly, buffer)).toThrow(
      expect.objectContaining({ code: 'EBADF' })
    );
    fs.closeSync(writeOnly);

    const descriptor = fs.openSync(path, 'r+');
    expect(fs.fstatSync(descriptor).isCharacterDevice()).toBe(true);
    expect(fs.readSync(descriptor, buffer)).toBe(0);
    fs.closeSync(descriptor);
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

  it('keeps exclusive create when the file appears between lstat and stat', async () => {
    const path = `${root}/exclusive-race.txt`;
    await fs.promises.writeFile(path, 'created concurrently');
    vi.spyOn(fixture.filesystem, 'lstatSync').mockReturnValue(null);
    const writeRange = vi.spyOn(fixture.filesystem, 'writeRangeSync');

    expect(() => fs.openSync(path, 'wx')).toThrow(expect.objectContaining({ code: 'EEXIST' }));
    expect(writeRange).not.toHaveBeenCalled();
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

  it('reads stdin through EOF and continues reading descriptors at their current position', async () => {
    await fs.promises.writeFile('descriptor-input.txt', 'abcdef');
    const descriptor = fs.openSync('descriptor-input.txt', 'r');
    const prefix = Buffer.alloc(2);
    expect(fs.readSync(descriptor, prefix)).toBe(2);
    expect(prefix.toString()).toBe('ab');
    expect(fs.readFileSync(descriptor, 'utf8')).toBe('cdef');
    fs.closeSync(descriptor);

    const sync = vi
      .spyOn(fixture.bridge, 'sync')
      .mockReturnValueOnce([...Buffer.from('input line\n')])
      .mockReturnValueOnce([...Buffer.from('tail')])
      .mockReturnValueOnce([]);
    sync.mockClear();
    const target = Buffer.alloc(5);
    expect(fs.readSync(0, target)).toBe(5);
    expect(target.toString()).toBe('input');
    expect(fs.readFileSync(0, 'utf8')).toBe(' line\ntail');
    expect(sync).toHaveBeenCalledTimes(3);

    sync
      .mockReset()
      .mockReturnValueOnce([...Buffer.from('device-')])
      .mockReturnValueOnce([...Buffer.from('stdin')])
      .mockReturnValueOnce([]);
    expect(fs.readFileSync('/dev/stdin', 'utf8')).toBe('device-stdin');
    expect(sync).toHaveBeenCalledTimes(3);
  });
});
