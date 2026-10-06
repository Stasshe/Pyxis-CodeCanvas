import type {
  FsRequest,
  FsStat,
  RpcCall,
  RpcReply,
  RpcResult,
  RpcValue,
  TranspileRequest,
} from './protocol';

export interface RuntimeFilesystem {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<FsStat>;
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  rename(path: string, newPath: string): Promise<void>;
}

async function executeFs(fs: RuntimeFilesystem, request: FsRequest): Promise<RpcValue> {
  switch (request.op) {
    case 'readFile':
      return Array.from(await fs.readFile(request.path));
    case 'readdir':
      return fs.readdir(request.path);
    case 'stat':
      return fs.stat(request.path);
    case 'writeFile':
      await fs.writeFile(request.path, new Uint8Array(request.data));
      break;
    case 'mkdir':
      await fs.mkdir(request.path, { recursive: request.recursive });
      break;
    case 'rm':
      await fs.rm(request.path, { recursive: request.recursive, force: request.force });
      break;
    case 'rename':
      await fs.rename(request.path, request.newPath);
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
    try {
      let value: RpcValue;
      if (request.kind === 'fs') value = await executeFs(fs, request);
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
    const reply: RpcReply = { id, result };
    port.postMessage(reply);
  };
  port.start();
}
