import * as Comlink from 'comlink';
import { describe, expect, it } from 'vitest';
import { FSError, registerFsErrors } from '@/engine/core/fs/errors';

describe('filesystem errors over Comlink', () => {
  it('preserves errno and path instead of discarding Error properties', async () => {
    registerFsErrors();
    const channel = new MessageChannel();
    const service = {
      async read(): Promise<void> {
        throw new FSError('ENOENT', '/missing');
      },
    };
    Comlink.expose(service, channel.port1);
    const remote = Comlink.wrap<typeof service>(channel.port2);
    try {
      await expect(remote.read()).rejects.toMatchObject({
        name: 'FSError',
        code: 'ENOENT',
        path: '/missing',
      });
    } finally {
      remote[Comlink.releaseProxy]();
      channel.port1.close();
      channel.port2.close();
    }
  });
});
