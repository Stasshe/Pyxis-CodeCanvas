export interface PackageInfo {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  os?: string[];
  cpu?: string[];
  tarball: string;
  integrity?: string;
  bin?: string | Record<string, string>;
}

export interface InstallResult {
  installed: number;
  packageCount: number;
}

export type InstallProgressCallback = (
  packageName: string,
  version: string,
  isDirect: boolean
) => Promise<void> | void;
