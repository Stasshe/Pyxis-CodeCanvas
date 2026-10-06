import { describe, expect, it } from 'vitest';
import { createPathModule } from '@/engine/runtime/nodejs/modules/pathModule';

describe('runtime path module', () => {
  it('resolves relative paths from the current runtime cwd', () => {
    let cwd = '/workspace';
    const runtimePath = createPathModule(() => cwd);

    expect(runtimePath.resolve('src', '../package.json')).toBe('/workspace/package.json');

    cwd = '/workspace/examples';
    expect(runtimePath.resolve('src')).toBe('/workspace/examples/src');
    expect(runtimePath.posix.resolve('src')).toBe('/workspace/examples/src');
    expect(runtimePath.resolve('/tmp', 'file.txt')).toBe('/tmp/file.txt');
  });
});
