export interface MountStat {
  type: 'file' | 'directory';
  size: number;
  mtime: Date;
}

export interface VirtualMount {
  hasFile(path: string): boolean;
  hasDir(path: string): boolean;
  getFileSync(path: string): string | Uint8Array | undefined;

  getFile(path: string): Promise<string | Uint8Array | undefined>;
  setFile(path: string, content: string | Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<boolean>;
  mkdir(path: string, recursive?: boolean): Promise<void>;
  rmdir(path: string, recursive?: boolean): Promise<void>;
  listDir(path: string): Promise<string[]>;
  stat(path: string): Promise<MountStat | null>;
}
