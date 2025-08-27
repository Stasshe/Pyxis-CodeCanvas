import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { exportPdfFromHtml } from '@/utils/export/exportPdf';
import { useTheme, ThemeContext } from '@/context/ThemeContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import { HighlightedCode } from './HighlightedCode';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import 'katex/dist/katex.min.css';
import { FileItem } from '@/types';
import {
  loadImageAsDataURL,
  parseMermaidContent,
  parseYamlConfig,
} from './markdownUtils';

interface MarkdownPreviewTabProps {
  content: string;
  fileName: string;
  currentProjectName?: string;
  projectFiles?: FileItem[];
}

// ユニークID生成用
let mermaidIdCounter = 0;
const getUniqueMermaidId = () => `mermaid-svg-${mermaidIdCounter++}`;

// ローカル画像をDataURLに変換する関数（プロジェクトファイルのbufferContentから読み込み）
// loadImageAsDataURL moved to markdownUtils

// parseYamlConfig moved to markdownUtils

// Mermaidチャートから設定と図表を分離する関数
// parseMermaidContent moved to markdownUtils

// メモ化されたMermaidコンポーネント
const Mermaid = React.memo<{ chart: string; colors: any }>(({ chart, colors }) => {

  const ref = useRef<HTMLDivElement>(null);
  // chart内容ごとにIDを固定
  const idRef = useMemo(() => `mermaid-svg-${btoa(unescape(encodeURIComponent(chart))).slice(0, 12)}`, [chart]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  // Mermaidチャート内容ごとにズーム・パン情報をuseStateで管理
  const [zoomState, setZoomState] = useState<{ scale: number; translate: { x: number; y: number } }>({ scale: 1, translate: { x: 0, y: 0 } });
  const scaleRef = useRef<number>(zoomState.scale);
  const translateRef = useRef<{ x: number; y: number }>({ ...zoomState.translate });
  const isPanningRef = useRef<boolean>(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const renderMermaid = async () => {
      if (!ref.current) return;
  setIsLoading(true);
  setError(null);
  // 初期ズーム・パン情報をzoomStateから復元
  scaleRef.current = zoomState.scale;
  translateRef.current = { ...zoomState.translate };
      ref.current.innerHTML = `
        <div class="mermaid-loading" style="display:flex;align-items:center;justify-content:center;height:120px;">
          <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
            <circle cx="20" cy="20" r="18" stroke="#4ade80" stroke-width="4" fill="none" stroke-dasharray="90" stroke-dashoffset="60">
              <animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="1s" repeatCount="indefinite"/>
            </circle>
          </svg>
          <span style="margin-left:10px;color:#4ade80;font-size:14px;">Mermaid図表を生成中...</span>
        </div>
      `;
      try {
        const { config, diagram } = parseMermaidContent(chart);
        const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const mermaidConfig: any = {
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'loose',
          themeVariables: {
            fontSize: '8px',
          },
          suppressErrorRendering: true,
          flowchart: {
            useMaxWidth: false,
            htmlLabels: true,
            curve: 'basis',
            rankSpacing: 80,
            nodeSpacing: 50,
          },
          layout: 'dagre'
        };
        if (config.config) {
          if (config.config.theme) {
            mermaidConfig.theme = config.config.theme;
          }
          if (config.config.themeVariables) {
            mermaidConfig.themeVariables = {
              ...mermaidConfig.themeVariables,
              ...config.config.themeVariables
            };
          }
          if (config.config.flowchart) {
            mermaidConfig.flowchart = {
              ...mermaidConfig.flowchart,
              ...config.config.flowchart
            };
          }
          if (config.config.defaultRenderer === 'elk') {
            mermaidConfig.flowchart.defaultRenderer = 'elk';
          }
          if (config.config.layout) {
            mermaidConfig.layout = config.config.layout;
            if (config.config.layout === 'elk') {
              mermaidConfig.flowchart.defaultRenderer = 'elk';
              mermaidConfig.elk = {
                algorithm: 'layered',
                'elk.direction': 'DOWN',
                'elk.spacing.nodeNode': 50,
                'elk.layered.spacing.nodeNodeBetweenLayers': 80,
                ...(config.config.elk || {})
              };
            }
          }
          if (config.config.look) {
            mermaidConfig.look = config.config.look;
          }
        }
        console.log('[Mermaid] Initializing with config:', mermaidConfig);
        console.log('[Mermaid] Rendering diagram:', diagram);
        mermaid.initialize(mermaidConfig);
        const { svg } = await mermaid.render(idRef, diagram);
        ref.current.innerHTML = svg;
        setSvgContent(svg);
        const svgElem = ref.current.querySelector('svg');
        if (svgElem) {
          svgElem.style.maxWidth = '100%';
          svgElem.style.height = 'auto';
          svgElem.style.maxHeight = '90vh';
          svgElem.style.overflow = 'visible';
          svgElem.style.background = colors.mermaidBg || '#eaffea';
          svgElem.style.touchAction = 'none';
          svgElem.style.transformOrigin = '0 0';
          // SVG生成後にzoomStateを必ず反映
          svgElem.style.transform = `translate(${zoomState.translate.x}px, ${zoomState.translate.y}px) scale(${zoomState.scale})`;
          // attach pan/zoom handlers
          const container = ref.current as HTMLDivElement;

          const applyTransform = () => {
            const s = scaleRef.current;
            const { x, y } = translateRef.current;
            svgElem.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
            // useStateで保存
            setZoomState({ scale: s, translate: { x, y } });
          };

          const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = container.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const delta = e.deltaY < 0 ? 1.12 : 0.9;
            const prevScale = scaleRef.current;
            const newScale = Math.max(0.2, Math.min(8, prevScale * delta));
            const tx = translateRef.current.x;
            const ty = translateRef.current.y;
            translateRef.current.x = mx - (mx - tx) * (newScale / prevScale);
            translateRef.current.y = my - (my - ty) * (newScale / prevScale);
            scaleRef.current = newScale;
            applyTransform();
          };

          const onPointerDown = (e: PointerEvent) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            isPanningRef.current = true;
            lastPointerRef.current = { x: e.clientX, y: e.clientY };
            container.style.cursor = 'grabbing';
          };

          const onPointerMove = (e: PointerEvent) => {
            if (!isPanningRef.current || !lastPointerRef.current) return;
            const dx = e.clientX - lastPointerRef.current.x;
            const dy = e.clientY - lastPointerRef.current.y;
            lastPointerRef.current = { x: e.clientX, y: e.clientY };
            translateRef.current.x += dx;
            translateRef.current.y += dy;
            applyTransform();
          };

          const onPointerUp = (e: PointerEvent) => {
            try { (e.target as Element).releasePointerCapture?.(e.pointerId); } catch (e) { /* ignore */ }
            isPanningRef.current = false;
            lastPointerRef.current = null;
            container.style.cursor = 'default';
          };

          const onDblClick = (e: MouseEvent) => {
            // reset
            scaleRef.current = 1;
            translateRef.current = { x: 0, y: 0 };
            applyTransform();
          };

          container.addEventListener('wheel', onWheel, { passive: false });
          container.addEventListener('pointerdown', onPointerDown as any);
          window.addEventListener('pointermove', onPointerMove as any);
          window.addEventListener('pointerup', onPointerUp as any);
          container.addEventListener('dblclick', onDblClick as any);

          const cleanup = () => {
            try {
              container.removeEventListener('wheel', onWheel as any);
              container.removeEventListener('pointerdown', onPointerDown as any);
              window.removeEventListener('pointermove', onPointerMove as any);
              window.removeEventListener('pointerup', onPointerUp as any);
              container.removeEventListener('dblclick', onDblClick as any);
            } catch (err) {
              // ignore
            }
          };
          (container as any).__mermaidCleanup = cleanup;
        }
        setIsLoading(false);
      } catch (e) {
        const errorMessage = `Mermaidのレンダリングに失敗しました。コードを確認してください。${e}`;
        ref.current.innerHTML = `<div class="mermaid-error" style="color: #cc0000; padding: 16px; border: 1px solid #ff9999; border-radius: 4px; background: #ffe6e6;">${errorMessage}</div>`;
        setError(errorMessage);
        setIsLoading(false);
        setSvgContent(null);
        console.error('[Mermaid] Rendering error:', e);
      }
    };
    renderMermaid();
    return () => {
      try {
        if (ref.current && (ref.current as any).__mermaidCleanup) {
          (ref.current as any).__mermaidCleanup();
        }
      } catch (err) {
        /* ignore */
      }
    };
  }, [chart, colors.mermaidBg]);

  // SVGダウンロード処理
  const handleDownloadSvg = useCallback(() => {
    if (!svgContent) return;
    // Blob生成
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mermaid-diagram.svg';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }, [svgContent]);

  // Small helpers for UI controls
  const handleZoomIn = useCallback(() => {
    const container = ref.current;
    if (!container) return;
    const svgElem = container.querySelector('svg') as SVGElement | null;
    if (!svgElem) return;
    const prev = scaleRef.current;
    const next = Math.min(8, prev * 1.2);
    // center zoom on container center
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    translateRef.current.x = cx - (cx - translateRef.current.x) * (next / prev);
    translateRef.current.y = cy - (cy - translateRef.current.y) * (next / prev);
  scaleRef.current = next;
  svgElem.style.transform = `translate(${translateRef.current.x}px, ${translateRef.current.y}px) scale(${scaleRef.current})`;
  setZoomState({ scale: scaleRef.current, translate: { ...translateRef.current } });
  }, []);

  const handleZoomOut = useCallback(() => {
    const container = ref.current;
    if (!container) return;
    const svgElem = container.querySelector('svg') as SVGElement | null;
    if (!svgElem) return;
    const prev = scaleRef.current;
    const next = Math.max(0.2, prev / 1.2);
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    translateRef.current.x = cx - (cx - translateRef.current.x) * (next / prev);
    translateRef.current.y = cy - (cy - translateRef.current.y) * (next / prev);
  scaleRef.current = next;
  svgElem.style.transform = `translate(${translateRef.current.x}px, ${translateRef.current.y}px) scale(${scaleRef.current})`;
  setZoomState({ scale: scaleRef.current, translate: { ...translateRef.current } });
  }, []);

  const handleResetView = useCallback(() => {
    const container = ref.current;
    if (!container) return;
    const svgElem = container.querySelector('svg') as SVGElement | null;
    if (!svgElem) return;
  scaleRef.current = 1;
  translateRef.current = { x: 0, y: 0 };
  svgElem.style.transform = `translate(0px, 0px) scale(1)`;
  setZoomState({ scale: 1, translate: { x: 0, y: 0 } });
  }, []);

  return (
    <div style={{ gap: '8px', minHeight: '120px' }}>
      {/* Controls: separate container with higher z-index so it won't be overlapped by the SVG */}
      {svgContent && !isLoading && !error && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px', position: 'relative', zIndex: 20 }}>
          <div className="select-none" style={{ display: 'flex', gap: 6, background: 'rgba(255,255,255,0.85)', padding: '6px', borderRadius: 6 }}>
            <button
              type="button"
              onClick={handleZoomIn}
              style={{ padding: '4px 8px', background: '#60a5fa', color: '#fff', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '12px' }}
              title="ズームイン"
            >
              ＋
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              style={{ padding: '4px 8px', background: '#60a5fa', color: '#fff', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '12px' }}
              title="ズームアウト"
            >
              －
            </button>
            <button
              type="button"
              onClick={handleResetView}
              style={{ padding: '4px 8px', background: '#94a3b8', color: '#fff', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '12px' }}
              title="リセット"
            >
              リセット
            </button>
            <button
              type="button"
              onClick={handleDownloadSvg}
              style={{ padding: '4px 8px', background: '#38bdf8', color: '#fff', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '12px', marginLeft: '4px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
              title="SVGダウンロード"
            >
              SVG
            </button>
          </div>
        </div>
      )}

      {/* Diagram container: scrollable area and separate from controls to avoid overlap when panning/zooming */}
      <div style={{ position: 'relative', zIndex: 10, overflow: 'auto', maxHeight: '60vh', paddingTop: 4 }}>
        <div ref={ref} className="mermaid" style={{ minHeight: '120px' }} />
      </div>
    </div>
  );
});

Mermaid.displayName = 'Mermaid';

// メモ化されたローカル画像コンポーネント
const LocalImage = React.memo<{ 
  src: string; 
  alt?: string; 
  projectName?: string; 
  projectFiles?: FileItem[];
  [key: string]: any; 
}>(({ src, alt, projectName, projectFiles, ...props }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const loadImage = async () => {
      if (!src || !projectName) {
        setError(true);
        setLoading(false);
        return;
      }

      // 外部URLの場合はそのまま使用
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
        setDataUrl(src);
        setLoading(false);
        return;
      }

      // ローカル画像の場合はプロジェクトファイルまたはファイルシステムから読み込み
      try {
        const loadedDataUrl = await loadImageAsDataURL(src, projectName, projectFiles);
        if (loadedDataUrl) {
          setDataUrl(loadedDataUrl);
          console.log('Loaded local image:', src);
          setError(false);
        } else {
          setError(true);
        }
      } catch (err) {
        console.warn('Failed to load local image:', src, err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    loadImage();
  }, [src, projectName, projectFiles]);

  if (loading) {
    return (
      <div 
        style={{ 
          display: 'inline-block', 
          padding: '8px 12px', 
          background: '#f0f0f0', 
          border: '1px dashed #ccc', 
          borderRadius: '4px',
          color: '#666'
        }}
      >
        画像を読み込み中...
      </div>
    );
  }

  if (error || !dataUrl) {
    return (
      <div 
        style={{ 
          display: 'inline-block', 
          padding: '8px 12px', 
          background: '#ffe6e6', 
          border: '1px dashed #ff9999', 
          borderRadius: '4px',
          color: '#cc0000'
        }}
      >
        画像が見つかりません: {src}
      </div>
    );
  }

  return <img {...props} src={dataUrl} alt={alt} />;
});

LocalImage.displayName = 'LocalImage';

// メモ化されたコードコンポーネント
const MemoizedCodeComponent = React.memo<{
  className?: string;
  children: React.ReactNode;
  colors: any;
  currentProjectName?: string;
  projectFiles?: FileItem[];
}>(({ className, children, colors, currentProjectName, projectFiles, ...props }) => {
  const match = /language-(\w+)/.exec(className || '');
  const codeString = String(children).replace(/\n$/, '').trim();
  
  if (match && match[1] === 'mermaid') {
    return <Mermaid chart={codeString} colors={colors} />;
  }
  
  if (className && match) {
    return <HighlightedCode language={match[1] || ''} value={codeString} />;
  }
  
  // インラインコード
  return <code {...props}>{children}</code>;
});

MemoizedCodeComponent.displayName = 'MemoizedCodeComponent';

const MarkdownPreviewTab: React.FC<MarkdownPreviewTabProps> = ({ 
  content, 
  fileName, 
  currentProjectName, 
  projectFiles 
}) => {
  const { colors } = useTheme();

  // ReactMarkdownのコンポーネントをメモ化
  // 通常表示用
  const markdownComponents = useMemo(() => ({
    code: ({ node, className, children, ...props }: any) => (
      <MemoizedCodeComponent 
        className={className}
        colors={colors}
        currentProjectName={currentProjectName}
        projectFiles={projectFiles}
        {...props}
      >
        {children}
      </MemoizedCodeComponent>
    ),
    img: ({ node, src, alt, ...props }: any) => {
      const srcString = typeof src === 'string' ? src : '';
      return (
        <LocalImage 
          src={srcString} 
          alt={alt || ''} 
          projectName={currentProjectName}
          projectFiles={projectFiles}
          {...props}
        />
      );
    },
  }), [colors, currentProjectName, projectFiles]);

  // PDFエクスポート用: plain=trueを渡す
  const markdownComponentsPlain = useMemo(() => ({
    code: ({ node, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const codeString = String(children).replace(/\n$/, '').trim();
      if (match && match[1] === 'mermaid') {
        return <Mermaid chart={codeString} colors={colors} />;
      }
      return (
        <HighlightedCode
          language={match ? match[1] : ''}
          value={codeString}
          plain={true}
          {...props}
        />
      );
    },
    img: ({ node, src, alt, ...props }: any) => {
      const srcString = typeof src === 'string' ? src : '';
      return (
        <LocalImage 
          src={srcString} 
          alt={alt || ''} 
          projectName={currentProjectName}
          projectFiles={projectFiles}
          {...props}
        />
      );
    },
  }), [colors, currentProjectName, projectFiles]);

  // メイン部分もメモ化
  const markdownContent = useMemo(() => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, rehypeRaw]}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  ), [content, markdownComponents]);

  // PDF用
  const markdownContentPlain = useMemo(() => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, rehypeRaw]}
      components={markdownComponentsPlain}
    >
      {content}
    </ReactMarkdown>
  ), [content, markdownComponentsPlain]);

  // PDFエクスポート処理
  const handleExportPdf = useCallback(async () => {
    if (typeof window === 'undefined') return; // SSR対策
    const container = document.createElement('div');
    container.style.background = colors.background;
    container.style.color = '#000';
    container.className = 'markdown-body prose prose-github max-w-none';
    document.body.appendChild(container);
    try {
      // React 18+ の createRoot を使う（動的インポートでSSR安全）
      const ReactDOMClient = await import('react-dom/client');
      const root = ReactDOMClient.createRoot(container);
      // ThemeContext.Providerでラップ
      root.render(
        <ThemeContext.Provider value={{
          colors,
          setColor: () => {},
          setColors: () => {},
          themeName: 'pdf',
          setTheme: () => {},
          themeList: [],
          highlightTheme: '',
          setHighlightTheme: () => {},
          highlightThemeList: [],
        }}>
          {markdownContentPlain}
        </ThemeContext.Provider>
      );
      setTimeout(() => {
      // インラインCSSで強制的に黒文字にする
      container.innerHTML = `
        <style>
          body, .markdown-body, .prose, .prose-github, .markdown-body * {
            color: #000 !important;
          }
        </style>
        ${container.innerHTML}
      `;
        exportPdfFromHtml(container.innerHTML, fileName.replace(/\.[^/.]+$/, '') + '.pdf');
        try { root.unmount(); } catch (e) { /* ignore */ }
        document.body.removeChild(container);
      }, 300);
    } catch (err) {
      console.error('PDFエクスポート中にエラーが発生しました', err);
      if (document.body.contains(container)) document.body.removeChild(container);
    }
  }, [markdownContentPlain, fileName, colors]);

  return (
    <div className="p-4 overflow-auto h-full w-full">
      <div className="flex items-center mb-2">
        <div className="font-bold text-lg mr-2">{fileName} プレビュー</div>
        <button
          type="button"
          className="px-2 py-1 rounded bg-green-500 text-white text-xs hover:bg-green-600 transition"
          style={{ marginLeft: 4 }}
          onClick={handleExportPdf}
          title="PDFエクスポート"
        >
          PDFエクスポート
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