import { Buffer } from 'buffer';
import type { FsFifoApi } from '@/engine/core/fs/types';
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

export interface RuntimeFilesystem
  extends Pick<FsFifoApi, 'openFifo' | 'readFifo' | 'writeFifo' | 'closeFifo'> {
  readFile(path: string, benchmark?: FsBenchmark, ownerId?: string): Promise<Uint8Array>;
  writeFile(
    path: string,
    data: Uint8Array,
    benchmark?: FsBenchmark,
    ownerId?: string,
    mode?: number
  ): Promise<void>;
  writeRange(
    path: string,
    data: Uint8Array,
    position: number | null,
    create: boolean,
    exclusive: boolean,
    benchmark?: FsBenchmark,
    mode?: number
  ): Promise<number>;
  readdir(path: string, benchmark?: FsBenchmark): Promise<string[]>;
  stat(path: string, benchmark?: FsBenchmark): Promise<FsStat>;
  lstat(path: string, benchmark?: FsBenchmark): Promise<FsStat>;
  readlink(path: string, benchmark?: FsBenchmark): Promise<string>;
  realpath(path: string, benchmark?: FsBenchmark): Promise<string>;
  symlink(target: string, path: string, benchmark?: FsBenchmark): Promise<void>;
  mkdir(
    path: string,
    options: { recursive: boolean; mode?: number },
    benchmark?: FsBenchmark
  ): Promise<void>;
  chmod(path: string, mode: number, benchmark?: FsBenchmark): Promise<void>;
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
  runtimeId: string,
  benchmark?: FsBenchmark
): Promise<RpcValue> {
  switch (request.op) {
    case 'readFile':
      return Buffer.from(await fs.readFile(request.path, benchmark, runtimeId)).toString('base64');
    case 'readdir':
      return fs.readdir(request.path, benchmark);
    case 'stat':
      return fs.stat(request.path, benchmark);
    case 'lstat':
      return fs.lstat(request.path, benchmark);
    case 'readlink':
      return fs.readlink(request.path, benchmark);
    case 'realpath':
      return fs.realpath(request.path, benchmark);
    case 'symlink':
      await fs.symlink(request.target, request.path, benchmark);
      break;
    case 'writeFile':
      await fs.writeFile(
        request.path,
        Buffer.from(request.data, 'base64'),
        benchmark,
        runtimeId,
        request.mode
      );
      break;
    case 'writeRange':
      return fs.writeRange(
        request.path,
        Buffer.from(request.data, 'base64'),
        request.position,
        request.create,
        request.exclusive,
        benchmark,
        request.mode
      );
    case 'fifoOpen':
      await fs.openFifo(request.path, request.mode, request.endpointId, runtimeId, {
        nonblocking: request.nonblocking,
      });
      break;
    case 'fifoRead':
      return Buffer.from(await fs.readFifo(request.endpointId, request.maxBytes)).toString(
        'base64'
      );
    case 'fifoWrite':
      return fs.writeFifo(request.endpointId, Buffer.from(request.data, 'base64'));
    case 'fifoClose':
      await fs.closeFifo(request.endpointId);
      break;
    case 'mkdir':
      await fs.mkdir(request.path, { recursive: request.recursive, mode: request.mode }, benchmark);
      break;
    case 'chmod':
      await fs.chmod(request.path, request.mode, benchmark);
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
    const { id, request, runtimeId } = event.data;
    let result: RpcResult;
    let fsBenchmark: FsBenchmark | undefined;
    if (request.kind === 'fs' && request.benchmark) fsBenchmark = { queueMs: 0, coreMs: 0 };
    try {
      let value: RpcValue;
      if (request.kind === 'fs') value = await executeFs(fs, request, runtimeId, fsBenchmark);
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
