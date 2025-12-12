import { useEffect, useRef, useState, useCallback, useMemo, memo, type FC } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
import 'katex/dist/katex.min.css';

import { useTranslation } from '@/context/I18nContext';
import { useTheme, ThemeContext } from '@/context/ThemeContext';
import { exportPdfFromHtml, exportPngFromElement } from '@/engine/export/exportPdf';
import type { EditorTab, PreviewTab } from '@/engine/tabs/types';
import { useSettings } from '@/hooks/useSettings';
import { useTabStore } from '@/stores/tabStore';
import { Project } from '@/types';

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

  // Subscribe to editor tab content changes for real-time preview
  // Find the corresponding editor tab and get its content
  const editorTabContent = useTabStore(state => {
    // Find editor tab with the same path
    const result = state.findTabByPath(activeTab.path, 'editor');
    if (result?.tab && result.tab.kind === 'editor') {
      return (result.tab as EditorTab).content;
    }
    return null;
  });

  // Use editor tab content if available (for real-time updates), otherwise use preview tab content
  const contentSource = editorTabContent ?? activeTab.content ?? '';

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
        <CodeBlock className={className} colors={colors} currentProjectName={currentProject?.name} {...props}>
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
    }),
    [colors, currentProject?.name, currentProject?.id, activeTab]
  );

  // PDFエクスポート用: plain=trueを渡す
  const markdownComponentsPlain = useMemo<Partial<Components>>(
    () => ({
      code: ({ className, children, ...props }) => {
        const match = /language-(\w+)/.exec(className || '');
        const codeString = String(children).replace(/\n$/, '').trim();
        if (match && match[1] === 'mermaid') {
          return <Mermaid chart={codeString} colors={colors} />;
        }
        return <InlineHighlightedCode language={match ? match[1] : ''} value={codeString} plain={true} {...props} />;
      },
      img: ({ src, alt, ...props }) => {
        const srcString = typeof src === 'string' ? src : '';
        return (
          <LocalImage
            src={srcString}
            alt={alt || ''}
            projectName={currentProject?.name}
            projectId={currentProject?.id}
            activeTab={activeTab}
            // Pass base path for resolution inside markdown files
            baseFilePath={activeTab.path}
            {...props}
          />
        );
      },
    }),
    [colors, currentProject?.name, currentProject?.id, activeTab]
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
      
      let result = processNonCode(src, (seg) => {
        // Escape $$ first (display math), then $ (inline math)
        return seg
          .replace(/\$\$/g, DOUBLE_DOLLAR_PLACEHOLDER)
          .replace(/\$/g, SINGLE_DOLLAR_PLACEHOLDER);
      });
      // Convert bracket delimiters to dollar style
      result = processNonCode(result, (seg) => {
        return seg
          .replace(/\\\(([\s\S]+?)\\\)/g, (_m, g: string) => '$' + g + '$')
          .replace(/\\\[([\s\S]+?)\\\]/g, (_m, g: string) => '$$' + g + '$$');
      });
      // Restore escaped dollar signs as literal text (not math)
      result = result
        .replace(new RegExp(DOUBLE_DOLLAR_PLACEHOLDER, 'g'), '\\$\\$')
        .replace(new RegExp(SINGLE_DOLLAR_PLACEHOLDER, 'g'), '\\$');
      return result;
    }

    if (delimiter === 'both') {
      // 'both' mode: convert bracket delimiters to dollar style (dollars also work)
      return processNonCode(src, (seg) => {
        return seg
          .replace(/\\\(([\s\S]+?)\\\)/g, (_m, g: string) => '$' + g + '$')
          .replace(/\\\[([\s\S]+?)\\\]/g, (_m, g: string) => '$$' + g + '$$');
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

  // PDF用
  const markdownContentPlain = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeRaw]}
        components={markdownComponentsPlain}
      >
        {processedContent}
      </ReactMarkdown>
    ),
    [processedContent, markdownComponentsPlain]
  );

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
    
    // Override colors for PDF export
    clone.style.backgroundColor = '#ffffff';
    clone.style.color = '#000000';
    
    // Override all text colors to black for better PDF readability
    const allElements = clone.getElementsByTagName('*');
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i] as HTMLElement;
      el.style.color = '#000000';
    }
    
    // Get the HTML content
    const htmlContent = clone.outerHTML;
    
    // Export to PDF
    await exportPdfFromHtml(htmlContent, (activeTab.name || 'document').replace(/\.[^/.]+$/, '') + '.pdf');
  }, [activeTab.name]);

  // PNG export processing
  const handleExportPng = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const container = markdownContainerRef.current?.querySelector('.markdown-body');
    if (!container || !(container instanceof HTMLElement)) {
      console.error('Markdown container not found');
      return;
    }
    
    try {
      // Clone the element and override styles for export
      const clone = container.cloneNode(true) as HTMLElement;
      clone.style.backgroundColor = '#ffffff';
      clone.style.color = '#000000';
      
      // Override all text colors to black
      const allElements = clone.getElementsByTagName('*');
      for (let i = 0; i < allElements.length; i++) {
        const el = allElements[i] as HTMLElement;
        el.style.color = '#000000';
      }
      
      // Temporarily add to document for rendering
      clone.style.position = 'absolute';
      clone.style.left = '-9999px';
      clone.style.top = '0';
      document.body.appendChild(clone);
      
      try {
        await exportPngFromElement(clone, (activeTab.name || 'document').replace(/\.[^/.]+$/, '') + '.png');
      } finally {
        document.body.removeChild(clone);
      }
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
        className="markdown-body prose prose-github max-w-none"
        style={{
          background: colors.background,
          color: colors.foreground,
        }}
      >
        {markdownContent}
      </div>
    </div>
  );
};

export default memo(MarkdownPreviewTab);
