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
import { getFileSystem } from '@/utils/core/filesystem';
import { FileItem } from '@/types';

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
const loadImageAsDataURL = async (
  imagePath: string, 
  projectName?: string, 
  projectFiles?: FileItem[]
): Promise<string | null> => {
  if (!projectName) return null;
  
  // まずプロジェクトファイルからbufferContentを探す
  if (projectFiles) {
    // パスの正規化
    const normalizedPath = imagePath.startsWith('/') ? imagePath : '/' + imagePath;
    
    // プロジェクトファイルを平坦化して検索
    const findFileRecursively = (files: FileItem[]): FileItem | null => {
      for (const file of files) {
        if (file.path === normalizedPath && file.type === 'file' && file.isBufferArray && file.bufferContent) {
          return file;
        }
        if (file.children) {
          const found = findFileRecursively(file.children);
          if (found) return found;
        }
      }
      return null;
    };
    
    const imageFile = findFileRecursively(projectFiles);
    if (imageFile && imageFile.bufferContent) {
      try {
        // ファイル拡張子から MIME タイプを推定
        const extension = imagePath.toLowerCase().split('.').pop();
        let mimeType = 'image/png'; // デフォルト
        
        switch (extension) {
          case 'jpg':
          case 'jpeg':
            mimeType = 'image/jpeg';
            break;
          case 'png':
            mimeType = 'image/png';
            break;
          case 'gif':
            mimeType = 'image/gif';
            break;
          case 'svg':
            mimeType = 'image/svg+xml';
            break;
          case 'webp':
            mimeType = 'image/webp';
            break;
        }
        
        // ArrayBuffer を Uint8Array に変換
        const uint8Array = new Uint8Array(imageFile.bufferContent);
        
        // Base64 エンコード
        let binary = '';
        for (let i = 0; i < uint8Array.byteLength; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binary);
        
        console.log('[MarkdownPreviewTab] Loaded image from bufferContent:', imagePath, mimeType);
        return `data:${mimeType};base64,${base64}`;
      } catch (error) {
        console.warn(`Failed to load image from bufferContent: ${imagePath}`, error);
      }
    }
  }
  
  // フォールバック: ファイルシステムから読み込み
  const fs = getFileSystem();
  if (!fs) return null;
  
  try {
    // パスの正規化（先頭の/を除去）
    const normalizedPath = imagePath.startsWith('/') ? imagePath.slice(1) : imagePath;
    const fullPath = `/projects/${projectName}/${normalizedPath}`;
    console.log('[MarkdownPreviewTab] Loading local image from filesystem:', fullPath);
    // ファイルの存在確認
    const stat = await fs.promises.stat(fullPath);
    if (!stat.isFile()) return null;
    
    // ファイルを読み込み
    const fileData = await fs.promises.readFile(fullPath);
    
    // ファイル拡張子から MIME タイプを推定
    const extension = imagePath.toLowerCase().split('.').pop();
    let mimeType = 'image/png'; // デフォルト
    
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        mimeType = 'image/jpeg';
        break;
      case 'png':
        mimeType = 'image/png';
        break;
      case 'gif':
        mimeType = 'image/gif';
        break;
      case 'svg':
        mimeType = 'image/svg+xml';
        break;
      case 'webp':
        mimeType = 'image/webp';
        break;
    }
    
    // ArrayBuffer を Uint8Array に変換
    const uint8Array = fileData instanceof ArrayBuffer 
      ? new Uint8Array(fileData)
      : new Uint8Array(fileData as any);
    
    // Base64 エンコード
    let binary = '';
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.warn(`Failed to load image: ${imagePath}`, error);
    return null;
  }
};

// YAML frontmatter設定を解析する関数
const parseYamlConfig = (yamlText: string): any => {
  try {
    // 簡易的なYAML解析（完全なYAMLパーサーではないが、基本的な設定は処理可能）
    const lines = yamlText.split('\n').filter(line => line.trim());
    const config: any = {};
    let currentObject = config;
    const objectStack: any[] = [config];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const indent = line.length - line.trimStart().length;
      const colonIndex = trimmed.indexOf(':');
      
      if (colonIndex > 0) {
        const key = trimmed.substring(0, colonIndex).trim();
        const value = trimmed.substring(colonIndex + 1).trim();
        
        if (value) {
          // 値がある場合
          let parsedValue: any = value;
          if (value === 'true' || value === 'false') {
            parsedValue = value === 'true';
          } else if (!isNaN(Number(value))) {
            parsedValue = Number(value);
          } else if (value.startsWith("'") && value.endsWith("'")) {
            parsedValue = value.slice(1, -1);
          }
          currentObject[key] = parsedValue;
        } else {
          // 値がない場合（オブジェクト）
          currentObject[key] = {};
          currentObject = currentObject[key];
        }
      }
    }
    
    return config;
  } catch (error) {
    console.warn('YAML設定の解析に失敗:', error);
    return {};
  }
};

// Mermaidチャートから設定と図表を分離する関数
const parseMermaidContent = (chart: string): { config: any; diagram: string } => {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = chart.match(frontmatterRegex);
  
  if (match) {
    const yamlContent = match[1];
    const diagramContent = match[2];
    const config = parseYamlConfig(yamlContent);
    return { config, diagram: diagramContent };
  }
  
  return { config: {}, diagram: chart };
};

// メモ化されたMermaidコンポーネント
const Mermaid = React.memo<{ chart: string; colors: any }>(({ chart, colors }) => {

  const ref = useRef<HTMLDivElement>(null);
  const idRef = useRef<string>(getUniqueMermaidId());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [svgContent, setSvgContent] = useState<string | null>(null);

  useEffect(() => {
    const renderMermaid = async () => {
      if (!ref.current) return;
      setIsLoading(true);
      setError(null);
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
        let mermaidConfig: any = {
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
        const { svg } = await mermaid.render(idRef.current, diagram);
        ref.current.innerHTML = svg;
        setSvgContent(svg);
        const svgElem = ref.current.querySelector('svg');
        if (svgElem) {
          svgElem.style.maxWidth = '100%';
          svgElem.style.height = 'auto';
          svgElem.style.maxHeight = '90vh';
          svgElem.style.overflow = 'visible';
          svgElem.style.background = colors.mermaidBg || '#eaffea';
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

  return (
    <div style={{ gap: '8px', minHeight: '120px' }}>
      {svgContent && !isLoading && !error && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '8px' }}>
          <button
            type="button"
            onClick={handleDownloadSvg}
            style={{
            padding: '4px 8px',
            background: '#38bdf8',
            color: '#fff',
            borderRadius: '4px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '12px',
            marginLeft: '4px',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
            }}
            title="SVGダウンロード"
          >
            SVGダウンロード
          </button>
        </div>
      )}
      <div ref={ref} className="mermaid" style={{ minHeight: '120px' }} />
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
  const handleExportPdf = useCallback(() => {
    if (typeof window === 'undefined') return; // SSR対策
    const container = document.createElement('div');
    container.style.background = colors.background;
    container.style.color = '#000';
    container.className = 'markdown-body prose prose-github max-w-none';
    document.body.appendChild(container);
    // React 18+ の createRoot を使う
    const ReactDOM = require('react-dom/client');
    const root = ReactDOM.createRoot(container);
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
      root.unmount();
      document.body.removeChild(container);
    }, 300);
  }, [markdownContent, fileName, colors]);

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