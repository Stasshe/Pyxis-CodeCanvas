import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFSModule } from '@/engine/runtime/nodejs/modules/fsModule';
import { createNodeRuntimeFixture, type NodeRuntimeFixture } from '../../_helpers/nodeRuntime';

describe('fs streams', () => {
  let fixture: NodeRuntimeFixture;
  let fs: ReturnType<typeof createFSModule>;
  const root = '/tmp/fs-stream-tests';

  beforeEach(async () => {
    fixture = await createNodeRuntimeFixture(root);
    fs = createFSModule({
      filesystem: fixture.filesystem,
      bridge: fixture.bridge,
      getCwd: () => root,
      writeStdout: () => {},
      writeStderr: () => {},
    });
  });

  afterEach(() => fixture.close());

  it('persists each write before the stream finishes', async () => {
    const path = `${root}/immediate.txt`;
    await fs.promises.writeFile(path, 'old contents');
    const stream = fs.createWriteStream(path);
    await new Promise<void>((resolve, reject) => {
      stream.write('first', error => {
        if (error) reject(error);
        else resolve();
      });
    });

    expect(await fs.promises.readFile(path, 'utf8')).toBe('first');
    stream.end();
    await once(stream, 'finish');
  });

  it('preserves writes from concurrent append streams', async () => {
    const path = `${root}/append.txt`;
    await fs.promises.writeFile(path, '');
    const first = fs.createWriteStream(path, { flags: 'a' });
    const second = fs.createWriteStream(path, { flags: 'a' });
    const firstFinished = once(first, 'finish');
    const secondFinished = once(second, 'finish');
    first.end('first');
    second.end('second');
    await Promise.all([firstFinished, secondFinished]);

    expect(await fs.promises.readFile(path, 'utf8')).toMatch(/^(firstsecond|secondfirst)$/);
  });

  it.each(['wx', 'ax'] as const)('creates %s paths exclusively when streams race', async flags => {
    const path = `${root}/${flags}.txt`;
    const first = fs.createWriteStream(path, { flags });
    const second = fs.createWriteStream(path, { flags });
    const firstFinished = finished(first);
    const secondFinished = finished(second);
    first.end('first');
    second.end('second');
    const outcomes = await Promise.allSettled([firstFinished, secondFinished]);
    const successes = outcomes.filter(outcome => outcome.status === 'fulfilled');
    const failures = outcomes.filter(outcome => outcome.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'EEXIST' },
    });
    expect(['first', 'second']).toContain(await fs.promises.readFile(path, 'utf8'));
  });

  it('writes at the requested position without truncating the remaining file', async () => {
    const path = `${root}/position.txt`;
    await fs.promises.writeFile(path, 'abcdef');
    const stream = fs.createWriteStream(path, { flags: 'r+', start: 2 });
    const finished = once(stream, 'finish');
    stream.end('ZZ');
    await finished;

    expect(await fs.promises.readFile(path, 'utf8')).toBe('abZZef');
  });

  it('completes a read whose end is past EOF', async () => {
    const path = `${root}/bounded.txt`;
    await fs.promises.writeFile(path, 'short');
    let contents = '';
    for await (const chunk of fs.createReadStream(path, { end: 100 })) {
      contents += chunk.toString();
    }

    expect(contents).toBe('short');
  });

  it('rejects unsupported write flags', () => {
    expect(() => fs.createWriteStream(`${root}/invalid.txt`, { flags: 'q' })).toThrow(
      'Unsupported write stream flags: q'
    );
  });
});
