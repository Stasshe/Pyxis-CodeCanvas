/**
 * react-preview Extension (CDN-optimized) - Fixed with Metafile
 * 依存関係の検出を正規表現からesbuildのmetafileに変更し、誤検知を防止
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
    metafile?: boolean; // 追加: 依存関係解析用
  }): Promise<{ 
    outputFiles: Array<{ text: string }>;
    metafile?: { inputs: Record<string, { imports: Array<{ path: string }> }> }; // 追加
  }>;
}

interface PageInfo {
  path: string;
  route: string;
  filePath: string;
}

// CDN経由で読み込むライブラリの設定
const CDN_LIBRARIES = {
  'react': {
    global: 'React',
    url: 'https://unpkg.com/react@18/umd/react.production.min.js',
    order: 1,
    integrity: null
  },
  'react-dom': {
    global: 'ReactDOM',
    url: 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
    order: 2,
    integrity: null
  },
  'react-dom/client': {
    global: 'ReactDOM',
    url: null,
    order: 3,
    integrity: null
  },
  'lodash': {
    global: '_',
    url: 'https://unpkg.com/lodash@4.17.21/lodash.min.js',
    order: 4,
    integrity: null
  },
  'd3': {
    global: 'd3',
    url: 'https://unpkg.com/d3@7.8.5/dist/d3.min.js',
    order: 5,
    integrity: null
  },
  'recharts': {
    global: 'Recharts',
    url: 'https://unpkg.com/recharts@2.5.0/dist/Recharts.js',
    order: 6,
    integrity: null
  },
  'lucide-react': {
    global: 'LucideReact',
    url: 'https://unpkg.com/lucide-react@0.263.1/dist/umd/lucide-react.js',
    order: 7,
    integrity: null
  }
} as const;

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

function createGlobalExternalsPlugin() {
  return {
    name: 'global-externals',
    setup(build: any) {
      const patterns = Object.keys(CDN_LIBRARIES).map(lib => 
        lib.includes('/') ? lib.replace('/', '\\/') : lib
      );
      const filterRegex = new RegExp(`^(${patterns.join('|')})$`);

      build.onResolve({ filter: filterRegex }, (args: any) => {
        return {
          path: args.path,
          namespace: 'global-external',
        };
      });

      build.onLoad({ filter: /.*/, namespace: 'global-external' }, (args: any) => {
        const libConfig = CDN_LIBRARIES[args.path as keyof typeof CDN_LIBRARIES];
        if (!libConfig) {
          return { errors: [{ text: `No CDN mapping for ${args.path}` }] };
        }

        const code = `module.exports = window.${libConfig.global};`;
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
        if (args.path in CDN_LIBRARIES) {
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
        } catch (e) {}
        
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
            } catch (e) {}
          }
          
          try {
            const indexPath = path + '/index.js';
            const file = await fileRepository.getFileByPath(projectId, indexPath);
            if (file) {
              return { path: indexPath, namespace: 'virtual' };
            }
          } catch (e) {}
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

async function detectPages(
  projectId: string,
  context: ExtensionContext
): Promise<PageInfo[]> {
  const fileRepository = await context.getSystemModule('fileRepository');
  const allFiles = await fileRepository.getProjectFiles(projectId);
  
  const pageFiles = allFiles.filter((f: any) => {
    const path = f.path || '';
    return path.match(/^\/pages\/.+\.(jsx|tsx)$/);
  });

  const pages: PageInfo[] = [];

  for (const file of pageFiles) {
    const filePath = file.path;
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

// 修正ポイント: 正規表現によるdetectUsedLibrariesを削除
// esbuildのmetafileを使って正確に検出するため不要になりました。

async function buildJSX(
  filePath: string,
  projectId: string,
  context: ExtensionContext,
  globalName: string = '__ReactApp__'
): Promise<{ code: string; error?: string; usedLibs?: Set<string> }> {
  try {
    const esbuild = await loadESBuild();
    const fileRepository = await context.getSystemModule('fileRepository');
    const file = await fileRepository.getFileByPath(projectId, filePath);
    if (!file) {
      return { code: '', error: `File not found: ${filePath}` };
    }
    
    // 修正ポイント: metafile: true を追加し、結果からライブラリを抽出
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
      metafile: true, // 重要: これにより正確な依存関係を取得可能
      plugins: [createGlobalExternalsPlugin(), createVirtualFSPlugin(projectId, fileRepository)],
      target: 'es2020',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      define: {
        'process.env.NODE_ENV': '"production"'
      },
    });

    const bundled = result.outputFiles[0].text;

    // 修正ポイント: esbuildのmetafileから実際にバンドルされたimportのみを抽出
    const usedLibs = new Set<string>(['react', 'react-dom']);
    
    if (result.metafile) {
      // inputsにはバンドルに含まれた全てのファイルと、そのimportが含まれる
      Object.values(result.metafile.inputs).forEach(input => {
        input.imports.forEach(imp => {
          // CDN_LIBRARIESにあるものだけを抽出
          if (imp.path in CDN_LIBRARIES) {
            usedLibs.add(imp.path);
          }
        });
      });
    }

    return { code: bundled, usedLibs };
  } catch (error: any) {
    return { code: '', error: error?.message || 'Build failed' };
  }
}

