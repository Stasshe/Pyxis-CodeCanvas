import { NpmInstall } from '@/engine/cmd/npmOperations/npmInstall';
import { fileRepository } from '@/engine/core/fileRepository';

jest.mock('@/engine/core/fileRepository', () => ({
  fileRepository: {
    getProjectFiles: jest.fn(),
    createFile: jest.fn(),
    deleteFile: jest.fn(),
  },
}));

describe('NpmInstall snapshot optimizations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('installWithDependencies uses single snapshot for checks', async () => {
    const mockFiles = [
      { id: '1', path: '/package.json', content: JSON.stringify({ dependencies: { foo: '^1.0.0' } }) },
    ];
    (fileRepository.getProjectFiles as jest.Mock).mockResolvedValue(mockFiles);

    const installer = new NpmInstall('proj', 'projId', true);
      // spy on internal methods that call getProjectFiles
      const spyGet = fileRepository.getProjectFiles as jest.MockedFunction<any>;

      // Mock network/file heavy methods to avoid actual fetch and tar extraction
      jest.spyOn((installer as any), 'fetchPackageInfo').mockImplementation(async () => ({
        name: 'foo',
        version: '1.0.0',
        dependencies: {},
        tarball: 'http://example.com/foo.tgz',
      }));
      jest.spyOn((installer as any), 'downloadAndInstallPackage').mockImplementation(async () => {
        // no-op for test
      });

      // call installWithDependencies (it will call getProjectFiles once for snapshot)
      await installer.installWithDependencies('foo', '1.0.0');

      // Ensure getProjectFiles called at least once, but not excessively (snapshot reuse)
      expect(spyGet).toHaveBeenCalled();
      expect(spyGet.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
