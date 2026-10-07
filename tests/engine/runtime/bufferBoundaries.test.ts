import { Buffer } from 'buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Process } from '@/engine/cmd/shell/process';
import { ProcessStdin } from '@/engine/cmd/terminalProcessBridge';
import { createCryptoModule } from '@/engine/runtime/nodejs/modules/cryptoModule';
import { createHTTPModule } from '@/engine/runtime/nodejs/modules/httpModule';
import { WorkerStdin } from '@/engine/runtime/nodejs/workerStdin';

describe('Buffer boundaries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns Buffer values from crypto APIs', async () => {
    const crypto = createCryptoModule();
    const derivedKey = await new Promise<Buffer>(resolve => {
      crypto.pbkdf2('password', 'salt', 1, 12, 'sha256', (_error, key) => resolve(key));
    });

    expect(Buffer.isBuffer(crypto.createHash('sha256').update('value').digest())).toBe(true);
    expect(Buffer.isBuffer(crypto.randomBytes(8))).toBe(true);
    expect(Buffer.isBuffer(derivedKey)).toBe(true);
    expect(derivedKey).toHaveLength(12);
    expect(Buffer.isBuffer(crypto.pbkdf2Sync('password', 'salt', 1, 7, 'sha256'))).toBe(true);
    expect(crypto.pbkdf2Sync('password', 'salt', 1, 7, 'sha256')).toHaveLength(7);
    expect(Buffer.isBuffer(crypto.scryptSync('password', 'salt', 5))).toBe(true);
    expect(crypto.scryptSync('password', 'salt', 5)).toHaveLength(5);
  });

  it('emits Buffer chunks from HTTP responses', () => {
    const { IncomingMessage } = createHTTPModule();
    const message = new IncomingMessage();
    const chunks: unknown[] = [];
    message.on('data', chunk => chunks.push(chunk));

    const utf8 = Buffer.from('日本語');
    message._addData(utf8.subarray(0, 2));
    message._addData(utf8.subarray(2));

    expect(chunks.every(Buffer.isBuffer)).toBe(true);
    expect(message.getText()).toBe('日本語');
  });

  it('preserves binary response subviews without decoding', () => {
    const { IncomingMessage } = createHTTPModule();
    const message = new IncomingMessage();
    const chunks: Buffer[] = [];
    message.on('data', (chunk: Buffer) => chunks.push(chunk));
    const view = Buffer.from([9, 0, 255, 128, 9]).subarray(1, 4);
    message._addData(view);
    expect(Buffer.concat(chunks)).toEqual(view);
  });

  it('preserves Buffer bytes in HTTP request bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: { forEach: vi.fn() },
      body: undefined,
    });
    vi.stubGlobal('fetch', fetchMock);
    const { ClientRequest } = createHTTPModule();
    const request = new ClientRequest({
      protocol: 'https:',
      hostname: 'example.test',
      method: 'POST',
    });
    request.write(Buffer.from([9, 0, 255, 9]).subarray(1, 3));

    await new Promise<void>(resolve => {
      request.on('response', () => resolve());
    });

    const requestBody = fetchMock.mock.calls[0][1].body as Uint8Array;
    expect([...requestBody]).toEqual([0, 255]);
  });

  it('preserves Buffer bytes written to shell output', () => {
    const process = new Process();
    const chunks: Buffer[] = [];
    process.stdout.on('data', chunk => chunks.push(chunk));

    process.writeStdout(Buffer.from([0, 255]));

    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 255]));
  });

  it('preserves buffered input queued before a worker stdin listener attaches', async () => {
    const stdin = new WorkerStdin(
      () => {},
      () => {},
      () => {}
    );
    stdin.submit('日本語\n');
    const chunk = new Promise<Buffer>(resolve => {
      stdin.on('data', resolve);
    });

    await expect(chunk).resolves.toEqual(Buffer.from('日本語\n'));
  });

  it('submits terminal input as Buffer', () => {
    const stdin = new ProcessStdin();
    let chunk: Buffer | undefined;
    stdin.on('data', value => {
      chunk = value;
    });
    stdin._active = true;

    stdin.submitLine('日本語');

    expect(Buffer.isBuffer(chunk)).toBe(true);
    expect(chunk?.toString()).toBe('日本語\n');
  });
});
