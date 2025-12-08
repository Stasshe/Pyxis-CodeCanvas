/**
 * Pyxis Ruby Runtime Extension
 * 
 * Ruby runtime using ruby.wasm for browser-based Ruby execution
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

// Ruby.wasm interface types
interface RubyVM {
  eval(code: string): any;
  evalAsync(code: string): Promise<any>;
}

// Global Ruby instance
let rubyInstance: RubyVM | null = null;
let currentProjectId: string | null = null;

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('Ruby Runtime Extension activating...');

  // Initialize Ruby.wasm
  async function initRuby(): Promise<RubyVM> {
    if (rubyInstance) {
      return rubyInstance;
    }

    try {
      // Import ruby.wasm module
      const rubyWasm = await import('@ruby/wasm-wasi') as any;
      const { DefaultRubyVM } = rubyWasm;
      
      // Fetch the WebAssembly module from CDN
      // Using version 2.7.2 to match package.json dependency
      const response = await fetch(
        'https://cdn.jsdelivr.net/npm/@ruby/3.2-wasm-wasi@2.7.2/dist/ruby+stdlib.wasm'
      );
      const buffer = await response.arrayBuffer();
      const module = await WebAssembly.compile(buffer);
      
      const { vm } = await DefaultRubyVM(module);
      rubyInstance = vm;
      
      context.logger.info('✅ Ruby.wasm initialized');
      return vm;
    } catch (error) {
      context.logger.error('❌ Failed to initialize Ruby.wasm:', error);
      throw error;
    }
  }

  // Execute Ruby code
  async function executeRubyCode(code: string): Promise<{ stdout: string; stderr: string; result: any }> {
    const ruby = await initRuby();
    
    let stdout = '';
    let stderr = '';
    let result = null;

    try {
      // Capture stdout/stderr
      const wrappedCode = `
begin
  $stdout = StringIO.new
  $stderr = StringIO.new
  
  result = begin
    ${code}
  end
  
  {
    stdout: $stdout.string,
    stderr: $stderr.string,
    result: result.inspect
  }
rescue => e
  {
    stdout: $stdout.string,
    stderr: e.full_message,
    result: nil
  }
end
`;

      const output = await ruby.evalAsync(wrappedCode);
      
      if (output && typeof output === 'object') {
        stdout = output.stdout || '';
        stderr = output.stderr || '';
        result = output.result;
      }
    } catch (error) {
      stderr = error instanceof Error ? error.message : String(error);
    }

    return { stdout: stdout.trim(), stderr: stderr.trim(), result };
  }

  // Register the Ruby runtime provider
  await context.registerRuntime?.({
    id: 'ruby',
    name: 'Ruby',
    supportedExtensions: ['.rb'],
    
    canExecute(filePath: string): boolean {
      return filePath.endsWith('.rb');
    },
    
    async initialize(projectId: string, projectName: string): Promise<void> {
      context.logger.info(`💎 Initializing Ruby runtime for project: ${projectName}`);
      currentProjectId = projectId;
      await initRuby();
    },
    
    async execute(options: any): Promise<any> {
      const { projectId, filePath } = options;
      
      try {
        context.logger.info(`💎 Executing Ruby file: ${filePath}`);
        
        // Get the file repository to read the file
        const fileRepository = await context.getSystemModule('fileRepository');
        await fileRepository.init();
        
        // Read the Ruby file
        const file = await fileRepository.getFileByPath(projectId, filePath);
        if (!file || !file.content) {
          throw new Error(`File not found: ${filePath}`);
        }
        
        // Execute the Ruby code
        const result = await executeRubyCode(file.content);
        
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          result: result.result,
          exitCode: result.stderr ? 1 : 0,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        context.logger.error(`❌ Ruby execution failed: ${errorMessage}`);
        return {
          stderr: errorMessage,
          exitCode: 1,
        };
      }
    },
    
    async executeCode(code: string, options: any): Promise<any> {
      try {
        context.logger.info('💎 Executing Ruby code snippet');
        
        // Execute the Ruby code
        const result = await executeRubyCode(code);
        
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          result: result.result,
          exitCode: result.stderr ? 1 : 0,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        context.logger.error(`❌ Ruby code execution failed: ${errorMessage}`);
        return {
          stderr: errorMessage,
          exitCode: 1,
        };
      }
    },
    
    isReady(): boolean {
      return rubyInstance !== null;
    },
  });

  context.logger.info('✅ Ruby Runtime Extension activated');

  return {};
}

/**
 * Extension deactivation
 */
export async function deactivate(): Promise<void> {
  console.log('[Ruby Runtime] Deactivating...');
}
