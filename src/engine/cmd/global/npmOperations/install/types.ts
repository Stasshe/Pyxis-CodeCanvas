export interface PackageInfo {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
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
