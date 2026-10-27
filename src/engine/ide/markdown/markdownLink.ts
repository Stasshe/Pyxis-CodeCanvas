import { getParentPath, resolvePath } from '@/engine/core/fs/index';

export type MarkdownLinkTarget =
  | { kind: 'anchor'; id: string }
  | { kind: 'external' }
  | { kind: 'blocked' }
  | { kind: 'local'; paths: string[] }
  | { kind: 'invalid' };

export const resolveMarkdownLink = (href: string, markdownPath: string): MarkdownLinkTarget => {
  if (href.startsWith('#')) {
    try {
      return { kind: 'anchor', id: decodeURIComponent(href.slice(1)) };
    } catch {
      return { kind: 'invalid' };
    }
  }

  if (/^(https?:|mailto:|tel:|\/\/)/i.test(href)) return { kind: 'external' };
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return { kind: 'blocked' };

  const encodedPath = href.split(/[?#]/, 1)[0];
  if (!encodedPath) return { kind: 'invalid' };

  try {
    const path = decodeURIComponent(encodedPath);
    if (path.startsWith('/')) return { kind: 'local', paths: [resolvePath('/', path)] };
    return {
      kind: 'local',
      paths: [resolvePath(getParentPath(markdownPath), path), resolvePath('/', path)],
    };
  } catch {
    return { kind: 'invalid' };
  }
};
