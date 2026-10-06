export interface MountStat {
  type: 'file' | 'directory';
  size: number;
  mtime: Date;
}
