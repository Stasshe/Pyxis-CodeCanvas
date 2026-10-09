import { parentPort } from 'node:worker_threads';
import type { RpcValue, TranspileRequest } from '@/engine/system/runtime/bridge/protocol';
import {
  extractCjsDependencies,
  transformEsmToCjs,
} from '@/engine/system/runtime/transpiler/esmTransformer';

interface TranspileWorkerRequest {
  id: number;
  request: TranspileRequest;
}

if (!parentPort) throw new Error('Transpiler worker requires a parent port.');

parentPort.on('message', async ({ id, request }: TranspileWorkerRequest) => {
  try {
    const code = await transformEsmToCjs(request.code, request.filePath, {
      isTypeScript: request.isTypeScript,
      isJSX: request.isJSX,
    });
    const value: RpcValue = { code, dependencies: extractCjsDependencies(code) };
    parentPort?.postMessage({ id, result: { ok: true, value } });
  } catch (error) {
    parentPort?.postMessage({
      id,
      result: {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && 'code' in error ? { code: String(error.code) } : {}),
      },
    });
  }
});
