import { ZoomIn, ZoomOut, RefreshCw, Download } from 'lucide-react';
import { exportPdfFromHtml } from '@/engine/export/exportPdf';
import mermaid from 'mermaid';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import InlineHighlightedCode from './InlineHighlightedCode';
import 'katex/dist/katex.min.css';
import { loadImageAsDataURL, parseMermaidContent } from './markdownUtils';
import { useTranslation } from '@/context/I18nContext';
import { useTheme, ThemeContext } from '@/context/ThemeContext';
import type { PreviewTab } from '@/engine/tabs/types';
import { useSettings } from '@/hooks/useSettings';
import { FileItem, Project } from '@/types';

interface MarkdownPreviewTabProps {
  activeTab: PreviewTab;
  currentProject?: Project;
}

// グローバルカウンタ: ID衝突を確実に防ぐ
let globalMermaidCounter = 0;

// 安全なID生成（非ASCII文字でのエラー回避）
const generateSafeId = (chart: string): string => {
  try {
    const hash = chart.split('').reduce((acc, char) => {
      return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
    }, 0);
    return `mermaid-${Math.abs(hash)}-${++globalMermaidCounter}`;
  } catch {
    return `mermaid-fallback-${++globalMermaidCounter}`;
  }
};

const Mermaid = React.memo<{ chart: string; colors: any }>(({ chart, colors }) => {
  const { t } = useTranslation();
  const { themeName } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  
  // ID生成をメモ化（chart変更時のみ再生成）
  const idRef = useMemo(() => generateSafeId(chart), [chart]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [zoomState, setZoomState] = useState<{
    scale: number;
    translate: { x: number; y: number };
  }>({ scale: 1, translate: { x: 0, y: 0 } });
  
  const scaleRef = useRef<number>(zoomState.scale);
  const translateRef = useRef<{ x: number; y: number }>({ ...zoomState.translate });
  const isPanningRef = useRef<boolean>(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  // 設定パースをメモ化（パフォーマンス改善）
  const { config, diagram } = useMemo(() => parseMermaidContent(chart), [chart]);

  useEffect(() => {
    let lastTouchDist = 0;
    let isPinching = false;
    let pinchStartScale = 1;
    let pinchStart = { x: 0, y: 0 };
    let isMounted = true;

    const renderMermaid = async () => {
      if (!ref.current || !isMounted) return;
      
      setIsLoading(true);
      setError(null);
      scaleRef.current = zoomState.scale;
      translateRef.current = { ...zoomState.translate };
      
      ref.current.innerHTML = `
        <div class="mermaid-loading" style="display:flex;align-items:center;justify-content:center;height:120px;">
          <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
            <circle cx="20" cy="20" r="18" stroke="#4ade80" stroke-width="4" fill="none" stroke-dasharray="90" stroke-dashoffset="60">
              <animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="1s" repeatCount="indefinite"/>
            </circle>
          </svg>
          <span style="margin-left:10px;color:#4ade80;font-size:14px;">${t ? t('markdownPreview.generatingMermaid') : 'Mermaid図表を生成中...'}</span>
        </div>
      `;

      try {
        const isDark = !(themeName && themeName.includes('light'));
        const mermaidConfig: any = {
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'loose',
          themeVariables: {
            fontSize: '8px',
          },
          suppressErrorRendering: true,
          maxTextSize: 100000, // 複雑な図のサイズ制限緩和
          maxEdges: 2000,
          flowchart: {
            useMaxWidth: false,
            htmlLabels: true,
            curve: 'basis',
            rankSpacing: 80,
            nodeSpacing: 50,
          },
          layout: 'dagre',
        };

        if (config.config) {
          if (config.config.theme) mermaidConfig.theme = config.config.theme;
          if (config.config.themeVariables) {
            mermaidConfig.themeVariables = {
              ...mermaidConfig.themeVariables,
              ...config.config.themeVariables,
            };
          }
          if (config.config.flowchart) {
            mermaidConfig.flowchart = {
              ...mermaidConfig.flowchart,
              ...config.config.flowchart,
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
                'algorithm': 'layered',
                'elk.direction': 'DOWN',
                'elk.spacing.nodeNode': 50,
                'elk.layered.spacing.nodeNodeBetweenLayers': 80,
                ...(config.config.elk || {}),
              };
            }
          }
          if (config.config.look) {
            mermaidConfig.look = config.config.look;
          }
        }

        console.log('[Mermaid] Initializing with config:', mermaidConfig);
        console.log('[Mermaid] Rendering diagram (length:', diagram.length, ')');
        
        mermaid.initialize(mermaidConfig);

        // タイムアウト処理追加（10秒）
        const timeoutMs = 10000;
        const renderPromise = mermaid.render(idRef, diagram);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Rendering timeout')), timeoutMs)
        );

        const { svg } = (await Promise.race([renderPromise, timeoutPromise])) as any;

        if (!isMounted || !ref.current) return;

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

          // requestAnimationFrameで描画完了を保証
          requestAnimationFrame(() => {
            if (svgElem && isMounted) {
              svgElem.style.transform = `translate(${zoomState.translate.x}px, ${zoomState.translate.y}px) scale(${zoomState.scale})`;
            }
          });

          const container = ref.current as HTMLDivElement;
          const applyTransform = () => {
            const s = scaleRef.current;
            const { x, y } = translateRef.current;
            svgElem.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
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

          const getTouchDist = (touches: TouchList) => {
            if (touches.length < 2) return 0;
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
          };

          const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
              isPinching = true;
              lastTouchDist = getTouchDist(e.touches);
              pinchStartScale = scaleRef.current;
              const rect = container.getBoundingClientRect();
              pinchStart = {
                x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
                y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top,
              };
            }
          };

          const onTouchMove = (e: TouchEvent) => {
            if (isPinching && e.touches.length === 2) {
              e.preventDefault();
              const newDist = getTouchDist(e.touches);
              if (lastTouchDist > 0) {
                const scaleDelta = newDist / lastTouchDist;
                const newScale = Math.max(0.2, Math.min(8, pinchStartScale * scaleDelta));
                const tx = translateRef.current.x;
                const ty = translateRef.current.y;
                translateRef.current.x =
                  pinchStart.x - (pinchStart.x - tx) * (newScale / scaleRef.current);
                translateRef.current.y =
                  pinchStart.y - (pinchStart.y - ty) * (newScale / scaleRef.current);
                scaleRef.current = newScale;
                applyTransform();
              }
            }
          };

          const onTouchEnd = (e: TouchEvent) => {
            if (e.touches.length < 2) {
              isPinching = false;
              lastTouchDist = 0;
            }
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
            try {
              (e.target as Element).releasePointerCapture?.(e.pointerId);
            } catch (e) {}
            isPanningRef.current = false;
            lastPointerRef.current = null;
            container.style.cursor = 'default';
          };

          const onDblClick = (e: MouseEvent) => {
            scaleRef.current = 1;
            translateRef.current = { x: 0, y: 0 };
            applyTransform();
          };

          container.addEventListener('wheel', onWheel, { passive: false });
          container.addEventListener('pointerdown', onPointerDown as any);
          window.addEventListener('pointermove', onPointerMove as any);
          window.addEventListener('pointerup', onPointerUp as any);
          container.addEventListener('dblclick', onDblClick as any);
          container.addEventListener('touchstart', onTouchStart, { passive: false });
          container.addEventListener('touchmove', onTouchMove, { passive: false });
          container.addEventListener('touchend', onTouchEnd, { passive: false });

          const cleanup = () => {
            try {
              container.removeEventListener('wheel', onWheel as any);
              container.removeEventListener('pointerdown', onPointerDown as any);
              window.removeEventListener('pointermove', onPointerMove as any);
              window.removeEventListener('pointerup', onPointerUp as any);
              container.removeEventListener('dblclick', onDblClick as any);
              container.removeEventListener('touchstart', onTouchStart as any);
              container.removeEventListener('touchmove', onTouchMove as any);
              container.removeEventListener('touchend', onTouchEnd as any);
            } catch (err) {}
          };
          (container as any).__mermaidCleanup = cleanup;
        }
        setIsLoading(false);
      } catch (e: any) {
        if (!isMounted || !ref.current) return;
        
        // 詳細なエラーメッセージ
        let errorMessage = 'Mermaidのレンダリングに失敗しました。';
        if (e.message?.includes('timeout') || e.message?.includes('Rendering timeout')) {
          errorMessage += ' 図が複雑すぎてタイムアウトしました。ノード数を減らすか、シンプルな構造にしてください。';
        } else if (e.message?.includes('Parse error')) {
          errorMessage += ` 構文エラー: ${e.message}`;
        } else if (e.message?.includes('Lexical error')) {
          errorMessage += ' 不正な文字が含まれています。';
        } else if (e.str) {
          errorMessage += ` ${e.str}`;
        } else {
          errorMessage += ` ${e.message || e}`;
        }

        ref.current.innerHTML = `<div class="mermaid-error" style="color: #cc0000; padding: 16px; border: 1px solid #ff9999; border-radius: 4px; background: #ffe6e6;">${errorMessage}</div>`;
        setError(errorMessage);
        setIsLoading(false);
        setSvgContent(null);
        console.error('[Mermaid] Rendering error:', e);
      }
    };

    renderMermaid();

    return () => {
      isMounted = false;
      try {
        if (ref.current && (ref.current as any).__mermaidCleanup) {
          (ref.current as any).__mermaidCleanup();
        }
      } catch (err) {}
    };
  }, [chart, colors.mermaidBg, themeName, config, diagram, idRef]);

  const handleDownloadSvg = useCallback(() => {
    if (!svgContent) return;
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

  const handleZoomIn = useCallback(() => {
    const container = ref.current;
    if (!container) return;
    const svgElem = container.querySelector('svg') as SVGElement | null;
    if (!svgElem) return;
    const prev = scaleRef.current;
    const next = Math.min(8, prev * 1.2);
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
      {svgContent && !isLoading && !error && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px', position: 'relative', zIndex: 20 }}>
          <div className="select-none" style={{ display: 'flex', gap: 6, background: 'rgba(255,255,255,0.85)', padding: '6px', borderRadius: 6 }}>
            <button type="button" aria-label={t ? t('markdownPreview.zoomIn') : 'ズームイン'} onClick={handleZoomIn}
              style={{ margin: '0 4px', padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', background: colors.background, color: colors.foreground, display: 'flex', alignItems: 'center', gap: 4 }}>
              <ZoomIn size={18} style={{ verticalAlign: 'middle' }} />
              {t ? t('markdownPreview.zoomIn') : 'ズームイン'}
            </button>
            <button type="button" aria-label={t ? t('markdownPreview.zoomOut') : 'ズームアウト'} onClick={handleZoomOut}
              style={{ margin: '0 4px', padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', background: colors.background, color: colors.foreground, display: 'flex', alignItems: 'center', gap: 4 }}>
              <ZoomOut size={18} style={{ verticalAlign: 'middle' }} />
              {t ? t('markdownPreview.zoomOut') : 'ズームアウト'}
            </button>
            <button type="button" aria-label={t ? t('markdownPreview.reset') : 'リセット'} onClick={handleResetView}
              style={{ margin: '0 4px', padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', background: colors.background, color: colors.foreground, display: 'flex', alignItems: 'center', gap: 4 }}>
              <RefreshCw size={18} style={{ verticalAlign: 'middle' }} />
              {t ? t('markdownPreview.reset') : 'リセット'}
            </button>
            <button type="button" aria-label={t ? t('markdownPreview.downloadSvg') : 'SVGダウンロード'} onClick={handleDownloadSvg}
              style={{ margin: '0 4px', padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', background: colors.background, color: colors.foreground, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Download size={18} style={{ verticalAlign: 'middle' }} />
              {t ? t('markdownPreview.downloadSvg') : 'SVGダウンロード'}
            </button>
          </div>
        </div>
      )}
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
  alt: string;
  activeTab: PreviewTab;
  projectName?: string | undefined;
  projectId?: string | undefined;
  [key: string]: any;
}>(({ src, alt, activeTab, projectName, projectId, ...props }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // i18n
  const { t } = useTranslation();

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
        const loadedDataUrl = await loadImageAsDataURL(
          src,
          projectName,
          projectId,
          // pass the path of the markdown file so relative paths can be resolved
          activeTab.path
        );
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
  }, [src, projectName, activeTab.path]);

  if (loading) {
    return (
      <span
        role="img"
        aria-label="loading-image"
        style={{
          display: 'inline-block',
          padding: '8px 12px',
          background: '#f0f0f0',
          border: '1px dashed #ccc',
          borderRadius: '4px',
          color: '#666',
        }}
      >
        {t ? t('markdownPreview.loadingImage') : '画像を読み込み中...'}
      </span>
    );
  }

  if (error || !dataUrl) {
    return (
      <span
        role="img"
        aria-label="missing-image"
        style={{
          display: 'inline-block',
          padding: '8px 12px',
          background: '#ffe6e6',
          border: '1px dashed #ff9999',
          borderRadius: '4px',
          color: '#cc0000',
        }}
      >
        {t
          ? t('markdownPreview.imageNotFound', { params: { src } })
          : `画像が見つかりません: ${src}`}
      </span>
    );
  }

  return (
    <img
      {...props}
      src={dataUrl}
      alt={alt}
    />
  );
});

LocalImage.displayName = 'LocalImage';

// メモ化されたコードコンポーネント
const MemoizedCodeComponent = React.memo<{
  className?: string;
  children: React.ReactNode;
  colors: any;
  currentProjectName?: string | undefined;
  projectFiles?: FileItem[];
}>(({ className, children, colors, currentProjectName, projectFiles, ...props }) => {
  const match = /language-(\w+)/.exec(className || '');
  const codeString = String(children).replace(/\n$/, '').trim();

  if (match && match[1] === 'mermaid') {
    return (
      <Mermaid
        chart={codeString}
        colors={colors}
      />
    );
  }

  if (className && match) {
    return (
      <InlineHighlightedCode
        language={match[1] || ''}
        value={codeString}
      />
    );
  }

  // インラインコード: InlineHighlightedCode を使う
  const inlineCode = codeString;
  return (
    <InlineHighlightedCode
      language={'plainText'}
      value={inlineCode}
      inline
    />
  );
});

MemoizedCodeComponent.displayName = 'MemoizedCodeComponent';

const MarkdownPreviewTab: React.FC<MarkdownPreviewTabProps> = ({ activeTab, currentProject }) => {
  const { colors, themeName } = useTheme();
  const { settings } = useSettings(currentProject?.id);
  const { t } = useTranslation();
  // ref to markdown container for scrolling
  const markdownContainerRef = useRef<HTMLDivElement | null>(null);
  // keep previous content to detect append-only updates
  const prevContentRef = useRef<string | null>(null);

  // determine markdown plugins based on settings
  const [extraRemarkPlugins, setExtraRemarkPlugins] = useState<any[]>([
    /* maybe remark-breaks */
  ]);

  useEffect(() => {
    let mounted = true;
    const setup = async () => {
      const plugins: any[] = [];
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
        // No AST-level conversion here. Bracket-style math is handled by
        // preprocessing the raw markdown string (see `processedContent` below)
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
  const markdownComponents = useMemo(
    () => ({
      code: ({ node, className, children, ...props }: any) => (
        <MemoizedCodeComponent
          className={className}
          colors={colors}
          currentProjectName={currentProject?.name}
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
            projectName={currentProject?.name}
            projectId={currentProject?.id}
            activeTab={activeTab}
            {...props}
          />
        );
      },
    }),
    [colors, currentProject?.name]
  );

  // PDFエクスポート用: plain=trueを渡す
  const markdownComponentsPlain = useMemo(
    () => ({
      code: ({ node, className, children, ...props }: any) => {
        const match = /language-(\w+)/.exec(className || '');
        const codeString = String(children).replace(/\n$/, '').trim();
        if (match && match[1] === 'mermaid') {
          return (
            <Mermaid
              chart={codeString}
              colors={colors}
            />
          );
        }
        return (
          <InlineHighlightedCode
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
    [colors, currentProject?.name]
  );

  // メイン部分もメモ化
  // Preprocess the raw markdown to convert bracket-style math delimiters
  // into dollar-style, while skipping code fences and inline code.
  const processedContent = useMemo(() => {
    const src = activeTab.content || '';
    const delimiter = settings?.markdown?.math?.delimiter || 'dollar';
    if (delimiter === 'dollar') return src;

    const convertInNonCode = (text: string) => {
      // Split by code fences (```...```) and keep them intact
      return text
        .split(/(```[\s\S]*?```)/g)
        .map(part => {
          if (/^```/.test(part)) return part; // code fence, leave
          // Within non-fence parts, also preserve inline code `...`
          return part
            .split(/(`[^`]*`)/g)
            .map(seg => {
              if (/^`/.test(seg)) return seg; // inline code
              // replace \(...\) -> $...$ and \[...\] -> $$...$$
              return seg
                .replace(/\\\(([\s\S]+?)\\\)/g, (_m, g) => `$${g}$`)
                .replace(/\\\[([\s\S]+?)\\\]/g, (_m, g) => `$$${g}$$`);
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
        // include remark-gfm, optional conversion plugins, then remark-math
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
    [activeTab.content, markdownComponentsPlain]
  );

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
        // インラインCSSで強制的に黒文字にする
        container.innerHTML = `
        <style>
          body, .markdown-body, .prose, .prose-github, .markdown-body * {
            color: #000 !important;
          }
        </style>
        ${container.innerHTML}
      `;
        exportPdfFromHtml(
          container.innerHTML,
          (activeTab.name || 'document').replace(/\.[^/.]+$/, '') + '.pdf'
        );
        try {
          root.unmount();
        } catch (e) {
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
    if (typeof window === 'undefined') return; // SSR対策
    const prev = prevContentRef.current;
    const current = activeTab.content || '';

    const collapseNewlines = (s: string) => s.replace(/\n{3,}/g, '\n\n');
    const trimTrailingWhitespace = (s: string) => s.replace(/[\s\u00A0]+$/g, '');

    // Strictly determine if newStr is the result of appending content to oldStr.
    // Rules:
    // - oldStr must be non-empty and strictly shorter than newStr
    // - after trimming trailing whitespace/newlines from oldStr, it must match a prefix
    //   of newStr (also allowing newStr to contain extra leading newlines between old and new)
    // - edits in the middle (changes not at the end) should NOT pass
    // - limit the comparison window to the last N characters of oldStr for performance on huge docs
    const isAppend = (oldStr: string | null, newStr: string) => {
      if (!oldStr) return false;
      if (newStr.length <= oldStr.length) return false;

      const MAX_WINDOW = 2000; // compare up to last 2KB of the old content

      // Normalize collapsing excessive blank lines only for comparison (not for display)
      const oldTrimmed = trimTrailingWhitespace(oldStr);
      const newTrimmed = newStr; // keep newStr intact for prefix checks

      // Fast path: exact prefix match (most common case)
      if (newTrimmed.startsWith(oldTrimmed)) return true;

      // If old is very large, compare using a window at the end of oldTrimmed
      const start = Math.max(0, oldTrimmed.length - MAX_WINDOW);
      const oldWindow = oldTrimmed.slice(start);

      // If the new string contains oldWindow at its start and the remainder is appended,
      // ensure that the portion of old before the window hasn't been modified by checking
      // that the prefix of newStr (up to start) equals the corresponding prefix of oldTrimmed.
      if (newTrimmed.startsWith(oldWindow)) {
        // Verify the untouched prefix (if any)
        if (start === 0) return true; // whole oldTrimmed was within window and matched
        const oldPrefix = oldTrimmed.slice(0, start);
        const newPrefix = newTrimmed.slice(0, start);
        if (oldPrefix === newPrefix) return true;
      }

      // Allow a relaxed match where multiple blank lines/newline-only differences exist
      // between end of old and start of appended content: normalize sequences of 2+ newlines
      const normalizeNewlines = (s: string) => s.replace(/\n{2,}/g, '\n\n');
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
    } catch (err) {
      const el = markdownContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }

    // 常に最新を保存
    prevContentRef.current = current;
  }, [activeTab.content]);

  return (
    <div
      className="p-4 overflow-auto h-full w-full"
      ref={markdownContainerRef}
    >
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
          color: colors.foreground
        }}
      >
        {markdownContent}
      </div>
    </div>
  );
};

export default React.memo(MarkdownPreviewTab);
