import git from 'isomorphic-git';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MergeConflictDetector,
  saveResolvedConflict,
} from '@/engine/cmd/global/gitOperations/mergeConflictDetector';
import { WorkerGitCommands } from '@/engine/cmd/global/gitOperations/worker';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs, repositoryPath } from '@/engine/core/fs/git';

describe('Git with the worker filesystem', () => {
  const root = '/tmp/repo';
  let core: FsCore;
  let commands: WorkerGitCommands;

  beforeEach(async () => {
    core = new FsCore();
    commands = new WorkerGitCommands(core, root);
    await commands.init();
  });

  it('commits files directly and restores branch content', async () => {
    await core.writeFile(`${root}/readme.md`, 'initial\n');
    await commands.add(`${root}/readme.md`);
    await commands.commit('Initial content');
    expect(await commands.status()).toContain('working tree clean');
    expect(await commands.getHeadFileContent(`${root}/readme.md`)).toEqual(
      new TextEncoder().encode('initial\n')
    );

    await commands.checkout('feature', true);
    await core.writeFile(`${root}/readme.md`, 'feature\n');
    await commands.add('readme.md');
    expect(await commands.getStagedFileContent(`${root}/readme.md`)).toEqual(
      new TextEncoder().encode('feature\n')
    );
    await commands.commit('Feature content');
    await commands.checkout('main');
    expect(await core.readText(`${root}/readme.md`)).toBe('initial\n');
    await commands.checkout('feature');
    expect(await core.readText(`${root}/readme.md`)).toBe('feature\n');
  });

  it('preserves binary data and untracked files during a hard reset', async () => {
    const bytes = new Uint8Array([0, 255, 128, 10, 13]);
    await core.writeFile(`${root}/image.bin`, bytes);
    await commands.add('image.bin');
    await commands.commit('Binary content');
    const fs = createGitFs(core);
    const oid = await git.resolveRef({ fs, dir: root, ref: 'HEAD' });
    const { blob } = await git.readBlob({ fs, dir: root, oid, filepath: 'image.bin' });
    expect(blob).toEqual(bytes);

    await core.writeFile(`${root}/image.bin`, new Uint8Array([42]));
    await core.writeFile(`${root}/draft.txt`, 'keep this draft');
    await commands.reset({ hard: true });
    expect(Array.from(await core.readFile(`${root}/image.bin`))).toEqual(Array.from(bytes));
    expect(await core.readText(`${root}/draft.txt`)).toBe('keep this draft');
    expect(await commands.getCurrentBranch()).toBe('main');
  });

  it('returns bytes by default and honors requested Node encodings', async () => {
    const source = new Uint8Array([99, 0, 255, 128, 88]);
    const view = source.subarray(1, 4);
    const path = `${root}/encoded.bin`;
    await core.writeFile(path, view);
    const fs = createGitFs(core);

    expect(await fs.promises.readFile(path)).toEqual(view);
    expect(await fs.promises.readFile(path, 'base64')).toBe('AP+A');
    expect(await fs.promises.readFile(path, { encoding: 'hex' })).toBe('00ff80');
    await expect(fs.promises.readFile(path, 'invalid-encoding')).rejects.toThrow(
      'Unknown encoding'
    );
  });

  it('returns exact Git content bytes and raw show output for misleading extensions and BOMs', async () => {
    const backing = new Uint8Array([9, 0, 255, 128, 9]);
    const invalidText = backing.subarray(1, 4);
    const bom = new Uint8Array([239, 187, 191, 104, 105]);
    await core.writeFile(`${root}/binary.txt`, invalidText);
    await core.writeFile(`${root}/bom.js`, bom);
    await commands.add('.');
    expect(await commands.getStagedFileContent('binary.txt')).toEqual(invalidText);
    expect(await commands.getStagedFileContent('bom.js')).toEqual(bom);
    await commands.commit('Exact bytes');
    const fs = createGitFs(core);
    const oid = await git.resolveRef({ fs, dir: root, ref: 'HEAD' });
    for (const [path, bytes] of [
      ['binary.txt', invalidText],
      ['bom.js', bom],
    ] as const) {
      expect(await commands.getHeadFileContent(path)).toEqual(bytes);
      expect(await commands.getFileContentAtCommit(oid, path)).toEqual(bytes);
      expect(await commands.show([`HEAD:${path}`])).toEqual(bytes);
    }
    expect(await commands.getHeadFileContent('missing.txt')).toBeNull();
    expect(await commands.getStagedFileContent('missing.txt')).toBeNull();
    await core.writeFile(`${root}/.git/refs/heads/main`, `${'f'.repeat(40)}\n`);
    await expect(commands.getHeadFileContent('binary.txt')).rejects.toThrow();
  });

  it('preserves binary conflict versions and saves only the selected exact bytes', async () => {
    const path = `${root}/conflict.txt`;
    await core.writeFile(path, new Uint8Array([0, 1]));
    await commands.add('conflict.txt');
    await commands.commit('Base');
    await commands.checkout('feature', true);
    const backing = new Uint8Array([9, 0, 255, 128, 9]);
    const theirs = backing.subarray(1, 4);
    await core.writeFile(path, theirs);
    await commands.add('conflict.txt');
    await commands.commit('Theirs');
    await commands.checkout('main');
    const ours = new Uint8Array([0, 2]);
    await core.writeFile(path, ours);
    await commands.add('conflict.txt');
    await commands.commit('Ours');
    const fs = createGitFs(core);
    const head = await git.resolveRef({ fs, dir: root, ref: 'HEAD' });
    const reporter = vi.fn(async () => {});
    commands.configureConflictReporter(reporter);
    const detector = new MergeConflictDetector(fs, root);
    const conflicts = await detector.detectConflicts('main', 'feature');
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    expect(conflict.binary).toEqual({
      base: new Uint8Array([0, 1]),
      ours,
      theirs,
      resolved: ours,
    });
    expect(await commands.merge('feature')).toContain('CONFLICT');
    expect(reporter).toHaveBeenCalledOnce();
    expect(await core.readFile(path)).toEqual(ours);
    expect(await commands.getHeadFileContent('conflict.txt')).toEqual(ours);
    expect(await git.resolveRef({ fs, dir: root, ref: 'HEAD' })).toBe(head);
    if (!conflict.binary) throw new Error('Expected binary conflict.');
    conflict.binary.resolved = conflict.binary.theirs;
    await saveResolvedConflict(core, conflict);
    expect(await core.readFile(path)).toEqual(theirs);
    await commands.add(path);
    expect(await commands.getStagedFileContent(path)).toEqual(theirs);
    conflict.binary.resolved = new Uint8Array();
    await saveResolvedConflict(core, conflict);
    expect(await core.readFile(path)).toEqual(new Uint8Array());
    conflict.binary.resolved = null;
    await saveResolvedConflict(core, conflict);
    expect(await core.exists(path)).toBe(false);
    await commands.add(path);
    expect(await commands.getStagedFileContent(path)).toBeNull();
  });

  it('keeps text bytes opaque when another conflict version is binary', async () => {
    const path = `${root}/mixed.txt`;
    const base = new Uint8Array([0, 255]);
    const ours = new Uint8Array([239, 187, 191, 111, 117, 114, 115]);
    await core.writeFile(path, base);
    await commands.add(path);
    await commands.commit('Base');
    await commands.checkout('feature', true);
    await core.writeFile(path, new Uint8Array([0, 128]));
    await commands.add(path);
    await commands.commit('Theirs');
    await commands.checkout('main');
    await core.writeFile(path, ours);
    await commands.add(path);
    await commands.commit('Ours');
    const detector = new MergeConflictDetector(createGitFs(core), root);
    const [conflict] = await detector.detectConflicts('main', 'feature');
    expect(conflict.binary?.ours).toEqual(ours);
    await saveResolvedConflict(core, conflict);
    expect(await core.readFile(path)).toEqual(ours);
  });

  it('preserves BOM text in conflict resolver content and exposes detection errors', async () => {
    const path = `${root}/conflict.txt`;
    await core.writeFile(path, '\uFEFFbase\n');
    await commands.add('conflict.txt');
    await commands.commit('Base');
    await commands.checkout('feature', true);
    await core.writeFile(path, '\uFEFFtheirs\n');
    await commands.add('conflict.txt');
    await commands.commit('Theirs');
    await commands.checkout('main');
    await core.writeFile(path, '\uFEFFours\n');
    await commands.add('conflict.txt');
    await commands.commit('Ours');
    const detector = new MergeConflictDetector(createGitFs(core), root);
    const conflicts = await detector.detectConflicts('main', 'feature');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      baseContent: '\uFEFFbase\n',
      oursContent: '\uFEFFours\n',
      theirsContent: '\uFEFFtheirs\n',
      resolvedContent: '\uFEFFours\n',
    });
    await expect(detector.detectConflicts('main', 'missing')).rejects.toThrow();
  });

  it('normalizes repository paths and rejects paths outside the root', async () => {
    expect(repositoryPath(root, '.')).toBe('.');
    expect(repositoryPath(root, 'file.ts')).toBe('file.ts');
    expect(repositoryPath(root, `${root}/src/file.ts`)).toBe('src/file.ts');
    expect(repositoryPath(root, './src/../file.ts')).toBe('file.ts');
    expect(repositoryPath(root, root)).toBe('.');
    expect(repositoryPath('/', '/src/file.ts')).toBe('src/file.ts');
    expect(() => repositoryPath(root, '/tmp/repository/file.ts')).toThrow('outside repository');
    expect(() => repositoryPath(root, '../outside.ts')).toThrow('outside repository');
    await expect(commands.getFileContentAtCommit('HEAD', '/tmp/outside.ts')).rejects.toThrow(
      'outside repository'
    );
  });

  it('removes empty directories while preserving nonempty directories', async () => {
    const fs = createGitFs(core);
    const directory = `${root}/nested`;
    await core.mkdir(directory);
    await core.writeFile(`${directory}/draft.txt`, 'keep');
    await expect(fs.promises.rmdir(directory)).rejects.toMatchObject({ code: 'ENOTEMPTY' });
    expect(await core.readText(`${directory}/draft.txt`)).toBe('keep');
    await fs.promises.unlink(`${directory}/draft.txt`);
    await fs.promises.rmdir(directory);
    expect(await core.exists(directory)).toBe(false);
  });
});
