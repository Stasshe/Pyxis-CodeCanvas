import type { FsApi } from '@/engine/core/fs/index';
import expandBraces from './braceExpand';
import { expandTokens } from './expansion';
import { expandParametersAsync } from './parameter';
import { makeShellTextToken, parseShellWords } from './parser';
import type { OutputCallbacks, Segment, TokenObj, WordPart } from './types';

export interface WordExpansionShell {
  runInSubshell(line: string): Promise<{ stdout: string; stderr: string; code: number | null }>;
  processSubstitution(
    command: string,
    direction: 'input' | 'output',
    resources?: ExpansionResources
  ): Promise<string>;
}

export interface ExpansionResources {
  fifoOwners: Array<{ path: string; ownerId: string }>;
  cancelChildren: Array<() => Promise<void>>;
  processSubstitutionCallbacks?: OutputCallbacks;
}

interface WordExpansionOptions {
  rootPath: string;
  cwd: string;
  fsClient: FsApi;
  env: Record<string, string>;
  nounset: boolean;
  assignmentOnly?: boolean;
  declarationAssignments?: boolean;
  literalQuotes?: boolean;
  resources?: ExpansionResources;
}

export type ShellExpansionContext = Omit<
  WordExpansionOptions,
  'assignmentOnly' | 'declarationAssignments' | 'literalQuotes'
> & {
  getWorkingDirectory: () => Promise<string>;
};

export interface ExpandedWords {
  words: string[];
  commandSubStatus?: number;
  assignmentOnly?: true;
}

interface Replacement {
  values: string[];
  quoted: boolean;
  multiple: boolean;
}

function wordParts(
  source: string,
  replacements: Map<string, Replacement>,
  assignment: boolean,
  literalQuotes: boolean
): WordPart[] {
  const parts: WordPart[] = [];
  let quote = '';
  const literal = (text: string, quoted: boolean) => {
    const previous = parts[parts.length - 1];
    if (previous && !previous.split && previous.quoted === quoted && !previous.boundary)
      previous.text += text;
    else parts.push({ text, quoted, split: false });
  };
  for (let index = 0; index < source.length; index++) {
    const replacement = [...replacements.keys()].find(key => source.startsWith(key, index));
    if (replacement) {
      const value = replacements.get(replacement);
      if (!value) throw new Error('Missing word expansion');
      const quoted = value.quoted || quote !== '';
      if (value.multiple && !assignment) {
        if (quoted && value.values.length === 0 && parts[parts.length - 1]?.text === '')
          parts.pop();
        for (let element = 0; element < value.values.length; element++) {
          parts.push({
            text: value.values[element],
            quoted,
            split: !quoted,
            boundary: element > 0,
          });
        }
      } else {
        parts.push({
          text: value.values.join(' '),
          quoted: quoted || assignment,
          split: !quoted && !assignment,
        });
      }
      index += replacement.length - 1;
      continue;
    }
    const character = source[index];
    if (!literalQuotes && character === quote) {
      quote = '';
      continue;
    }
    if (!literalQuotes && quote === '' && (character === "'" || character === '"')) {
      quote = character;
      // A quoted empty word survives expansion and splitting.
      literal('', true);
      continue;
    }
    if (character === '\\' && quote !== "'" && index + 1 < source.length) {
      const next = source[index + 1];
      let escapable = quote !== '"' || '$`"\\\n'.includes(next);
      if (literalQuotes) escapable = '$`\\\n'.includes(next);
      if (escapable) {
        if (next !== '\n') literal(next, true);
        index++;
        continue;
      }
    }
    literal(character, quote !== '' || assignment);
  }
  return parts;
}

export async function expandShellTokens(
  tokens: Array<string | TokenObj>,
  options: WordExpansionOptions,
  shell: WordExpansionShell,
  callbacks?: OutputCallbacks
): Promise<ExpandedWords> {
  const expandedTokens: WordPart[][] = [];
  let commandSubStatus: number | undefined;
  for (const token of tokens) {
    if (typeof token === 'string') {
      expandedTokens.push([{ text: token, quoted: true, split: false }]);
      continue;
    }
    if (token.raw !== undefined) {
      const assignment =
        options.assignmentOnly ||
        (options.declarationAssignments && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token.raw));
      let rawWords = [token.raw];
      if (!options.literalQuotes && !options.assignmentOnly) rawWords = expandBraces(token.raw);
      for (const raw of rawWords) {
        const replacements = new Map<string, Replacement>();
        let prefix = '__WORD_EXPANSION_';
        while (raw.includes(prefix)) prefix += '_';
        for (const substitution of token.processSubs ?? []) {
          const path = await shell.processSubstitution(
            substitution.command,
            substitution.direction,
            options.resources
          );
          replacements.set(substitution.placeholder, {
            values: [path],
            quoted: true,
            multiple: false,
          });
        }
        const render = (values: string[], quoted: boolean, multiple: boolean): string => {
          const key = `${prefix}${replacements.size}__`;
          replacements.set(key, { values, quoted, multiple });
          return key;
        };
        let tildeSource = raw;
        if (options.env.HOME && !options.literalQuotes) {
          const tilde = raw.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=)?~(?=\/|$)/);
          if (tilde) {
            const position = tilde[0].length - 1;
            tildeSource =
              raw.slice(0, position) +
              render([options.env.HOME], true, false) +
              raw.slice(position + 1);
          }
        }
        const source = await expandParametersAsync(tildeSource, {
          env: options.env,
          nounset: options.nounset,
          substitutions: token.cmdSubs ?? [],
          render,
          literalQuotes: options.literalQuotes,
          async substitute(command) {
            const result = await shell.runInSubshell(command);
            commandSubStatus = result.code ?? 0;
            if (result.stderr) callbacks?.stderr?.(result.stderr);
            return result.stdout.replace(/\n+$/, '');
          },
        });
        expandedTokens.push(
          wordParts(source, replacements, assignment ?? false, options.literalQuotes ?? false)
        );
      }
      continue;
    }
    expandedTokens.push([{ text: token.text, quoted: true, split: false }]);
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

