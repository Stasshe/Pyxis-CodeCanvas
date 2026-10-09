import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { executeRuntimeShell } from '@/engine/runtime/nodejs/shellHost';
import { setupTestProject } from '../../_helpers/testProject';

describe('runtime shell host', () => {
  it('passes child stdin to cat', async () => {
    const { rootPath } = await setupTestProject('RuntimeShellHostTest');
    const stdin = new PassThrough();
    stdin.end('runtime stdin');

    const result = await executeRuntimeShell(rootPath, 'cat', { stdin });

    expect(result).toEqual({ stdout: 'runtime stdin', stderr: '', code: 0 });
  });
});
