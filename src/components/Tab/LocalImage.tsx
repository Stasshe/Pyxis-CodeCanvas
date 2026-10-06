import { type ComponentPropsWithoutRef, useEffect, useState } from 'react';
import { useTranslation } from '@/context/I18nContext';
import { loadImageAsDataURL } from './markdownUtils';

type LocalImageProps = ComponentPropsWithoutRef<'img'> & { src: string };

export const LocalImage = ({ src, alt = '', style, ...props }: LocalImageProps) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setLoading(true);
      setError(false);
      if (/^(https?:|data:|\/\/)/i.test(src)) {
        setDataUrl(src);
        setLoading(false);
        return;
      }

      try {
        const imageData = await loadImageAsDataURL(src);
        if (!cancelled) setDataUrl(imageData);
      } catch (loadError) {
        console.warn('[LocalImage] Failed to load image.', loadError);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (loading) {
    return (
      <span role="img" aria-label="loading-image" style={style}>
        {t('markdownPreview.loadingImage')}
      </span>
    );
  }

  if (error || !dataUrl) {
    return (
      <span role="img" aria-label="missing-image" style={style}>
        {t('markdownPreview.imageNotFound', { params: { src } })}
      </span>
    );
  }

  return (
    <img
      src={dataUrl}
      alt={alt}
      style={{ maxWidth: '100%', height: 'auto', ...style }}
      {...props}
    />
  );
};

export default LocalImage;
