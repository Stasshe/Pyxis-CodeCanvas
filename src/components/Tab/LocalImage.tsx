import React, { useEffect, useState } from 'react';
import { loadImageAsDataURL } from './markdownUtils';
import { FileItem } from '@/types';
import { useTranslation } from '@/context/I18nContext';

export const LocalImage: React.FC<{
  src: string;
  alt?: string;
  projectName?: string | undefined;
  projectId?: string | undefined;
  baseFilePath?: string | undefined;
  style?: React.CSSProperties;
  [k: string]: any;
}> = ({ src, alt = '', projectName, projectId, baseFilePath, style, ...props }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(false);
      if (!src) {
        setError(true);
        setLoading(false);
        return;
      }
      // External or data-URLs are left as-is
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
        setDataUrl(src);
        setLoading(false);
        return;
      }
      try {
        const d = await loadImageAsDataURL(src, projectName, projectId, baseFilePath);
        if (!cancelled) {
          if (d) {
            setDataUrl(d);
            setError(false);
          } else {
            setError(true);
          }
        }
      } catch (e) {
        console.warn('LocalImage failed to load', e);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [src, projectName, projectId, baseFilePath]);

  if (loading) {
    return (
      <span
        role="img"
        aria-label="loading-image"
        style={{ display: 'inline-block', padding: '8px 12px', background: '#f0f0f0', border: '1px dashed #ccc', borderRadius: 4, color: '#666', ...style }}
        {...props}
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
        style={{ display: 'inline-block', padding: '8px 12px', background: '#ffe6e6', border: '1px dashed #ff9999', borderRadius: 4, color: '#cc0000', ...style }}
        {...props}
      >
        {t ? t('markdownPreview.imageNotFound', { params: { src } }) : `画像が見つかりません: ${src}`}
      </span>
    );
  }

  return <img src={dataUrl} alt={alt} style={{ maxWidth: '100%', height: 'auto', ...style }} {...props} />;
};

export default LocalImage;
