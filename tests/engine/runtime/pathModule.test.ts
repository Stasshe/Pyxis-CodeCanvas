import nativePath from 'node:path';
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

  it('exposes reciprocal POSIX and Windows modules with native Windows path behavior', () => {
    const runtimePath = createPathModule(() => '/workspace');
    const runtimeWin32 = runtimePath.win32;
    const nativeWin32 = nativePath.win32;

    expect(runtimePath.posix).toBe(runtimePath);
    expect(runtimePath.win32).toBe(runtimeWin32);
    expect(runtimeWin32.win32).toBe(runtimeWin32);
    expect(runtimeWin32.posix).toBe(runtimePath);
    expect(runtimeWin32.sep).toBe('\\');
    expect(runtimeWin32.resolve()).toBe(nativeWin32.resolve('/workspace'));

    for (const input of ['C:/workspace/../file.txt', '\\\\server/share//folder/../file.txt']) {
      expect(runtimeWin32.normalize(input)).toBe(nativeWin32.normalize(input));
    }
    expect(runtimeWin32.resolve('C:\\workspace', 'src/../file.txt')).toBe(
      nativeWin32.resolve('C:\\workspace', 'src/../file.txt')
    );
    const driveRuntimePath = createPathModule(() => 'C:\\base');
    expect(driveRuntimePath.win32.resolve('C:..\\file.txt')).toBe(
      nativeWin32.resolve('C:\\base', 'C:..\\file.txt')
    );
    expect(runtimeWin32.parse('\\\\server\\share\\folder\\file.txt')).toEqual(
      nativeWin32.parse('\\\\server\\share\\folder\\file.txt')
    );
    expect(runtimeWin32.relative('C:\\workspace\\src', 'C:\\workspace\\test\\file.txt')).toBe(
      nativeWin32.relative('C:\\workspace\\src', 'C:\\workspace\\test\\file.txt')
    );
    expect(runtimeWin32.relative('src', 'test/file.txt')).toBe(
      nativeWin32.relative('/workspace/src', '/workspace/test/file.txt')
    );
    expect(runtimeWin32.toNamespacedPath('file.txt')).toBe(
      nativeWin32.toNamespacedPath(nativeWin32.resolve('/workspace', 'file.txt'))
    );
    expect(runtimeWin32.toNamespacedPath('')).toBe('');
    expect(Reflect.apply(runtimeWin32.toNamespacedPath, runtimeWin32, [null])).toBeNull();
    expect(runtimePath.toNamespacedPath('file.txt')).toBe('file.txt');
    expect(runtimeWin32.toNamespacedPath('C:/workspace/file.txt')).toBe(
      nativeWin32.toNamespacedPath(nativeWin32.resolve('/workspace', 'C:/workspace/file.txt'))
    );
    expect(runtimeWin32.toNamespacedPath('\\\\server\\share\\file.txt')).toBe(
      nativeWin32.toNamespacedPath(nativeWin32.resolve('/workspace', '\\\\server\\share\\file.txt'))
    );
    expect(driveRuntimePath.win32.toNamespacedPath('C:relative.txt')).toBe(
      nativeWin32.toNamespacedPath(nativeWin32.resolve('C:\\base', 'C:relative.txt'))
    );
  });
});
