import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/context/I18nContext';
import type { FsChangeEvent } from '@/engine/core/fs';
import { basename, fsClient, normalizePath } from '@/engine/core/fs';
import { inlineHtmlAssets } from '@/engine/in-ex/inlineHtmlAssets';

interface WebPreviewTabProps {
  filePath: string;
  onTitleChange?: (title: string) => void;
}

const WebPreviewTab: React.FC<WebPreviewTabProps> = ({ filePath, onTitleChange }) => {
  const normalizedPath = normalizePath(filePath);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onTitleChangeRef = useRef(onTitleChange);
  const lastAppliedTitleRef = useRef<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { t } = useTranslation();

  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  const getDefaultTabName = useCallback(() => {
    const name = basename(normalizedPath) || 'web';
    return `Preview: ${name}`;
  }, [normalizedPath]);

  const applyHtmlTitle = useCallback(
    (html: string) => {
      const handleTitleChange = onTitleChangeRef.current;
      if (!handleTitleChange || typeof DOMParser === 'undefined') return;

      try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const title = doc.querySelector('title')?.textContent?.trim();
        const nextTitle = title || getDefaultTabName();
        if (lastAppliedTitleRef.current === nextTitle) return;
        lastAppliedTitleRef.current = nextTitle;
        handleTitleChange(nextTitle);
      } catch (error) {
        console.warn('[WebPreviewTab] Failed to parse HTML title.', error);
      }
    },
    [getDefaultTabName]
  );

  const fetchFileContent = useCallback(async () => {
    try {
      await fsClient.init();
      const entry = await fsClient.stat(normalizedPath);
      if (entry.type === 'file') {
        setFileContent(await fsClient.readText(normalizedPath));
        return;
      }

      const files = (await fsClient.readdir(normalizedPath))
        .filter(file => file.type === 'file')
        .map(file => basename(file.path));
      if (files.length === 0) {
        setFileContent(`<h1>${t('webPreviewTab.emptyDirectory')}</h1>`);
        return;
      }

      const content = await inlineHtmlAssets(files, normalizedPath, path =>
        fsClient.readText(path)
      );
      setFileContent(content);
    } catch (error) {
      console.error('[WebPreviewTab] Failed to load preview content.', error);
      setFileContent(`<h1>${t('webPreviewTab.notFound')}</h1>`);
    }
  }, [normalizedPath, t]);

  // refreshTrigger intentionally reruns this effect after filesystem change events.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTrigger is an explicit reload counter.
  useEffect(() => {
    void fetchFileContent();
  }, [fetchFileContent, refreshTrigger]);

  useEffect(() => {
    const iframeDocument = iframeRef.current?.contentDocument;
    if (!iframeDocument) return;
    iframeDocument.open();
    iframeDocument.write(fileContent);
    iframeDocument.close();
    iframeDocument.documentElement.style.backgroundColor = '#ffffff';
    if (iframeDocument.body) iframeDocument.body.style.backgroundColor = '#ffffff';
    if (iframeRef.current) iframeRef.current.style.backgroundColor = '#ffffff';
    applyHtmlTitle(fileContent);
  }, [fileContent, applyHtmlTitle]);

  useEffect(() => {
    const isWithinPreview = (path: string): boolean => {
      const normalized = normalizePath(path);
      return normalized === normalizedPath || normalized.startsWith(`${normalizedPath}/`);
    };
    const onChange = (event: FsChangeEvent) => {
      if (isWithinPreview(event.path)) {
        setRefreshTrigger(value => value + 1);
      }
      if (event.oldPath && isWithinPreview(event.oldPath)) {
        setRefreshTrigger(value => value + 1);
      }
    };

    const unsubscribe = fsClient.addChangeListener(onChange);
    return unsubscribe;
  }, [normalizedPath]);

  return (
    <div style={{ backgroundColor: '#ffffff', height: '100%', width: '100%' }}>
      <iframe
        ref={iframeRef}
        title={getDefaultTabName()}
        style={{ border: 'none', width: '100%', height: '100%', backgroundColor: '#ffffff' }}
      />
    </div>
  );
};

export default WebPreviewTab;
