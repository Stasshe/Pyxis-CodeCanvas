import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/context/I18nContext';
import type { FsChangeEvent } from '@/engine/core/fs/index';
import {
  basename,
  fsClient,
  getParentPath,
  isPathWithin,
  normalizePath,
} from '@/engine/core/fs/index';
import { inlineHtmlAssets } from '@/engine/ide/importExport/inlineHtmlAssets';

interface WebPreviewTabProps {
  filePath: string;
  onTitleChange?: (title: string) => void;
}

const WebPreviewTab: React.FC<WebPreviewTabProps> = ({ filePath, onTitleChange }) => {
  const normalizedPath = normalizePath(filePath);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onTitleChangeRef = useRef(onTitleChange);
  const lastAppliedTitleRef = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const dependencyPath = useRef(normalizedPath);
  const dependencyPaths = useRef(new Set<string>([normalizedPath]));
  const pendingDependencyPaths = useRef<Set<string> | null>(null);
  const directoryRootPath = useRef<string | null>(null);
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
    const request = ++loadGeneration.current;
    const isCurrentRequest = () => request === loadGeneration.current;
    if (dependencyPath.current !== normalizedPath) {
      dependencyPath.current = normalizedPath;
      dependencyPaths.current = new Set([normalizedPath]);
      directoryRootPath.current = null;
    }
    const requestDependencies = new Set([normalizedPath]);
    pendingDependencyPaths.current = requestDependencies;
    const recordDependency = (path: string) => {
      requestDependencies.add(normalizePath(path));
    };
    try {
      await fsClient.init();
      if (!isCurrentRequest()) return;
      const entry = await fsClient.stat(normalizedPath);
      if (!isCurrentRequest()) return;
      if (entry.type === 'file') {
        directoryRootPath.current = null;
        if (
          normalizedPath.toLowerCase().endsWith('.html') ||
          normalizedPath.toLowerCase().endsWith('.htm')
        ) {
          const directoryPath = getParentPath(normalizedPath);
          const entries = await fsClient.readdir(directoryPath);
          if (!isCurrentRequest()) return;
          const files = entries
            .filter(file => file.type === 'file')
            .map(file => basename(file.path));
          const content = await inlineHtmlAssets(
            files,
            directoryPath,
            path => fsClient.readFile(path),
            basename(normalizedPath),
            recordDependency
          );
          if (!isCurrentRequest()) return;
          dependencyPaths.current = requestDependencies;
          pendingDependencyPaths.current = null;
          setFileContent(content);
        } else {
          const content = await fsClient.readText(normalizedPath);
          if (!isCurrentRequest()) return;
          dependencyPaths.current = requestDependencies;
          pendingDependencyPaths.current = null;
          setFileContent(content);
        }
        return;
      }

      directoryRootPath.current = normalizedPath;
      const entries = await fsClient.readdir(normalizedPath);
      if (!isCurrentRequest()) return;
      const files = entries.filter(file => file.type === 'file').map(file => basename(file.path));
      if (files.length === 0) {
        dependencyPaths.current = requestDependencies;
        pendingDependencyPaths.current = null;
        setFileContent(`<h1>${t('webPreviewTab.emptyDirectory')}</h1>`);
        return;
      }

      const content = await inlineHtmlAssets(
        files,
        normalizedPath,
        path => fsClient.readFile(path),
        undefined,
        recordDependency
      );
      if (!isCurrentRequest()) return;
      dependencyPaths.current = requestDependencies;
      pendingDependencyPaths.current = null;
      setFileContent(content);
    } catch (error) {
      if (!isCurrentRequest()) return;
      dependencyPaths.current = requestDependencies;
      pendingDependencyPaths.current = null;
      console.error('[WebPreviewTab] Failed to load preview content.', error);
      setFileContent(`<h1>${t('webPreviewTab.notFound')}</h1>`);
    }
  }, [normalizedPath, t]);

  // refreshTrigger intentionally reruns this effect after filesystem change events.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTrigger is an explicit reload counter.
  useEffect(() => {
    void fetchFileContent();
    return () => {
      loadGeneration.current += 1;
    };
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
    const isWithinDirectory = (path: string): boolean => {
      if (!directoryRootPath.current) return false;
      return isPathWithin(path, directoryRootPath.current);
    };
    const isDependency = (path: string): boolean => {
      const normalized = normalizePath(path);
      return [...dependencyPaths.current, ...(pendingDependencyPaths.current ?? [])].some(
        dependency => isPathWithin(dependency, normalized)
      );
    };
    const onChange = (event: FsChangeEvent) => {
      if (
        isWithinDirectory(event.path) ||
        isDependency(event.path) ||
        (event.oldPath && (isWithinDirectory(event.oldPath) || isDependency(event.oldPath)))
      ) {
        setRefreshTrigger(value => value + 1);
      }
    };

    const unsubscribe = fsClient.addChangeListener(onChange);
    return unsubscribe;
  }, []);

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
