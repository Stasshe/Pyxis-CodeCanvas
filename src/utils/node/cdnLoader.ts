// CDN関連の処理を切り出したモジュール
import { pushMsgOutPanel } from '@/components/Bottom/BottomPanel';

export async function loadFromCDN(moduleName: string, fs: any): Promise<string> {
  const cdnUrls = [
    `https://unpkg.com/${moduleName}`,
    `https://cdn.skypack.dev/${moduleName}`,
    `https://jspm.dev/${moduleName}`
  ];

  console.log(`[CDNLoader] Attempting to load ${moduleName} from CDN...`);

  for (const url of cdnUrls) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const content = await response.text();
        console.log(`[CDNLoader] Successfully loaded ${moduleName} from ${url}`);

        // BottomPanelへのcheck出力
        if (pushMsgOutPanel) {
          pushMsgOutPanel(`✅ CDNから「${moduleName}」をロードしました: ${url}`, 'check', 'CDNLoader');
        }

        // 仮想ファイルシステムにキャッシュ保存（次回は高速化）
        try {
          const modulePath = `/node_modules/${moduleName}/index.js`;
          await fs.promises.mkdir(`/node_modules/${moduleName}`, { recursive: true });
          await fs.promises.writeFile(modulePath, content, 'utf-8');
          console.log(`[CDNLoader] Cached ${moduleName} to virtual filesystem`);
        } catch (cacheError) {
          console.warn(`[CDNLoader] Failed to cache ${moduleName}:`, cacheError);
        }

        return content;
      }
    } catch (error) {
      console.log(`[CDNLoader] Failed to load from ${url}:`, error);
    }
  }

  throw new Error(`Failed to load module ${moduleName} from CDN`);
}

export async function evaluateModuleCode(
  code: string,
  moduleName: string,
  resolveModule: (name: string) => Promise<any>,
  currentWorkingDirectory: string
): Promise<any> {
  try {
    // モジュール用のサンドボックスを作成
    const moduleScope = {
      module: { exports: {} },
      exports: {},
      require: (name: string) => resolveModule(name),
      __filename: `/node_modules/${moduleName}/index.js`,
      __dirname: `/node_modules/${moduleName}`,
      console: console,
      process: {
        env: {},
        cwd: () => currentWorkingDirectory,
        platform: 'browser',
        version: 'v16.0.0',
        versions: { node: '16.0.0' }
      },
      Buffer: Buffer,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      global: {},
      window: undefined
    };

    // コードを実行
    const wrappedCode = `
      (function(module, exports, require, __filename, __dirname, console, process, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, global) {
        ${code}
        return module.exports;
      })
    `;

    const moduleFunction = eval(wrappedCode);
    const result = await moduleFunction(
      moduleScope.module,
      moduleScope.exports,
      moduleScope.require,
      moduleScope.__filename,
      moduleScope.__dirname,
      moduleScope.console,
      moduleScope.process,
      moduleScope.Buffer,
      moduleScope.setTimeout,
      moduleScope.clearTimeout,
      moduleScope.setInterval,
      moduleScope.clearInterval,
      moduleScope.global
    );

    if (
      moduleScope.module.exports &&
      typeof moduleScope.module.exports === 'object' &&
      'default' in moduleScope.module.exports &&
      Object.keys(moduleScope.module.exports).length === 1
    ) {
      // ESM default only: promote default to exports
      moduleScope.module.exports = moduleScope.module.exports.default as any;
    }

    return result || moduleScope.module.exports || moduleScope.exports;
  } catch (error) {
    console.error(`[evaluateModuleCode] Error evaluating ${moduleName}:`, error);
    throw new Error(`Failed to evaluate module ${moduleName}: ${(error as Error).message}`);
  }
}
