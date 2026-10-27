export interface MountStat {
  type: 'file' | 'directory' | 'symlink' | 'fifo' | 'characterDevice';
  size: number;
  mtime: Date;
  mode: number;
}
