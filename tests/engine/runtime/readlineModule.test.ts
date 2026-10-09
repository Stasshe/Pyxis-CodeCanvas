import { describe, expect, it } from 'vitest';
import {
  createReadlineModule,
  createReadlinePromisesModule,
} from '@/engine/runtime/nodejs/modules/readlineModule';
import { WorkerStdin } from '@/engine/runtime/nodejs/workerStdin';

function createStdin(): WorkerStdin {
  return new WorkerStdin(
    () => {},
    () => {},
    () => {}
  );
}

describe('readline module', () => {
  it('propagates line listener exceptions through stdin', async () => {
    const input = createStdin();
    const iface = createReadlineModule(input).createInterface({ input });
    iface.on('line', () => {
      throw new Error('line failed');
    });
    await Promise.resolve();

    expect(() => input.submit('line\n')).toThrow('line failed');
  });

  it('detaches stdin lifecycle listeners when interfaces close', async () => {
    const input = createStdin();
    const initialListeners = {
      data: input.listenerCount('data'),
      end: input.listenerCount('end'),
      close: input.listenerCount('close'),
    };

    for (let index = 0; index < 5; index++) {
      const iface = createReadlineModule(input).createInterface({ input });
      iface.close();
    }

    await Promise.resolve();
    expect({
      data: input.listenerCount('data'),
      end: input.listenerCount('end'),
      close: input.listenerCount('close'),
    }).toEqual(initialListeners);
  });

  it('iterates lines and finishes when stdin reaches EOF', async () => {
    const input = createStdin();
    const iface = createReadlineModule(input).createInterface({ input });
    const iterator = iface[Symbol.asyncIterator]();
    await Promise.resolve();
    input.submit('first\nsecond\n');

    await expect(iterator.next()).resolves.toEqual({ value: 'first', done: false });
    await expect(iterator.next()).resolves.toEqual({ value: 'second', done: false });
    input.eof();
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it('resolves promise questions and rejects an aborted question', async () => {
    const input = createStdin();
    const iface = createReadlinePromisesModule(input).createInterface({ input });
    await Promise.resolve();
    const answer = iface.question('Name? ');
    input.submit('Stasshe\n');
    await expect(answer).resolves.toBe('Stasshe');

    const controller = new AbortController();
    const abortedAnswer = iface.question('Again? ', { signal: controller.signal });
    controller.abort();
    await expect(abortedAnswer).rejects.toMatchObject({ name: 'AbortError' });
    iface.close();
  });
});
