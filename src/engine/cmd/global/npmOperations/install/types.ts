export interface PackageInfo {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  tarball: string;
}

export type InstallProgressCallback = (
  packageName: string,
  version: string,
  isDirect: boolean
) => Promise<void> | void;

export type ExtractedFileMap = Map<
  string,
  { isDirectory: boolean; content?: string; fullPath: string }
>;
