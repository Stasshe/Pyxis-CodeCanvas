import { ZoomIn, ZoomOut, RefreshCw, Download } from 'lucide-react';
import mermaid from 'mermaid';
import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';

import { useTranslation } from '@/context/I18nContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';

import { parseMermaidContent } from '../markdownUtils';

import { useIntersectionObserver } from './useIntersectionObserver';

interface MermaidProps {
  chart: string;
  colors: ThemeColors;
}

interface ZoomState {
  scale: number;
  translate: { x: number; y: number };
}

// グローバルカウンタ: ID衝突を確実に防ぐ
let globalMermaidCounter = 0;

// グローバルズーム状態ストア: diagramハッシュをキーにしてズーム状態を保持
const mermaidZoomStore = new Map<string, ZoomState>();

// diagram内容からハッシュキーを生成（安定したキー）
const generateDiagramKey = (diagram: string): string => {
  try {
    const hash = diagram.split('').reduce((acc, char) => {
      return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
    }, 0);
    return `diagram-${Math.abs(hash)}`;
  } catch {
    return `diagram-fallback-${Date.now()}`;
  }
};

// ズーム状態を取得
const getStoredZoomState = (diagramKey: string): ZoomState | undefined => {
  return mermaidZoomStore.get(diagramKey);
};

// ズーム状態を保存
const setStoredZoomState = (diagramKey: string, state: ZoomState): void => {
  mermaidZoomStore.set(diagramKey, state);
};

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

