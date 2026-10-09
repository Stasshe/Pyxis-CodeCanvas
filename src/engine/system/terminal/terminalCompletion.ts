import { FSError } from '@/engine/core/fs/index';
import { insertLineText, type LineState } from './lineEditor';

export interface TerminalCompletionSource {
  getCommandNames(): Promise<string[]>;
  pwd(): Promise<string>;
  normalizePath(path: string): string;
  readdir(path: string): Promise<Array<{ path: string; type: string }>>;
}

export type TerminalCompletion =
  | { state: LineState; candidates?: never }
  | { candidates: string[]; state?: never }
  | undefined;

function currentWord(line: string, cursor: number): { start: number; end: number } | undefined {
  let start = 0;
  let end = line.length;
  let quote = '';
  let escaped = false;
  let unsafe = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (!quote && !escaped && /\s/u.test(character)) {
      if (index < cursor) {
        start = index + 1;
        unsafe = false;
        continue;
      }
      end = index;
      break;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      escaped = true;
      unsafe = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      unsafe = true;
    }
  }
  if (unsafe || quote || escaped) return undefined;
  return { start, end };
}

export async function completeTerminalLine(
  line: string,
  cursor: number,
  source: TerminalCompletionSource | null,
  localCommands: readonly string[] = []
): Promise<TerminalCompletion> {
  if (!source) return undefined;
  const word = currentWord(line, cursor);
  if (!word) return undefined;
  const tokenStart = word.start;
  const tokenEnd = word.end;
  if (cursor < tokenStart || cursor > tokenEnd) return undefined;
  const prefix = line.slice(0, cursor);
  const token = prefix.slice(tokenStart);
  const existingToken = line.slice(tokenStart, tokenEnd);
  if (/[$`*?()[\]{};&|<>]/u.test(existingToken)) return undefined;
  const isCommand = tokenStart === 0 && !token.includes('/');
  let candidates: string[] = [];

  if (isCommand) {
    const commandNames = new Set(await source.getCommandNames());
    for (const command of localCommands) commandNames.add(command);
    candidates = [...commandNames]
      .filter(name => name.startsWith(token))
      .sort((left, right) => left.localeCompare(right));
  }

  if (candidates.length === 0) {
    const slash = token.lastIndexOf('/');
    const directoryPart = slash < 0 ? '' : token.slice(0, slash + 1);
    const basename = token.slice(slash + 1);
    const cwd = await source.pwd();
    let directoryPath = `${cwd}/${directoryPart || '.'}`;
    if (directoryPart.startsWith('/')) directoryPath = directoryPart;
    const directory = source.normalizePath(directoryPath);
    let entries: Awaited<ReturnType<TerminalCompletionSource['readdir']>>;
    try {
      entries = await source.readdir(directory);
    } catch (error) {
      if (error instanceof FSError && error.code === 'ENOENT') return undefined;
      throw error;
    }
    candidates = entries
      .flatMap(entry => {
        const name = entry.path.split('/').pop();
        if (!name || !name.startsWith(basename)) return [];
        if (!basename.startsWith('.') && name.startsWith('.')) return [];
        return [`${directoryPart}${name}${entry.type === 'folder' ? '/' : ''}`];
      })
      .sort((left, right) => left.localeCompare(right));
  }

  if (candidates.length === 0) return undefined;
  let insertion = candidates[0];
  if (candidates.length > 1) {
    for (const candidate of candidates.slice(1)) {
      let index = 0;
      while (index < insertion.length && insertion[index] === candidate[index]) index += 1;
      insertion = insertion.slice(0, index);
    }
    if (insertion.length === token.length) return { candidates };
  }

  const suffix = insertion.slice(token.length).replace(/[\\\s'"$`*?()[\]{};&|<>]/gu, '\\$&');
  let completedToken = `${token}${suffix}`;
  if (candidates.length === 1 && tokenEnd === line.length && !insertion.endsWith('/')) {
    completedToken += ' ';
  }
  const state = insertLineText(
    { text: line.slice(0, tokenStart) + line.slice(tokenEnd), cursor: tokenStart },
    completedToken
  );
  return { state };
}
