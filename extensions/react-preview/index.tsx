/**
 * react-preview Extension
 * React JSXをブラウザでビルド&プレビュー（Tailwind CSS + Multi-page対応）
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
    define?: { [key: string]: string };
    globalName?: string;
  }): Promise<{ outputFiles: Array<{ text: string }> }>;
}

interface PageInfo {
  path: string;
  route: string;
  filePath: string;
}

let esbuildInstance: ESBuild | null = null;
let isInitializing = false;

async function loadESBuild(): Promise<ESBuild> {
  if (esbuildInstance) return esbuildInstance;

  if (isInitializing) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return loadESBuild();
  }

  isInitializing = true;

  try {
    const esbuildModule = await import('esbuild-wasm');
    const esbuild = (esbuildModule as any).default || esbuildModule;

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
 * externalモジュールをグローバル変数に書き換えるプラグイン
 */
function createGlobalExternalsPlugin() {
  return {
    name: 'global-externals',
    setup(build: any) {
      const globalMap: Record<string, string> = {
        'react': 'React',
        'react-dom': 'ReactDOM',
        'react-dom/client': 'ReactDOM',
      };

      build.onResolve({ filter: /^react(-dom)?(\/client)?$/ }, (args: any) => {
        return {
          path: args.path,
          namespace: 'global-external',
        };
      });

      build.onLoad({ filter: /.*/, namespace: 'global-external' }, (args: any) => {
        const globalName = globalMap[args.path];
        if (!globalName) {
          return { errors: [{ text: `No global mapping for ${args.path}` }] };
        }

        const code = `module.exports = window.${globalName};`;
        return { contents: code, loader: 'js' };
      });
    },
  };
}

function createVirtualFSPlugin(projectId: string, fileRepository: any) {
  return {
    name: 'virtual-fs',
    setup(build: any) {
      build.onResolve({ filter: /^[^./]/ }, async (args: any) => {
        if (args.path === 'react' || args.path === 'react-dom' || args.path === 'react-dom/client') {
          return undefined;
        }
        
        try {
          const pkgJsonPath = `/node_modules/${args.path}/package.json`;
          const pkgJsonFile = await fileRepository.getFileByPath(projectId, pkgJsonPath);
          
          if (pkgJsonFile) {
            const pkgJson = JSON.parse(pkgJsonFile.content);
            const entryPoint = pkgJson.module || pkgJson.main || 'index.js';
            const resolvedPath = `/node_modules/${args.path}/${entryPoint}`;
            
            return { path: resolvedPath, namespace: 'virtual' };
          }
        } catch (e) {
          console.error(`Failed to resolve package.json for ${args.path}:`, e);
        }
        
        try {
          const distIndexPath = `/node_modules/${args.path}/dist/index.js`;
          const file = await fileRepository.getFileByPath(projectId, distIndexPath);
          if (file) {
            return { path: distIndexPath, namespace: 'virtual' };
          }
        } catch (e) {
          // dist/index.jsもない
        }
        
        return { path: args.path, external: true };
      });

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
        
        if (!path.match(/\.[^/]+$/)) {
          for (const ext of ['.js', '.ts', '.jsx', '.tsx']) {
            try {
              const testPath = path + ext;
              const file = await fileRepository.getFileByPath(projectId, testPath);
              if (file) {
                return { path: testPath, namespace: 'virtual' };
              }
            } catch (e) {
              // 次の拡張子を試す
            }
          }
          
          try {
            const indexPath = path + '/index.js';
            const file = await fileRepository.getFileByPath(projectId, indexPath);
            if (file) {
              return { path: indexPath, namespace: 'virtual' };
            }
          } catch (e) {
            // index.jsもない
          }
        }
        
        return { path, namespace: 'virtual' };
      });

      build.onLoad({ filter: /.*/, namespace: 'virtual' }, async (args: any) => {
        const file = await fileRepository.getFileByPath(projectId, args.path);
        
        if (!file) {
          return { errors: [{ text: `File not found: ${args.path}` }] };
        }

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

        if (args.path.match(/\.(png|jpe?g|svg|gif|webp)$/i)) {
          return { contents: '', loader: 'text' };
        }

        let loader: 'js' | 'ts' | 'jsx' | 'tsx' = 'js';
        if (args.path.endsWith('.tsx')) loader = 'tsx';
        else if (args.path.endsWith('.ts')) loader = 'ts';
        else if (args.path.endsWith('.jsx')) loader = 'jsx';

        return {
          contents: file.content,
          loader,
        };
      });
    },
  };
}