async function buildMultiPage(
  pages: PageInfo[],
  projectId: string,
  context: ExtensionContext
): Promise<{ bundledPages: Record<string, string>; errors: Record<string, string>; usedLibs: Set<string> }> {
  const bundledPages: Record<string, string> = {};
  const errors: Record<string, string> = {};
  const allUsedLibs = new Set<string>(['react', 'react-dom']);

  for (const page of pages) {
    const globalName = `__Page_${page.route.replace(/\//g, '_').replace(/^_$/, 'root')}__`;
    const { code, error, usedLibs } = await buildJSX(page.filePath, projectId, context, globalName);
    
    if (error) {
      errors[page.route] = error;
    } else {
      bundledPages[page.route] = code;
      if (usedLibs) {
        usedLibs.forEach(lib => allUsedLibs.add(lib));
      }
    }
  }

  return { bundledPages, errors, usedLibs: allUsedLibs };
}

// ... 以降のコード（reactBuildCommand, ReactPreviewTabComponentなど）は変更なしでOK ...
// ただし、コード全文が必要であれば提示します。
// 基本的に buildJSX の変更だけで問題は解決します。

async function reactBuildCommand(args: string[], context: any): Promise<string> {
  // ... (元のコードと同じ)
  if (args.length === 0) {
    return 'Usage: react-build <entry.jsx|pages> [--tailwind]\n\nExamples:\n  react-build App.jsx\n  react-build App.jsx --tailwind\n  react-build pages\n  react-build pages --tailwind';
  }

  const target = args[0];
  const useTailwind = args.includes('--tailwind');

  if (target === 'pages') {
    const pages = await detectPages(context.projectId, context);
    
    if (pages.length === 0) {
      return '❌ No pages found in /pages/\n\nCreate pages like:\n  /pages/index.tsx\n  /pages/about.tsx';
    }

    const { bundledPages, errors, usedLibs } = await buildMultiPage(pages, context.projectId, context);

    if (Object.keys(errors).length > 0) {
      let errorMsg = '❌ Build errors:\n';
      for (const [route, error] of Object.entries(errors)) {
        errorMsg += `\n  ${route}: ${error}`;
      }
      return errorMsg;
    }

    context.tabs.createTab({
      id: `preview-multipage-${Date.now()}`,
      title: 'Preview: Multi-page',
      icon: 'Eye',
      closable: true,
      activateAfterCreate: true,
      data: { 
        mode: 'multipage',
        pages,
        bundledPages,
        builtAt: Date.now(),
        useTailwind,
        usedLibs: Array.from(usedLibs)
      },
    });

    const pageList = pages.map(p => `  ${p.route} → ${p.filePath}`).join('\n');
    return `✅ Built ${pages.length} pages${useTailwind ? ' (Tailwind enabled)' : ''}\n\n${pageList}\n\n📺 Preview opened`;
  }

  const filePath = target;
  let normalizedPath = filePath;
  if (!filePath.startsWith('/')) {
    const relativeCurrent = (context.currentDirectory || '').replace(`/projects/${context.projectName}`, '');
    normalizedPath = relativeCurrent === '' ? `/${filePath}` : `${relativeCurrent}/${filePath}`;
  } else {
    normalizedPath = filePath.replace(`/projects/${context.projectName}`, '');
  }

  const { code, error, usedLibs } = await buildJSX(normalizedPath, context.projectId, context);

  if (error) {
    return `❌ Build failed:\n${error}`;
  }

  context.tabs.createTab({
    id: `preview-${normalizedPath}`,
    title: `Preview: ${normalizedPath.split('/').pop()}`,
    icon: 'Eye',
    closable: true,
    activateAfterCreate: true,
    data: { 
      mode: 'single',
      filePath: normalizedPath,
      code,
      builtAt: Date.now(),
      useTailwind,
      usedLibs: Array.from(usedLibs || ['react', 'react-dom'])
    },
  });

  return `✅ Built: ${filePath}${useTailwind ? ' (Tailwind enabled)' : ''}\n\n📺 Preview opened`;
}

function ReactPreviewTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  // ... (元のコードと同じ)
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const data = tab.data || {};
  const mode = data.mode || 'single';
  const useTailwind = data.useTailwind || false;
  const usedLibs = data.usedLibs || ['react', 'react-dom'];
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
        setLoading(false);
        return;
      }

      try {
        const sortedLibraries = Object.entries(CDN_LIBRARIES)
          .filter(([libName, config]) => {
            if (libName === 'react-dom/client') return false;
            return config.url !== null && usedLibs.includes(libName);
          })
          .sort((a, b) => a[1].order - b[1].order);

        let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src *; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; font-src * data:; connect-src *; frame-src *;">
  <style>
    body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #root { width: 100%; min-height: 100vh; }
    #loading { padding: 16px; color: #666; }
  </style>`;

        if (useTailwind) {
          html += '\n  <script src="https://cdn.tailwindcss.com"></script>';
        }

        html += `\n</head>
<body>
  <div id="loading">Loading libraries...</div>
  <div id="root" style="display: none;"></div>
  
  `;

        for (let i = 0; i < sortedLibraries.length; i++) {
          const [_, config] = sortedLibraries[i];
          html += `  <script src="${config.url}" crossorigin></script>\n`;
        }

        html += `  
  <script>
    (function() {
      let checkCount = 0;
      const maxChecks = 100;
      
      function checkLibraries() {
        checkCount++;
        
        if (!window.React || !window.ReactDOM) {
          if (checkCount < maxChecks) {
            setTimeout(checkLibraries, 100);
            return;
          } else {
            document.getElementById('loading').innerHTML = 
              '<div style="color: #f88;">Failed to load React libraries</div>';
            console.error('React or ReactDOM not loaded');
            return;
          }
        }
        
        document.getElementById('loading').style.display = 'none';
        document.getElementById('root').style.display = 'block';
        
        initApp();
      }
      
      setTimeout(checkLibraries, 100);
    })();
    
    function initApp() {
      try {
`;

        if (mode === 'single') {
          html += `        
        ${data.code}
        
        const Component = window.__ReactApp__?.default || window.__ReactApp__;
        
        if (!Component) {
          throw new Error('No component exported from __ReactApp__');
        }

        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(React.createElement(Component));
`;
        } else {
          const pages = data.pages || [];
          const bundledPages = data.bundledPages || {};
          
          for (const [route, code] of Object.entries(bundledPages)) {
            html += `        ${code}\n`;
          }

          const routeMap = pages.map((p: PageInfo) => {
            const globalName = `__Page_${p.route.replace(/\//g, '_').replace(/^_$/, 'root')}__`;
            return `          '${p.route}': window.${globalName}?.default || window.${globalName}`;
          }).join(',\n');

          html += `
        const routes = {
${routeMap}
        };

        let currentRoot = null;

        function navigate(path) {
          const Component = routes[path];
          
          if (!Component) {
            document.getElementById('root').innerHTML = '<div style="padding: 16px;"><h1>404</h1><p>Available routes:</p><ul>' + 
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
            document.getElementById('root').innerHTML = '<div style="color: #f88; padding: 16px; font-family: monospace; white-space: pre-wrap;">Error: ' + (err?.stack || String(err)) + '</div>';
            console.error(err);
          }
        }

        window.addEventListener('hashchange', () => {
          navigate(window.location.hash.slice(1) || '/');
        });
        
        navigate(window.location.hash.slice(1) || '/');
`;
        }

        html += `        
      } catch (err) {
        const errorMsg = err?.stack || err?.message || String(err);
        document.getElementById('root').innerHTML = 
          '<div style="color: #f88; padding: 16px; font-family: monospace; font-size: 12px; white-space: pre-wrap;">Error: ' + 
          errorMsg + '</div>';
        console.error('[ReactPreview Error]', err);
      }
    }
  </script>
</body>
</html>`;

        doc.open();
        doc.write(html);
        doc.close();
        initializedRef.current = true;
        setError(null);
        setLoading(false);
      } catch (err: any) {
        setError(err?.message || 'Init failed');
        setLoading(false);
      }
    };

    if (iframe.contentDocument?.readyState === 'complete') {
      initIframe();
    } else {
      iframe.onload = initIframe;
    }
  }, [isActive, data, mode, useTailwind, usedLibs]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#1e1e1e', color: '#d4d4d4' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #333' }}>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
          {mode === 'multipage' && `${data.pages?.length || 0} pages | `}
          Built: {data.builtAt ? new Date(data.builtAt).toLocaleString() : 'N/A'}
          {useTailwind && ' | Tailwind'}
          {loading && ' | Loading...'}
        </p>
      </div>

      {error && (
        <div style={{ padding: '16px', background: '#3e1e1e', color: '#f88', fontFamily: 'monospace', fontSize: '12px' }}>
          ❌ {error}
        </div>
      )}

      <iframe
        ref={iframeRef}
        style={{ flex: 1, border: 'none', background: '#fff' }}
        title="React Preview"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
      />
    </div>
  );
}

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('react-preview (CDN-optimized) activating...');

  context.tabs.registerTabType(ReactPreviewTabComponent);
  context.commands.registerCommand('react-build', reactBuildCommand);

  loadESBuild().catch(err => {
    context.logger.error('esbuild preload failed:', err);
  });

  context.logger.info('react-preview activated');
  return {};
}

export async function deactivate(): Promise<void> {
  esbuildInstance = null;
}
