import { DuCommand } from '../src/engine/cmd/global/unixOperations/du';
import { SortCommand } from '../src/engine/cmd/global/unixOperations/sort';
import { ZipCommand } from '../src/engine/cmd/global/unixOperations/zip';
import { UnzipCommand } from '../src/engine/cmd/global/unixOperations/unzip';
import { fileRepository } from '../src/engine/core/fileRepository';

const now = new Date();

const mockFiles = [
  { id: '1', projectId: 'p', path: '/src/a.txt', name: 'a.txt', type: 'file' as const, content: 'hello', createdAt: now, updatedAt: now },
  { id: '2', projectId: 'p', path: '/src/dir/b.txt', name: 'b.txt', type: 'file' as const, content: 'abcd', createdAt: now, updatedAt: now },
  { id: '3', projectId: 'p', path: '/src/list.txt', name: 'list.txt', type: 'file' as const, content: '3\n1\n2\n', createdAt: now, updatedAt: now },
];

class TestDu extends DuCommand {
  async cachedGetFilesByPrefix(prefix: string) {
    const normalized = prefix === '' ? '/' : prefix;
    return mockFiles.filter(f => f.path.startsWith(normalized));
  }
  async getFileFromDB(relativePath: string) {
    return mockFiles.find(f => f.path === relativePath);
  }
}

class TestSort extends SortCommand {
  async getFileFromDB(relativePath: string) {
    return mockFiles.find(f => f.path === relativePath);
  }
}

describe('Unix extra commands', () => {
  it('du returns sizes and total', async () => {
    const du = new TestDu('p', '/projects/p', 'p');
    const out = await du.execute(['-s', '.']);
    expect(out).toMatch(/\/projects/); // path shown
    expect(out).toMatch(/\d+/);
  });

  it('sort sorts numerically and uniquely', async () => {
    const sort = new TestSort('p', '/projects/p', 'p');
    sort.setStdin('3\n1\n2\n1\n');
    const out = await sort.execute(['-n', '-u']);
    expect(out.trim()).toBe('1\n2\n3');
  });

  it('zip creates archive and unzip extracts files', async () => {
    const zip = new ZipCommand('p', '/projects/p', 'p');
    const unzip = new UnzipCommand('p', '/projects/p', 'p');

    // stub out fileRepository.createFile to capture archive buffer
    const created: any[] = [];
    const origCreate = fileRepository.createFile.bind(fileRepository);
    jest.spyOn(fileRepository, 'createFile').mockImplementation(async (projectId: string, path: string, content: string, type: any, isBufferArray?: boolean, bufferContent?: ArrayBuffer) => {
      created.push({ projectId, path, isBufferArray, bufferContent });
      // call original to satisfy other behavior, but avoid real DB by returning a minimal object
      return { id: 'z', projectId, path, name: path.split('/').pop() || '', content, type, createdAt: new Date(), updatedAt: new Date(), isBufferArray: !!isBufferArray, bufferContent } as any;
    });

    // create a zip containing /src/a.txt and /src/dir/b.txt
    await zip.execute(['archive.zip', '/src/a.txt', '/src/dir/b.txt']);

    expect(created.length).toBeGreaterThan(0);
    const archiveBuf = created[0].bufferContent as ArrayBuffer;
    expect(archiveBuf.byteLength).toBeGreaterThan(0);

    // now call unzip.extract with the buffer and capture createFilesBulk calls
    const createdEntries: any[] = [];
    jest.spyOn(fileRepository, 'createFilesBulk').mockImplementation(async (projectId: string, entries: any[]) => {
      createdEntries.push(...entries);
      return [] as any;
    });

    const res = await unzip.extract('archive.zip', '/extracted', archiveBuf);
    expect(res).toContain('Unzipped');
    expect(createdEntries.length).toBeGreaterThan(0);
    expect(createdEntries.some(e => e.path.endsWith('a.txt'))).toBe(true);

    // restore mocks
    (fileRepository.createFile as jest.Mock).mockRestore();
    (fileRepository.createFilesBulk as jest.Mock).mockRestore();
  }, 15000);
});
