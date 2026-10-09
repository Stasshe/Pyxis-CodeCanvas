import { posixPath } from '@/engine/core/pathUtils';
import { runtimeWarn } from '../core/runtimeLogger';
import { isProcessExitSignal } from '../nodejs/processExit';
import { createRuntimeFunction } from './dynamicFunction';
import { ModuleCode, type ModuleFormat } from './moduleCode';
import type { ModuleLoader } from './moduleLoader';

const NativeEval = globalThis.eval;

export type ModuleLoaderReturn = ReturnType<ModuleLoader['requireSync']>;

export interface RuntimeRequire {
  (specifier: string): ModuleLoaderReturn;
  resolve: {
    (specifier: string, options?: { paths?: string[] }): string;
    paths(specifier: string): string[] | null;
  };
  main: CommonJsModule | undefined;
  cache: Record<string, CommonJsModule>;
  extensions: Record<string, (module: CommonJsModule, filename: string) => void>;
}

export interface CommonJsModule {
  exports: ModuleLoaderReturn;
  id: string;
  filename: string;
  path: string;
  paths: string[];
  parent: CommonJsModule | null;
  children: CommonJsModule[];
  loaded: boolean;
  require: RuntimeRequire;
  _compile: (content: string, filename: string) => ModuleLoaderReturn;
}

export function executeModule(
  code: string,
  filePath: string,
  module: CommonJsModule,
  loaders: Pick<ModuleLoader, 'requireSync' | 'asyncLoad' | 'createRequire' | 'resolveImport'>,
  format: ModuleFormat,
  asyncEvaluation = false,
  loadImport?: (specifier: string) => ReturnType<ModuleLoader['asyncLoad']>
): ModuleLoaderReturn {
  const exports = module.exports;
  const __filename = filePath;
  const __dirname = posixPath.dirname(filePath);

  if (code.startsWith('#!')) {
    code = `//${code}`; // Preserve line numbers while disabling the shebang.
  }

  if (format === 'module') {
    code = `"use strict";\n${code}`;
  }

  // Modules must be pre-loaded into execution cache before they can be required
  const require = loaders.createRequire(filePath);
  const requireImport = (moduleName: string): unknown =>
    loaders.requireSync(moduleName, filePath, 'import');

  const asyncLoadFn = loaders.asyncLoad.bind(loaders);
  const runtimeFunction = createRuntimeFunction((specifier: string | URL) =>
    loaders.asyncLoad(specifier, filePath)
  );
  let bodyFunction = 'function';
  let bodyParameters = '';
  let bodyArguments = '';
  if (format === 'commonjs') {
    bodyParameters = 'exports, require, module, __filename, __dirname';
    bodyArguments = ', exports, require, module, __filename, __dirname';
  }
  if (asyncEvaluation) {
    bodyFunction = 'async function';
    code = ModuleCode.runtimeCode(code, false, true);
  }
  const wrappedCode = `
      (function(module, exports, require, __filename, __dirname, __injected_asyncLoad, __pyxisRequireImport, Function, __pyxisLoadImport, __pyxisImportMetaResolve) {
        const __pyxisRequireCommonJs = require;
        var __pyxisImport = function(s) { return __injected_asyncLoad(s, __filename); };
        return (${bodyFunction}(${bodyParameters}) {
          ${code}
        }).call(exports${bodyArguments});
      })
    `;

  try {
    const executeFunc = NativeEval(wrappedCode);
    const result = executeFunc(
      module,
      exports,
      require,
      __filename,
      __dirname,
      asyncLoadFn,
      requireImport,
      runtimeFunction,
      loadImport,
      (specifier: string) => loaders.resolveImport(specifier, filePath)
    );
    if (asyncEvaluation) return result;
    return module.exports;
  } catch (error) {
    if (isProcessExitSignal(error)) {
      throw error;
    }
    if (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND') {
      runtimeWarn('❌ Module not found during execution:', filePath);
      runtimeWarn('Error details:', error.message);
      throw error;
    }

    runtimeWarn('❌ Module execution failed:', filePath);
    runtimeWarn(
      'Error details:',
      error instanceof Error ? `${error.name}: ${error.message}` : String(JSON.stringify(error))
    );
    throw error;
  }
}
