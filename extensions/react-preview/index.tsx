/**
 * react-preview Extension (CDN-optimized - FIXED)
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
    external?: string[];
  }): Promise<{ outputFiles: Array<{ text: string }> }>;
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
    url: 'https://unpkg.com/react@18/umd/react.production.min.js'
  },
  'react-dom': {
    global: 'ReactDOM',
    url: 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js'
  },
  'react-dom/client': {
    global: 'ReactDOM',
    url: null // react-domに含まれる
  },
  'lucide-react': {
    global: 'LucideReact',
    url: 'https://unpkg.com/lucide-react@0.263.1/dist/umd/lucide-react.js'
  },
  'recharts': {
    global: 'Recharts',
    url: 'https://unpkg.com/recharts@2.5.0/dist/Recharts.js'
  },
  'lodash': {
    global: '_',
    url: 'https://unpkg.com/lodash@4.17.21/lodash.min.js'
  },
  'd3': {
    global: 'd3',
    url: 'https://unpkg.com/d3@7.8.5/dist/d3.min.js'
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

/**
 * CDNライブラリを window.XXX にマップする inject plugin
 */
function createCDNInjectPlugin() {
  return {
    name: 'cdn-inject',
    setup(build: any) {
      const cdnModules = Object.keys(CDN_LIBRARIES);
      
      // すべてのCDNモジュールをインターセプト
      for (const moduleName of cdnModules) {
        build.onResolve({ filter: new RegExp(`^${moduleName.replace(/[\/\-]/g, '\\$&')}$`) }, (args: any) => {
          return {
            path: moduleName,
            namespace: 'cdn-shim',
          };
        });
      }

      build.onLoad({ filter: /.*/, namespace: 'cdn-shim' }, (args: any) => {
        const libConfig = CDN_LIBRARIES[args.path as keyof typeof CDN_LIBRARIES];
        if (!libConfig) {
          return { errors: [{ text: `No CDN config for ${args.path}` }] };
        }

        // グローバル変数から読み込むshimコードを生成
        const shimCode = `export default window.${libConfig.global};\nexport * from 'data:text/javascript,export default window.${libConfig.global}'`;
        return { contents: shimCode, loader: 'js' };
      });
    },
  };
}

