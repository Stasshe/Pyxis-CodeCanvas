import { Buffer } from 'buffer';
import type { FsApi } from '@/engine/core/fs';
import { resolvePath } from '@/engine/core/pathUtils';
import type { OutputCallbacks } from './executor';
import type { Process } from './process';
import { isDevNull, type Segment } from './types';

export class ShellOutputHandler {
  constructor(
    private readonly fsClient: FsApi,
    private readonly getWorkingDirectory: () => Promise<string>
  ) {}

  watch(
    process: Process,
    segment: Segment,
    fdBuffers: Record<number, Buffer[]>,
    callbacks?: OutputCallbacks
  ): void {
    const watched = new Set<ReturnType<Process['getFdWrite']>>();
    const fileBuffers = new Map<string, Buffer[]>();
    for (const [descriptor, info] of Object.entries(segment.fdFiles ?? {})) {
      let chunks = fileBuffers.get(info.path);
      if (!chunks) {
        chunks = [];
        fileBuffers.set(info.path, chunks);
      }
      fdBuffers[Number(descriptor)] = chunks;
    }
    const watchFd = (fd: number) => {
      if (!fdBuffers[fd]) fdBuffers[fd] = [];
      try {
        const stream = process.getFdWrite(fd);
        if (watched.has(stream)) return;
        watched.add(stream);
        const fdFiles = segment.fdFiles ?? {};
        const fileInfo = fdFiles[fd];
        if (fileInfo && isDevNull(fileInfo.path)) {
          stream.on('data', () => {});
          return;
        }
        const decoder = new TextDecoder();
        const display = (text: string) => {
          if (!text) return;
          if (fd === 1) callbacks?.stdout?.(text);
          if (fd === 2) callbacks?.stderr?.(text);
        };
        stream.on('data', (chunk: Buffer | string) => {
          const bytes = Buffer.from(chunk);
          fdBuffers[fd].push(bytes);
          display(decoder.decode(bytes, { stream: true }));
        });
        stream.on('end', () => display(decoder.decode()));
      } catch {
        return;
      }
    };

    if (segment.stdoutToStderr) {
      watchFd(2);
      watchFd(1);
    } else {
      watchFd(1);
      watchFd(2);
    }
    for (const descriptor of Object.keys(segment.fdFiles ?? {})) {
      const fd = Number(descriptor);
      if (!Number.isNaN(fd) && fd > 2) watchFd(fd);
    }
  }

  async handleRedirections(segment: Segment, fdBuffers: Record<number, Buffer[]>): Promise<void> {
    const writes: Record<string, Buffer[]> = {};
    const appendMap: Record<string, boolean> = {};
    const addedBuffers = new Map<string, Set<Buffer[]>>();
    const cwd = await this.getWorkingDirectory();
    const resolveRedirectPath = (path: string): string => {
      if (!path || isDevNull(path)) return path;
      return resolvePath(cwd, path);
    };
    const add = (path: string | undefined | null, content: Buffer[], append = false) => {
      if (!path || isDevNull(path)) return;
      const key = resolveRedirectPath(path);
      if (!key || isDevNull(key)) return;
      let added = addedBuffers.get(key);
      if (!added) {
        added = new Set();
        addedBuffers.set(key, added);
      }
      if (added.has(content)) return;
      added.add(content);
      if (!writes[key]) writes[key] = [];
      writes[key].push(...content);
      appendMap[key] = appendMap[key] || append;
    };

    for (const [descriptor, info] of Object.entries(segment.fdFiles ?? {})) {
      const fd = Number(descriptor);
      if (Number.isNaN(fd) || isDevNull(info.path)) continue;
      add(info.path, fdBuffers[fd] ?? [], info.append);
    }

    if (Object.keys(segment.fdFiles ?? {}).length === 0) {
      if (segment.stdoutFile) add(segment.stdoutFile, fdBuffers[1] ?? [], segment.append);
      if (segment.stderrFile) add(segment.stderrFile, fdBuffers[2] ?? []);
    }

    for (const path of Object.keys(writes)) {
      let content = Buffer.concat(writes[path]);
      if (appendMap[path] && (await this.fsClient.exists(path))) {
        const previous = await this.fsClient.readFile(path);
        content = Buffer.concat([previous, content]);
      }
      await this.fsClient.writeFile(path, content);
    }
  }

  shouldSuppressOutput(segment: Segment | null, fd: number): boolean {
    if (!segment) return false;
    if (segment.fdFiles?.[fd]) return true;
    if (fd === 1) return Boolean(segment.stdoutFile || segment.stdoutToStderr);
    if (fd === 2) return Boolean(segment.stderrFile || segment.stderrToStdout);
    return false;
  }
}