export async function expandCommandSegment(
  segment: Segment,
  context: ShellExpansionContext,
  shell: WordExpansionShell,
  callbacks?: OutputCallbacks,
  resources?: ExpansionResources
): Promise<ExpandedWords> {
  const assignmentOnly =
    segment.tokens.length > 0 &&
    segment.tokens.every(
      token =>
        typeof token !== 'string' &&
        token.raw !== undefined &&
        /^[A-Za-z_][A-Za-z0-9_]*=/.test(token.raw)
    );
  if (assignmentOnly) {
    const result: ExpandedWords = { words: [], assignmentOnly: true };
    for (const token of segment.tokens) {
      const expansion = await expandShellTokens(
        [token],
        { ...context, assignmentOnly: true, resources },
        shell,
        callbacks
      );
      const word = expansion.words[0];
      const assignment = word?.match(/^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/);
      if (expansion.words.length !== 1 || !assignment)
        throw new Error('Invalid assignment expansion');
      context.env[assignment[1]] = assignment[2];
      result.words.push(word);
      if (expansion.commandSubStatus !== undefined)
        result.commandSubStatus = expansion.commandSubStatus;
    }
    return result;
  }
  const first = segment.tokens[0];
  let command: string | undefined;
  if (typeof first === 'string') command = first;
  else command = first?.text;
  const declarationAssignments = command === 'export';
  return expandShellTokens(
    segment.tokens,
    { ...context, assignmentOnly, declarationAssignments, resources },
    shell,
    callbacks
  );
}

export async function expandWordsForShell(
  source: string,
  context: ShellExpansionContext,
  shell: WordExpansionShell,
  callbacks?: OutputCallbacks,
  resources?: ExpansionResources
): Promise<string[]> {
  const cwd = await context.getWorkingDirectory();
  return expandShellWords(source, { ...context, cwd, resources }, shell, callbacks);
}

export async function expandTextForShell(
  source: string,
  context: ShellExpansionContext,
  shell: WordExpansionShell
): Promise<string> {
  const cwd = await context.getWorkingDirectory();
  return expandShellText(source, { ...context, cwd }, shell);
}

export async function expandShellRedirections(
  segments: Segment[],
  expandWords: (source: string, resources: ExpansionResources) => Promise<string[]>,
  resources: ExpansionResources
): Promise<void> {
  for (const segment of segments) {
    for (const redirection of segment.redirections ?? []) {
      if (
        (redirection.kind !== 'output' && redirection.kind !== 'input') ||
        redirection.raw === undefined
      ) {
        continue;
      }
      const words = await expandWords(redirection.raw, resources);
      if (words.length !== 1) throw new Error('Ambiguous redirect');
      redirection.path = words[0];
    }
  }
}

export async function expandProcessSegment(
  segment: Segment,
  context: ShellExpansionContext,
  shell: WordExpansionShell,
  callbacks: OutputCallbacks,
  resources: ExpansionResources
): Promise<void> {
  await expandShellRedirections(
    [segment],
    (source, expansionResources) =>
      expandWordsForShell(source, context, shell, callbacks, expansionResources),
    resources
  );
  if (/^[A-Za-z_][A-Za-z0-9_]*=\(/.test(segment.raw)) return;

  const expansion = await expandCommandSegment(segment, context, shell, callbacks, resources);
  segment.tokens = expansion.words;
  segment.assignmentOnly = expansion.assignmentOnly === true;
  if (expansion.commandSubStatus !== undefined)
    segment.commandSubStatus = expansion.commandSubStatus;
}

export async function expandShellWords(
  source: string,
  options: Omit<WordExpansionOptions, 'assignmentOnly'>,
  shell: WordExpansionShell,
  callbacks?: OutputCallbacks
): Promise<string[]> {
  const tokens = parseShellWords(source);
  const result = await expandShellTokens(tokens, options, shell, callbacks);
  return result.words;
}

export async function expandShellText(
  source: string,
  options: Omit<WordExpansionOptions, 'assignmentOnly'>,
  shell: WordExpansionShell,
  callbacks?: OutputCallbacks
): Promise<string> {
  const token = makeShellTextToken(source);
  const result = await expandShellTokens(
    [token],
    { ...options, assignmentOnly: true, literalQuotes: true },
    shell,
    callbacks
  );
  return result.words.join('');
}
