/**
 * react-preview Extension
 * React JSXをブラウザでビルド&プレビュー
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

let esbuildModule: any = null;
let esbuildInitPromise: Promise<any> | null = null;

async function loadESBuild(): Promise<ESBuild> {
  // モジュール自体は1回だけロード
  if (!esbuildModule) {
    if (!esbuildInitPromise) {
      esbuildInitPromise = import('esbuild-wasm').then(m => {
        esbuildModule = (m as any).default || m;
        return esbuildModule;
      });
    }
    await esbuildInitPromise;
  }

  // 毎回新しいインスタンスを作成
  const runtimeBase = (typeof window !== 'undefined' && (window as any).__NEXT_PUBLIC_BASE_PATH__) || '';
  const normalizedBase = runtimeBase.endsWith('/') ? runtimeBase.slice(0, -1) : runtimeBase;
  const wasmURL = `${normalizedBase}/extensions/react-preview/esbuild.wasm`;

  // タイムスタンプでキャッシュを無効化
  const cacheBuster = Date.now();
  await esbuildModule.initialize({ 
    wasmURL: `${wasmURL}?t=${cacheBuster}` 
  });
  
  return esbuildModule;
}

/**
 * 仮想ファイルシステムプラグイン
 */
function createVirtualFSPlugin(projectId: string, fileRepository: any, previewId: string) {
  return {
    name: 'virtual-fs',
    setup(build: any) {
      // 外部依存（react等）を無視
      build.onResolve({ filter: /^[^./]/ }, (args: any) => {
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

        // CSSはスタイル注入コードに変換（プレビュー固有のIDを付与）
        if (args.path.match(/\.css$/i)) {
          const cssContent = JSON.stringify(file.content);
          const code = `
            (function() {
              var style = document.createElement('style');
              style.textContent = ${cssContent};
              style.setAttribute('data-react-preview-id', '${previewId}');
              style.setAttribute('data-react-preview-path', '${args.path}');
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
 * JSXファイルをビルド（HMR対応版）
 */
async function buildJSX(
  filePath: string,
  projectId: string,
  context: ExtensionContext,
  previewId: string
): Promise<{ code: string; error?: string }> {
  try {
    // 毎回新しいesbuildインスタンスを作成
    const esbuild = await loadESBuild();
    const fileRepository = await context.getSystemModule('fileRepository');
    const file = await fileRepository.getFileByPath(projectId, filePath);
    if (!file) {
      return { code: '', error: `File not found: ${filePath}` };
    }
    
    // タイムスタンプをビルドに埋め込んでキャッシュ無効化
    const buildTimestamp = Date.now();
    const timestampComment = `/* Build: ${buildTimestamp} */\n`;
    
    const result = await esbuild.build({
      stdin: {
        contents: timestampComment + file.content,
        resolveDir: filePath.split('/').slice(0, -1).join('/') || '/',
        sourcefile: filePath,
        loader: filePath.endsWith('.tsx') ? 'tsx' : 'jsx',
      },
      bundle: true,
      format: 'cjs',
      write: false,
      plugins: [createVirtualFSPlugin(projectId, fileRepository, previewId)],
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
    return 'Usage: react-build <entry.jsx>\n\nExample:\n  react-build App.jsx\n  react-build src/App.jsx';
  }

  const filePath = args[0];
  
  // パス正規化
  let normalizedPath = filePath;
  if (!filePath.startsWith('/')) {
    const relativeCurrent = (context.currentDirectory || '').replace(`/projects/${context.projectName}`, '');
    normalizedPath = relativeCurrent === '' ? `/${filePath}` : `${relativeCurrent}/${filePath}`;
  } else {
    normalizedPath = filePath.replace(`/projects/${context.projectName}`, '');
  }

  // プレビュー固有のIDを生成
  const previewId = `preview-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const { code, error } = await buildJSX(
    normalizedPath,
    context.projectId,
    context,
    previewId
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
    data: { filePath: normalizedPath, code, builtAt: Date.now(), previewId },
  });

  return `[react-preview] Building: ${filePath}\n✅ Build successful!\n\n📺 Preview opened in tab\n`;
}

/**
 * プレビュータブコンポーネント（完全修正版）
 */
function ReactPreviewTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<any>(null);
  const mountedRef = useRef<boolean>(false);
  const data = tab.data || {};

  // このプレビュー専用のスタイルのみを削除
  const cleanup = () => {
    if (data.previewId) {
      document.querySelectorAll(`style[data-react-preview-id="${data.previewId}"]`).forEach(el => el.remove());
    }
    
    if (rootRef.current) {
      try {
        rootRef.current.unmount();
      } catch (e) {
        console.warn('[ReactPreview] Unmount error:', e);
      }
      rootRef.current = null;
    }
    
    mountedRef.current = false;
  };

  useEffect(() => {
    if (!isActive || !data.code) {
      cleanup();
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    // 既存のコンテンツを完全クリア
    if (mountedRef.current) {
      cleanup();
    }

    try {
      setError(null);
      
      const React = (window as any).__PYXIS_REACT__;
      const ReactDOM = (window as any).__PYXIS_REACT_DOM__;

      if (!React || !ReactDOM) {
        setError('React/ReactDOM not available');
        return;
      }

      // requireシム
      const shimRequire = (name: string) => {
        if (name === 'react') return React;
        if (name === 'react-dom') return ReactDOM;
        if (name === 'react-dom/client') return ReactDOM;
        throw new Error(`Module not found: ${name}`);
      };

      // このプレビュー専用のスタイルのみ削除
      cleanup();

      // コードを実行してコンポーネントを取得
      const module = { exports: {} };
      const moduleFunc = new Function('module', 'exports', 'require', data.code);
      moduleFunc(module, module.exports, shimRequire);
      
      const Component = (module.exports as any).default || (module.exports as any);

      if (!Component) {
        setError('No component exported');
        return;
      }

      // 新しいルートを作成して強制的にリマウント
      rootRef.current = ReactDOM.createRoot(container);
      rootRef.current.render(React.createElement(Component));
      mountedRef.current = true;

      console.log('[ReactPreview] Rendered at:', data.builtAt, 'ID:', data.previewId);

    } catch (err: any) {
      setError(err?.message || 'Render failed');
      console.error('[ReactPreview] Error:', err);
    }

    // クリーンアップ
    return cleanup;
  }, [isActive, data.code, data.builtAt, data.previewId]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#1e1e1e', color: '#d4d4d4' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #333' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
          React Preview: {data.filePath || 'Unknown'}
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
          Built at: {data.builtAt ? new Date(data.builtAt).toLocaleString() : 'N/A'}
        </p>
      </div>

      {error && (
        <div style={{ padding: '16px', background: '#3e1e1e', color: '#f88', fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
          ❌ Error: {error}
        </div>
      )}

      <div ref={containerRef} style={{ flex: 1, overflow: 'auto', padding: '16px', background: '#fff', color: '#000' }} />
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

  context.logger.info('react-preview activated');

  return {};
}

export async function deactivate(): Promise<void> {
  esbuildModule = null;
  esbuildInitPromise = null;
}
