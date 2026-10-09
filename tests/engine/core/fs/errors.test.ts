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

  it('preserves nested cleanup causes over Comlink', async () => {
    registerFsErrors();
    const channel = new MessageChannel();
    const cause = new AggregateError(
      [
        new Error('sidecar removal failed'),
        new AggregateError([new Error('restore failed')], 'rollback failed'),
      ],
      'directory cleanup failed'
    );
    const service = {
      async remove(): Promise<void> {
        throw new FSError('EIO', '/tree', cause);
      },
    };
    Comlink.expose(service, channel.port1);
    const remote = Comlink.wrap<typeof service>(channel.port2);
    try {
      await expect(remote.remove()).rejects.toMatchObject({
        name: 'FSError',
        message:
          'EIO: /tree: directory cleanup failed [sidecar removal failed; rollback failed [restore failed]]',
        code: 'EIO',
        path: '/tree',
        cause: {
          name: 'AggregateError',
          message: 'directory cleanup failed',
          errors: [
            { name: 'Error', message: 'sidecar removal failed' },
            {
              name: 'AggregateError',
              message: 'rollback failed',
              errors: [{ name: 'Error', message: 'restore failed' }],
            },
          ],
        },
      });
    } finally {
      remote[Comlink.releaseProxy]();
      channel.port1.close();
      channel.port2.close();
    }
  });
});
