export interface MountStat {
  type: 'file' | 'directory' | 'symlink';
  size: number;
  mtime: Date;
}
