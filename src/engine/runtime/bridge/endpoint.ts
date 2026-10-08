import type {
  FsBenchmark,
  FsRequest,
  FsStat,
  RpcCall,
  RpcReply,
  RpcResult,
  RpcValue,
  TranspileRequest,
} from './protocol';

export interface RuntimeFilesystem {
  readFile(path: string, benchmark?: FsBenchmark): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array, benchmark?: FsBenchmark): Promise<void>;
  readdir(path: string, benchmark?: FsBenchmark): Promise<string[]>;
  stat(path: string, benchmark?: FsBenchmark): Promise<FsStat>;
  mkdir(path: string, options: { recursive: boolean }, benchmark?: FsBenchmark): Promise<void>;
  rm(
    path: string,
    options: { recursive: boolean; force: boolean },
    benchmark?: FsBenchmark
  ): Promise<void>;
  rename(path: string, newPath: string, benchmark?: FsBenchmark): Promise<void>;
}

async function executeFs(
  fs: RuntimeFilesystem,
  request: FsRequest,
  benchmark?: FsBenchmark
): Promise<RpcValue> {
  switch (request.op) {
    case 'readFile':
      return Array.from(await fs.readFile(request.path, benchmark));
    case 'readdir':
      return fs.readdir(request.path, benchmark);
    case 'stat':
      return fs.stat(request.path, benchmark);
    case 'writeFile':
      await fs.writeFile(request.path, new Uint8Array(request.data), benchmark);
      break;
    case 'mkdir':
      await fs.mkdir(request.path, { recursive: request.recursive }, benchmark);
      break;
    case 'rm':
      await fs.rm(request.path, { recursive: request.recursive, force: request.force }, benchmark);
      break;
    case 'rename':
      await fs.rename(request.path, request.newPath, benchmark);
      break;
  }
  return null;
}

export function attachRuntimePort(
  port: MessagePort,
  fs: RuntimeFilesystem,
  transpile: (request: TranspileRequest) => Promise<RpcValue>
): void {
  port.onmessage = async (event: MessageEvent<RpcCall>) => {
    const { id, request } = event.data;
    let result: RpcResult;
    let fsBenchmark: FsBenchmark | undefined;
    if (request.kind === 'fs' && request.benchmark) fsBenchmark = { queueMs: 0, coreMs: 0 };
    try {
      let value: RpcValue;
      if (request.kind === 'fs') value = await executeFs(fs, request, fsBenchmark);
      else if (request.kind === 'transpile') value = await transpile(request);
      else throw new Error('Shell and stdin requests must be handled by main.');
      result = { ok: true, value };
    } catch (error) {
      let message = String(error);
      let code: string | undefined;
      if (error instanceof Error) {
        message = error.message;
        if ('code' in error && typeof error.code === 'string') code = error.code;
      }
      result = { ok: false, error: message, code };
    }
    if (fsBenchmark) result.fsBenchmark = fsBenchmark;
    const reply: RpcReply = { id, result };
    port.postMessage(reply);
  };
  port.start();
}
