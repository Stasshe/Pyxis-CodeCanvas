import { fileRepository } from '@/engine/core/fileRepository';
import { runtimeError, runtimeInfo, runtimeWarn } from '@/engine/runtime/runtimeLogger';

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
  globals?: any; // for direct access
}

let pyodideInstance: PyodideInterface | null = null;
let currentProjectId: string | null = null;
let currentProjectName: string | null = null;

export async function initPyodide(): Promise<PyodideInterface> {
  if (pyodideInstance) {
    return pyodideInstance;
  }

  // @ts-ignore
  const pyodide = await window.loadPyodide({
    stdout: (msg: string) => runtimeInfo(msg, 'log'),
    stderr: (msg: string) => runtimeError(msg, 'error'),
  });

  pyodideInstance = pyodide;
  return pyodide;
}

export function getPyodide(): PyodideInterface | null {
  return pyodideInstance;
}

/**
 * Convert a project (IndexedDB) path to a path appropriate for Pyodide's /home
 * If project paths include a leading /pyodide prefix, strip it so files end up under /home/<path>
 */
function normalizePathToPyodide(projectPath: string): string {
  if (!projectPath) return projectPath;
  // ensure leading slash
  const p = projectPath.startsWith('/') ? projectPath : `/${projectPath}`;
  if (p === '/pyodide') return '/';
  if (p.startsWith('/pyodide/')) return p.replace('/pyodide', '');
  return p;
}

/**
 * Convert a pyodide relative path (returned from scan) into the project path used in IndexedDB
 * If pyodide contains a /pyodide prefix, drop it.
 */
function normalizePathFromPyodide(pyodideRelativePath: string): string {
  if (!pyodideRelativePath) return pyodideRelativePath;
  // ensure leading slash
  const p = pyodideRelativePath.startsWith('/') ? pyodideRelativePath : `/${pyodideRelativePath}`;
  if (p === '/pyodide') return '/';
  if (p.startsWith('/pyodide/')) return p.replace('/pyodide', '');
  return p;
}

export async function setCurrentProject(projectId: string, projectName: string): Promise<void> {
  currentProjectId = projectId;
  currentProjectName = projectName;

  // Pyodideが初期化されていれば、ファイルシステムを同期
  if (pyodideInstance && projectId) {
    await syncPyodideFromIndexedDB(projectId);
  }
}

/**
 * IndexedDBからPyodideのファイルシステムへ同期
 * NEW-ARCHITECTURE: fileRepositoryから読み取り、Pyodideに書き込むだけ
 */
export async function syncPyodideFromIndexedDB(projectId: string): Promise<void> {
  const pyodide = await initPyodide();

  try {
    // IndexedDBから全ファイルを効率的に取得（prefix '/' でプロジェクト全体）
    const files = await fileRepository.getFilesByPrefix(projectId, '/');

    // Pyodideのファイルシステムをクリア（/homeディレクトリを再作成）
    try {
      const homeContents = pyodide.FS.readdir('/home');
      for (const item of homeContents) {
        if (item !== '.' && item !== '..') {
          try {
            pyodide.FS.unlink(`/home/${item}`);
          } catch {
            try {
              pyodide.FS.rmdir(`/home/${item}`);
            } catch {
              // 無視
            }
          }
        }
      }
    } catch {
      // /homeが存在しない場合は作成
      try {
        pyodide.FS.mkdir('/home');
      } catch {
        // 既に存在する場合は無視
      }
    }

    // 各ファイルをPyodideに書き込む
    for (const file of files) {
      if (file.type === 'file' && file.content) {
        // project path -> pyodide path mapping
        const normalizedProjectPath = normalizePathToPyodide(file.path);
        const pyodidePath = `/home${normalizedProjectPath}`;

        // ディレクトリを作成
        const dirPath = pyodidePath.substring(0, pyodidePath.lastIndexOf('/'));
        createDirectoryRecursive(pyodide, dirPath);

        // ファイルを書き込む
        try {
          pyodide.FS.writeFile(pyodidePath, file.content);
        } catch (error) {
          runtimeWarn(`Failed to write file to Pyodide: ${pyodidePath}`, error);
        }
      }
    }

    runtimeInfo(`Synced ${files.filter(f => f.type === 'file').length} files to Pyodide`);
  } catch (error) {
    runtimeError('Failed to sync Pyodide from IndexedDB:', error);
    throw error;
  }
}

/**
 * PyodideのファイルシステムからIndexedDBへ同期
 * NEW-ARCHITECTURE: Pyodideから読み取り、fileRepositoryに書き込むだけ
 * 自動的にGitFileSystemに同期される
 */
