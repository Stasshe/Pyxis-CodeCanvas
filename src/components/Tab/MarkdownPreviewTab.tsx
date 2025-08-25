import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTheme } from '@/context/ThemeContext';
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

// メモ化されたMermaidコンポーネント
const Mermaid = React.memo<{ chart: string; colors: any }>(({ chart, colors }) => {
  const ref = useRef<HTMLDivElement>(null);
  const idRef = useRef<string>(getUniqueMermaidId());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const renderMermaid = async () => {
      if (!ref.current) return;
      
      setIsLoading(true);
      setError(null);
      
      // ローディング表示
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
        // ダーク/ライト自動切替
        const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        mermaid.initialize({ 
          startOnLoad: false, 
          theme: isDark ? 'dark' : 'default', 
          securityLevel: 'loose',
          themeVariables: {
            fontSize: '8px',
          },
          suppressErrorRendering: true
        });
        
        const { svg } = await mermaid.render(idRef.current, chart);
        ref.current.innerHTML = svg;
        
        // SVGのoverflow調整 & 背景色設定
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
      }
    };

    renderMermaid();
  }, [chart, colors.mermaidBg]);

  return <div ref={ref} className="mermaid" style={{ minHeight: '120px' }} />;
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

  return (
    <div className="p-4 overflow-auto h-full w-full">
      <div className="font-bold text-lg mb-2">{fileName} プレビュー</div>
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
