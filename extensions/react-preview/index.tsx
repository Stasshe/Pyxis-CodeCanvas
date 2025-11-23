/**
 * react-preview Extension
 * React JSXをブラウザでビルド&プレビュー（Tailwind CSS対応）
 */

import React, { useState, useEffect, useRef } from 'react';

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

interface ESBuild {
  initialize(options: { wasmURL: string }): Promise<void>;
  build(options: {
    stdin?: { contents: string; resolveDir?: string; sourcefile?: string; loader?: string };
    bundle: boolean;
    format: string;
    write: boolean;
    plugins?: any[];
    target?: string;
    jsxFactory?: string;
    jsxFragment?: string;
    external?: string[];
  }): Promise<{ outputFiles: Array<{ text: string }> }>;
}

let esbuildInstance: ESBuild | null = null;
let isInitializing = false;

async function loadESBuild(): Promise<ESBuild> {
  if (esbuildInstance) return esbuildInstance;

  // 既に初期化中なら待機
  if (isInitializing) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return loadESBuild();
  }

  isInitializing = true;

  try {
    const esbuildModule = await import('esbuild-wasm');
    const esbuild = (esbuildModule as any).default || esbuildModule;

    // 既に初期化済みかチェック
    if (esbuildInstance) {
      isInitializing = false;
      return esbuildInstance;
    }

    const runtimeBase = (typeof window !== 'undefined' && (window as any).__NEXT_PUBLIC_BASE_PATH__) || '';
    const normalizedBase = runtimeBase.endsWith('/') ? runtimeBase.slice(0, -1) : runtimeBase;
    const wasmURL = `${normalizedBase}/extensions/react-preview/esbuild.wasm`;

    await esbuild.initialize({ wasmURL });
    esbuildInstance = esbuild;
    
    return esbuild;
  } finally {
    isInitializing = false;
  }
}

/**
 * 仮想ファイルシステムプラグイン
 */
function createVirtualFSPlugin(projectId: string, fileRepository: any) {
  return {
    name: 'virtual-fs',
    setup(build: any) {
      // npm ライブラリの解決（./や../から始まらないもの）
      build.onResolve({ filter: /^[^./]/ }, async (args: any) => {
        if (args.path.startsWith('react') || args.path.startsWith('react-dom')) {
          return { path: args.path, external: true };
        }
        try {
          // プロジェクトルートの node_modules から読み込みを試みる
          const file = await fileRepository.getFileByPath(projectId, `/node_modules/${args.path}`);
          if (file) {
            return { path: `/node_modules/${args.path}`, namespace: 'virtual' };
          }
        } catch (e) {
          // ファイルが見つからない場合は external として扱う
        }
        return { path: args.path, external: true };
      });

      // 相対パスの解決
      build.onResolve({ filter: /^\./ }, async (args: any) => {
        const fromDir = args.importer === '<stdin>' 
          ? args.resolveDir 
          : args.importer.split('/').slice(0, -1).join('/');
        
        const parts = (fromDir + '/' + args.path).split('/');
        const resolved: string[] = [];
        
        for (const part of parts) {
          if (part === '' || part === '.') continue;
          if (part === '..') {
            if (resolved.length > 0) resolved.pop();
            continue;
          }
          resolved.push(part);
        }
        
        let path = '/' + resolved.join('/');
        
        // 拡張子補完（CSSは除く）
        if (!path.match(/\.[^/]+$/)) {
          path += '.jsx';
        }
        
        return { path, namespace: 'virtual' };
      });

      // ファイルの読み込み
      build.onLoad({ filter: /.*/, namespace: 'virtual' }, async (args: any) => {
        const file = await fileRepository.getFileByPath(projectId, args.path);
        
        if (!file) {
          return { errors: [{ text: `File not found: ${args.path}` }] };
        }

        // CSSはスタイル注入コードに変換
        if (args.path.match(/\.css$/i)) {
          const cssContent = JSON.stringify(file.content);
          const code = `
            (function() {
              var style = document.createElement('style');
              style.textContent = ${cssContent};
              style.setAttribute('data-react-preview', '${args.path}');
              document.head.appendChild(style);
            })();
          `;
          return { contents: code, loader: 'js' };
        }

        // 画像などはスキップ
        if (args.path.match(/\.(png|jpe?g|svg|gif|webp)$/i)) {
          return { contents: '', loader: 'text' };
        }

        return {
          contents: file.content,
          loader: args.path.endsWith('.tsx') ? 'tsx' : 'jsx',
        };
      });
    },
  };
}

