/** Runs esbuild transforms in the FS Worker's pooled child Worker. */

import * as Comlink from 'comlink';
import type { TranspileBenchmark } from '../bridge/protocol';
import type { ModuleDependency } from '../module/moduleCode';
import { extractCjsDependencies, transformEsmToCjs } from './esmTransformer';

export interface TranspileRequest {
  id: string;
  code: string;
  filePath: string;
  benchmark?: boolean;
  options: {
    isTypeScript: boolean;
    isJSX: boolean;
  };
}

export interface TranspileResult {
  id: string;
  code: string;
  sourceMap?: string;
  dependencies: ModuleDependency[];
  benchmark?: TranspileBenchmark;
}

async function transpile(request: TranspileRequest): Promise<TranspileResult> {
  let benchmark: TranspileBenchmark | undefined;
  if (request.benchmark) benchmark = { initMs: 0, transformMs: 0 };
  const transformed = await transformEsmToCjs(request.code, request.filePath, {
    isTypeScript: request.options.isTypeScript,
    isJSX: request.options.isJSX,
    benchmark,
  });

  return {
    id: request.id,
    benchmark,
    code: transformed,
    dependencies: extractCjsDependencies(transformed),
  };
}

export interface TranspileWorkerApi {
  transpile(request: TranspileRequest): Promise<TranspileResult>;
}

const api: TranspileWorkerApi = {
  transpile,
};

Comlink.expose(api);
