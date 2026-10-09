import { StringDecoder } from 'node:string_decoder';
import type { Process } from './process';
import type { ScriptShell } from './scriptRunner';

/** Read only through the newline, leaving the next record in the stream buffer. */
export async function readVariables(
  args: string[],
  proc: Process,
  shell: ScriptShell
): Promise<number> {
  let raw = false;
  if (args[0] === '-r') {
    raw = true;
    args = args.slice(1);
  }
  if (args.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
    proc.writeStderr('read: expected variable names (only -r is supported)\n');
    return 2;
  }
  const stream = proc.stdinStream;
  const decoder = new StringDecoder('utf8');
  let line = '';
  let terminated = false;
  while (true) {
    if (proc.hasExited) return 1;
    const chunk = stream.read(1);
    if (chunk === null) {
      if (stream.readableEnded || stream.destroyed || proc.hasExited) break;
      await new Promise<void>(resolve => {
        const ready = () => {
          stream.off('readable', ready);
          stream.off('end', ready);
          stream.off('close', ready);
          proc.off('exit', ready);
          resolve();
        };
        stream.once('readable', ready);
        stream.once('end', ready);
        stream.once('close', ready);
        proc.once('exit', ready);
      });
      continue;
    }
    const character = decoder.write(chunk);
    if (character === '\n') {
      const backslashes = /\\+$/.exec(line)?.[0].length ?? 0;
      if (!raw && backslashes % 2 === 1) {
        line = line.slice(0, -1);
        continue;
      }
      terminated = true;
      break;
    }
    line += character;
  }
  line += decoder.end();
  const characters: Array<{ value: string; quoted: boolean }> = [];
  for (let index = 0; index < line.length; index++) {
    if (!raw && line[index] === '\\' && index + 1 < line.length) {
      characters.push({ value: line[++index], quoted: true });
    } else characters.push({ value: line[index], quoted: false });
  }
  const text = (start: number, end: number) =>
    characters
      .slice(start, end)
      .map(character => character.value)
      .join('');
  if (args.length === 0) shell.setEnv('REPLY', text(0, characters.length));
  else {
    const ifs = shell.getEnv('IFS') ?? ' \t\n';
    const delimiter = (index: number) => {
      const character = characters[index];
      return character !== undefined && !character.quoted && ifs.includes(character.value);
    };
    const whitespace = (index: number) =>
      delimiter(index) && ' \t\n'.includes(characters[index].value);
    let end = characters.length;
    while (end > 0 && whitespace(end - 1)) end--;
    let cursor = 0;
    while (cursor < end && whitespace(cursor)) cursor++;
    const fields: Array<{ start: number; end: number }> = [];
    while (cursor < end) {
      const start = cursor;
      while (cursor < end && !delimiter(cursor)) cursor++;
      fields.push({ start, end: cursor });
      let nonwhite = false;
      while (cursor < end && whitespace(cursor)) cursor++;
      if (cursor < end && delimiter(cursor)) {
        nonwhite = true;
        cursor++;
      }
      while (cursor < end && whitespace(cursor)) cursor++;
      if (!nonwhite && cursor === start) break;
    }
    for (let index = 0; index < args.length; index++) {
      const field = fields[index];
      let value = '';
      if (field) {
        let fieldEnd = field.end;
        if (index === args.length - 1 && fields.length > index + 1) fieldEnd = end;
        value = text(field.start, fieldEnd);
      }
      shell.setEnv(args[index], value);
    }
  }
  if (terminated) return 0;
  return 1;
}
