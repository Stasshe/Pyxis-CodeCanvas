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

async function loadESBuild(): Promise<ESBuild> {
  if (esbuildInstance) return esbuildInstance;

  const esbuildModule = await import('esbuild-wasm');
  const esbuild = (esbuildModule as any).default || esbuildModule;

  const runtimeBase = (typeof window !== 'undefined' && (window as any).__NEXT_PUBLIC_BASE_PATH__) || '';
  const normalizedBase = runtimeBase.endsWith('/') ? runtimeBase.slice(0, -1) : runtimeBase;
  const wasmURL = `${normalizedBase}/extensions/react-preview/esbuild.wasm`;

  await esbuild.initialize({ wasmURL });
  esbuildInstance = esbuild;
  
  return esbuild;
}

/**
 * 仮想ファイルシステムプラグイン
 */
function createVirtualFSPlugin(projectId: string, fileRepository: any) {
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

/**
 * プレビュータブコンポーネント
 */
function ReactPreviewTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [tailwindLoaded, setTailwindLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<any>(null);
  const data = tab.data || {};
  const useTailwind = data.useTailwind || false;

  // Tailwind CSS CDNを読み込む（useTailwindがtrueの場合のみ）
  useEffect(() => {
    if (!useTailwind) {
      setTailwindLoaded(true);
      return;
    }

    const existingLink = document.getElementById('tailwind-cdn');
    if (!existingLink) {
      const link = document.createElement('link');
      link.id = 'tailwind-cdn';
      link.rel = 'stylesheet';
      link.href = 'https://cdn.tailwindcss.com';
      link.onload = () => setTailwindLoaded(true);
      document.head.appendChild(link);
    } else {
      setTailwindLoaded(true);
    }
  }, [useTailwind]);

  useEffect(() => {
    if (!isActive || !data.code || !tailwindLoaded) return;

    const container = containerRef.current;
    if (!container) return;

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

      // 古いスタイルを削除
      document.querySelectorAll('style[data-react-preview]').forEach(el => el.remove());

      // コードを実行してコンポーネントを取得
      const module = { exports: {} };
      const moduleFunc = new Function('module', 'exports', 'require', data.code);
      moduleFunc(module, module.exports, shimRequire);
      
      const Component = (module.exports as any).default || (module.exports as any);

      if (!Component) {
        setError('No component exported');
        return;
      }

      // レンダリング
      if (!rootRef.current) {
        rootRef.current = ReactDOM.createRoot(container);
      }

      rootRef.current.render(React.createElement(Component));

      return () => {
        // クリーンアップ：スタイルを削除
        document.querySelectorAll('style[data-react-preview]').forEach(el => el.remove());
        
        if (rootRef.current) {
          rootRef.current.unmount();
          rootRef.current = null;
        }
      };
    } catch (err: any) {
      setError(err?.message || 'Render failed');
      console.error('[ReactPreview] Error:', err);
    }
  }, [isActive, data.code, tailwindLoaded]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#1e1e1e', color: '#d4d4d4' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #333' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
          React Preview: {data.filePath || 'Unknown'}
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
          Built at: {data.builtAt ? new Date(data.builtAt).toLocaleString() : 'N/A'}
          {useTailwind && !tailwindLoaded && ' | Loading Tailwind CSS...'}
          {useTailwind && tailwindLoaded && ' | Tailwind CSS loaded'}
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

  loadESBuild().catch(err => {
    context.logger.error('Failed to preload esbuild:', err);
  });

  context.logger.info('react-preview activated');

  return {};
}

export async function deactivate(): Promise<void> {
  esbuildInstance = null;
  
  // Tailwind CSSのクリーンアップ
  const tailwindLink = document.getElementById('tailwind-cdn');
  if (tailwindLink) {
    tailwindLink.remove();
  }
}
