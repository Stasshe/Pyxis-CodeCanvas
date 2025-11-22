/**
 * react-preview Extension
 * クライアントサイドでReact JSXをリアルタイムビルド&プレビュー
 * 
 * 機能:
 * - `react-build <entry.jsx>` コマンドでJSXをビルド
 * - esbuild-wasm (CDN経由) でJSX → React.createElement変換
 * - ビルド成功後、カスタムタブで自動プレビュー
 */

import React, { useState, useEffect, useRef } from 'react';
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

// esbuild-wasm の型定義（最小限）
interface ESBuild {
  initialize(options: { wasmURL: string }): Promise<void>;
  transform(code: string, options: {
    loader: string;
    jsxFactory?: string;
    jsxFragment?: string;
    target?: string;
  }): Promise<{ code: string }>;
}

// グローバルにロードされたesbuildインスタンス
let esbuildInstance: ESBuild | null = null;
let esbuildInitPromise: Promise<ESBuild> | null = null;

/**
 * esbuild-wasmをCDN経由でロード
 */
async function loadESBuild(): Promise<ESBuild> {
  if (esbuildInstance) return esbuildInstance;
  if (esbuildInitPromise) return esbuildInitPromise;

  esbuildInitPromise = (async () => {
    // npmでインストールされた `esbuild-wasm` を直接インポートして初期化する
    // フォールバック（CDN等）は不要という要件のため、失敗した場合は例外を投げる
    const esbuildModule = await import('esbuild-wasm');
    const esbuild = (esbuildModule as any).default || esbuildModule;

    // runtime の base path を考慮して wasm の URL を組み立てる
    // `src/app/layout.tsx` で `window.__NEXT_PUBLIC_BASE_PATH__` が設定されている想定
    const runtimeBase = (typeof window !== 'undefined' && (window as any).__NEXT_PUBLIC_BASE_PATH__) || '';
    const normalizedBase = runtimeBase.endsWith('/') ? runtimeBase.slice(0, -1) : runtimeBase;
    const wasmURL = `${normalizedBase}/extensions/react-preview/esbuild.wasm`;

    await esbuild.initialize({ wasmURL });

    esbuildInstance = esbuild;
    console.log('[react-preview] esbuild-wasm loaded from npm successfully');
    return esbuild;
  })();

  return esbuildInitPromise;
}

/**
 * import文を解析してファイルパスのリストを取得
 */
function extractImports(code: string): string[] {
  const imports: string[] = [];
  
  // import from 'path' または import from "path" のパターン
  const importRegex = /import\s+(?:[\w\s{},*]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = importRegex.exec(code)) !== null) {
    const importPath = match[1];
    
    // 相対パスのみ処理（./または../で始まる）
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      imports.push(importPath);
    }
  }
  
  return imports;
}

/**
 * 相対パスを絶対パスに解決
 */
function resolveImportPath(fromPath: string, importPath: string): string {
  const fromDir = fromPath.split('/').slice(0, -1).join('/');
  const parts = (fromDir + '/' + importPath).split('/');
  const resolved: string[] = [];
  
  for (const part of parts) {
    if (part === '..') {
      resolved.pop();
    } else if (part !== '.' && part !== '') {
      resolved.push(part);
    }
  }
  
  let result = resolved.join('/');
  
  // 拡張子がなければ .jsx を追加
  if (!result.match(/\.(jsx?|tsx?)$/)) {
    result += '.jsx';
  }
  
  // 先頭の / を確保
  if (!result.startsWith('/')) {
    result = '/' + result;
  }
  
  return result;
}

/**
 * JSXファイルとその依存関係を再帰的にビルド
 */
async function buildJSXFile(
  filePath: string,
  projectId: string,
  getSystemModule: any
): Promise<{ code: string; modules: Record<string, string>; error?: string }> {
  try {
    const esbuild = await loadESBuild();
    const fileRepository = await getSystemModule('fileRepository');
    
    const modules: Record<string, string> = {};
    const buildQueue: string[] = [filePath];
    const processed = new Set<string>();

    while (buildQueue.length > 0) {
      const currentPath = buildQueue.shift()!;
      
      // 既に処理済みならスキップ
      if (processed.has(currentPath)) continue;
      processed.add(currentPath);

      // ファイルを取得
      const file = await fileRepository.getFileByPath(projectId, currentPath);
      if (!file) {
        return { code: '', modules: {}, error: `File not found: ${currentPath}` };
      }

      // import文を抽出
      const imports = extractImports(file.content);
      
      // 依存ファイルをキューに追加
      for (const imp of imports) {
        const resolvedPath = resolveImportPath(currentPath, imp);
        if (!processed.has(resolvedPath)) {
          buildQueue.push(resolvedPath);
        }
      }

      // JSX → React.createElement に変換
      const result = await esbuild.transform(file.content, {
        loader: currentPath.endsWith('.tsx') ? 'tsx' : 'jsx',
        jsxFactory: 'React.createElement',
        jsxFragment: 'React.Fragment',
        target: 'es2020',
      });

      modules[currentPath] = result.code;
    }

    // エントリーポイントのコードを返す
    const entryCode = modules[filePath] || '';
    return { code: entryCode, modules };
  } catch (error: any) {
    return { 
      code: '', 
      modules: {},
      error: error?.message || 'Build failed'
    };
  }
}

