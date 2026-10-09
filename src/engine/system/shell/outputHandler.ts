import type { PassThrough } from 'node:stream';
import { Buffer } from 'buffer';
import { FSError, type FsApi, type FsFifoApi, getFifoApi } from '@/engine/core/fs/index';
import { resolvePath } from '@/engine/core/paths';
import type { Process } from './process';
import {
  isDevNull,
  isSpecialFile,
  type OutputCallbacks,
  type Segment,
  SPECIAL_FILES,
} from './types';

type FileState = { path: string; content: Buffer };
type FifoEndpoint = {
  id: string;
  api: FsFifoApi;
  cancelled: boolean;
  close(): Promise<void>;
};
type Destination =
  | { kind: 'console'; fd: 1 | 2 }
  | { kind: 'pipe' }
  | { kind: 'file'; state: FileState; offset: number; append: boolean }
  | { kind: 'fifo'; endpoint: FifoEndpoint }
  | { kind: 'closed' }
  | { kind: 'sink' };
type FifoWriterReference = { write: (bytes: Buffer) => void };

export type PreparedOutput = {
  routes: Map<number, Destination>;
  streams: Set<number>;
  pipeDisabled: boolean;
  input?: Buffer;
  inputPath?: string;
  inputFifo?: FifoEndpoint;
  failure?: string;
  writeFailure?: boolean;
};

export class ShellOutputHandler {
  private readonly fifoApi: FsFifoApi | null;
  private readonly fifoOwners = new Map<string, string>();

  constructor(
    private readonly fsClient: FsApi,
    private readonly getWorkingDirectory: () => Promise<string>
  ) {
    this.fifoApi = getFifoApi(fsClient);
  }

  registerFifoOwner(path: string, ownerId: string): void {
    this.fifoOwners.set(path, ownerId);
  }

  releaseFifoOwner(path: string): void {
    this.fifoOwners.delete(path);
  }

  preparePipeline(segments: Segment[], processes: Process[]): Promise<PreparedOutput>[] {
    const cwd = this.getWorkingDirectory();
    const files = new Map<string, FileState>();
    return segments.map(async (segment, index) => {
      const next = segments[index + 1];
      const pipeDisabled =
        next !== undefined &&
        (next.stdinText !== undefined ||
          next.redirections?.some(redirection => redirection.kind === 'input') === true);
      return this.prepareStage(
        segment,
        processes[index],
        next !== undefined,
        pipeDisabled,
        await cwd,
        files
      );
    });
  }

