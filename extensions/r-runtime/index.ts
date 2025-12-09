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
      
      // Use CDN for webR files (no need to copy to public)
      context.logger.info('📦 Initializing webR from CDN');
      
      // Initialize webR with default CDN configuration
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
      // Execute code and capture output
      const captureResult = await webR.evalR(`
capture.output({
  tryCatch({
    ${code}
  }, error = function(e) {
    cat("Error:", conditionMessage(e), "\\n")
  })
})
`);
      
      // Convert result to JS
      const output = await captureResult.toArray();
      stdout = output.map((line: any) => String(line)).join('\n');
      
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

  // Register 'r' and 'Rscript' terminal commands
  if (context.commands) {
    const rCommand = async (args: string[], cmdContext: any) => {
      try {
        if (args.length === 0) {
          return 'Usage: r <file.r> or r -e "<code>"';
        }

        // Handle -e flag for inline code execution
        if (args[0] === '-e') {
          const code = args.slice(1).join(' ');
          const result = await executeRCode(code);
          return result.stdout || result.stderr || '';
        }

        // Execute R file
        const filePath = args[0];
        const fileRepository = await context.getSystemModule('fileRepository');
        await fileRepository.init();
        
        // Normalize path
        let normalizedPath = filePath;
        if (!filePath.startsWith('/')) {
          const relativeCurrent = cmdContext.currentDirectory.replace(`/projects/${cmdContext.projectName}`, '');
          normalizedPath = relativeCurrent === '' 
            ? `/${filePath}` 
            : `${relativeCurrent}/${filePath}`;
        } else {
          normalizedPath = filePath.replace(`/projects/${cmdContext.projectName}`, '');
        }

        const file = await fileRepository.getFileByPath(cmdContext.projectId, normalizedPath);
        if (!file || !file.content) {
          return `Error: File not found: ${normalizedPath}`;
        }

        const result = await executeRCode(file.content);
        return result.stdout || result.stderr || '';
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    };

    context.commands.registerCommand('r', rCommand);
    context.commands.registerCommand('Rscript', rCommand);
    context.logger.info('✅ Registered terminal commands: r, Rscript');
  }

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
