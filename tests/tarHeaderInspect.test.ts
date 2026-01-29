import { TarCommand } from '../src/engine/cmd/global/unixOperations/tar';
import { fileRepository } from '../src/engine/core/fileRepository';

function readString(buf: Buffer, start: number, length: number) {
  return buf.slice(start, start + length).toString('utf8').replace(/\0+$/, '');
}

describe('Tar header inspection', () => {
  test('inspect first 512 bytes of generated tar header', async () => {
    jest.restoreAllMocks();
    jest.setTimeout(20000);

    // Mock getFileFromDB to return a simple file
    jest.spyOn(TarCommand.prototype as any, 'getFileFromDB').mockImplementation(async (...args: any[]) => ({
      path: args[0] as string,
      type: 'file',
      content: 'hello',
    } as any));

    let capturedArrayBuffer: ArrayBuffer | undefined;
    jest.spyOn(fileRepository, 'createFile').mockImplementation(async (...args: any[]) => {
      capturedArrayBuffer = args[5] as ArrayBuffer | undefined;
      return {} as any;
    });

    const cmd = new TarCommand('project', '/projects/project', 'pid');

    console.log('[test-inspect] calling execute');
    await cmd.execute(['-c', '-f', 'test.tar', '/src/typescript/hello.ts']);
    console.log('[test-inspect] execute returned');

    expect(capturedArrayBuffer).toBeDefined();
    const buf = Buffer.from(capturedArrayBuffer!);
    const header = buf.slice(0, 512);

    // Decode key fields
    const name = readString(header, 0x00, 100);
    const mode = readString(header, 0x64, 8);
    const uid = readString(header, 0x6c, 8);
    const gid = readString(header, 0x74, 8);
    const size = readString(header, 0x7c, 12);
    const mtime = readString(header, 0x88, 12);
    const chksum = readString(header, 0x94, 8);
    const typeflag = readString(header, 0x9c, 1);
    const magic = readString(header, 0x101, 6);

    // Log for diagnosis
    // eslint-disable-next-line no-console
    console.log('tar header dump:');
    // eslint-disable-next-line no-console
    console.log({ name, mode, uid, gid, size, mtime, chksum, typeflag, magic });

    // Basic expectations: name exists and mode/uid/gid/checksum non-empty
    expect(name).toBeTruthy();
    expect(mode.trim()).not.toBe('');
    expect(uid.trim()).not.toBe('');
    expect(gid.trim()).not.toBe('');
    expect(chksum.trim()).not.toBe('');
  });
});
