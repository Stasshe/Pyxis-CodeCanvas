import { UnixCommandBase } from './base';

/**
 * df - ファイルシステムのディスク使用量を表示（簡易）
 * Usage: df [options]
 * Options:
 *   -h, --human-readable
 */
export class DfCommand extends UnixCommandBase {
  async execute(_: string[] = []): Promise<string> {
    // For our virtual FS, report project usage vs a fixed quota
    const TOTAL_BYTES = 1024 * 1024 * 1024; // 1 GiB quota
    const all = await this.cachedGetFilesByPrefix('');
    const used = all.reduce((s, f) => s + (f.bufferContent?.byteLength || f.content?.length || 0), 0);
    const avail = Math.max(0, TOTAL_BYTES - used);

    const toK = (b: number) => Math.ceil(b / 1024).toString().padStart(10);

    const lines = [];
    lines.push('Filesystem     1K-blocks     Used Available Use% Mounted on');
    lines.push(`pyxis:${this.projectName}${toK(TOTAL_BYTES)}${toK(used)}${toK(avail)} ${(Math.round((used / TOTAL_BYTES) * 100) || 0).toString().padStart(4)}% /`);
    return lines.join('\n');
  }
}
