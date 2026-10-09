/**
 * Pyxis Python Runtime Extension
 *
 * Python runtime using Pyodide for browser-based Python execution
 */

import type { CommandContext, ExtensionActivation, ExtensionContext } from '../_shared/types';

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

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('Python Runtime Extension activating...');

  // Initialize Pyodide
  async function initPyodide(): Promise<PyodideInterface> {
    if (pyodideInstance) {
      return pyodideInstance;
    }

    // @ts-expect-error - loadPyodide is loaded from CDN
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
  // Convert project path to Pyodide path, stripping /pyodide prefix if present
  function normalizePathToPyodide(projectPath: string): string {
    if (!projectPath) return projectPath;
    // ensure leading slash
    const p = projectPath.startsWith('/') ? projectPath : `/${projectPath}`;
    if (p === '/pyodide') return '/';
    if (p.startsWith('/pyodide/')) return p.replace('/pyodide', '');
    return p;
  }

  // Convert Pyodide path back to project path, stripping /pyodide prefix if present
  function normalizePathFromPyodide(pyodideRelativePath: string): string {
    if (!pyodideRelativePath) return pyodideRelativePath;
    // ensure leading slash
    const p = pyodideRelativePath.startsWith('/') ? pyodideRelativePath : `/${pyodideRelativePath}`;
    if (p === '/pyodide') return '/';
    if (p.startsWith('/pyodide/')) return p.replace('/pyodide', '');
    return p;
  }

  async function syncFilesToPyodide(rootPath: string): Promise<void> {
    if (!pyodideInstance) return;

    const fsClient = await context.getSystemModule('fsClient');
    const pathUtils = await context.getSystemModule('pathUtils');

    try {
      // Get all files from the project
      const files = await fsClient.walk(rootPath);

      // Parse .gitignore if it exists
      let gitignorePatterns: string[] = [];
      const gitignorePath = pathUtils.resolvePath(rootPath, '.gitignore');
      if (await fsClient.exists(gitignorePath)) {
        gitignorePatterns = parseGitignore(await fsClient.readText(gitignorePath));
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
        if (file.type === 'file' && file.path) {
          const relativePath = pathUtils.posixPath.relative(rootPath, file.path);
          const content = await fsClient.readText(file.path);
          // Skip files matching .gitignore patterns
          if (isIgnored(relativePath, gitignorePatterns)) {
            ignoredCount++;
            continue;
          }

          try {
            // Normalize path: strip /pyodide prefix if present
            const normalizedProjectPath = normalizePathToPyodide(relativePath);
            const pyodidePath = `/home${normalizedProjectPath}`;

            // Create directory structure
            const dirPath = pyodidePath.substring(0, pyodidePath.lastIndexOf('/'));
            if (dirPath && dirPath !== '/home') {
              createDirectoryRecursive(pyodideInstance, dirPath);
            }

            // Write the file
            pyodideInstance.FS.writeFile(pyodidePath, content);
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
    'numpy',
    'pandas',
    'matplotlib',
    'scipy',
    'sklearn',
    'sympy',
    'networkx',
    'seaborn',
    'statsmodels',
    'micropip',
    'bs4',
    'lxml',
    'pyyaml',
    'requests',
    'pyodide',
    'pyparsing',
    'dateutil',
    'jedi',
    'pytz',
    'sqlalchemy',
    'pyarrow',
    'bokeh',
    'plotly',
    'altair',
    'openpyxl',
    'xlrd',
    'xlsxwriter',
    'jsonschema',
    'pillow',
    'pygments',
    'pytest',
    'tqdm',
    'scikit-image',
    'scikit-learn',
    'shapely',
    'zipp',
  ];

  // Execute Python code with auto-loading and sync back
  async function runPythonWithSync(
    code: string,
    rootPath: string
  ): Promise<{ result: string; stdout: string; stderr: string }> {
    const pyodide = await initPyodide();
    await syncFilesToPyodide(rootPath);

    // Auto-load packages based on import statements
    const importRegex = /^\s*import\s+([\w_]+)|^\s*from\s+([\w_]+)\s+import/gm;
    const packages = new Set<string>();
    let match: RegExpExecArray | null = null;
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
    await syncFilesFromPyodide(rootPath);

    return { result: stdout.trim(), stdout: stdout.trim(), stderr: stderr.trim() };
  }

  // Sync files from Pyodide back to IndexedDB
  async function syncFilesFromPyodide(rootPath: string): Promise<void> {
    if (!pyodideInstance) return;

    const fsClient = await context.getSystemModule('fsClient');
    const pathUtils = await context.getSystemModule('pathUtils');

    try {
      // Get existing files from IndexedDB
      const existingFiles = await fsClient.walk(rootPath);
      const existingPaths = new Map(existingFiles.map(f => [f.path, f]));

      // Parse .gitignore if it exists
      let gitignorePatterns: string[] = [];
      const gitignorePath = pathUtils.resolvePath(rootPath, '.gitignore');
      if (await fsClient.exists(gitignorePath)) {
        gitignorePatterns = parseGitignore(await fsClient.readText(gitignorePath));
      }

      // Scan /home directory for files
      const pyodideFiles = scanPyodideDirectory(pyodideInstance, '/home', '');

      let syncedCount = 0;
      let newFilesCount = 0;
      let updatedFilesCount = 0;
      let ignoredCount = 0;

      // Sync files from Pyodide to IndexedDB
      for (const file of pyodideFiles) {
        // Normalize the path: strip /pyodide prefix if present
        const relativePath = normalizePathFromPyodide(file.path).replace(/^\/+/, '');
        const projectPath = pathUtils.resolvePath(rootPath, relativePath);

        // Skip files matching .gitignore patterns
        if (isIgnored(relativePath, gitignorePatterns)) {
          ignoredCount++;
          continue;
        }

        const existingFile = existingPaths.get(projectPath);

        if (existingFile) {
          // Update existing file if content changed
          if ((await fsClient.readText(existingFile.path)) !== file.content) {
            await fsClient.writeFile(existingFile.path, file.content);
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
            await fsClient.mkdir(pathUtils.getParentPath(projectPath), { recursive: true });
            await fsClient.writeFile(projectPath, file.content);
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

    async initialize(rootPath: string): Promise<void> {
      context.logger.info(`🐍 Initializing Python runtime for workspace: ${rootPath}`);
      await initPyodide();
      await syncFilesToPyodide(rootPath);
    },

    async execute(options: any): Promise<any> {
      const { rootPath, filePath } = options;

      try {
        context.logger.info(`🐍 Executing Python file: ${filePath}`);

        const fsClient = await context.getSystemModule('fsClient');
        if (!(await fsClient.exists(filePath))) {
          throw new Error(`File not found: ${filePath}`);
        }
        const content = await fsClient.readText(filePath);

        // Execute the Python code
        const result = await runPythonWithSync(content, rootPath);

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

    isReady(): boolean {
      return pyodideInstance !== null;
    },
  });

  // Register 'python' terminal command
  if (context.commands) {
    context.commands.registerCommand(
      'python',
      async (args: string[], cmdContext: CommandContext) => {
        try {
          if (args.length === 0) {
            return 'Usage: python <file.py> or python -c "<code>"';
          }

          // Handle -c flag for inline code execution
          if (args[0] === '-c') {
            const code = args.slice(1).join(' ');
            const result = await runPythonWithSync(code, cmdContext.rootPath);
            return result.stdout || result.stderr || '';
          }

          // Execute Python file
          const filePath = args[0];
          const fsClient = await context.getSystemModule('fsClient');
          const pathUtils = await context.getSystemModule('pathUtils');
          const normalizedPath = pathUtils.resolvePath(cmdContext.currentDirectory, filePath);
          if (!(await fsClient.exists(normalizedPath))) {
            return `Error: File not found: ${normalizedPath}`;
          }

          const result = await runPythonWithSync(
            await fsClient.readText(normalizedPath),
            cmdContext.rootPath
          );
          return result.stdout || result.stderr || '';
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    );
    context.logger.info('✅ Registered terminal command: python');
  }

  context.logger.info('✅ Python Runtime Extension activated');

  return {};
}

/**
 * Extension deactivation
 */
export async function deactivate(): Promise<void> {
  console.log('[Python Runtime] Deactivating...');
}
