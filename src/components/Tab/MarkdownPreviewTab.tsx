import { fileRepository } from '@/engine/core/fileRepository';
import type React from 'react';
import { type FC, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
import 'katex/dist/katex.min.css';
import 'github-markdown-css/github-markdown.css';

import { useTranslation } from '@/context/I18nContext';
import { ThemeContext, useTheme } from '@/context/ThemeContext';
import { exportPdfFromHtml, exportPngFromElement } from '@/engine/in-ex/exportPdf';
import type { EditorTab, PreviewTab } from '@/engine/tabs/types';
import { useSettings } from '@/hooks/state/useSettings';
import { tabActions, tabState } from '@/stores/tabState';
import { useSnapshot } from 'valtio';
import type { Project, ProjectFile } from '@/types';

import InlineHighlightedCode from './InlineHighlightedCode';
import { CodeBlock, LocalImage, Mermaid } from './MarkdownPreview';

interface MarkdownPreviewTabProps {
  activeTab: PreviewTab;
  currentProject?: Project;
}

const MarkdownPreviewTab: FC<MarkdownPreviewTabProps> = ({ activeTab, currentProject }) => {
  const { colors, themeName } = useTheme();
  const { settings } = useSettings(currentProject?.id);
  const { t } = useTranslation();
  // ref to markdown container for scrolling
  const markdownContainerRef = useRef<HTMLDivElement | null>(null);
  // keep previous content to detect append-only updates
  const prevContentRef = useRef<string | null>(null);

  // determine markdown plugins based on settings
  const [extraRemarkPlugins, setExtraRemarkPlugins] = useState<PluggableList>([]);

  const { panes } = useSnapshot(tabState);
  const editorTabContent = useMemo(() => {
    const find = (paneList: any[]): string | null => {
      for (const p of paneList) {
        const t = p.tabs?.find((x: any) => x.path === activeTab.path && x.kind === 'editor');
        if (t?.content) return t.content;
        if (p.children) {
          const r = find(p.children);
          if (r) return r;
        }
      }
      return null;
    };
    return find(panes);
  }, [panes, activeTab.path]);

  const contentSource = editorTabContent ?? activeTab.content ?? '';
  const { openTab } = tabActions;

  useEffect(() => {
    let mounted = true;
    const setup = async (): Promise<void> => {
      const plugins: PluggableList = [];
      try {
        const mode = settings?.markdown?.singleLineBreaks || 'default';
        if (mode === 'breaks') {
          // dynamic import to avoid hard dependency at compile time
          try {
            const mod = await import('remark-breaks');
            if (mounted) plugins.push(mod.default || mod);
          } catch (e) {
            console.warn(
              '[MarkdownPreviewTab] remark-breaks not available, falling back to default linebreak behavior.'
            );
          }
        }
      } catch (e) {
        console.warn('[MarkdownPreviewTab] failed to configure markdown plugins', e);
      }
      if (mounted) setExtraRemarkPlugins(plugins);
    };
    setup();
    return () => {
      mounted = false;
    };
  }, [settings?.markdown?.singleLineBreaks, settings?.markdown?.math?.delimiter]);

  // ReactMarkdownのコンポーネントをメモ化
  // 通常表示用
  const markdownComponents = useMemo<Partial<Components>>(
    () => ({
      code: ({ className, children, ...props }) => (
        <CodeBlock
          className={className}
          colors={colors}
          currentProjectName={currentProject?.name}
          {...props}
        >
          {children}
        </CodeBlock>
      ),
      img: ({ src, alt, ...props }) => {
        const srcString = typeof src === 'string' ? src : '';
        return (
          <LocalImage
            src={srcString}
            alt={alt || ''}
            projectName={currentProject?.name}
            projectId={currentProject?.id}
            activeTab={activeTab}
            {...props}
          />
        );
      },
      a: ({ href, children, ...props }) => {
        const hrefString = typeof href === 'string' ? href : '';

        // Normalize and handle clicks for local links (open in preview tab)
        const handleClick = async (e: React.MouseEvent) => {
          try {
            if (!hrefString) return;

            // Hash-only links - scroll within current preview
            if (hrefString.startsWith('#')) {
              e.preventDefault();
              const anchor = decodeURIComponent(hrefString.substring(1));
              const el = markdownContainerRef.current?.querySelector(`#${CSS.escape(anchor)}`);
              if (el && el instanceof HTMLElement) el.scrollIntoView({ behavior: 'smooth' });
              return;
            }

            if (
              hrefString.startsWith('https://') ||
              hrefString.startsWith('mailto:') ||
              hrefString.startsWith('tel:') ||
              hrefString.startsWith('data:')
            ) {
              e.preventDefault();
              window.open(hrefString, '_blank', 'noopener');
              return;
            }

            // At this point, treat as a project-local link. Resolve relative to activeTab.path
            e.preventDefault();
            if (!currentProject || !currentProject.id) {
              // fallback: open in new tab
              window.open(hrefString, '_blank', 'noopener');
              return;
            }

            // Helper to normalize path segments and remove ./ and ..
            const normalizeSegments = (p: string) => {
              const parts = p.split('/');
              const stack: string[] = [];
              for (const part of parts) {
                if (!part || part === '.') continue;
                if (part === '..') {
                  if (stack.length) stack.pop();
                } else {
                  stack.push(part);
                }
              }
              return `/${stack.join('/')}`;
            };

            // Remove any search/query/hash from href for file lookup
            const hrefNoHash = hrefString.split('#')[0].split('?')[0];

            // Build candidate paths: relative to current file and root-relative
            const candidates: string[] = [];
            if (hrefNoHash.startsWith('/')) {
              candidates.push(normalizeSegments(hrefNoHash));
            } else {
              const base = activeTab.path || '/';
              const dir = base.replace(/\/[^/]*$/, '').replace(/^\/?$/, '/');
              candidates.push(normalizeSegments(`${dir}/${hrefNoHash}`));
              candidates.push(normalizeSegments(`/${hrefNoHash}`));
            }

            // Try candidates and also try adding .md if missing
            const tryCandidates: string[] = [];
            for (const c of candidates) {
              tryCandidates.push(c);
              if (!c.toLowerCase().endsWith('.md')) tryCandidates.push(`${c}.md`);
            }

            // Query fileRepository for existence
            for (const cand of Array.from(new Set(tryCandidates))) {
              try {
                const f = await fileRepository.getFileByPath(currentProject.id, cand);
                if (f && f.type === 'file') {
                  const file = f as ProjectFile;

                  // Determine if markdown
                  const fileName = file.name || '';
                  const isMarkdown =
                    fileName.toLowerCase().endsWith('.md') || cand.toLowerCase().endsWith('.md');

                  if (isMarkdown) {
                    // Decode content if buffer
                    let content = file.content || '';
                    if (file.isBufferArray && file.bufferContent) {
                      content = new TextDecoder('utf-8').decode(file.bufferContent as ArrayBuffer);
                    }

                    await openTab(
                      {
                        name: fileName || cand.replace(/^\//, ''),
                        path: cand,
                        content,
                        kind: 'preview',
                      },
                      { kind: 'preview', makeActive: true }
                    );
                    return;
                  }

                  // Non-markdown file - open with web preview
                  await openTab(
                    {
                      name: fileName || cand.replace(/^\//, ''),
                      path: cand,
                      content: file.content || '',
                      kind: 'webPreview',
                      webPreviewUrl: undefined,
                    },
                    { kind: 'webPreview', makeActive: true }
                  );
                  return;
                }
              } catch (err) {
                // ignore and try next
              }
            }

            // Fallback: open in new tab
            window.open(hrefString, '_blank', 'noopener');
          } catch (err) {
            console.warn('[MarkdownPreviewTab] link handler failed:', err);
            // Last resort: follow the link
            window.open(hrefString, '_blank', 'noopener');
          }
        };

        return (
          // eslint-disable-next-line jsx-a11y/anchor-has-content
          <a href={hrefString} onClick={handleClick} {...props}>
            {children}
          </a>
        );
      },
    }),
    [colors, currentProject?.name, currentProject?.id, activeTab, openTab]
  );

  // Preprocess the raw markdown to convert bracket-style math delimiters
  // into dollar-style, while skipping code fences and inline code.
  // For 'bracket' mode: escape dollar signs so they don't get processed as math
  const processedContent = useMemo(() => {
    // Use editor tab content for real-time updates, otherwise fall back to preview tab content
    const src = contentSource;
    const delimiter = settings?.markdown?.math?.delimiter || 'dollar';
    if (delimiter === 'dollar') return src;

    // Helper: process text while preserving code blocks
    const processNonCode = (text: string, processFn: (segment: string) => string): string => {
      // Split by code fences and keep them intact
      return text
        .split(/(```[\s\S]*?```)/g)
        .map(part => {
          if (/^```/.test(part)) return part; // code fence, leave
          // Within non-fence parts, also preserve inline code
          return part
            .split(/(`[^`]*`)/g)
            .map(seg => {
              if (/^`/.test(seg)) return seg; // inline code
              return processFn(seg);
            })
            .join('');
        })
        .join('');
    };

    if (delimiter === 'bracket') {
      // 'bracket' mode:
      // 1. First, escape existing dollar signs to prevent remark-math from processing them
      // 2. Then, convert bracket delimiters to dollar style
      // Use unique placeholders that won't appear in normal markdown text
      const DOUBLE_DOLLAR_PLACEHOLDER = '__PYXIS_ESCAPED_DOUBLE_DOLLAR__';
      const SINGLE_DOLLAR_PLACEHOLDER = '__PYXIS_ESCAPED_SINGLE_DOLLAR__';

      let result = processNonCode(src, seg => {
        // Escape $$ first (display math), then $ (inline math)
        return seg
          .replace(/\$\$/g, DOUBLE_DOLLAR_PLACEHOLDER)
          .replace(/\$/g, SINGLE_DOLLAR_PLACEHOLDER);
      });
      // Convert bracket delimiters to dollar style
      result = processNonCode(result, seg => {
        return seg
          .replace(/\\\(([\s\S]+?)\\\)/g, (_m, g: string) => `$${g}$`)
          .replace(/\\\[([\s\S]+?)\\\]/g, (_m, g: string) => `$$${g}$$`);
      });
      // Restore escaped dollar signs as literal text (not math)
      result = result
        .replace(new RegExp(DOUBLE_DOLLAR_PLACEHOLDER, 'g'), '\\$\\$')
        .replace(new RegExp(SINGLE_DOLLAR_PLACEHOLDER, 'g'), '\\$');
      return result;
    }

    if (delimiter === 'both') {
      // 'both' mode: convert bracket delimiters to dollar style (dollars also work)
      return processNonCode(src, seg => {
        return seg
          .replace(/\\\(([\s\S]+?)\\\)/g, (_m, g: string) => `$${g}$`)
          .replace(/\\\[([\s\S]+?)\\\]/g, (_m, g: string) => `$$${g}$$`);
      });
    }

    return src;
  }, [contentSource, settings?.markdown?.math?.delimiter]);

  const markdownContent = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, ...extraRemarkPlugins, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeRaw]}
        components={markdownComponents}
      >
        {processedContent}
      </ReactMarkdown>
    ),
    [processedContent, markdownComponents, extraRemarkPlugins]
  );

  /**
   * Apply export-friendly styles to an element
   * Forces white background and black text for all elements
   * Special handling for code blocks to ensure visibility
   */
  const applyExportStyles = useCallback((element: HTMLElement) => {
    element.style.backgroundColor = '#ffffff';
    element.style.color = '#000000';

    // Override all element colors for better readability
    const allElements = Array.from(element.getElementsByTagName('*'));
    for (const el of allElements) {
      if (el instanceof HTMLElement) {
        // Set text color to black
        el.style.color = '#000000';

        // For code blocks and pre elements, ensure light background
        if (el.tagName === 'PRE' || el.tagName === 'CODE') {
          el.style.backgroundColor = '#f6f8fa';
          el.style.color = '#24292f';
        }
      }
    }
  }, []);

  // PDF export processing
  const handleExportPdf = useCallback(async () => {
    if (typeof window === 'undefined') return;

    // Get the rendered markdown content directly from the DOM
    const markdownElement = markdownContainerRef.current?.querySelector('.markdown-body');
    if (!markdownElement) {
      console.error('Markdown content not found');
      return;
    }

    // Clone the element to avoid modifying the original
    const clone = markdownElement.cloneNode(true) as HTMLElement;

    // Apply export styles
    applyExportStyles(clone);

    // Get the HTML content
    const htmlContent = clone.outerHTML;

    // Export to PDF
    await exportPdfFromHtml(
      htmlContent,
      `${(activeTab.name || 'document').replace(/\.[^/.]+$/, '')}.pdf`
    );
  }, [activeTab.name, applyExportStyles]);

  // PNG export processing
  const handleExportPng = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const container = markdownContainerRef.current?.querySelector('.markdown-body');
    if (!container || !(container instanceof HTMLElement)) {
      console.error('Markdown container not found');
      return;
    }

    try {
      await exportPngFromElement(
        container,
        `${(activeTab.name || 'document').replace(/\.[^/.]+$/, '')}.png`
      );
    } catch (err) {
      console.error('Error occurred during PNG export', err);
    }
  }, [activeTab.name]);

  // 自動スクロール: 新しいコンテンツが「末尾に追記」された場合のみスクロールする
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const prev = prevContentRef.current;
    const current = contentSource;

    const trimTrailingWhitespace = (s: string): string => s.replace(/[\s\u00A0]+$/g, '');

    const isAppend = (oldStr: string | null, newStr: string): boolean => {
      if (!oldStr) return false;
      if (newStr.length <= oldStr.length) return false;

      const MAX_WINDOW = 2000;
      // Trim trailing whitespace from both old and new for consistent comparison
      const oldTrimmed = trimTrailingWhitespace(oldStr);
      const newTrimmed = trimTrailingWhitespace(newStr);

      if (newTrimmed.startsWith(oldTrimmed)) return true;

      const start = Math.max(0, oldTrimmed.length - MAX_WINDOW);
      const oldWindow = oldTrimmed.slice(start);

      if (newTrimmed.startsWith(oldWindow)) {
        if (start === 0) return true;
        const oldPrefix = oldTrimmed.slice(0, start);
        const newPrefix = newTrimmed.slice(0, start);
        if (oldPrefix === newPrefix) return true;
      }

      const normalizeNewlines = (s: string): string => s.replace(/\n{2,}/g, '\n\n');
      const oldNormalized = normalizeNewlines(oldTrimmed);
      const newNormalized = normalizeNewlines(newTrimmed);
      if (newNormalized.startsWith(oldNormalized)) return true;

      return false;
    };

    try {
      if (isAppend(prev, current)) {
        const el = markdownContainerRef.current;
        if (el) {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        }
      }
    } catch {
      const el = markdownContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }

    prevContentRef.current = current;
  }, [contentSource]);

  return (
    <div className="p-4 overflow-auto h-full w-full" ref={markdownContainerRef}>
      <div className="flex items-center mb-2">
        <div className="font-bold text-lg mr-2" style={{ color: colors.foreground }}>
          {activeTab.name} {t('markdownPreview.preview')}
        </div>
        <button
          type="button"
          className="px-2 py-1 rounded bg-green-500 text-white text-xs hover:bg-green-600 transition"
          style={{ marginLeft: 4 }}
          onClick={handleExportPdf}
          title={t('markdownPreview.exportPdf')}
        >
          {t('markdownPreview.exportPdf')}
        </button>
        <button
          type="button"
          className="px-2 py-1 rounded bg-blue-500 text-white text-xs hover:bg-blue-600 transition ml-2"
          onClick={handleExportPng}
          title={t('markdownPreview.exportPng')}
        >
          {t('markdownPreview.exportPng')}
        </button>
      </div>
      <div
        className={`markdown-body prose prose-github max-w-none ${
          themeName?.toLowerCase().includes('light') ? 'markdown-light' : 'markdown-dark'
        }`}
        style={{ color: colors.foreground, backgroundColor: colors.background }}
      >
        {markdownContent}
      </div>
    </div>
  );
};

export default memo(MarkdownPreviewTab);
