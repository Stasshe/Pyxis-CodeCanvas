/**
 * pathResolver.test.ts - パス解決モジュールのテスト
 */

import {
  toAppPath,
  toGitPath,
  fromGitPath,
  getProjectRoot,
  toFSPath,
  fsPathToAppPath,
  isWithinProject,
  getParentPath,
  getFileName,
  joinPath,
  resolvePath,
  normalizeDotSegments,
  isRoot,
  hasPrefix,
  removePrefix,
} from '../src/engine/core/pathResolver';

describe('pathResolver', () => {
  describe('toAppPath', () => {
    it('should add leading slash to paths without one', () => {
      expect(toAppPath('src/hello.ts')).toBe('/src/hello.ts');
      expect(toAppPath('folder')).toBe('/folder');
    });

    it('should keep paths with leading slash unchanged', () => {
      expect(toAppPath('/src/hello.ts')).toBe('/src/hello.ts');
      expect(toAppPath('/folder')).toBe('/folder');
    });

    it('should remove trailing slash except for root', () => {
      expect(toAppPath('src/')).toBe('/src');
      expect(toAppPath('/src/')).toBe('/src');
      expect(toAppPath('/')).toBe('/');
    });

    it('should handle empty and null paths', () => {
      expect(toAppPath('')).toBe('/');
      expect(toAppPath(null)).toBe('/');
      expect(toAppPath(undefined)).toBe('/');
    });

    it('should collapse multiple slashes', () => {
      expect(toAppPath('//src//hello.ts')).toBe('/src/hello.ts');
      expect(toAppPath('///folder///')).toBe('/folder');
    });
  });

  describe('toGitPath', () => {
    it('should remove leading slash', () => {
      expect(toGitPath('/src/hello.ts')).toBe('src/hello.ts');
      expect(toGitPath('/folder')).toBe('folder');
    });

    it('should return "." for root path', () => {
      expect(toGitPath('/')).toBe('.');
      expect(toGitPath('')).toBe('.');
      expect(toGitPath(null)).toBe('.');
    });

    it('should handle paths without leading slash', () => {
      expect(toGitPath('src/hello.ts')).toBe('src/hello.ts');
    });
  });

  describe('fromGitPath', () => {
    it('should add leading slash', () => {
      expect(fromGitPath('src/hello.ts')).toBe('/src/hello.ts');
      expect(fromGitPath('folder')).toBe('/folder');
    });

    it('should return "/" for root indicators', () => {
      expect(fromGitPath('.')).toBe('/');
      expect(fromGitPath('./')).toBe('/');
      expect(fromGitPath('')).toBe('/');
      expect(fromGitPath(null)).toBe('/');
    });
  });

  describe('getProjectRoot', () => {
    it('should return /projects/{projectName}', () => {
      expect(getProjectRoot('MyProject')).toBe('/projects/MyProject');
      expect(getProjectRoot('Test')).toBe('/projects/Test');
    });
  });

  describe('toFSPath', () => {
    it('should combine project name and app path', () => {
      expect(toFSPath('MyProject', '/src/hello.ts')).toBe('/projects/MyProject/src/hello.ts');
      expect(toFSPath('MyProject', 'src/hello.ts')).toBe('/projects/MyProject/src/hello.ts');
    });

    it('should return project root for root path', () => {
      expect(toFSPath('MyProject', '/')).toBe('/projects/MyProject');
      expect(toFSPath('MyProject', '')).toBe('/projects/MyProject');
    });
  });

  describe('fsPathToAppPath', () => {
    it('should extract app path from FS path', () => {
      expect(fsPathToAppPath('/projects/MyProject/src/hello.ts', 'MyProject')).toBe('/src/hello.ts');
      expect(fsPathToAppPath('/projects/MyProject/folder', 'MyProject')).toBe('/folder');
    });

    it('should return "/" for project root', () => {
      expect(fsPathToAppPath('/projects/MyProject', 'MyProject')).toBe('/');
    });
  });

  describe('isWithinProject', () => {
    it('should return true for paths within project', () => {
      expect(isWithinProject('/projects/MyProject', 'MyProject')).toBe(true);
      expect(isWithinProject('/projects/MyProject/src', 'MyProject')).toBe(true);
      expect(isWithinProject('/projects/MyProject/src/hello.ts', 'MyProject')).toBe(true);
    });

    it('should return false for paths outside project', () => {
      expect(isWithinProject('/projects/OtherProject', 'MyProject')).toBe(false);
      expect(isWithinProject('/other/path', 'MyProject')).toBe(false);
    });
  });

  describe('getParentPath', () => {
    it('should return parent directory', () => {
      expect(getParentPath('/src/hello.ts')).toBe('/src');
      expect(getParentPath('/src/sub/file.ts')).toBe('/src/sub');
    });

    it('should return root for top-level files', () => {
      expect(getParentPath('/hello.ts')).toBe('/');
    });

    it('should return root for root', () => {
      expect(getParentPath('/')).toBe('/');
    });
  });

  describe('getFileName', () => {
    it('should return file name', () => {
      expect(getFileName('/src/hello.ts')).toBe('hello.ts');
      expect(getFileName('/hello.ts')).toBe('hello.ts');
    });

    it('should return folder name for directories', () => {
      expect(getFileName('/src/folder')).toBe('folder');
    });

    it('should return empty string for root', () => {
      expect(getFileName('/')).toBe('');
    });
  });

  describe('joinPath', () => {
    it('should join paths correctly', () => {
      expect(joinPath('/src', 'hello.ts')).toBe('/src/hello.ts');
      expect(joinPath('/', 'src')).toBe('/src');
    });

    it('should handle paths with trailing/leading slashes', () => {
      // 絶対パスが渡された場合は前のパスは無視される（POSIX準拠）
      expect(joinPath('/src/', '/hello.ts')).toBe('/hello.ts');
    });

    it('should handle multiple path segments', () => {
      expect(joinPath('/src', 'sub', 'file.ts')).toBe('/src/sub/file.ts');
    });

    it('should handle absolute paths in segments', () => {
      expect(joinPath('/src', '/absolute')).toBe('/absolute');
    });
  });

  describe('resolvePath', () => {
    it('should resolve relative paths', () => {
      expect(resolvePath('/src', 'hello.ts')).toBe('/src/hello.ts');
      expect(resolvePath('/src', './hello.ts')).toBe('/src/hello.ts');
    });

    it('should resolve parent references', () => {
      expect(resolvePath('/src/sub', '../hello.ts')).toBe('/src/hello.ts');
      expect(resolvePath('/src/sub/deep', '../../hello.ts')).toBe('/src/hello.ts');
    });

    it('should handle absolute paths', () => {
      expect(resolvePath('/src', '/absolute/path')).toBe('/absolute/path');
    });
  });

  describe('normalizeDotSegments', () => {
    it('should remove current directory references', () => {
      expect(normalizeDotSegments('/src/./hello.ts')).toBe('/src/hello.ts');
      expect(normalizeDotSegments('/./src/./hello.ts')).toBe('/src/hello.ts');
    });

    it('should resolve parent directory references', () => {
      expect(normalizeDotSegments('/src/../hello.ts')).toBe('/hello.ts');
      expect(normalizeDotSegments('/src/sub/../../hello.ts')).toBe('/hello.ts');
    });

    it('should not go above root', () => {
      expect(normalizeDotSegments('/../../hello.ts')).toBe('/hello.ts');
    });
  });

  describe('isRoot', () => {
    it('should return true for root paths', () => {
      expect(isRoot('/')).toBe(true);
      expect(isRoot('')).toBe(true);
      expect(isRoot(null)).toBe(true);
    });

    it('should return false for non-root paths', () => {
      expect(isRoot('/src')).toBe(false);
      expect(isRoot('/hello.ts')).toBe(false);
    });
  });

  describe('hasPrefix', () => {
    it('should return true when path starts with prefix', () => {
      expect(hasPrefix('/src/hello.ts', '/src')).toBe(true);
      expect(hasPrefix('/src/sub/file.ts', '/src')).toBe(true);
    });

    it('should return true for root prefix', () => {
      expect(hasPrefix('/anything', '/')).toBe(true);
    });

    it('should return false when path does not start with prefix', () => {
      expect(hasPrefix('/other/hello.ts', '/src')).toBe(false);
    });

    it('should handle exact match', () => {
      expect(hasPrefix('/src', '/src')).toBe(true);
    });
  });

  describe('removePrefix', () => {
    it('should remove prefix from path', () => {
      expect(removePrefix('/src/hello.ts', '/src')).toBe('/hello.ts');
      expect(removePrefix('/src/sub/file.ts', '/src')).toBe('/sub/file.ts');
    });

    it('should return path unchanged for root prefix', () => {
      expect(removePrefix('/src/hello.ts', '/')).toBe('/src/hello.ts');
    });

    it('should return "/" when path equals prefix', () => {
      expect(removePrefix('/src', '/src')).toBe('/');
    });
  });
});