/**
 * react-buildコマンドの実装
 */
async function reactBuildCommand(args: string[], context: any): Promise<string> {
  if (args.length === 0) {
    return 'Usage: react-build <entry.jsx>\n\nExample:\n  react-build App.jsx\n  react-build src/components/MyComponent.jsx';
  }

  const filePath = args[0];
  let output = `[react-preview] Building: ${filePath}\n`;

  try {
    // file path 正規化（sample-command と同様のルール）
    let normalizedPath = filePath;
    if (!filePath.startsWith('/')) {
      const relativeCurrent = (context.currentDirectory || '').replace(`/projects/${context.projectName}`, '');
      normalizedPath = relativeCurrent === '' ? `/${filePath}` : `${relativeCurrent}/${filePath}`;
    } else {
      normalizedPath = filePath.replace(`/projects/${context.projectName}`, '');
    }

    // ビルド実行
    const { code, modules, error } = await buildJSXFile(
      normalizedPath,
      context.projectId,
      context.getSystemModule
    );

    if (error) {
      output += `\n❌ Build failed:\n${error}\n`;
      return output;
    }

    // ビルド成功
    const moduleCount = Object.keys(modules).length;
    output += `✅ Build successful! (${moduleCount} module${moduleCount > 1 ? 's' : ''})\n`;
    
    if (moduleCount > 1) {
      output += `\nBuilt modules:\n`;
      Object.keys(modules).forEach(path => {
        output += `  - ${path}\n`;
      });
    }
    
    output += `\nEntry point code (first 500 chars):\n`;
    output += `${'='.repeat(60)}\n`;
    output += code.slice(0, 500);
    if (code.length > 500) {
      output += '\n... (truncated)';
    }
    output += `\n${'='.repeat(60)}\n`;

    // カスタムタブを開く
    try {
      const tabId = context.tabs.createTab({
        id: `preview-${filePath}`,
        title: `Preview: ${filePath}`,
        icon: 'Eye',
        closable: true,
        activateAfterCreate: true,
        data: {
          filePath,
          code,
          modules,
          builtAt: Date.now(),
        },
      });
      output += `\n📺 Preview opened in tab: ${tabId}\n`;
    } catch (tabError: any) {
      output += `\n⚠️  Preview tab could not be opened: ${tabError?.message || 'Unknown error'}\n`;
    }

    return output;
  } catch (error: any) {
    output += `\n❌ Unexpected error:\n${error?.message || error}\n`;
    return output;
  }
}

/**
 * プレビュータブコンポーネント
 */
function ReactPreviewTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<any>(null);
  const data = (tab as any).data || {};

  // エラーバウンダリ用のコンポーネント
  const ErrorBoundary = React.useMemo(() => {
    return class ErrorBoundaryClass extends React.Component<
      { children: React.ReactNode },
      { hasError: boolean; error: Error | null }
    > {
      constructor(props: any) {
        super(props);
        this.state = { hasError: false, error: null };
      }

      static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
      }

      componentDidCatch(error: Error, errorInfo: any) {
        console.error('[ReactPreview] Component error:', error, errorInfo);
      }

      render() {
        if (this.state.hasError) {
          return React.createElement('div', {
            style: {
              padding: '16px',
              background: '#3e1e1e',
              color: '#f88',
              fontFamily: 'monospace',
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
            }
          }, [
            '❌ Component Error:\n',
            this.state.error?.message || 'Unknown error',
            '\n\nStack:\n',
            this.state.error?.stack || 'No stack trace'
          ].join(''));
        }

        return this.props.children;
      }
    };
  }, []);

  // コンポーネントをレンダリング
  useEffect(() => {
    if (!isActive || !data.code) return;

    const container = containerRef.current;
    if (!container) return;

    try {
      setError(null);
      
      // React/ReactDOMをグローバルから取得
      const React = (window as any).__PYXIS_REACT__;
      const ReactDOM = (window as any).__PYXIS_REACT_DOM__;

      if (!React || !ReactDOM) {
        setError('React/ReactDOM not available');
        return;
      }

      // モジュールシステムを構築
      const moduleCache: Record<string, any> = {};
      const modules = data.modules || { [data.filePath]: data.code };

      // モジュール解決関数
      const requireModule = (modulePath: string, fromPath: string) => {
        const resolvedPath = resolveImportPath(fromPath, modulePath);
        
        if (moduleCache[resolvedPath]) {
          return moduleCache[resolvedPath];
        }

        const moduleCode = modules[resolvedPath];
        if (!moduleCode) {
          throw new Error(`Module not found: ${resolvedPath}`);
        }

        const exports: any = {};
        const module = { exports };

        // モジュールコードを実行（require関数を注入）
        const moduleFactory = new Function(
          'exports',
          'module',
          'require',
          'React',
          moduleCode + '\nreturn module.exports;'
        );

        const result = moduleFactory(
          exports,
          module,
          (path: string) => requireModule(path, resolvedPath),
          React
        );

        moduleCache[resolvedPath] = result;
        return result;
      };

      // エントリーポイントを実行
      const entryExports = requireModule(data.filePath, data.filePath);

      // default exportまたは最初のexportを使用
      const Component = entryExports.default || entryExports[Object.keys(entryExports)[0]];

      if (!Component) {
        setError('No component exported from entry point');
        return;
      }

      // コンポーネントをレンダリング（ErrorBoundaryでラップ）
      if (!rootRef.current) {
        rootRef.current = ReactDOM.createRoot(container);
      }

      rootRef.current.render(
        React.createElement(ErrorBoundary, null,
          React.createElement(Component)
        )
      );

      return () => {
        try {
          if (rootRef.current) {
            rootRef.current.unmount();
            rootRef.current = null;
          }
        } catch (e) {
          // ignore
        }
      };
    } catch (err: any) {
      setError(err?.message || 'Render failed');
      console.error('[ReactPreview] Render error:', err);
    }
  }, [isActive, data.code, data.modules, ErrorBoundary]);

  const handleRebuild = async () => {
    setIsRebuilding(true);
    setError(null);

    try {
      // コマンドレジストリ経由で再ビルド
      const commandRegistry = await (window as any).__getSystemModule('commandRegistry');
      await commandRegistry.executeCommand('react-build', [data.filePath], {
        projectName: 'default',
        projectId: '',
        currentDirectory: '/',
        getSystemModule: (window as any).__getSystemModule,
      });
    } catch (err: any) {
      setError(err?.message || 'Rebuild failed');
    } finally {
      setIsRebuilding(false);
    }
  };

  const moduleCount = data.modules ? Object.keys(data.modules).length : 1;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#1e1e1e',
        color: '#d4d4d4',
      }}
    >
      {/* ヘッダー */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
            React Preview: {data.filePath || 'Unknown'}
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
            Built at: {data.builtAt ? new Date(data.builtAt).toLocaleString() : 'N/A'}
            {moduleCount > 1 && ` • ${moduleCount} modules`}
          </p>
        </div>
        <button
          onClick={handleRebuild}
          disabled={isRebuilding}
          style={{
            padding: '6px 12px',
            background: '#007acc',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: isRebuilding ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            opacity: isRebuilding ? 0.6 : 1,
          }}
        >
          {isRebuilding ? 'Rebuilding...' : 'Rebuild'}
        </button>
      </div>

      {/* エラー表示 */}
      {error && (
        <div
          style={{
            padding: '16px',
            background: '#3e1e1e',
            color: '#f88',
            fontFamily: 'monospace',
            fontSize: '12px',
            whiteSpace: 'pre-wrap',
          }}
        >
          ❌ Error: {error}
        </div>
      )}

      {/* プレビューコンテナ */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px',
          background: '#fff',
          color: '#000',
        }}
      />
    </div>
  );
}

/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('react-preview activating...');

  // タブタイプを登録
  context.tabs.registerTabType(ReactPreviewTabComponent);
  context.logger.info('Tab type "react-preview" registered');

  // react-buildコマンドを登録
  context.commands.registerCommand('react-build', reactBuildCommand);
  context.logger.info('Command "react-build" registered');

  // esbuild-wasmを事前ロード（オプション）
  loadESBuild().catch(err => {
    context.logger.error('Failed to preload esbuild-wasm:', err);
  });

  context.logger.info('react-preview activated successfully');

  return {};
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('react-preview deactivated');
  esbuildInstance = null;
  esbuildInitPromise = null;
}