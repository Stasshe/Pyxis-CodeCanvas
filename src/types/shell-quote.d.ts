declare module 'shell-quote' {
  /** Parse a command string into an array of arguments */
  export function parse(cmd: string, env?: Record<string, string>): (string | { op: string })[];
  /** Quote an array of arguments into a command string */
  export function quote(args: string[]): string;
}
