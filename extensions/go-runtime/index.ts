/**
 * Pyxis Go Runtime Extension
 * 
 * Go runtime using GopherJS for browser-based Go execution
 * Note: This is an experimental implementation with limited compatibility
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

// Global state
let currentProjectId: string | null = null;

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('Go Runtime Extension activating...');

  /**
   * Execute Go code (simulated)
   * Note: GopherJS requires server-side compilation, so this is a limited implementation
   * that demonstrates the structure but cannot actually execute arbitrary Go code
   */
  async function executeGoCode(code: string): Promise<{ stdout: string; stderr: string; result: any }> {
    let stdout = '';
    let stderr = '';
    
    try {
      // GopherJSはサーバーサイドでのコンパイルが必要なため、
      // ブラウザ上での動的なGo実行は非常に制限されています
      
      // 簡単なパターンマッチングで基本的な出力をシミュレート
      const printMatch = code.match(/fmt\.Println\("([^"]+)"\)/);
      const printfMatch = code.match(/fmt\.Printf\("([^"]+)"/);
      
      if (printMatch) {
        stdout = printMatch[1] + '\n';
      } else if (printfMatch) {
        stdout = printfMatch[1];
      } else {
        stderr = 'Error: Go runtime requires server-side compilation via GopherJS.\n' +
                'This browser-based implementation has very limited functionality.\n' +
                'Only simple fmt.Println statements are supported for demonstration purposes.\n\n' +
                'For full Go support, please use a server-based Go compiler.';
      }
      
      context.logger.warn('⚠️ Go runtime has limited functionality in browser environment');
    } catch (error) {
      stderr = error instanceof Error ? error.message : String(error);
    }

    return { stdout: stdout.trim(), stderr: stderr.trim(), result: null };
  }

  // Register the Go runtime provider
  await context.registerRuntime?.({
    id: 'go',
    name: 'Go',
    supportedExtensions: ['.go'],
    
    canExecute(filePath: string): boolean {
      return filePath.endsWith('.go');
    },
    
    async initialize(projectId: string, projectName: string): Promise<void> {
      context.logger.info(`🐹 Initializing Go runtime for project: ${projectName}`);
      context.logger.warn('⚠️ Go runtime has limited browser support - requires server-side compilation');
      currentProjectId = projectId;
    },
    
    async execute(options: any): Promise<any> {
      const { projectId, filePath } = options;
      
      try {
        context.logger.info(`🐹 Attempting to execute Go file: ${filePath}`);
        
        // Get the file repository to read the file
        const fileRepository = await context.getSystemModule('fileRepository');
        await fileRepository.init();
        
        // Read the Go file
        const file = await fileRepository.getFileByPath(projectId, filePath);
        if (!file || !file.content) {
          throw new Error(`File not found: ${filePath}`);
        }
        
        // Execute the Go code (limited)
        const result = await executeGoCode(file.content);
        
        return {
          stdout: result.stdout,
          stderr: result.stderr || 
                  'Note: This is a limited implementation. Full Go support requires server-side compilation.',
          result: result.result,
          exitCode: result.stderr && !result.stdout ? 1 : 0,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        context.logger.error(`❌ Go execution failed: ${errorMessage}`);
        return {
          stderr: errorMessage,
          exitCode: 1,
        };
      }
    },
    
    async executeCode(code: string, options: any): Promise<any> {
      try {
        context.logger.info('🐹 Executing Go code snippet (limited)');
        
        // Execute the Go code (limited)
        const result = await executeGoCode(code);
        
        return {
          stdout: result.stdout,
          stderr: result.stderr || 
                  'Note: This is a limited implementation. Full Go support requires server-side compilation.',
          result: result.result,
          exitCode: result.stderr && !result.stdout ? 1 : 0,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        context.logger.error(`❌ Go code execution failed: ${errorMessage}`);
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

  context.logger.info('✅ Go Runtime Extension activated (limited functionality)');

  return {};
}

/**
 * Extension deactivation
 */
export async function deactivate(): Promise<void> {
  console.log('[Go Runtime] Deactivating...');
}
