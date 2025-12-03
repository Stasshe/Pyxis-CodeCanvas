import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
import 'katex/dist/katex.min.css';

import { useTranslation } from '@/context/I18nContext';
import { useTheme, ThemeContext } from '@/context/ThemeContext';
import { exportPdfFromHtml } from '@/engine/export/exportPdf';
import type { PreviewTab } from '@/engine/tabs/types';
import { useSettings } from '@/hooks/useSettings';
import { Project } from '@/types';

import InlineHighlightedCode from './InlineHighlightedCode';
import { CodeBlock, LocalImage, Mermaid } from './MarkdownPreview';

interface MarkdownPreviewTabProps {
  activeTab: PreviewTab;
  currentProject?: Project;
}

const MarkdownPreviewTab: React.FC<MarkdownPreviewTabProps> = ({ activeTab, currentProject }) => {
  const { colors, themeName } = useTheme();
  const { settings } = useSettings(currentProject?.id);
  const { t } = useTranslation();
  // ref to markdown container for scrolling
  const markdownContainerRef = useRef<HTMLDivElement | null>(null);
  // keep previous content to detect append-only updates
  const prevContentRef = useRef<string | null>(null);

  // determine markdown plugins based on settings
  const [extraRemarkPlugins, setExtraRemarkPlugins] = useState<PluggableList>([]);

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
  const processedContent = useMemo(() => {
    const src = activeTab.content || '';
    const delimiter = settings?.markdown?.math?.delimiter || 'dollar';
    if (delimiter === 'dollar') return src;

    const convertInNonCode = (text: string): string => {
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
              // replace bracket delimiters with dollar
              return seg
                .replace(/\\\(([\s\S]+?)\\\)/g, (_m, g: string) => '$' + g + '$')
                .replace(/\\\[([\s\S]+?)\\\]/g, (_m, g: string) => '$$' + g + '$$');
            })
            .join('');
        })
        .join('');
    };

    if (delimiter === 'bracket' || delimiter === 'both') {
      return convertInNonCode(src);
    }

    return src;
  }, [activeTab.content, settings?.markdown?.math?.delimiter]);

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

  // PDFエクスポート処理
  const handleExportPdf = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const container = document.createElement('div');
    container.style.background = colors.background;
    container.style.color = '#000';
    container.className = 'markdown-body prose prose-github max-w-none';
    document.body.appendChild(container);
    try {
      const ReactDOMClient = await import('react-dom/client');
      const root = ReactDOMClient.createRoot(container);
      root.render(
        <ThemeContext.Provider
          value={{
            colors,
            setColor: () => {},
            setColors: () => {},
            themeName: 'pdf',
            setTheme: () => {},
            themeList: [],
          }}
        >
          {markdownContentPlain}
        </ThemeContext.Provider>
      );
      setTimeout(() => {
        container.innerHTML =
          '<style>body, .markdown-body, .prose, .prose-github, .markdown-body * { color: #000 !important; }</style>' +
          container.innerHTML;
        exportPdfFromHtml(container.innerHTML, (activeTab.name || 'document').replace(/\.[^/.]+$/, '') + '.pdf');
        try {
          root.unmount();
        } catch {
          /* ignore */
        }
        document.body.removeChild(container);
      }, 300);
    } catch (err) {
      console.error('PDFエクスポート中にエラーが発生しました', err);
      if (document.body.contains(container)) document.body.removeChild(container);
    }
  }, [markdownContentPlain, activeTab.name, colors]);

  // 自動スクロール: 新しいコンテンツが「末尾に追記」された場合のみスクロールする
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const prev = prevContentRef.current;
    const current = activeTab.content || '';

    const trimTrailingWhitespace = (s: string): string => s.replace(/[\s\u00A0]+$/g, '');

    const isAppend = (oldStr: string | null, newStr: string): boolean => {
      if (!oldStr) return false;
      if (newStr.length <= oldStr.length) return false;

      const MAX_WINDOW = 2000;
      const oldTrimmed = trimTrailingWhitespace(oldStr);
      const newTrimmed = newStr;

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
  }, [activeTab.content]);

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

export default React.memo(MarkdownPreviewTab);
