declare module 'path-browserify' {
  interface ParsedPath {
    root: string;
    dir: string;
    base: string;
    ext: string;
    name: string;
  }
  interface PathObject {
    root?: string;
    dir?: string;
    base?: string;
    ext?: string;
    name?: string;
  }
  interface PosixPath {
    normalize(path: string): string;
    join(...paths: string[]): string;
    resolve(...paths: string[]): string;
    relative(from: string, to: string): string;
    dirname(path: string): string;
    basename(path: string, suffix?: string): string;
    extname(path: string): string;
    isAbsolute(path: string): boolean;
    parse(path: string): ParsedPath;
    format(path: PathObject): string;
    sep: '/';
    delimiter: ':';
  }
  const path: PosixPath;
  export default path;
}
