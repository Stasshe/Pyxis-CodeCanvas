/**
 * Pyxis Python Runtime Extension
 * 
 * Python runtime using Pyodide for browser-based Python execution
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

// Pyodide interface types
interface PyodideInterface {
  runPythonAsync(code: string): Promise<any>;
  FS: {
    readdir(path: string): string[];
    readFile(path: string, options: { encoding: string }): string;
    writeFile(path: string, content: string): void;
    mkdir(path: string): void;
    rmdir(path: string): void;
    unlink(path: string): void;
    isDir(mode: number): boolean;
    stat(path: string): { mode: number };
  };
  loadPackage(packages: string[]): Promise<void>;
  globals?: any;
}

// Global Pyodide instance
let pyodideInstance: PyodideInterface | null = null;
let currentProjectId: string | null = null;

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('Python Runtime Extension activating...');

  // Initialize Pyodide
  async function initPyodide(): Promise<PyodideInterface> {
    if (pyodideInstance) {
      return pyodideInstance;
    }

    // @ts-ignore - loadPyodide is loaded from CDN
    const pyodide = await window.loadPyodide({
      stdout: (msg: string) => context.logger.info(msg),
      stderr: (msg: string) => context.logger.error(msg),
    });

    pyodideInstance = pyodide;
    return pyodide;
  }

  // Sync files from IndexedDB to Pyodide
  async function syncFilesToPyodide(projectId: string): Promise<void> {
    if (!pyodideInstance) return;

    const fileRepository = await context.getSystemModule('fileRepository');
    await fileRepository.init();
    
    const files = await fileRepository.getProjectFiles(projectId);
    
    for (const file of files) {
      if (file.type === 'file' && file.path && file.content) {
        try {
          const pyPath = file.path.startsWith('/') ? file.path : `/${file.path}`;
          const dirPath = pyPath.substring(0, pyPath.lastIndexOf('/'));
          
          if (dirPath && dirPath !== '/') {
            // Create directory if needed
            try {
              pyodideInstance.FS.stat(dirPath);
            } catch {
              const parts = dirPath.split('/').filter(p => p);
              let currentPath = '';
              for (const part of parts) {
                currentPath += '/' + part;
                try {
                  pyodideInstance.FS.stat(currentPath);
                } catch {
                  pyodideInstance.FS.mkdir(currentPath);
                }
              }
            }
          }
          
          pyodideInstance.FS.writeFile(pyPath, file.content);
        } catch (error) {
          context.logger.warn(`Failed to sync file ${file.path}:`, error);
        }
      }
    }
  }

  // Execute Python code and sync back
  async function runPythonWithSync(code: string, projectId: string): Promise<any> {
    const pyodide = await initPyodide();
    await syncFilesToPyodide(projectId);
    
    try {
      const result = await pyodide.runPythonAsync(code);
      return { result, stdout: '', stderr: '' };
    } catch (error: any) {
      return { result: null, stdout: '', stderr: error.message || String(error) };
    }
  }

  // Register the Python runtime provider
  await context.registerRuntime?.({
    id: 'python',
    name: 'Python',
    supportedExtensions: ['.py'],
    
    canExecute(filePath: string): boolean {
      return filePath.endsWith('.py');
    },
    
    async initialize(projectId: string, projectName: string): Promise<void> {
      context.logger.info(`🐍 Initializing Python runtime for project: ${projectName}`);
      currentProjectId = projectId;
      await initPyodide();
      await syncFilesToPyodide(projectId);
    },
    
    async execute(options: any): Promise<any> {
      const { projectId, filePath } = options;
      
      try {
        context.logger.info(`🐍 Executing Python file: ${filePath}`);
        
        // Get the file repository to read the file
        const fileRepository = await context.getSystemModule('fileRepository');
        await fileRepository.init();
        
        // Read the Python file
        const file = await fileRepository.getFileByPath(projectId, filePath);
        if (!file || !file.content) {
          throw new Error(`File not found: ${filePath}`);
        }
        
        // Execute the Python code
        const result = await runPythonWithSync(file.content, projectId);
        
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          result: result.result,
          exitCode: result.stderr ? 1 : 0,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        context.logger.error(`❌ Python execution failed: ${errorMessage}`);
        return {
          stderr: errorMessage,
          exitCode: 1,
        };
      }
    },
    
    async executeCode(code: string, options: any): Promise<any> {
      try {
        context.logger.info('🐍 Executing Python code snippet');
        
        // Execute the Python code
        const pyodide = await initPyodide();
        const result = await pyodide.runPythonAsync(code);
        
        return {
          result: String(result),
          exitCode: 0,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        context.logger.error(`❌ Python code execution failed: ${errorMessage}`);
        return {
          stderr: errorMessage,
          exitCode: 1,
        };
      }
    },
    
    isReady(): boolean {
      return pyodideInstance !== null;
    },
  });

  context.logger.info('✅ Python Runtime Extension activated');

  return {};
}

/**
 * Extension deactivation
 */
export async function deactivate(): Promise<void> {
  console.log('[Python Runtime] Deactivating...');
}
