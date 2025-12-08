/**
 * Pyxis R Runtime Extension
 * 
 * R runtime using webR for browser-based statistical computing
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

// WebR interface types
interface WebRInstance {
  evalR(code: string): Promise<any>;
  evalRAsync(code: string): Promise<any>;
  close(): void;
}

// Global WebR instance
let webRInstance: WebRInstance | null = null;
let currentProjectId: string | null = null;

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('R Runtime Extension activating...');

  // Initialize webR
  async function initWebR(): Promise<WebRInstance> {
    if (webRInstance) {
      return webRInstance;
    }

    try {
      // Import webR module
      const webRModule = await import('webr') as any;
      const { WebR } = webRModule;
      
      // Initialize webR with configuration
      const webR = new WebR({
        baseUrl: 'https://webr.r-wasm.org/latest/',
        interactive: false,
      });
      
      await webR.init();
      webRInstance = webR;
      
      context.logger.info('✅ webR initialized');
      return webR;
    } catch (error) {
      context.logger.error('❌ Failed to initialize webR:', error);
      throw error;
    }
  }

  // Execute R code
  async function executeRCode(code: string): Promise<{ stdout: string; stderr: string; result: any }> {
    const webR = await initWebR();
    
    let stdout = '';
    let stderr = '';
    let result = null;

    try {
      // Capture output using R's capture.output
      const wrappedCode = `
tryCatch({
  output <- capture.output({
    result <- {
      ${code}
    }
  })
  list(
    stdout = paste(output, collapse = "\\n"),
    stderr = "",
    result = if (exists("result")) as.character(result) else ""
  )
}, error = function(e) {
  list(
    stdout = "",
    stderr = as.character(e),
    result = NULL
  )
})
`;

      const output = await webR.evalR(wrappedCode);
      const resultObj = await output.toJs();
      
      if (resultObj) {
        stdout = resultObj.stdout || '';
        stderr = resultObj.stderr || '';
        result = resultObj.result;
      }
    } catch (error) {
      stderr = error instanceof Error ? error.message : String(error);
    }

    return { stdout: stdout.trim(), stderr: stderr.trim(), result };
  }

  // Register the R runtime provider
  await context.registerRuntime?.({
    id: 'r',
    name: 'R',
    supportedExtensions: ['.r', '.R'],
    
    canExecute(filePath: string): boolean {
      return /\.(r|R)$/.test(filePath);
    },
    
    async initialize(projectId: string, projectName: string): Promise<void> {
      context.logger.info(`📊 Initializing R runtime for project: ${projectName}`);
      currentProjectId = projectId;
      await initWebR();
    },
    
    async execute(options: any): Promise<any> {
      const { projectId, filePath } = options;
      
      try {
        context.logger.info(`📊 Executing R file: ${filePath}`);
        
        // Get the file repository to read the file
        const fileRepository = await context.getSystemModule('fileRepository');
        await fileRepository.init();
        
        // Read the R file
        const file = await fileRepository.getFileByPath(projectId, filePath);
        if (!file || !file.content) {
          throw new Error(`File not found: ${filePath}`);
        }
        
        // Execute the R code
        const result = await executeRCode(file.content);
        
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          result: result.result,
          exitCode: result.stderr ? 1 : 0,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        context.logger.error(`❌ R execution failed: ${errorMessage}`);
        return {
          stderr: errorMessage,
          exitCode: 1,
        };
      }
    },
    
    async executeCode(code: string, options: any): Promise<any> {
      try {
        context.logger.info('📊 Executing R code snippet');
        
        // Execute the R code
        const result = await executeRCode(code);
        
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          result: result.result,
          exitCode: result.stderr ? 1 : 0,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        context.logger.error(`❌ R code execution failed: ${errorMessage}`);
        return {
          stderr: errorMessage,
          exitCode: 1,
        };
      }
    },
    
    isReady(): boolean {
      return webRInstance !== null;
    },
  });

  context.logger.info('✅ R Runtime Extension activated');

  return {};
}

/**
 * Extension deactivation
 */
export async function deactivate(): Promise<void> {
  if (webRInstance) {
    try {
      webRInstance.close();
    } catch (error) {
      console.error('[R Runtime] Error during deactivation:', error);
    }
  }
  console.log('[R Runtime] Deactivating...');
}
