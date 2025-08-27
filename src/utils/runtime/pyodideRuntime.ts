import { getAllFilesAndDirs } from '@/utils/core/filesystem';
export class PyodideRuntime {
  
  /**
   * Lightning-FSの仮想ファイルシステム全体をPyodide FSに同期する（/projects配下）
   * @param pyodideRuntimeInstance PyodideRuntimeインスタンス
   * @param baseDir 同期したいLightning-FSのベースディレクトリ（デフォルト: /projects）
  */
 // Pyodideラッパークラス (CDN window.loadPyodide版)
 
 pyodide: any = null;
 isReady: boolean = false;
 onOutput: (output: string, type: 'log' | 'error' | 'input') => void;

  /**
   * Pythonミニライブラリ（パッケージ）をインストールする
   * @param packages インストールしたいパッケージ名の配列
   */
  async installPackages(packages: string[]) {
    if (!this.isReady) await this.load();
    try {
      // micropipがなければロード
      if (!this.pyodide.isPyodidePackageLoaded || !this.pyodide.isPyodidePackageLoaded('micropip')) {
        await this.pyodide.loadPackage('micropip');
      }
      const micropip = this.pyodide.pyimport('micropip');
      await micropip.install(packages);
      this.onOutput(`[Pyodide] パッケージインストール完了: ${packages.join(', ')}`, 'log');
      return { success: true };
    } catch (e: any) {
      this.onOutput(`[Pyodide] パッケージインストール失敗: ${e.message}`, 'error');
      return { success: false, error: e.message };
    }
  }

 static async syncLightningFSToPyodideFS(pyodideRuntimeInstance: PyodideRuntime, baseDir: string = '/projects') {
   const files = await getAllFilesAndDirs(baseDir);
   await pyodideRuntimeInstance.syncFilesToPyodideFS(files);
  
  }
 /**
  * Pyodideの仮想ファイルシステムにファイル・ディレクトリを同期する
  * @param files [{ path, content, type }]
   */
  async syncFilesToPyodideFS(files: Array<{ path: string; content?: string; type: 'file' | 'folder' }>) {
    if (!this.isReady) await this.load();
    const FS = this.pyodide.FS;
    // まずディレクトリを先に作成
    const dirs = files.filter(f => f.type === 'folder').sort((a, b) => a.path.length - b.path.length);
    for (const dir of dirs) {
      try {
        FS.mkdirTree(dir.path);
      } catch (e) {
        // 既存なら無視
      }
    }
    // ファイルを書き込み
    const fileItems = files.filter(f => f.type === 'file');
    for (const file of fileItems) {
      try {
        // 親ディレクトリがなければ作成
        const parent = file.path.substring(0, file.path.lastIndexOf('/'));
        if (parent) {
          try { FS.stat(parent); } catch { FS.mkdirTree(parent); }
        }
        FS.writeFile(file.path, file.content || '');
      } catch (e) {
  const msg = (e as any)?.message || String(e);
  this.onOutput(`[PyodideFS] Failed to sync file: ${file.path} (${msg})`, 'error');
      }
    }
    this.onOutput('[PyodideFS] ファイルシステム同期完了', 'log');
  }

  constructor(onOutput: (output: string, type: 'log' | 'error' | 'input') => void) {
    this.onOutput = onOutput;
  }

  async load() {
    if (this.isReady) return;
    // @ts-ignore
    this.pyodide = await window.loadPyodide({
      stdout: (msg: string) => this.onOutput(msg, 'log'),
      stderr: (msg: string) => this.onOutput(msg, 'error'),
    });
    this.isReady = true;
  }

  async executePython(code: string) {
    if (!this.isReady) await this.load();
    // コードからimport文を抽出し、必要なパッケージを自動インストール
    let codeStr = code;
    if (typeof code === 'object' && code !== null && (code as any).latexInput) {
      codeStr = '';
    }
    // import文抽出（簡易: "import xxx"/"from xxx import"）
    const importRegex = /(?:import|from)\s+([a-zA-Z0-9_]+)/g;
    const pkgs = new Set<string>();
    let match;
    while ((match = importRegex.exec(codeStr)) !== null) {
      pkgs.add(match[1]);
    }
    // sympy, mpmathは必ずロード
    pkgs.add('sympy');
    pkgs.add('mpmath');
    for (const pkg of pkgs) {
      try {
        await this.pyodide.loadPackage(pkg);
      } catch (e) {
        // ロード失敗は無視（Pyodide未対応パッケージ等）
      }
    }
    // LaTeX入力対応: codeが { latexInput, latexEvalType, latexEvalArgs } を持つ場合
    if (typeof code === 'object' && code !== null && (code as any).latexInput) {
      const { latexInput, latexEvalType, latexEvalArgs } = code as any;
      let pyCode = `import sys\nimport io\n_pyxis_stdout = sys.stdout\n_pyxis_stringio = io.StringIO()\nsys.stdout = _pyxis_stringio\nfrom sympy import *\nfrom sympy.parsing.latex import parse_latex\ntry:\n    expr = parse_latex("""${latexInput.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}""")\n`;
      if (latexEvalType === 'limit' && latexEvalArgs) {
        pyCode += `    result = limit(expr, Symbol('${latexEvalArgs.var}'), ${latexEvalArgs.point}, dir='${latexEvalArgs.dir || '+'}')\n`;
      } else if (latexEvalType === 'diff' && latexEvalArgs) {
        pyCode += `    result = diff(expr, Symbol('${latexEvalArgs.var}'))\n`;
      } else if (latexEvalType === 'integrate' && latexEvalArgs) {
        pyCode += `    result = integrate(expr, Symbol('${latexEvalArgs.var}'))\n`;
      } else {
        pyCode += `    result = expr\n`;
      }
      pyCode += `    print(latex(result))\n    _pyxis_result = _pyxis_stringio.getvalue()\nfinally:\n    sys.stdout = _pyxis_stdout\ndel _pyxis_stringio\ndel _pyxis_stdout\n`;
      try {
        await this.pyodide.runPythonAsync(pyCode);
        const output = this.pyodide.globals.get('_pyxis_result') || '';
        this.pyodide.globals.set('_pyxis_result', undefined);
        return { success: true, output: output };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    } else {
      // 通常のPythonコード
      try {
        const captureCode = `
import sys
import io
_pyxis_stdout = sys.stdout
_pyxis_stringio = io.StringIO()
sys.stdout = _pyxis_stringio
try:
    exec("""${typeof code === 'string' ? code.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') : ''}""", globals())
    _pyxis_result = _pyxis_stringio.getvalue()
finally:
    sys.stdout = _pyxis_stdout
del _pyxis_stringio
del _pyxis_stdout
`;
        await this.pyodide.runPythonAsync(captureCode);
        const output = this.pyodide.globals.get('_pyxis_result') || '';
        this.pyodide.globals.set('_pyxis_result', undefined);
        return { success: true, output: output };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }
  }
}