/**
 * JSXファイルをビルド
 */
async function buildJSX(
  filePath: string,
  projectId: string,
  context: ExtensionContext
): Promise<{ code: string; error?: string }> {
  try {
    const esbuild = await loadESBuild();
    const fileRepository = await context.getSystemModule('fileRepository');
    const file = await fileRepository.getFileByPath(projectId, filePath);
    if (!file) {
      return { code: '', error: `File not found: ${filePath}` };
    }
    
    const result = await esbuild.build({
      stdin: {
        contents: file.content,
        resolveDir: filePath.split('/').slice(0, -1).join('/') || '/',
        sourcefile: filePath,
        loader: filePath.endsWith('.tsx') ? 'tsx' : 'jsx',
      },
      bundle: true,
      format: 'cjs',
      write: false,
      plugins: [createVirtualFSPlugin(projectId, fileRepository)],
      target: 'es2020',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      external: ['react', 'react-dom', 'react-dom/client'],
    });

    const bundled = result.outputFiles[0].text;
    const transformImportsModule = await context.getSystemModule('transformImports');
    const transformed = transformImportsModule(bundled);

    return { code: transformed };
  } catch (error: any) {
    return { code: '', error: error?.message || 'Build failed' };
  }
}

/**
 * react-buildコマンド
 */
async function reactBuildCommand(args: string[], context: any): Promise<string> {
  if (args.length === 0) {
    return 'Usage: react-build <entry.jsx> [--tailwind]\n\nExample:\n  react-build App.jsx\n  react-build App.jsx --tailwind\n  react-build src/App.jsx --tailwind';
  }

  const filePath = args[0];
  const useTailwind = args.includes('--tailwind');
  
  // パス正規化
  let normalizedPath = filePath;
  if (!filePath.startsWith('/')) {
    const relativeCurrent = (context.currentDirectory || '').replace(`/projects/${context.projectName}`, '');
    normalizedPath = relativeCurrent === '' ? `/${filePath}` : `${relativeCurrent}/${filePath}`;
  } else {
    normalizedPath = filePath.replace(`/projects/${context.projectName}`, '');
  }

  const { code, error } = await buildJSX(
    normalizedPath,
    context.projectId,
    context,
  );

  if (error) {
    return `[react-preview] Building: ${filePath}\n❌ Build failed:\n${error}\n`;
  }

  // プレビュータブを開く
  context.tabs.createTab({
    id: `preview-${normalizedPath}`,
    title: `Preview: ${normalizedPath}`,
    icon: 'Eye',
    closable: true,
    activateAfterCreate: true,
    data: { filePath: normalizedPath, code, builtAt: Date.now(), useTailwind },
  });

  const tailwindMsg = useTailwind ? '\n🎨 Tailwind CSS enabled' : '';
  return `[react-preview] Building: ${filePath}\n✅ Build successful!${tailwindMsg}\n\n📺 Preview opened in tab\n`;
}

function ReactPreviewTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'error'>('loading');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const data = tab.data || {};
  const useTailwind = data.useTailwind || false;
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!isActive) return;

    const iframe = iframeRef.current;
    if (!iframe) return;

    // iframe属性を明示的に設定
    iframe.setAttribute('crossorigin', 'anonymous');
    iframe.setAttribute('allow', '*');

    // 前回の状態をクリア
    setLoadingState('loading');
    setError(null);

    let timeoutId: number;

    const initIframe = () => {
      const doc = iframe.contentDocument;
      if (!doc) {
        setError('Cannot access iframe document - CORS or security issue');
        setLoadingState('error');
        return;
      }

      try {
        let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src *; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; font-src * data:; connect-src *; frame-src *;">
  <script src="https://cdn.jsdelivr.net/npm/eruda"></script>
  <script>eruda.init();</script>
  <style>
    body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #root { width: 100%; min-height: 100vh; }
  </style>`;

        if (useTailwind) {
          html += '\n  <script src="https://cdn.tailwindcss.com"><\/script>';
        }

        html += `\n</head>
<body>
  <div id="root"></div>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom-client.production.min.js"><\/script>
  <script>
    // 親にステータスを通知
    window.onerror = function(msg, url, line, col, error) {
      window.parent.postMessage({ type: 'preview-error', error: String(msg) }, '*');
      return false;
    };

    window.React = React;
    window.ReactDOM = ReactDOM;

    function shimRequire(name) {
      if (name === 'react') return React;
      if (name === 'react-dom') return ReactDOM;
      if (name === 'react-dom/client') return ReactDOM;
      throw new Error('Module not found: ' + name);
    }

    // すべてのリソースがロードされるまで待つ
    window.addEventListener('load', function() {
      try {
        const code = ${JSON.stringify(data.code)};
        const module = { exports: {} };
        const moduleFunc = new Function('module', 'exports', 'require', code);
        moduleFunc(module, module.exports, shimRequire);
        
        const Component = module.exports.default || module.exports;
        
        if (!Component) {
          throw new Error('No component exported');
        }

        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(React.createElement(Component));
        
        // 成功を親に通知
        window.parent.postMessage({ type: 'preview-ready' }, '*');
      } catch (err) {
        const root = document.getElementById('root');
        root.innerHTML = '<div style="color: #f88; padding: 16px; font-family: monospace; font-size: 12px; white-space: pre-wrap;">Error: ' + (err?.message || 'Unknown error') + '</div>';
        window.parent.postMessage({ type: 'preview-error', error: err?.message || 'Unknown error' }, '*');
      }
    });
  <\/script>
</body>
</html>`;

        doc.open();
        doc.write(html);
        doc.close();

        // タイムアウト設定（10秒以内にreadyが来なければエラー）
        timeoutId = window.setTimeout(() => {
          if (mountedRef.current && loadingState === 'loading') {
            setError('Preview timeout: React failed to load or render');
            setLoadingState('error');
          }
        }, 10000);

      } catch (err: any) {
        setError(err?.message || 'Failed to initialize iframe');
        setLoadingState('error');
      }
    };

    // postMessageリスナー
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      
      if (event.data.type === 'preview-ready') {
        if (mountedRef.current) {
          setLoadingState('ready');
          setError(null);
          clearTimeout(timeoutId);
        }
      } else if (event.data.type === 'preview-error') {
        if (mountedRef.current) {
          setError(event.data.error);
          setLoadingState('error');
          clearTimeout(timeoutId);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // iframe loadイベントを待ってから初期化
    if (iframe.contentDocument?.readyState === 'complete') {
      initIframe();
    } else {
      iframe.onload = initIframe;
      // iframe読み込みエラー時もハンドリング
      iframe.onerror = () => {
        setError('Failed to load iframe - network or CORS error');
        setLoadingState('error');
      };
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(timeoutId);
    };
  }, [isActive, data.code, data.builtAt, useTailwind]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#1e1e1e', color: '#d4d4d4' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #333' }}>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
          Built at: {data.builtAt ? new Date(data.builtAt).toLocaleString() : 'N/A'}
          {useTailwind && ' | Tailwind CSS enabled'}
          {loadingState === 'loading' && ' | Loading...'}
        </p>
      </div>

      {error && (
        <div style={{ padding: '16px', background: '#3e1e1e', color: '#f88', fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
          ❌ Error: {error}
        </div>
      )}

      <iframe
        ref={iframeRef}
        style={{
          flex: 1,
          border: 'none',
          background: '#fff',
          opacity: loadingState === 'ready' ? 1 : 0.5,
        }}
        title="React Preview"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-presentation allow-pointer-lock allow-top-navigation"
        allow="*"
      />
    </div>
  );
}
/**
 * 拡張機能のactivate
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('react-preview activating...');

  context.tabs.registerTabType(ReactPreviewTabComponent);
  context.commands.registerCommand('react-build', reactBuildCommand);

  loadESBuild().catch(err => {
    context.logger.error('Failed to preload esbuild:', err);
  });

  context.logger.info('react-preview activated');

  return {};
}

export async function deactivate(): Promise<void> {
  esbuildInstance = null;
}
