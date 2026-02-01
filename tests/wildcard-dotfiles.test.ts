import { UnixCommandBase } from '@/engine/cmd/global/unixOperations/base';
import { fileRepository } from '@/engine/core/fileRepository';
import type { ProjectFile } from '@/types';

// Mock fileRepository
jest.mock('@/engine/core/fileRepository', () => ({
  fileRepository: {
    getFileByPath: jest.fn(),
    getFilesByPrefix: jest.fn(),
  },
}));

describe('Wildcard expansion with dotfiles', () => {
  let unixCmd: UnixCommandBase;
  const projectId = 'test-project-id';
  const projectName = 'test-project';
  const currentDir = `/projects/${projectName}`;

  beforeEach(() => {
    // Create a concrete instance by using an anonymous class
    unixCmd = new (class extends UnixCommandBase {
      async execute(args: string[]): Promise<string> {
        return 'test';
      }
    })(projectName, currentDir, projectId);

    jest.clearAllMocks();
  });

  describe('expandPathPattern', () => {
    it('should exclude dotfiles when using * wildcard', async () => {
      // Setup mock files including dotfiles
      const mockFiles: ProjectFile[] = [
        { id: '1', path: '/file1.txt', name: 'file1.txt', type: 'file' } as ProjectFile,
        { id: '2', path: '/file2.js', name: 'file2.js', type: 'file' } as ProjectFile,
        { id: '3', path: '/.gitignore', name: '.gitignore', type: 'file' } as ProjectFile,
        { id: '4', path: '/.env', name: '.env', type: 'file' } as ProjectFile,
        { id: '5', path: '/.hidden', name: '.hidden', type: 'file' } as ProjectFile,
      ];

      (fileRepository.getFilesByPrefix as jest.Mock).mockResolvedValue(mockFiles);

      // Test wildcard expansion with *
      const result = await (unixCmd as any).expandPathPattern('*');

      // Should match file1.txt and file2.js but NOT .gitignore, .env, or .hidden
      expect(result).toHaveLength(2);
      expect(result).toContain(`${currentDir}/file1.txt`);
      expect(result).toContain(`${currentDir}/file2.js`);
      expect(result).not.toContain(`${currentDir}/.gitignore`);
      expect(result).not.toContain(`${currentDir}/.env`);
      expect(result).not.toContain(`${currentDir}/.hidden`);
    });

    it('should include dotfiles when pattern explicitly starts with dot', async () => {
      const mockFiles: ProjectFile[] = [
        { id: '1', path: '/file1.txt', name: 'file1.txt', type: 'file' } as ProjectFile,
        { id: '3', path: '/.gitignore', name: '.gitignore', type: 'file' } as ProjectFile,
        { id: '4', path: '/.env', name: '.env', type: 'file' } as ProjectFile,
        { id: '5', path: '/.hidden', name: '.hidden', type: 'file' } as ProjectFile,
      ];

      (fileRepository.getFilesByPrefix as jest.Mock).mockResolvedValue(mockFiles);

      // Test wildcard expansion with .*
      const result = await (unixCmd as any).expandPathPattern('.*');

      // Should match only dotfiles
      expect(result).toHaveLength(3);
      expect(result).toContain(`${currentDir}/.gitignore`);
      expect(result).toContain(`${currentDir}/.env`);
      expect(result).toContain(`${currentDir}/.hidden`);
      expect(result).not.toContain(`${currentDir}/file1.txt`);
    });

    it('should include specific dotfile when explicitly named', async () => {
      const mockFiles: ProjectFile[] = [
        { id: '3', path: '/.gitignore', name: '.gitignore', type: 'file' } as ProjectFile,
      ];

      (fileRepository.getFilesByPrefix as jest.Mock).mockResolvedValue(mockFiles);
      (fileRepository.getFileByPath as jest.Mock).mockResolvedValue(mockFiles[0]);

      // Test expansion with explicit .gitignore
      const result = await (unixCmd as any).expandPathPattern('.gitignore');

      // Should match .gitignore since it's explicitly named (no wildcard)
      expect(result).toHaveLength(1);
      expect(result).toContain(`${currentDir}/.gitignore`);
    });

    it('should exclude dotfiles with ?.txt pattern', async () => {
      const mockFiles: ProjectFile[] = [
        { id: '1', path: '/a.txt', name: 'a.txt', type: 'file' } as ProjectFile,
        { id: '2', path: '/b.txt', name: 'b.txt', type: 'file' } as ProjectFile,
        { id: '3', path: '/.txt', name: '.txt', type: 'file' } as ProjectFile,
      ];

      (fileRepository.getFilesByPrefix as jest.Mock).mockResolvedValue(mockFiles);

      // Test wildcard expansion with ?.txt
      const result = await (unixCmd as any).expandPathPattern('?.txt');

      // Should match a.txt and b.txt but NOT .txt
      expect(result).toHaveLength(2);
      expect(result).toContain(`${currentDir}/a.txt`);
      expect(result).toContain(`${currentDir}/b.txt`);
      expect(result).not.toContain(`${currentDir}/.txt`);
    });

    it('should match dotfiles with .g* pattern', async () => {
      const mockFiles: ProjectFile[] = [
        { id: '1', path: '/git.txt', name: 'git.txt', type: 'file' } as ProjectFile,
        { id: '2', path: '/.gitignore', name: '.gitignore', type: 'file' } as ProjectFile,
        { id: '3', path: '/.github', name: '.github', type: 'folder' } as ProjectFile,
        { id: '4', path: '/.gradle', name: '.gradle', type: 'folder' } as ProjectFile,
      ];

      (fileRepository.getFilesByPrefix as jest.Mock).mockResolvedValue(mockFiles);

      // Test wildcard expansion with .g*
      const result = await (unixCmd as any).expandPathPattern('.g*');

      // Should match only dotfiles starting with .g
      expect(result).toHaveLength(3);
      expect(result).toContain(`${currentDir}/.gitignore`);
      expect(result).toContain(`${currentDir}/.github`);
      expect(result).toContain(`${currentDir}/.gradle`);
      expect(result).not.toContain(`${currentDir}/git.txt`);
    });
  });

  describe('expandGlob', () => {
    it('should exclude dotfiles from * glob', async () => {
      const mockFiles: ProjectFile[] = [
        { id: '1', path: '/file1.txt', name: 'file1.txt', type: 'file' } as ProjectFile,
        { id: '2', path: '/file2.js', name: 'file2.js', type: 'file' } as ProjectFile,
        { id: '3', path: '/.gitignore', name: '.gitignore', type: 'file' } as ProjectFile,
        { id: '4', path: '/.env', name: '.env', type: 'file' } as ProjectFile,
      ];

      (fileRepository.getFilesByPrefix as jest.Mock).mockResolvedValue(mockFiles);

      const result = await (unixCmd as any).expandGlob('*', currentDir);

      expect(result).toHaveLength(2);
      expect(result).toContain(`${currentDir}/file1.txt`);
      expect(result).toContain(`${currentDir}/file2.js`);
      expect(result).not.toContain(`${currentDir}/.gitignore`);
      expect(result).not.toContain(`${currentDir}/.env`);
    });

    it('should include dotfiles with .* glob', async () => {
      const mockFiles: ProjectFile[] = [
        { id: '1', path: '/file1.txt', name: 'file1.txt', type: 'file' } as ProjectFile,
        { id: '3', path: '/.gitignore', name: '.gitignore', type: 'file' } as ProjectFile,
        { id: '4', path: '/.env', name: '.env', type: 'file' } as ProjectFile,
      ];

      (fileRepository.getFilesByPrefix as jest.Mock).mockResolvedValue(mockFiles);

      const result = await (unixCmd as any).expandGlob('.*', currentDir);

      expect(result).toHaveLength(2);
      expect(result).toContain(`${currentDir}/.gitignore`);
      expect(result).toContain(`${currentDir}/.env`);
      expect(result).not.toContain(`${currentDir}/file1.txt`);
    });
  });
});
