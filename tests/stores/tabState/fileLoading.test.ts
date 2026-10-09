import { getTestFs, resetTestFs } from '@tests/_helpers/testFs';
import { beforeEach, describe, expect, it } from 'vitest';
import { prepareFileForTab } from '@/stores/tabState/fileLoading';

const rootPath = '/tmp/open-files';

describe('file tab loading', () => {
  beforeEach(async () => {
    resetTestFs();
    await getTestFs().mkdir(rootPath);
  });

  it('opens metadata-only misleading text filenames as exact binary bytes', async () => {
    const path = `${rootPath}/image.txt`;
    const bytes = Uint8Array.from([0xff, 0, 0x81]);
    await getTestFs().writeFile(path, bytes);
    const prepared = await prepareFileForTab({ path, name: 'image.txt' }, 'editor');
    expect(prepared.kind).toBe('binary');
    expect(prepared.file.isBufferArray).toBe(true);
    expect(prepared.file.bufferContent).toEqual(bytes.buffer);
    expect(prepared.file.content).toBeUndefined();
  });

  it('loads the current buffer when splitting a metadata-only binary file', async () => {
    const path = `${rootPath}/asset.bin`;
    const bytes = Uint8Array.from([3, 0, 4]);
    await getTestFs().writeFile(path, bytes);
    const prepared = await prepareFileForTab(
      { path, name: 'asset.bin', isBufferArray: true },
      'editor'
    );
    expect(prepared.kind).toBe('binary');
    expect(prepared.file.bufferContent).toEqual(bytes.buffer);
  });

  it('keeps UTF-8 BOM through text tab loading', async () => {
    const path = `${rootPath}/source.ts`;
    await getTestFs().writeFile(path, Uint8Array.from([0xef, 0xbb, 0xbf, 65]));
    const prepared = await prepareFileForTab({ path, name: 'source.ts' }, 'editor');
    expect(prepared.kind).toBe('editor');
    expect(prepared.file.content).toBe('\ufeffA');
  });
});