  private async prepareStage(
    segment: Segment,
    process: Process,
    hasNext: boolean,
    pipeDisabled: boolean,
    cwd: string,
    files: Map<string, FileState>
  ): Promise<PreparedOutput> {
    const routes = new Map<number, Destination>();
    if (hasNext) routes.set(1, { kind: 'pipe' });
    else routes.set(1, { kind: 'console', fd: 1 });
    routes.set(2, { kind: 'console', fd: 2 });
    const plan: PreparedOutput = { routes, streams: new Set([1, 2]), pipeDisabled };
    const replaceRoute = async (fd: number, destination: Destination) => {
      const previous = routes.get(fd);
      routes.set(fd, destination);
      if (previous?.kind === 'fifo' && ![...routes.values()].includes(previous)) {
        await previous.endpoint.close();
      }
    };
    const replaceInput = async () => {
      await plan.inputFifo?.close();
      plan.inputFifo = undefined;
      plan.input = undefined;
      plan.inputPath = undefined;
    };
    try {
      for (const redirection of segment.redirections ?? []) {
        if (process.hasExited) break;
        if (redirection.kind === 'input') {
          const path = resolvePath(cwd, redirection.path);
          if (isDevNull(path)) {
            await replaceInput();
            plan.input = Buffer.alloc(0);
            continue;
          }
          if (isSpecialFile(path)) {
            plan.failure = `Input redirection failed: unsupported device ${path}\n`;
            break;
          }
          if ((await this.pathType(path)) === 'fifo') {
            const endpoint = await this.openEndpoint(process, path, 'read');
            await replaceInput();
            plan.inputFifo = endpoint;
            continue;
          }
          try {
            await this.fsClient.readFile(path);
            await replaceInput();
            plan.inputPath = path;
          } catch (error) {
            plan.failure = `Input redirection failed: ${String(error)}\n`;
            break;
          }
          continue;
        }
        plan.streams.add(redirection.fd);
        if (redirection.kind === 'output') {
          const path = resolvePath(cwd, redirection.path);
          if (isDevNull(path)) {
            await replaceRoute(redirection.fd, { kind: 'sink' });
            continue;
          }
          if (path === SPECIAL_FILES.DEV_STDOUT || path === SPECIAL_FILES.DEV_STDERR) {
            let targetFd = 2;
            if (path === SPECIAL_FILES.DEV_STDOUT) targetFd = 1;
            const target = routes.get(targetFd);
            if (!target || target.kind === 'closed') {
              plan.failure = 'Redirection failed: Bad file descriptor\n';
              break;
            }
            await replaceRoute(redirection.fd, target);
            continue;
          }
          if (isSpecialFile(path)) {
            plan.failure = `Redirection failed: unsupported device ${path}\n`;
            break;
          }
          if ((await this.pathType(path)) === 'fifo') {
            const endpoint = await this.openEndpoint(process, path, 'write');
            await replaceRoute(redirection.fd, { kind: 'fifo', endpoint });
            continue;
          }
          try {
            let state = files.get(path);
            if (!state) {
              let content = Buffer.alloc(0);
              if (redirection.append && (await this.fsClient.exists(path))) {
                content = Buffer.from(await this.fsClient.readFile(path));
              }
              state = { path, content };
              files.set(path, state);
              await this.fsClient.writeFile(path, content);
            } else if (redirection.append) {
              await this.fsClient.writeFile(path, state.content);
            } else {
              await this.fsClient.writeFile(path, new Uint8Array());
              state.content = Buffer.alloc(0);
            }
            let offset = state.content.length;
            if (!redirection.append) offset = 0;
            await replaceRoute(redirection.fd, {
              kind: 'file',
              state,
              offset,
              append: redirection.append,
            });
          } catch (error) {
            plan.failure = `Redirection failed: ${String(error)}\n`;
          }
          if (plan.failure) break;
          continue;
        }
        if (redirection.kind === 'duplicate') {
          const target = routes.get(redirection.target);
          if (!target || target.kind === 'closed') {
            plan.failure = 'Redirection failed: Bad file descriptor\n';
            break;
          }
          await replaceRoute(redirection.fd, target);
          plan.streams.add(redirection.target);
          continue;
        }
        await replaceRoute(redirection.fd, { kind: 'closed' });
      }
      if (segment.stdinText !== undefined) await replaceInput();
      if (!plan.failure && plan.inputPath) {
        try {
          plan.input = Buffer.from(await this.fsClient.readFile(plan.inputPath));
        } catch (error) {
          plan.failure = `Input redirection failed: ${String(error)}\n`;
        }
      }
      return plan;
    } catch (error) {
      const endpoints = new Set<FifoEndpoint>();
      if (plan.inputFifo) endpoints.add(plan.inputFifo);
      for (const destination of routes.values()) {
        if (destination.kind === 'fifo') endpoints.add(destination.endpoint);
      }
      const closed = await Promise.allSettled([...endpoints].map(endpoint => endpoint.close()));
      const closeFailure = closed.find(result => result.status === 'rejected');
      if (closeFailure?.status === 'rejected') throw closeFailure.reason;
      throw error;
    }
  }

  private async openEndpoint(
    process: Process,
    path: string,
    mode: 'read' | 'write'
  ): Promise<FifoEndpoint> {
    const api = this.fifoApi;
    if (!api) throw new Error('FIFO support is unavailable.');
    const id = this.createEndpointId();
    let closePromise: Promise<void> | undefined;
    let opened = false;
    const endpoint: FifoEndpoint = {
      id,
      api,
      cancelled: false,
      close: () => {
        if (!closePromise) {
          process.off('signal', cancel);
          process.off('io-signal', cancel);
          process.off('exit', onExit);
          closePromise = api.closeFifo(id);
        }
        return closePromise;
      },
    };
    const cancel = () => {
      endpoint.cancelled = true;
      process.trackCleanup(endpoint.close());
    };
    const onExit = (_code: number | null, signal: string | null) => {
      if (mode === 'read' || !opened || signal) cancel();
    };
    process.on('signal', cancel);
    process.on('io-signal', cancel);
    process.on('exit', onExit);
    const ownerId = this.fifoOwners.get(path) ?? `shell-process-${process.pid}`;
    const opening = api.openFifo(path, mode, id, ownerId);
    if (process.hasExited) cancel();
    try {
      await opening;
      opened = true;
      return endpoint;
    } catch (error) {
      await endpoint.close();
      throw error;
    }
  }