/**
 * /pages/ 配下のページファイルを検出
 */
async function detectPages(
  projectId: string,
  context: ExtensionContext
): Promise<PageInfo[]> {
  const fileRepository = await context.getSystemModule('fileRepository');
  const allFiles = await fileRepository.listFiles(projectId);
  
  const pageFiles = allFiles.filter((f: any) => {
    const path = f.path || '';
    return path.match(/^\/pages\/.+\.(jsx|tsx)$/);
  });

  const pages: PageInfo[] = [];

  for (const file of pageFiles) {
    const filePath = file.path;
    // /pages/index.tsx → /
    // /pages/about.tsx → /about
    // /pages/blog/index.tsx → /blog
    // /pages/blog/post.tsx → /blog/post
    let route = filePath
      .replace(/^\/pages/, '')
      .replace(/\.(jsx|tsx)$/, '')
      .replace(/\/index$/, '');
    
    if (route === '') route = '/';
    if (route !== '/' && !route.startsWith('/')) route = '/' + route;

    pages.push({
      path: file.path,
      route,
      filePath,
    });
  }

  pages.sort((a, b) => a.route.localeCompare(b.route));

  return pages;
}

/**
 * JSXファイルをビルド（単体またはページ）
 */
async function buildJSX(
  filePath: string,
  projectId: string,
  context: ExtensionContext,
  globalName: string = '__ReactApp__'
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
      format: 'iife',
      globalName,
      write: false,
      plugins: [createGlobalExternalsPlugin(), createVirtualFSPlugin(projectId, fileRepository)],
      target: 'es2020',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      define: {
        'process.env.NODE_ENV': '"production"'
      },
    });

    const bundled = result.outputFiles[0].text;
    return { code: bundled };
  } catch (error: any) {
    return { code: '', error: error?.message || 'Build failed' };
  }
}

/**
 * 複数ページをビルド
 */
async function buildMultiPage(
  pages: PageInfo[],
  projectId: string,
  context: ExtensionContext
): Promise<{ bundledPages: Record<string, string>; errors: Record<string, string> }> {
  const bundledPages: Record<string, string> = {};
  const errors: Record<string, string> = {};

  for (const page of pages) {
    const globalName = `__Page_${page.route.replace(/\//g, '_').replace(/^_$/, 'root')}__`;
    const { code, error } = await buildJSX(page.filePath, projectId, context, globalName);
    
    if (error) {
      errors[page.route] = error;
    } else {
      bundledPages[page.route] = code;
    }
  }

  return { bundledPages, errors };
}

/**
 * react-buildコマンド
 */
async function reactBuildCommand(args: string[], context: any): Promise<string> {
  if (args.length === 0) {
    return 'Usage: react-build <entry.jsx|pages> [--tailwind]\n\nExamples:\n  react-build App.jsx              # Single component\n  react-build App.jsx --tailwind   # With Tailwind CSS\n  react-build pages                # Multi-page app (auto-detect /pages/)\n  react-build pages --tailwind     # Multi-page with Tailwind';
  }

  const target = args[0];
  const useTailwind = args.includes('--tailwind');

  // Multi-page mode
  if (target === 'pages') {
    const pages = await detectPages(context.projectId, context);
    
    if (pages.length === 0) {
      return '❌ No pages found in /pages/ directory.\n\nCreate pages like:\n  /pages/index.tsx\n  /pages/about.tsx\n  /pages/blog/index.tsx';
    }

    const { bundledPages, errors } = await buildMultiPage(pages, context.projectId, context);

    if (Object.keys(errors).length > 0) {
      let errorMsg = '❌ Some pages failed to build:\n';
      for (const [route, error] of Object.entries(errors)) {
        errorMsg += `\n  ${route}: ${error}`;
      }
      return errorMsg;
    }

    // プレビュータブを開く
    context.tabs.createTab({
      id: `preview-multipage-${Date.now()}`,
      title: 'Preview: Multi-page App',
      icon: 'Eye',
      closable: true,
      activateAfterCreate: true,
      data: { 
        mode: 'multipage',
        pages,
        bundledPages,
        builtAt: Date.now(),
        useTailwind 
      },
    });

    const pageList = pages.map(p => `  ${p.route} → ${p.filePath}`).join('\n');
    const tailwindMsg = useTailwind ? '\n🎨 Tailwind CSS enabled' : '';
    return `[react-preview] Building multi-page app...\n✅ Built ${pages.length} pages:${tailwindMsg}\n\n${pageList}\n\n📺 Preview opened in tab`;
  }

  // Single component mode
  const filePath = target;
  
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

  context.tabs.createTab({
    id: `preview-${normalizedPath}`,
    title: `Preview: ${normalizedPath}`,
    icon: 'Eye',
    closable: true,
    activateAfterCreate: true,
    data: { 
      mode: 'single',
      filePath: normalizedPath,
      code,
      builtAt: Date.now(),
      useTailwind 
    },
  });

  const tailwindMsg = useTailwind ? '\n🎨 Tailwind CSS enabled' : '';
  return `[react-preview] Building: ${filePath}\n✅ Build successful!${tailwindMsg}\n\n📺 Preview opened in tab\n`;
}

function ReactPreviewTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const data = tab.data || {};
  const mode = data.mode || 'single';
  const useTailwind = data.useTailwind || false;
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!isActive) {
      initializedRef.current = false;
      return;
    }

    const iframe = iframeRef.current;
    if (!iframe || initializedRef.current) return;

    const initIframe = () => {
      const doc = iframe.contentDocument;
      if (!doc) {
        setError('Cannot access iframe document');
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
  
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>
`;

        if (mode === 'single') {
          // Single component mode
          html += `  
  <script>
    ${data.code}
  <\/script>
  
  <script>
    try {
      const Component = window.__ReactApp__.default || window.__ReactApp__;
      
      if (!Component) {
        throw new Error('No component exported from ${data.filePath}');
      }

      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(React.createElement(Component));
      
    } catch (err) {
      document.getElementById('root').innerHTML = '<div style="color: #f88; padding: 16px; font-family: monospace; font-size: 12px; white-space: pre-wrap;">Error: ' + (err?.stack || err?.message || String(err)) + '</div>';
      console.error('[ReactPreview]', err);
    }
  <\/script>`;
        } else {
          // Multi-page mode
          const pages = data.pages || [];
          const bundledPages = data.bundledPages || {};
          
          // すべてのページのコードを埋め込み
          for (const [route, code] of Object.entries(bundledPages)) {
            html += `  <script>${code}<\/script>\n`;
          }

          // ルーティングロジック
          const routeMap = pages.map((p: PageInfo) => {
            const globalName = `__Page_${p.route.replace(/\//g, '_').replace(/^_$/, 'root')}__`;
            return `    '${p.route}': window.${globalName}.default || window.${globalName}`;
          }).join(',\n');

          html += `
  <script>
    const routes = {
${routeMap}
    };

    let currentRoot = null;

    function navigate(path) {
      const Component = routes[path];
      
      if (!Component) {
        document.getElementById('root').innerHTML = '<div style="padding: 16px;"><h1>404 Not Found</h1><p>Page "' + path + '" does not exist.</p><p>Available routes:</p><ul>' + 
          Object.keys(routes).map(r => '<li><a href="#' + r + '">' + r + '</a></li>').join('') + 
          '</ul></div>';
        return;
      }

      if (!currentRoot) {
        currentRoot = ReactDOM.createRoot(document.getElementById('root'));
      }
      
      try {
        currentRoot.render(React.createElement(Component));
      } catch (err) {
        document.getElementById('root').innerHTML = '<div style="color: #f88; padding: 16px; font-family: monospace; font-size: 12px; white-space: pre-wrap;">Error rendering ' + path + ':\\n' + (err?.stack || err?.message || String(err)) + '</div>';
        console.error('[ReactPreview]', err);
      }
    }

    function handleRouteChange() {
      const hash = window.location.hash.slice(1) || '/';
      navigate(hash);
    }

    window.addEventListener('hashchange', handleRouteChange);
    handleRouteChange();
  <\/script>`;
        }

        html += `
</body>
</html>`;

        doc.open();
        doc.write(html);
        doc.close();
        initializedRef.current = true;
        setError(null);
      } catch (err: any) {
        setError(err?.message || 'Failed to initialize iframe');
      }
    };

    if (iframe.contentDocument?.readyState === 'complete') {
      initIframe();
    } else {
      iframe.onload = initIframe;
    }
  }, [isActive, data, mode, useTailwind]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#1e1e1e', color: '#d4d4d4' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #333' }}>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
          {mode === 'multipage' && `Multi-page app (${data.pages?.length || 0} pages) | `}
          Built at: {data.builtAt ? new Date(data.builtAt).toLocaleString() : 'N/A'}
          {useTailwind && ' | Tailwind CSS enabled'}
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