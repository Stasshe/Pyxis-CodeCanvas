// Mock UI dependencies that contain JSX so Jest doesn't try to parse TSX during module import
jest.mock('@/components/Bottom/BottomPanel', () => ({
  pushMsgOutPanel: jest.fn(),
}));

// Mock transpileManager to avoid using import.meta in worker creation during tests
jest.mock('@/engine/runtime/transpileManager', () => ({
  transpileManager: {
    transpile: async (opts: any) => ({ code: opts.code, sourceMap: null, dependencies: [] }),
    detectLanguage: (filePath: string) => ({ isTypeScript: false, isESModule: false, isJSX: false }),
    isESModule: (code: string) => false,
  },
}));

import { fileRepository } from '@/engine/core/fileRepository';
jest.mock('@/engine/core/fileRepository', () => ({
  fileRepository: {
    getProjectFiles: jest.fn(),
    createFile: jest.fn(),
    saveFile: jest.fn(),
    deleteFile: jest.fn(),
  },
}));

import { executeNodeFile } from '@/engine/runtime/nodeRuntime';

describe('NodeRuntime __require__ thenable for built-in fs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('await __require__("fs").promises.writeFile works', async () => {
    // Setup a mock project file /index.js that uses the transpiled pattern
    const fileContent = `const fs = await __require__('fs').promises;
const data = JSON.stringify({ hello: 'world' }, null, 2);
await fs.writeFile('/trivia.json', data, 'utf8');
`;

    // Mock fileRepository to return the project file and no others
    const mockFiles = [
      {
        id: 'root',
        path: '/index.js',
        content: fileContent,
        type: 'file',
        createdAt: new Date(),
        updatedAt: new Date(),
        isBufferArray: false,
      },
    ];

    (fileRepository.getProjectFiles as jest.Mock).mockResolvedValue(mockFiles);

    // Spy on createFile/saveFile to ensure write was attempted
    const createSpy = fileRepository.createFile as jest.MockedFunction<any>;
    const saveSpy = fileRepository.saveFile as jest.MockedFunction<any>;

    // Execute the runtime
    await executeNodeFile({
      projectId: 'proj1',
      projectName: 'proj1',
      filePath: '/index.js',
      debugConsole: {
        log: () => {},
        error: () => {},
        warn: () => {},
        clear: () => {},
      },
    });

    // Expect that createFile or saveFile was called to create /trivia.json
    const called = createSpy.mock.calls.length + saveSpy.mock.calls.length;
    expect(called).toBeGreaterThanOrEqual(1);
  });
});