  watch(
    process: Process,
    prepared: PreparedOutput,
    nextProcess: Process | undefined,
    output: { stdout: Buffer[]; stderr: Buffer[] },
    callbacks?: OutputCallbacks
  ): Promise<void> {
    const pipe = nextProcess?.stdin;
    const streams = Array.from(prepared.streams);
    let openPipeWriters = 0;
    const endings: Promise<void>[] = [];
    const fifoStreams = new Map<Extract<Destination, { kind: 'fifo' }>, PassThrough[]>();
    const fifoWriters = new Map<Destination, FifoWriterReference>();

    for (const fd of streams) {
      const destination = prepared.routes.get(fd) ?? { kind: 'sink' };
      if (destination.kind === 'pipe' && pipe && !prepared.pipeDisabled) openPipeWriters += 1;
      const stream = process.getFdWrite(fd);
      if (destination.kind === 'fifo') {
        const group = fifoStreams.get(destination) ?? [];
        group.push(stream);
        fifoStreams.set(destination, group);
        continue;
      }
      const decoder = new TextDecoder();
      endings.push(new Promise(resolve => stream.once('end', resolve)));
      stream.on('data', (chunk: Buffer | string) => {
        const bytes = Buffer.from(chunk);
        if (destination.kind === 'file') {
          this.writeFile(destination, bytes);
          return;
        }
        if (destination.kind === 'pipe') {
          if (pipe && !prepared.pipeDisabled && !pipe.writableEnded && !pipe.destroyed) {
            pipe.write(bytes);
          }
          return;
        }
        if (destination.kind === 'closed') {
          if (!prepared.writeFailure) {
            prepared.writeFailure = true;
            this.reportBadDescriptor(prepared, pipe, output, fifoWriters, callbacks);
          }
          return;
        }
        if (destination.kind !== 'console') return;
        if (destination.fd === 1) output.stdout.push(bytes);
        if (destination.fd === 2) output.stderr.push(bytes);
        const text = decoder.decode(bytes, { stream: true });
        if (!text) return;
        if (destination.fd === 1) {
          callbacks?.stdout?.(text);
          return;
        }
        callbacks?.stderr?.(text);
      });
      stream.on('end', () => {
        if (destination.kind === 'console') {
          const text = decoder.decode();
          if (text) {
            if (destination.fd === 1) callbacks?.stdout?.(text);
            if (destination.fd === 2) callbacks?.stderr?.(text);
          }
        }
        if (destination.kind === 'pipe') {
          openPipeWriters -= 1;
          if (
            openPipeWriters === 0 &&
            !prepared.pipeDisabled &&
            pipe &&
            !pipe.writableEnded &&
            !pipe.destroyed
          ) {
            pipe.end();
          }
        }
      });
    }

    for (const [destination, fifoOutputs] of fifoStreams) {
      const writer: FifoWriterReference = { write: () => {} };
      fifoWriters.set(destination, writer);
      const watch = this.writeFifoStreams(process, destination, fifoOutputs, writer);
      endings.push(watch);
    }

    if (
      pipe &&
      !prepared.pipeDisabled &&
      openPipeWriters === 0 &&
      !pipe.writableEnded &&
      !pipe.destroyed
    ) {
      pipe.end();
    }
    return Promise.all(endings).then(() => undefined);
  }

  watchInput(process: Process, prepared: PreparedOutput): Promise<void> | undefined {
    if (!prepared.inputFifo) return undefined;
    return this.readFifoIntoProcess(process, prepared.inputFifo);
  }

  private writeFifoStreams(
    process: Process,
    destination: Extract<Destination, { kind: 'fifo' }>,
    streams: PassThrough[],
    writer: FifoWriterReference
  ): Promise<void> {
    const endpoint = destination.endpoint;
    let writeQueue = Promise.resolve();
    let writeError: Error | undefined;
    const enqueue = (bytes: Buffer, stream?: PassThrough) => {
      stream?.pause();
      writeQueue = writeQueue.then(async () => {
        try {
          if (!writeError && !endpoint.cancelled) {
            await this.writeFifoChunk(endpoint.api, endpoint.id, bytes);
          }
        } catch (error) {
          if (!endpoint.cancelled) {
            writeError = new Error(String(error));
            if (error instanceof Error) writeError = error;
            if (error instanceof FSError && error.code === 'EPIPE') {
              process.kill('SIGPIPE');
            }
          }
        } finally {
          if (stream && !stream.destroyed) stream.resume();
        }
      });
    };
    writer.write = bytes => enqueue(bytes);
    const streamCompletion = Promise.all(
      streams.map(stream => this.watchFifoStream(stream, enqueue))
    );
    const completion = (async () => {
      try {
        await streamCompletion;
        await writeQueue;
        if (writeError && !(writeError instanceof FSError && writeError.code === 'EPIPE')) {
          throw writeError;
        }
      } catch (error) {
        if (!endpoint.cancelled) throw error;
      } finally {
        await endpoint.close();
      }
    })();
    return completion;
  }

