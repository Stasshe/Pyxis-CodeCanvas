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

  // Parse .gitignore patterns
  function parseGitignore(content: string): string[] {
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(pattern => {
        // Convert .gitignore pattern to simple regex pattern
        // Remove leading slash
        if (pattern.startsWith('/')) {
          pattern = pattern.substring(1);
        }
        return pattern;
      });
  }

  // Check if a path matches any gitignore pattern
  function isIgnored(filePath: string, patterns: string[]): boolean {
    // Remove leading slash for comparison
    const normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    
    for (const pattern of patterns) {
      // Handle directory patterns (ending with /)
      if (pattern.endsWith('/')) {
        const dirPattern = pattern.slice(0, -1);
        if (normalizedPath.startsWith(dirPattern + '/') || normalizedPath === dirPattern) {
          return true;
        }
      }
      // Handle wildcard patterns
      else if (pattern.includes('*')) {
        const regexPattern = pattern
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '.');
        const regex = new RegExp(`^${regexPattern}$`);
        if (regex.test(normalizedPath)) {
          return true;
        }
      }
      // Handle exact match
      else if (normalizedPath === pattern || normalizedPath.startsWith(pattern + '/')) {
        return true;
      }
    }
    
    return false;
  }

  // Sync files from IndexedDB to Pyodide
  async function syncFilesToPyodide(projectId: string): Promise<void> {
    if (!pyodideInstance) return;

    const fileRepository = await context.getSystemModule('fileRepository');
    await fileRepository.init();
    
    try {
      // Get all files from the project
      const files = await fileRepository.getProjectFiles(projectId);
      
      // Parse .gitignore if it exists
      let gitignorePatterns: string[] = [];
      const gitignoreFile = files.find(f => f.path === '/.gitignore' || f.path === '.gitignore');
      if (gitignoreFile && gitignoreFile.content) {
        gitignorePatterns = parseGitignore(gitignoreFile.content);
      }
      
      // Clear /home directory (but keep . and ..)
      try {
        const homeContents = pyodideInstance.FS.readdir('/home');
        for (const item of homeContents) {
          if (item !== '.' && item !== '..') {
            try {
              pyodideInstance.FS.unlink(`/home/${item}`);
            } catch {
              try {
                // Try to remove as directory if unlink fails
                pyodideInstance.FS.rmdir(`/home/${item}`);
              } catch {
                // Ignore errors
              }
            }
          }
        }
      } catch {
        // If /home doesn't exist, create it
        try {
          pyodideInstance.FS.mkdir('/home');
        } catch {
          // Already exists, ignore
        }
      }
      
      // Write each file to Pyodide filesystem under /home
      let syncedCount = 0;
      let ignoredCount = 0;
      
      for (const file of files) {
        if (file.type === 'file' && file.path && file.content) {
          // Skip files matching .gitignore patterns
          if (isIgnored(file.path, gitignorePatterns)) {
            ignoredCount++;
            continue;
          }
          
          try {
            // Normalize path: remove leading slash if present, then add /home prefix
            let normalizedPath = file.path.startsWith('/') ? file.path.substring(1) : file.path;
            const pyodidePath = `/home/${normalizedPath}`;
            
            // Create directory structure
            const dirPath = pyodidePath.substring(0, pyodidePath.lastIndexOf('/'));
            if (dirPath && dirPath !== '/home') {
              createDirectoryRecursive(pyodideInstance, dirPath);
            }
            
            // Write the file
            pyodideInstance.FS.writeFile(pyodidePath, file.content);
            syncedCount++;
          } catch (error) {
            context.logger.warn(`Failed to sync file ${file.path}:`, error);
          }
        }
      }
      
      context.logger.info(
        `✅ Synced ${syncedCount} files to Pyodide` +
        (ignoredCount > 0 ? ` (${ignoredCount} ignored by .gitignore)` : '')
      );
    } catch (error) {
      context.logger.error('Failed to sync files to Pyodide:', error);
    }
  }
  
  // Helper to create directories recursively
  function createDirectoryRecursive(pyodide: PyodideInterface, path: string): void {
    const parts = path.split('/').filter(p => p);
    let currentPath = '';
    
    for (const part of parts) {
      currentPath += '/' + part;
      try {
        pyodide.FS.mkdir(currentPath);
      } catch {
        // Directory already exists, ignore
      }
    }
  }

  // List of available Pyodide packages
  const pyodidePackages = [
    'numpy', 'pandas', 'matplotlib', 'scipy', 'sklearn', 'sympy', 'networkx',
    'seaborn', 'statsmodels', 'micropip', 'bs4', 'lxml', 'pyyaml', 'requests',
    'pyodide', 'pyparsing', 'dateutil', 'jedi', 'pytz', 'sqlalchemy', 'pyarrow',
    'bokeh', 'plotly', 'altair', 'openpyxl', 'xlrd', 'xlsxwriter', 'jsonschema',
    'pillow', 'pygments', 'pytest', 'tqdm', 'scikit-image', 'scikit-learn',
    'shapely', 'zipp',
  ];

  // Execute Python code with auto-loading and sync back
  async function runPythonWithSync(code: string, projectId: string): Promise<any> {
    const pyodide = await initPyodide();
    await syncFilesToPyodide(projectId);
    
    // Auto-load packages based on import statements
    const importRegex = /^\s*import\s+([\w_]+)|^\s*from\s+([\w_]+)\s+import/gm;
    const packages = new Set<string>();
    let match;
    while ((match = importRegex.exec(code)) !== null) {
      if (match[1]) packages.add(match[1]);
      if (match[2]) packages.add(match[2]);
    }
    
    const toLoad = Array.from(packages).filter(pkg => pyodidePackages.includes(pkg));
    if (toLoad.length > 0) {
      try {
        context.logger.info(`📦 Loading Pyodide packages: ${toLoad.join(', ')}`);
        await pyodide.loadPackage(toLoad);
      } catch (e) {
        context.logger.warn(`⚠️ Failed to load some packages: ${toLoad.join(', ')}`, e);
      }
    }
    
    // Capture stdout using StringIO
    let stdout = '';
    let stderr = '';
    const captureCode = `
import sys
import io
_pyxis_stdout = sys.stdout
_pyxis_stringio = io.StringIO()
sys.stdout = _pyxis_stringio
try:
  exec("""${code.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}""", globals())
  _pyxis_result = _pyxis_stringio.getvalue()
finally:
  sys.stdout = _pyxis_stdout
del _pyxis_stringio
del _pyxis_stdout
`;
    
    try {
      await pyodide.runPythonAsync(captureCode);
      stdout = (pyodide as any).globals.get('_pyxis_result') || '';
      (pyodide as any).globals.set('_pyxis_result', undefined);
    } catch (error: any) {
      stderr = error.message || String(error);
    }
    
    // Sync files back to IndexedDB after execution
    await syncFilesFromPyodide(projectId);
    
    return { result: stdout.trim(), stdout: stdout.trim(), stderr: stderr.trim() };
  }
  
  // Sync files from Pyodide back to IndexedDB
  async function syncFilesFromPyodide(projectId: string): Promise<void> {
    if (!pyodideInstance) return;
    
    const fileRepository = await context.getSystemModule('fileRepository');
    await fileRepository.init();
    
    const pathUtils = await context.getSystemModule('pathUtils');
    
    try {
      // Get existing files from IndexedDB
      const existingFiles = await fileRepository.getProjectFiles(projectId);
      const existingPaths = new Map(existingFiles.map(f => [f.path, f]));
      
      // Parse .gitignore if it exists
      let gitignorePatterns: string[] = [];
      const gitignoreFile = existingFiles.find(f => f.path === '/.gitignore' || f.path === '.gitignore');
      if (gitignoreFile && gitignoreFile.content) {
        gitignorePatterns = parseGitignore(gitignoreFile.content);
      }
      
      // Scan /home directory for files
      const pyodideFiles = scanPyodideDirectory(pyodideInstance, '/home', '');
      
      let syncedCount = 0;
      let newFilesCount = 0;
      let updatedFilesCount = 0;
      let ignoredCount = 0;
      
      // Sync files from Pyodide to IndexedDB
      for (const file of pyodideFiles) {
        // Normalize the path
        const projectPath = pathUtils.normalizePath(file.path);
        
        // Skip files matching .gitignore patterns
        if (isIgnored(projectPath, gitignorePatterns)) {
          ignoredCount++;
          continue;
        }
        
        const existingFile = existingPaths.get(projectPath);
        
        if (existingFile) {
          // Update existing file if content changed
          if (existingFile.content !== file.content) {
            await fileRepository.updateFileContent(existingFile.id, file.content);
            updatedFilesCount++;
            syncedCount++;
          }
        } else {
          // Only create new files that were created during Python execution
          // Skip if the file path looks like a Python script that was already in the project
          // This prevents creating duplicates of source files
          const isPythonSource = projectPath.endsWith('.py');
          const wasInOriginalProject = existingFiles.some(f => f.path === projectPath);
          
          if (!isPythonSource || !wasInOriginalProject) {
            await fileRepository.createFile(projectId, projectPath, file.content, 'file');
            newFilesCount++;
            syncedCount++;
          }
        }
      }
      
      if (syncedCount > 0 || ignoredCount > 0) {
        context.logger.info(
          `✅ Synced ${syncedCount} files from Pyodide (${newFilesCount} new, ${updatedFilesCount} updated)` +
          (ignoredCount > 0 ? ` - ${ignoredCount} ignored by .gitignore` : '')
        );
      }
    } catch (error) {
      context.logger.error('Failed to sync files from Pyodide:', error);
    }
  }
  
  // Recursively scan Pyodide directory
  function scanPyodideDirectory(
    pyodide: PyodideInterface,
    pyodidePath: string,
    relativePath: string
  ): Array<{ path: string; content: string }> {
    const results: Array<{ path: string; content: string }> = [];
    
    try {
      const contents = pyodide.FS.readdir(pyodidePath);
      
      for (const item of contents) {
        if (item === '.' || item === '..') continue;
        
        const fullPyodidePath = `${pyodidePath}/${item}`;
        const fullRelativePath = relativePath ? `${relativePath}/${item}` : `/${item}`;
        
        try {
          const stat = pyodide.FS.stat(fullPyodidePath);
          
          if (pyodide.FS.isDir(stat.mode)) {
            results.push(...scanPyodideDirectory(pyodide, fullPyodidePath, fullRelativePath));
          } else {
            const content = pyodide.FS.readFile(fullPyodidePath, { encoding: 'utf8' });
            results.push({ path: fullRelativePath, content });
          }
        } catch (error) {
          context.logger.warn(`Failed to process: ${fullPyodidePath}`, error);
        }
      }
    } catch (error) {
      context.logger.warn(`Failed to read directory: ${pyodidePath}`, error);
    }
    
    return results;
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
