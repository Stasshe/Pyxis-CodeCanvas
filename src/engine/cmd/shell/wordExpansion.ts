import type { FsApi } from '@/engine/core/fs';
import { expandTokens } from './expansion';
import { ParseError, parseCommandLine } from './parser';
import type { OutputCallbacks, Segment, TokenObj } from './types';

interface WordExpansionShell {
  runInSubshell(line: string): Promise<{ stdout: string; stderr: string; code: number | null }>;
}

interface WordExpansionOptions {
  rootPath: string;
  cwd: string;
  fsClient: FsApi;
  env: Record<string, string>;
  nounset: boolean;
  assignmentOnly?: boolean;
}

export interface ExpandedWords {
  words: string[];
  commandSubStatus?: number;
}

export async function expandShellTokens(
  tokens: Array<string | TokenObj>,
  options: WordExpansionOptions,
  shell: WordExpansionShell,
  callbacks?: OutputCallbacks
): Promise<ExpandedWords> {
  const expandedTokens: TokenObj[] = [];
  let commandSubStatus: number | undefined;
  for (const token of tokens) {
    if (typeof token === 'string') {
      expandedTokens.push({ text: token, quote: options.assignmentOnly ? 'double' : null });
      continue;
    }
    let text = token.text;
    for (const substitution of token.cmdSubs ?? []) {
      const result = await shell.runInSubshell(substitution.command);
      commandSubStatus = result.code ?? 0;
      if (result.stderr) callbacks?.stderr?.(result.stderr);
      const replacement = result.stdout.replace(/\r?\n+$/, '');
      text = text.replace(substitution.placeholder, () => replacement);
    }
    expandedTokens.push({
      text,
      quote: options.assignmentOnly ? 'double' : token.quote,
    });
  }

  const words = await expandTokens(expandedTokens, {
    rootPath: options.rootPath,
    cwd: options.cwd,
    fsClient: options.fsClient,
    env: options.env,
  });
  const result: ExpandedWords = { words };
  if (commandSubStatus !== undefined) result.commandSubStatus = commandSubStatus;
  return result;
}

export async function expandShellWords(
  source: string,
  options: Omit<WordExpansionOptions, 'assignmentOnly'>,
  shell: WordExpansionShell,
  callbacks?: OutputCallbacks
): Promise<string[]> {
  const segments = parseCommandLine(source, options.env, { nounset: options.nounset });
  if (segments.length === 0) return [];
  if (segments.length !== 1) throw new ParseError('Expected a word list');
  const segment: Segment = segments[0];
  const result = await expandShellTokens(segment.tokens, options, shell, callbacks);
  return result.words;
}
