// Pyodideラッパークラス (CDN window.loadPyodide版)
export class PyodideRuntime {
  pyodide: any = null;
  isReady: boolean = false;
  onOutput: (output: string, type: 'log' | 'error' | 'input') => void;

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
    try {
      // print出力を取得するためにstdoutをリダイレクト
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
      await this.pyodide.runPythonAsync(captureCode);
      const output = this.pyodide.globals.get('_pyxis_result') || '';
      this.pyodide.globals.set('_pyxis_result', undefined);
      return { success: true, output: output };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
}
