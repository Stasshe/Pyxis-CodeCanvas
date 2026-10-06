import type { Buffer } from 'buffer';
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
    fdBuffers: Record<number, string[]>,
    callbacks?: OutputCallbacks
  ): void {
    const watchFd = (fd: number) => {
      if (!fdBuffers[fd]) fdBuffers[fd] = [];
      try {
        const stream = process.getFdWrite(fd);
        const fdFiles = segment.fdFiles ?? {};
        const fileInfo = fdFiles[fd];
        if (fileInfo && isDevNull(fileInfo.path)) {
          stream.on('data', () => {});
          return;
        }
        stream.on('data', (chunk: Buffer | string) => {
          const output = String(chunk);
          fdBuffers[fd].push(output);
          if (fd === 1) callbacks?.stdout?.(output);
          if (fd === 2) callbacks?.stderr?.(output);
        });
      } catch {
        return;
      }
    };

    watchFd(1);
    watchFd(2);
    for (const descriptor of Object.keys(segment.fdFiles ?? {})) {
      const fd = Number(descriptor);
      if (!Number.isNaN(fd) && fd > 2) watchFd(fd);
    }
  }

  async handleRedirections(
    segment: Segment,
    fdBuffers: Record<number, string[]>,
    stdout: string,
    stderr: string
  ): Promise<void> {
    const writes: Record<string, string> = {};
    const appendMap: Record<string, boolean> = {};
    const cwd = await this.getWorkingDirectory();
    const resolveRedirectPath = (path: string): string => {
      if (!path || isDevNull(path)) return path;
      return resolvePath(cwd, path);
    };
    const add = (path: string | undefined | null, content: string, append = false) => {
      if (!path || isDevNull(path)) return;
      const key = resolveRedirectPath(path);
      if (!key || isDevNull(key)) return;
      writes[key] = (writes[key] || '') + content;
      appendMap[key] = appendMap[key] || append;
    };

    for (const [descriptor, info] of Object.entries(segment.fdFiles ?? {})) {
      const fd = Number(descriptor);
      if (Number.isNaN(fd) || isDevNull(info.path)) continue;
      add(info.path, (fdBuffers[fd] ?? []).join(''), info.append);
    }

    if (Object.keys(segment.fdFiles ?? {}).length === 0) {
      if (segment.stdoutFile) add(segment.stdoutFile, stdout, segment.append);
      if (segment.stderrFile) add(segment.stderrFile, stderr);
    }

    for (const path of Object.keys(writes)) {
      try {
        let content = writes[path];
        if (appendMap[path])
          content = (await this.fsClient.readText(path).catch(() => '')) + content;
        await this.fsClient.writeFile(path, content);
      } catch {
        // Redirection failures do not change command output streams.
      }
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
