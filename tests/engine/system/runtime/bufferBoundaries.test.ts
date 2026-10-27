import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import { Process } from '@/engine/system/shell/process';
import { ProcessStdin } from '@/engine/system/terminal/terminalProcessBridge';
import { createCryptoModule } from '@/engine/system/runtime/nodejs/modules/cryptoModule';
import { WorkerStdin } from '@/engine/system/runtime/nodejs/workerStdin';

describe('Buffer boundaries', () => {
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