  private readFifoIntoProcess(process: Process, endpoint: FifoEndpoint): Promise<void> {
    const completion = (async () => {
      try {
        while (!process.hasExited) {
          const bytes = await endpoint.api.readFifo(endpoint.id, 65536);
          if (bytes.length === 0) break;
          if (process.stdin.writableEnded || process.stdin.destroyed) break;
          if (!process.stdin.write(bytes)) await this.waitForDrain(process);
        }
      } catch (error) {
        if (!endpoint.cancelled) throw error;
      } finally {
        await endpoint.close();
        if (!process.stdin.writableEnded) process.stdin.end();
      }
    })();
    return completion;
  }

  private async writeFifoChunk(
    fifoApi: FsFifoApi,
    endpointId: string,
    bytes: Uint8Array
  ): Promise<void> {
    let offset = 0;
    while (offset < bytes.length) {
      const written = await fifoApi.writeFifo(endpointId, bytes.subarray(offset));
      if (written <= 0) throw new Error('FIFO write made no progress.');
      offset += written;
    }
  }

  private watchFifoStream(
    stream: PassThrough,
    enqueue: (bytes: Buffer, stream?: PassThrough) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const onData = (chunk: Buffer | string) => enqueue(Buffer.from(chunk), stream);
      const onEnd = () => {
        stream.off('data', onData);
        stream.off('error', onError);
        resolve();
      };
      const onError = (error: Error) => {
        stream.off('data', onData);
        stream.off('end', onEnd);
        reject(error);
      };
      stream.on('data', onData);
      stream.once('end', onEnd);
      stream.once('error', onError);
    });
  }

  private waitForDrain(process: Process): Promise<void> {
    return new Promise(resolve => {
      const finish = () => {
        process.stdin.off('drain', finish);
        process.off('exit', finish);
        resolve();
      };
      process.stdin.once('drain', finish);
      process.once('exit', finish);
    });
  }

  private createEndpointId(): string {
    return `shell-fifo-${crypto.randomUUID()}`;
  }

  private async pathType(path: string): Promise<string | null> {
    try {
      return (await this.fsClient.stat(path)).type;
    } catch {
      return null;
    }
  }

  private reportBadDescriptor(
    prepared: PreparedOutput,
    pipe: Process['stdin'] | undefined,
    output: { stdout: Buffer[]; stderr: Buffer[] },
    fifoWriters: Map<Destination, FifoWriterReference>,
    callbacks?: OutputCallbacks
  ): void {
    const message = 'Redirection failed: Bad file descriptor\n';
    const bytes = Buffer.from(message);
    const destination = prepared.routes.get(2);
    if (!destination || destination.kind === 'sink' || destination.kind === 'closed') return;
    if (destination.kind === 'pipe') {
      if (!prepared.pipeDisabled && pipe && !pipe.writableEnded && !pipe.destroyed) {
        pipe.write(bytes);
      }
      return;
    }
    if (destination.kind === 'file') {
      this.writeFile(destination, bytes);
      return;
    }
    if (destination.kind === 'fifo') {
      fifoWriters.get(destination)?.write(bytes);
      return;
    }
    if (destination.kind !== 'console') return;
    if (destination.fd === 1) output.stdout.push(bytes);
    if (destination.fd === 2) output.stderr.push(bytes);
    if (destination.fd === 1) callbacks?.stdout?.(message);
    if (destination.fd === 2) callbacks?.stderr?.(message);
  }

  private writeFile(destination: Extract<Destination, { kind: 'file' }>, bytes: Buffer): void {
    let offset = destination.offset;
    if (destination.append) offset = destination.state.content.length;
    const end = offset + bytes.length;
    const content = Buffer.alloc(Math.max(destination.state.content.length, end));
    destination.state.content.copy(content);
    bytes.copy(content, offset);
    destination.state.content = content;
    destination.offset = end;
  }

  async flush(prepared: PreparedOutput[]): Promise<void> {
    const states = new Map<string, FileState>();
    for (const stage of prepared) {
      for (const destination of stage.routes.values()) {
        if (destination.kind === 'file') states.set(destination.state.path, destination.state);
      }
    }
    for (const state of states.values()) {
      await this.fsClient.writeFile(state.path, state.content);
    }
  }
}
