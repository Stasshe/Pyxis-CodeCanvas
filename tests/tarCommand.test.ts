import { TarCommand } from '../src/engine/cmd/global/unixOperations/tar';
import * as tar from 'tar-stream';
import { fileRepository } from '../src/engine/core/fileRepository';

describe('TarCommand createArchive', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.setTimeout(20000);
  });

  test('creates tar with correct header fields', async () => {
    // Arrange: stub getFileFromDB on TarCommand prototype to return a file
    const fileContent = 'hello world';
    jest.spyOn(TarCommand.prototype as any, 'getFileFromDB').mockImplementation(async (...args: any[]) => {
      const path = args[0] as string;
      return {
        path,
        type: 'file',
        content: fileContent,
      } as any;
    });

    // Spy on fileRepository.createFile to capture written archive
    const createFileSpy = jest.spyOn(fileRepository, 'createFile').mockImplementation(async () => {
      return {} as any;
    });

    const cmd = new TarCommand('project', '/projects/project', 'projectId');

    // Act: execute create (-c) for a single file
    console.log('[test] calling execute');
    await cmd.execute(['-c', '-f', 'test.tar', '/src/typescript/hello.ts']);
    console.log('[test] execute returned');

    // Assert: createFile was called and we can examine the archive buffer
    expect(createFileSpy).toHaveBeenCalled();
    const calls = (createFileSpy.mock.calls as any[][]);
    // buffer is last arg (ArrayBuffer)
    const archiveArrayBuffer = calls[0][5] as ArrayBuffer;
    const buf = Buffer.from(archiveArrayBuffer);

    // extract headers using tar-stream
    const extract = tar.extract();
    const headers: any[] = [];

    const finished = new Promise<void>((resolve, reject) => {
      extract.on('entry', (header, stream, next) => {
        headers.push(header);
        // drain the stream
        stream.on('end', () => next());
        stream.resume();
      });
      extract.on('finish', () => resolve());
      extract.on('error', (e) => reject(e));
    });

    extract.end(buf);
    await finished;

    expect(headers.length).toBeGreaterThan(0);
    const h = headers[0];
    // name should not start with '/'
    expect(h.name).toBe('src/typescript/hello.ts');
    // mode should include 0644 (owner rw)
    expect((h.mode & 0o777)).toBe(0o644);
    expect(h.uid).toBe(0);
    expect(h.gid).toBe(0);
    expect(h.uname).toBe('root');
    expect(h.gname).toBe('root');
    expect(h.size).toBe(Buffer.from(fileContent).length);
  });
});
