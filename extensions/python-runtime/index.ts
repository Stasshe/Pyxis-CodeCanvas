/**
 * Pyxis Python Runtime Extension
 * 
 * Python runtime using Pyodide for browser-based Python execution
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('Python Runtime Extension activating...');

  // Import the pyodide runtime functions from core
  const { initPyodide, setCurrentProject, runPythonWithSync } = 
    await import('@/engine/runtime/pyodideRuntime');

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
      await initPyodide();
      await setCurrentProject(projectId, projectName);
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
      return true;
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
