import { useEffect, useState, memo } from 'react';

import { useTranslation } from '@/context/I18nContext';
import type { PreviewTab } from '@/engine/tabs/types';

import { loadImageAsDataURL } from '../markdownUtils';

interface LocalImageProps {
  src: string;
  alt: string;
  activeTab: PreviewTab;
  projectName?: string;
  projectId?: string;
  baseFilePath?: string;
  [key: string]: unknown;
}

const LocalImage = memo<LocalImageProps>(
  ({ src, alt, activeTab, projectName, projectId, ...props }) => {
    const [dataUrl, setDataUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const { t } = useTranslation();

    useEffect(() => {
      const loadImage = async (): Promise<void> => {
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
    }, [src, projectName, activeTab.path, projectId]);

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

    return <img {...props} src={dataUrl} alt={alt} />;
  }
);

LocalImage.displayName = 'LocalImage';

export default LocalImage;
