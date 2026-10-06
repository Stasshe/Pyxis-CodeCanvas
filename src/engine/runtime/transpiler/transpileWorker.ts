/** Runs esbuild transforms in the FS Worker's pooled child Worker. */

import * as Comlink from 'comlink';
import { extractCjsDependencies, transformEsmToCjs } from './esmTransformer';

export interface TranspileRequest {
  id: string;
  code: string;
  filePath: string;
  options: {
    isTypeScript: boolean;
    isESModule: boolean;
    isJSX: boolean;
  };
}

export interface TranspileResult {
  id: string;
  code: string;
  sourceMap?: string;
  dependencies: string[];
}

async function transpile(request: TranspileRequest): Promise<TranspileResult> {
  const transformed = await transformEsmToCjs(request.code, request.filePath, {
    isTypeScript: request.options.isTypeScript,
    isJSX: request.options.isJSX,
  });

  return {
    id: request.id,
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
