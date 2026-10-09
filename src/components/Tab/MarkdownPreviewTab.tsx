import type React from 'react';
import { type FC, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { basename, fsClient, getParentPath, resolvePath } from '@/engine/core/fs';
import 'katex/dist/katex.min.css';
import 'github-markdown-css/github-markdown.css';

import { useSnapshot } from 'valtio';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { readFileContent } from '@/engine/core/fileContent';
import { exportPdfFromHtml, exportPngFromElement } from '@/engine/in-ex/exportPdf';
import type { EditorPane, PreviewTab, Tab } from '@/engine/tabs/types';
import { useSettings } from '@/hooks/state/useSettings';
import { useTabContent } from '@/stores/tabContentStore';
import { tabActions, tabState } from '@/stores/tabState';
import type { Project } from '@/types';
import LocalImage from './LocalImage';
import CodeBlock from './MarkdownPreview/CodeBlock';
import { resolveMarkdownLink } from './MarkdownPreview/markdownLink';
import { preprocessMarkdownMath } from './markdownMath';

interface MarkdownPreviewTabProps {
  activeTab: PreviewTab;
  currentProject?: Project;
}

type RemarkPlugins = NonNullable<Options['remarkPlugins']>;

const resolveImagePath = (source: string, markdownPath: string): string => {
  if (/^(https?:|data:|\/\/)/i.test(source)) return source;
  if (source.startsWith('/')) return resolvePath('/', source);
  return resolvePath(getParentPath(markdownPath), source);
};

const MarkdownPreviewTab: FC<MarkdownPreviewTabProps> = ({ activeTab, currentProject }) => {
  const { colors, themeName } = useTheme();
  const { settings } = useSettings(currentProject?.rootPath);
  const { t } = useTranslation();
  // ref to markdown container for scrolling
  const markdownContainerRef = useRef<HTMLDivElement | null>(null);
  // keep previous content to detect append-only updates
  const prevContentRef = useRef<string | null>(null);

  // determine markdown plugins based on settings
  const [extraRemarkPlugins, setExtraRemarkPlugins] = useState<RemarkPlugins>([]);

  // Only subscribe to panes for the purpose of finding the matching editor tab ID
  const panesSnapshot = useSnapshot(tabState).panes;
  const editorTabId = useMemo(() => {
    const find = (paneList: readonly EditorPane[]): string | null => {
      for (const p of paneList) {
        const t = p.tabs?.find((x: Tab) => x.path === activeTab.path && x.kind === 'editor');
        if (t) return t.id;
        if (p.children) {
          const r = find(p.children);
          if (r) return r;
        }
      }
      return null;
    };
    return find(panesSnapshot);
  }, [panesSnapshot, activeTab.path]);

  // Subscribe to the editor tab's content from tabContentStore for real-time updates
  const editorTabContent = useTabContent(editorTabId ?? '');
  // Preview tab's own runtime content is restored from its file.
  const previewTabContent = useTabContent(activeTab.id);

  // Priority: live editor > preview runtime store
  const contentSource = editorTabContent ?? previewTabContent ?? '';
  const { openTab } = tabActions;
  const markdownThemeStyle = {
    color: colors.foreground,
    backgroundColor: colors.background,
    '--fgColor-default': colors.foreground,
    '--fgColor-muted': colors.mutedFg,
    '--bgColor-default': colors.background,
    '--bgColor-muted': colors.mutedBg,
    '--borderColor-default': colors.border,
    '--borderColor-muted': colors.border,
  } as React.CSSProperties;

  useEffect(() => {
    let mounted = true;
    const setup = async (): Promise<void> => {
      const plugins: RemarkPlugins = [];
      try {
        const mode = settings?.markdown?.singleLineBreaks || 'default';
        if (mode === 'breaks') {
          // dynamic import to avoid hard dependency at compile time
          try {
            const mod = await import('remark-breaks');
            if (mounted) plugins.push(mod.default || mod);
          } catch (e) {
            console.warn('[MarkdownPreviewTab.tsx] caught non-fatal error', e);
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
  }, [settings?.markdown?.singleLineBreaks]);

  // code コンポーネントは activeTab/colors に依存しないため分離して安定させる
  // — 参照が変わらない限り react-markdown は Mermaid を remount しない
  const codeComponent = useMemo<Pick<Components, 'code'>>(
    () => ({
      code: ({ className, children, ...props }) => (
        <CodeBlock className={className} currentProjectName={currentProject?.name} {...props}>
          {children}
        </CodeBlock>
      ),
    }),
    [currentProject?.name]
  );

  // ReactMarkdownのコンポーネントをメモ化
  // 通常表示用
  const markdownComponents = useMemo<Partial<Components>>(
    () => ({
      ...codeComponent,
      img: ({ src, alt, ...props }) => {
        const source = typeof src === 'string' ? src : '';
        const srcString = resolveImagePath(source, activeTab.path);
        return <LocalImage src={srcString} alt={alt || ''} {...props} />;
      },
      a: ({ href, children, ...props }) => {
        const hrefString = typeof href === 'string' ? href : '';

        // Normalize and handle clicks for local links (open in preview tab)
        const handleClick = async (e: React.MouseEvent) => {
          try {
            if (!hrefString) return;

            const target = resolveMarkdownLink(hrefString, activeTab.path);
            if (target.kind === 'anchor') {
              e.preventDefault();
              const el = markdownContainerRef.current?.querySelector(`#${CSS.escape(target.id)}`);
              if (el && el instanceof HTMLElement) el.scrollIntoView({ behavior: 'smooth' });
              return;
            }
            if (target.kind === 'external') {
              e.preventDefault();
              window.open(hrefString, '_blank', 'noopener');
              return;
            }
            e.preventDefault();
            if (target.kind !== 'local') {
              if (target.kind === 'invalid') {
                console.warn('[MarkdownPreviewTab] invalid local link', hrefString);
              }
              return;
            }

            // Try candidates and also try adding .md if missing
            const tryCandidates: string[] = [];
            for (const c of target.paths) {
              tryCandidates.push(c);
              if (!c.toLowerCase().endsWith('.md')) tryCandidates.push(`${c}.md`);
            }

            // Check candidates in the filesystem.
            for (const cand of Array.from(new Set(tryCandidates))) {
              try {
                if (!(await fsClient.exists(cand))) continue;
                const file = await fsClient.stat(cand);
                if (file.type !== 'file') continue;
                const fileName = basename(cand);
                const isMarkdown = fileName.toLowerCase().endsWith('.md');
                const fileContent = await readFileContent(cand);
                if (fileContent.kind === 'binary') {
                  await openTab(
                    {
                      name: fileName,
                      path: cand,
                      content: '',
                      bufferContent: fileContent.bufferContent,
                      mimeType: fileContent.mimeType,
                      isBufferArray: true,
                      kind: 'binary',
                    },
                    { kind: 'binary', makeActive: true }
                  );
                  return;
                }
                if (isMarkdown) {
                  await openTab(
                    {
                      name: fileName,
                      path: cand,
                      content: fileContent.content,
                      kind: 'preview',
                    },
                    { kind: 'preview', makeActive: true }
                  );
                } else {
                  await openTab(
                    { name: fileName, path: cand, content: '', kind: 'webPreview' },
                    { kind: 'webPreview', makeActive: true }
                  );
                }
                return;
              } catch (err) {
                console.warn('[MarkdownPreviewTab] failed to resolve local link', err);
              }
            }

            console.warn('[MarkdownPreviewTab] local link not found', hrefString);
          } catch (err) {
            console.warn('[MarkdownPreviewTab] link handler failed:', err);
            e.preventDefault();
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
    [codeComponent, activeTab]
  );

  // Preprocess the raw markdown to convert bracket-style math delimiters
  // into dollar-style, while skipping code fences and inline code.
  // For 'bracket' mode: escape dollar signs so they don't get processed as math
  const processedContent = useMemo(() => {
    const delimiter = settings?.markdown?.math?.delimiter || 'dollar';
    return preprocessMarkdownMath(contentSource, delimiter);
  }, [contentSource, settings?.markdown?.math?.delimiter]);

  const markdownContent = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, ...extraRemarkPlugins, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeKatex]}
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
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="min-w-0 break-words font-bold text-lg" style={{ color: colors.foreground }}>
          {activeTab.name} {t('markdownPreview.preview')}
        </div>
        <button
          type="button"
          className="shrink-0 whitespace-nowrap rounded bg-green-500 px-2 py-1 text-xs text-white transition hover:bg-green-600"
          onClick={handleExportPdf}
          title={t('markdownPreview.exportPdf')}
        >
          {t('markdownPreview.exportPdf')}
        </button>
        <button
          type="button"
          className="shrink-0 whitespace-nowrap rounded bg-blue-500 px-2 py-1 text-xs text-white transition hover:bg-blue-600"
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
        style={markdownThemeStyle}
      >
        {markdownContent}
      </div>
    </div>
  );
};

export default memo(MarkdownPreviewTab);