export async function syncPyodideToIndexedDB(projectId: string): Promise<void> {
  if (!pyodideInstance) {
    runtimeWarn('Pyodide not initialized');
    return;
  }

  try {
    // 現在のIndexedDBファイル一覧を取得（prefix '/' でプロジェクト全体）
    const existingFiles = await fileRepository.getFilesByPrefix(projectId, '/');
    const existingPaths = new Set(existingFiles.map(f => f.path));

    // Pyodideの/homeディレクトリを再帰的にスキャン
    const pyodideFiles = scanPyodideDirectory(pyodideInstance, '/home', '');

    // Pyodideのファイルを同期
    for (const { path, content } of pyodideFiles) {
      // pyodide -> project path mapping
      const projectPath = normalizePathFromPyodide(path);

      const existingFile = existingFiles.find(f => f.path === projectPath);

      if (existingFile) {
        // 既存ファイルの更新
        if (existingFile.content !== content) {
          await fileRepository.saveFile({
            ...existingFile,
            content,
            updatedAt: new Date(),
          });
        }
      } else {
        // 新規ファイルの作成
        await fileRepository.createFile(projectId, projectPath, content, 'file');
      }

      existingPaths.delete(projectPath);
    }

    // Pyodideに存在しないファイルを削除
    for (const path of existingPaths) {
      const file = existingFiles.find(f => f.path === path);
      if (file && file.type === 'file') {
        await fileRepository.deleteFile(file.id);
      }
    }

    runtimeInfo(`Synced ${pyodideFiles.length} files from Pyodide to IndexedDB`);
  } catch (error) {
    runtimeError('Failed to sync Pyodide to IndexedDB:', error);
    throw error;
  }
}

/**
 * Pyodideのディレクトリを再帰的にスキャン
 */
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
          // ディレクトリの場合は再帰的にスキャン
          results.push(...scanPyodideDirectory(pyodide, fullPyodidePath, fullRelativePath));
        } else {
          // ファイルの場合は内容を読み取る
          const content = pyodide.FS.readFile(fullPyodidePath, { encoding: 'utf8' });
          results.push({ path: fullRelativePath, content });
        }
      } catch (error) {
        runtimeWarn(`Failed to process: ${fullPyodidePath}`, error);
      }
    }
  } catch (error) {
    runtimeWarn(`Failed to read directory: ${pyodidePath}`, error);
  }

  return results;
}

/**
 * ディレクトリを再帰的に作成
 */
function createDirectoryRecursive(pyodide: PyodideInterface, path: string): void {
  const parts = path.split('/').filter(p => p);
  let currentPath = '';

  for (const part of parts) {
    currentPath += '/' + part;
    try {
      pyodide.FS.mkdir(currentPath);
    } catch {
      // ディレクトリが既に存在する場合は無視
    }
  }
}

/**
 * Pythonコードを実行（ファイルシステムの自動同期付き）
 */
export async function runPythonWithSync(
  code: string,
  projectId: string
): Promise<{ result: any; stdout: string; stderr: string }> {
  const pyodide = await initPyodide();

  // 実行前: IndexedDBからPyodideへ同期
  await syncPyodideFromIndexedDB(projectId);

  // --- 追加: import文から必要なパッケージを自動ロード ---
  // import文を抽出
  const importRegex = /^\s*import\s+([\w_]+)|^\s*from\s+([\w_]+)\s+import/gm;
  const packages = new Set<string>();
  let match;
  while ((match = importRegex.exec(code)) !== null) {
    if (match[1]) packages.add(match[1]);
    if (match[2]) packages.add(match[2]);
  }
  // Pyodide標準パッケージリスト（必要なら拡張）
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
    'pycrypto',
    'pycryptodome',
    'pyjwt',
    'pyopenssl',
    'pyperclip',
    'pyzbar',
    'pyzmq',
    'pywavelets',
    'pywebview',
    'pywin32',
    'pyinstaller',
    'pycparser',
    'pyflakes',
    'pygal',
    'pyglet',
    'pygraphviz',
    'pygtrie',
    'pyhdf',
    'pyjokes',
    'pyld',
    'pymongo',
    'pynput',
    'pyodbc',
    'pyproj',
    'pyqt5',
    'pyqtgraph',
    'pyserial',
    'pyspark',
    'pytest',
    'python-dateutil',
    'python-docx',
    'python-pptx',
    'python-telegram-bot',
    'pytz',
    'pyvis',
    'pyyaml',
    'pyzmq',
    'scikit-image',
    'scikit-learn',
    'scipy',
    'seaborn',
    'shapely',
    'sklearn',
    'sqlalchemy',
    'statsmodels',
    'sympy',
    'tqdm',
    'xlrd',
    'xlsxwriter',
    'zipp',
  ];
  const toLoad = Array.from(packages).filter(pkg => pyodidePackages.includes(pkg));
  if (toLoad.length > 0) {
    try {
      await pyodide.loadPackage(toLoad);
    } catch (e) {
      runtimeWarn(`Pyodide package load failed: ${toLoad.join(', ')}`, e);
    }
  }

  // print出力を必ず取得するため、exec+StringIOでstdoutをキャプチャ
  let result: any = undefined;
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
    result = stdout;
  } catch (e: any) {
    stderr = e.message || String(e);
  }

  // 実行後: PyodideからIndexedDBへ同期
  await syncPyodideToIndexedDB(projectId);

  return { result, stdout: stdout.trim(), stderr: stderr.trim() };
}