const Mermaid = memo<MermaidProps>(({ chart, colors }) => {
  const { t } = useTranslation();
  const { themeName } = useTheme();
  const ref = useRef<HTMLDivElement>(null);

  // Lazy loading with IntersectionObserver
  const { ref: containerRef, hasIntersected } = useIntersectionObserver({
    rootMargin: '200px 0px', // Start loading 200px before coming into view
    triggerOnce: true,
  });

  // 設定パースをメモ化（パフォーマンス改善）
  const { config, diagram } = useMemo(() => parseMermaidContent(chart), [chart]);

  // diagramキーを生成（ズーム状態の保持に使用）
  const diagramKey = useMemo(() => generateDiagramKey(diagram), [diagram]);

  // ID生成をメモ化（chart変更時のみ再生成）
  const idRef = useMemo(() => generateSafeId(chart), [chart]);

  // 保存されたズーム状態を取得、なければデフォルト値
  const initialZoomState = useMemo((): ZoomState => {
    const stored = getStoredZoomState(diagramKey);
    return stored || { scale: 1, translate: { x: 0, y: 0 } };
  }, [diagramKey]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [zoomState, setZoomState] = useState<ZoomState>(initialZoomState);

  const scaleRef = useRef<number>(initialZoomState.scale);
  const translateRef = useRef<{ x: number; y: number }>({ ...initialZoomState.translate });
  const isPanningRef = useRef<boolean>(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  // diagramKeyが変わったときに保存されたズーム状態を復元
  useEffect(() => {
    const stored = getStoredZoomState(diagramKey);
    if (stored) {
      setZoomState(stored);
      scaleRef.current = stored.scale;
      translateRef.current = { ...stored.translate };
    }
  }, [diagramKey]);

  // ズーム状態が変わったときに保存
  useEffect(() => {
    setStoredZoomState(diagramKey, zoomState);
  }, [diagramKey, zoomState]);

  useEffect(() => {
    // Don't render until element comes into view
    if (!hasIntersected) return;

    let lastTouchDist = 0;
    let isPinching = false;
    let pinchStartScale = 1;
    let pinchStart = { x: 0, y: 0 };
    let isMounted = true;

    const renderMermaid = async (): Promise<void> => {
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
        const mermaidConfig: Record<string, unknown> = {
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'loose',
          themeVariables: {
            fontSize: '8px',
          },
          suppressErrorRendering: true,
          maxTextSize: 100000,
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
              ...(mermaidConfig.themeVariables as Record<string, unknown>),
              ...config.config.themeVariables,
            };
          }
          if (config.config.flowchart) {
            mermaidConfig.flowchart = {
              ...(mermaidConfig.flowchart as Record<string, unknown>),
              ...config.config.flowchart,
            };
          }
          if (config.config.defaultRenderer === 'elk') {
            (mermaidConfig.flowchart as Record<string, unknown>).defaultRenderer = 'elk';
          }
          if (config.config.layout) {
            mermaidConfig.layout = config.config.layout;
            if (config.config.layout === 'elk') {
              (mermaidConfig.flowchart as Record<string, unknown>).defaultRenderer = 'elk';
              mermaidConfig.elk = {
                algorithm: 'layered',
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

        mermaid.initialize(mermaidConfig as Parameters<typeof mermaid.initialize>[0]);

        // タイムアウト処理追加（10秒）
        const timeoutMs = 10000;
        const renderPromise = mermaid.render(idRef, diagram);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Rendering timeout')), timeoutMs)
        );

        const { svg } = (await Promise.race([renderPromise, timeoutPromise])) as { svg: string };

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
          
          // Apply transform directly to SVG without triggering React re-render
          const applyTransformVisual = (): void => {
            const s = scaleRef.current;
            const { x, y } = translateRef.current;
            svgElem.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
          };
          
          // Sync state with refs (called only when interaction ends)
          const syncStateWithRefs = (): void => {
            setZoomState({ scale: scaleRef.current, translate: { ...translateRef.current } });
          };

          const onWheel = (e: WheelEvent): void => {
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
            applyTransformVisual();
            syncStateWithRefs();
          };

          const getTouchDist = (touches: TouchList): number => {
            if (touches.length < 2) return 0;
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
          };

          const onTouchStart = (e: TouchEvent): void => {
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

          const onTouchMove = (e: TouchEvent): void => {
            if (isPinching && e.touches.length === 2) {
              e.preventDefault();
              const newDist = getTouchDist(e.touches);
              if (lastTouchDist > 0) {
                const scaleDelta = newDist / lastTouchDist;
                const newScale = Math.max(0.2, Math.min(8, pinchStartScale * scaleDelta));
                const tx = translateRef.current.x;
                const ty = translateRef.current.y;
                translateRef.current.x = pinchStart.x - (pinchStart.x - tx) * (newScale / scaleRef.current);
                translateRef.current.y = pinchStart.y - (pinchStart.y - ty) * (newScale / scaleRef.current);
                scaleRef.current = newScale;
                applyTransformVisual();
              }
            }
          };

          const onTouchEnd = (e: TouchEvent): void => {
            if (e.touches.length < 2) {
              isPinching = false;
              lastTouchDist = 0;
              syncStateWithRefs();
            }
          };

          const onPointerDown = (e: PointerEvent): void => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            isPanningRef.current = true;
            lastPointerRef.current = { x: e.clientX, y: e.clientY };
            container.style.cursor = 'grabbing';
          };

          const onPointerMove = (e: PointerEvent): void => {
            if (!isPanningRef.current || !lastPointerRef.current) return;
            const dx = e.clientX - lastPointerRef.current.x;
            const dy = e.clientY - lastPointerRef.current.y;
            lastPointerRef.current = { x: e.clientX, y: e.clientY };
            translateRef.current.x += dx;
            translateRef.current.y += dy;
            applyTransformVisual();
          };

          const onPointerUp = (e: PointerEvent): void => {
            try {
              (e.target as Element).releasePointerCapture?.(e.pointerId);
            } catch {
              // ignore
            }
            isPanningRef.current = false;
            lastPointerRef.current = null;
            container.style.cursor = 'default';
            syncStateWithRefs();
          };

          const onDblClick = (): void => {
            scaleRef.current = 1;
            translateRef.current = { x: 0, y: 0 };
            applyTransformVisual();
            syncStateWithRefs();
          };

          container.addEventListener('wheel', onWheel, { passive: false });
          container.addEventListener('pointerdown', onPointerDown);
          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          container.addEventListener('dblclick', onDblClick);
          container.addEventListener('touchstart', onTouchStart, { passive: false });
          container.addEventListener('touchmove', onTouchMove, { passive: false });
          container.addEventListener('touchend', onTouchEnd, { passive: false });

          const cleanup = (): void => {
            try {
              container.removeEventListener('wheel', onWheel);
              container.removeEventListener('pointerdown', onPointerDown);
              window.removeEventListener('pointermove', onPointerMove);
              window.removeEventListener('pointerup', onPointerUp);
              container.removeEventListener('dblclick', onDblClick);
              container.removeEventListener('touchstart', onTouchStart);
              container.removeEventListener('touchmove', onTouchMove);
              container.removeEventListener('touchend', onTouchEnd);
            } catch {
              // ignore
            }
          };
          (container as HTMLDivElement & { __mermaidCleanup?: () => void }).__mermaidCleanup = cleanup;
        }
        setIsLoading(false);
      } catch (e: unknown) {
        if (!isMounted || !ref.current) return;

        // 詳細なエラーメッセージ
        let errorMessage = 'Mermaidのレンダリングに失敗しました。';
        const err = e as Error & { str?: string };
        if (err.message?.includes('timeout') || err.message?.includes('Rendering timeout')) {
          errorMessage += ' 図が複雑すぎてタイムアウトしました。ノード数を減らすか、シンプルな構造にしてください。';
        } else if (err.message?.includes('Parse error')) {
          errorMessage += ` 構文エラー: ${err.message}`;
        } else if (err.message?.includes('Lexical error')) {
          errorMessage += ' 不正な文字が含まれています。';
        } else if (err.str) {
          errorMessage += ` ${err.str}`;
        } else {
          errorMessage += ` ${err.message || e}`;
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
        if (ref.current) {
          const container = ref.current as HTMLDivElement & { __mermaidCleanup?: () => void };
          if (container.__mermaidCleanup) {
            container.__mermaidCleanup();
          }
        }
      } catch {
        // ignore
      }
    };
  }, [chart, colors.mermaidBg, themeName, config, diagram, idRef, hasIntersected]);

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

  // Placeholder shown before the element comes into view
  if (!hasIntersected) {
    return (
      <div ref={containerRef} style={{ minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            padding: '16px',
            background: '#f5f5f5',
            borderRadius: '8px',
            color: '#666',
            fontSize: '14px',
          }}
        >
          {t ? t('markdownPreview.mermaidPlaceholder') : 'スクロールするとMermaid図が表示されます'}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ gap: '8px', minHeight: '120px' }}>
      {svgContent && !isLoading && !error && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: '8px',
            position: 'relative',
            zIndex: 20,
          }}
        >
          <div
            className="select-none"
            style={{
              display: 'flex',
              gap: 6,
              background: 'rgba(255,255,255,0.85)',
              padding: '6px',
              borderRadius: 6,
            }}
          >
            <button
              type="button"
              aria-label={t ? t('markdownPreview.zoomIn') : 'ズームイン'}
              onClick={handleZoomIn}
              style={{
                margin: '0 4px',
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid #ccc',
                background: colors.background,
                color: colors.foreground,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <ZoomIn size={18} style={{ verticalAlign: 'middle' }} />
              {t ? t('markdownPreview.zoomIn') : 'ズームイン'}
            </button>
            <button
              type="button"
              aria-label={t ? t('markdownPreview.zoomOut') : 'ズームアウト'}
              onClick={handleZoomOut}
              style={{
                margin: '0 4px',
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid #ccc',
                background: colors.background,
                color: colors.foreground,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <ZoomOut size={18} style={{ verticalAlign: 'middle' }} />
              {t ? t('markdownPreview.zoomOut') : 'ズームアウト'}
            </button>
            <button
              type="button"
              aria-label={t ? t('markdownPreview.reset') : 'リセット'}
              onClick={handleResetView}
              style={{
                margin: '0 4px',
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid #ccc',
                background: colors.background,
                color: colors.foreground,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <RefreshCw size={18} style={{ verticalAlign: 'middle' }} />
              {t ? t('markdownPreview.reset') : 'リセット'}
            </button>
            <button
              type="button"
              aria-label={t ? t('markdownPreview.downloadSvg') : 'SVGダウンロード'}
              onClick={handleDownloadSvg}
              style={{
                margin: '0 4px',
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid #ccc',
                background: colors.background,
                color: colors.foreground,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Download size={18} style={{ verticalAlign: 'middle' }} />
              {t ? t('markdownPreview.downloadSvg') : 'SVGダウンロード'}
            </button>
          </div>
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 10, overflow: 'hidden', paddingTop: 4 }}>
        <div ref={ref} className="mermaid" style={{ minHeight: '120px' }} />
      </div>
    </div>
  );
});

Mermaid.displayName = 'Mermaid';

export default Mermaid;