function createVirtualFSPlugin(projectId: string, fileRepository: any) {
  return {
    name: 'virtual-fs',
    setup(build: any) {
      // CDNライブラリは既にcdn-shimで処理されているのでスキップ
      const cdnModules = Object.keys(CDN_LIBRARIES);
      
      build.onResolve({ filter: /^[^./]/ }, async (args: any) => {
        // CDNライブラリはスキップ（cdn-inject pluginが処理する）
        if (cdnModules.includes(args.path)) {
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
        } catch (e) {}
        
        try {
          const distIndexPath = `/node_modules/${args.path}/dist/index.js`;
          const file = await fileRepository.getFileByPath(projectId, distIndexPath);
          if (file) {
            return { path: distIndexPath, namespace: 'virtual' };
          }
        } catch (e) {}
        
        // 見つからなければexternal扱い
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
      plugins: [
        createCDNInjectPlugin(),  // CDN inject pluginを先に実行
        createVirtualFSPlugin(projectId, fileRepository)
      ],
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
    console.error('Build error:', error);
    return { code: '', error: error?.message || 'Build failed' };
  }
}

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

async function reactBuildCommand(args: string[], context: any): Promise<string> {
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

    const { bundledPages, errors } = await buildMultiPage(pages, context.projectId, context);

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
        useTailwind 
      },
    });

    const pageList = pages.map(p => `  ${p.route} → ${p.filePath}`).join('\n');
    return `✅ Built ${pages.length} pages${useTailwind ? ' (Tailwind)' : ''}\n\n${pageList}\n\n📺 Preview opened`;
  }

  const filePath = target;
  let normalizedPath = filePath;
  if (!filePath.startsWith('/')) {
    const relativeCurrent = (context.currentDirectory || '').replace(`/projects/${context.projectName}`, '');
    normalizedPath = relativeCurrent === '' ? `/${filePath}` : `${relativeCurrent}/${filePath}`;
  } else {
    normalizedPath = filePath.replace(`/projects/${context.projectName}`, '');
  }

  const { code, error } = await buildJSX(normalizedPath, context.projectId, context);

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
      useTailwind 
    },
  });

  return `✅ Built: ${filePath}${useTailwind ? ' (Tailwind)' : ''}\n\n📺 Preview opened`;
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
        setError('Cannot access iframe');
        return;
      }

      try {
        // CDNスクリプトを順番に生成（依存関係を考慮）
        const cdnScripts = Object.entries(CDN_LIBRARIES)
          .filter(([_, config]) => config.url !== null)
          .map(([_, config]) => `  <script crossorigin src="${config.url}"></script>`)
          .join('\n');

        let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #root { width: 100%; min-height: 100vh; }
  </style>`;

        if (useTailwind) {
          html += '\n  <script src="https://cdn.tailwindcss.com"></script>';
        }

        html += `\n</head>
<body>
  <div id="root"></div>
  
  <!-- CDN Dependencies -->
${cdnScripts}
  
  <!-- Wait for all CDN scripts to load -->
  <script>
    window.__CDN_READY__ = new Promise((resolve) => {
      let checkCount = 0;
      const checkInterval = setInterval(() => {
        checkCount++;
        const allLoaded = window.React && window.ReactDOM;
        
        if (allLoaded) {
          clearInterval(checkInterval);
          resolve();
        } else if (checkCount > 50) {
          clearInterval(checkInterval);
          document.getElementById('root').innerHTML = '<div style="color: red; padding: 16px;">Failed to load CDN dependencies</div>';
        }
      }, 100);
    });
  </script>
`;

        if (mode === 'single') {
          html += `  
  <!-- Bundled App Code -->
  <script>
${data.code}
  </script>
  
  <!-- Initialize App -->
  <script>
    window.__CDN_READY__.then(() => {
      try {
        const Component = window.__ReactApp__;
        
        if (!Component) {
          throw new Error('No component found in __ReactApp__');
        }
        
        const ActualComponent = Component.default || Component;
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(React.createElement(ActualComponent));
        
      } catch (err) {
        document.getElementById('root').innerHTML = '<div style="color: #f88; padding: 16px; font-family: monospace; font-size: 11px; white-space: pre-wrap;">Error:\\n' + (err?.stack || err?.message || String(err)) + '</div>';
        console.error('[Preview Error]', err);
      }
    });
  </script>`;
        } else {
          const pages = data.pages || [];
          const bundledPages = data.bundledPages || {};
          
          // すべてのページコードを埋め込み
          for (const [route, code] of Object.entries(bundledPages)) {
            html += `  <script>\n${code}\n  </script>\n`;
          }

          const routeMap = pages.map((p: PageInfo) => {
            const globalName = `__Page_${p.route.replace(/\//g, '_').replace(/^_$/, 'root')}__`;
            return `      '${p.route}': window.${globalName}`;
          }).join(',\n');

          html += `
  <script>
    window.__CDN_READY__.then(() => {
      const routes = {
${routeMap}
      };

      let currentRoot = null;

      function navigate(path) {
        const PageModule = routes[path];
        
        if (!PageModule) {
          document.getElementById('root').innerHTML = '<div style="padding: 16px;"><h1>404</h1><p>Available:</p><ul>' + 
            Object.keys(routes).map(r => '<li><a href="#' + r + '">' + r + '</a></li>').join('') + 
            '</ul></div>';
          return;
        }

        if (!currentRoot) {
          currentRoot = ReactDOM.createRoot(document.getElementById('root'));
        }
        
        try {
          const Component = PageModule.default || PageModule;
          currentRoot.render(React.createElement(Component));
        } catch (err) {
          document.getElementById('root').innerHTML = '<div style="color: #f88; padding: 16px; font-family: monospace; white-space: pre-wrap;">Error:\\n' + (err?.stack || String(err)) + '</div>';
          console.error(err);
        }
      }

      window.addEventListener('hashchange', () => {
        navigate(window.location.hash.slice(1) || '/');
      });
      
      navigate(window.location.hash.slice(1) || '/');
    });
  </script>`;
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
        setError(err?.message || 'Init failed');
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
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #333', fontSize: '12px' }}>
        {mode === 'multipage' && `${data.pages?.length || 0} pages | `}
        Built: {data.builtAt ? new Date(data.builtAt).toLocaleTimeString() : 'N/A'}
        {useTailwind && ' | Tailwind'}
      </div>

      {error && (
        <div style={{ padding: '16px', background: '#3e1e1e', color: '#f88', fontFamily: 'monospace', fontSize: '11px' }}>
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
  context.logger.info('react-preview activating...');

  context.tabs.registerTabType(ReactPreviewTabComponent);
  context.commands.registerCommand('react-build', reactBuildCommand);

  loadESBuild().catch(err => {
    context.logger.error('esbuild load failed:', err);
  });

  context.logger.info('react-preview activated');
  return {};
}

export async function deactivate(): Promise<void> {
  esbuildInstance = null;
}
