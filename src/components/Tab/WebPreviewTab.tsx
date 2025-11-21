import React, { useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/context/I18nContext';

// Lightning-FSの仮想ファイルシステム取得関数
import { fileRepository } from '@/engine/core/fileRepository';
import { inlineHtmlAssets } from '@/engine/export/inlineHtmlAssets';
import { FolderWatcher, type FileChangeEvent } from '@/engine/fileWatcher';

interface WebPreviewTabProps {
  filePath: string;
  currentProjectName?: string;
}

const WebPreviewTab: React.FC<WebPreviewTabProps> = ({ filePath, currentProjectName }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fileContent, setFileContent] = useState('');
  const folderWatcherRef = useRef<FolderWatcher | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { t } = useTranslation();

  console.log('[web previewtab]', filePath);

  // ファイルパスを仮想ファイルシステムのルートに基づいて解決
  const resolveFilePath = (path: string): string => {
    const root = '/projects/' + currentProjectName; // 仮想ファイルシステムのルートを指定
    return path.startsWith('/') ? `${root}${path}` : `${root}/${path}`;
  };

  // ファイルシステムから直接ファイル内容を取得
  const fetchFileContent = async () => {
    try {
      // Use fileRepository (IndexedDB) as the source of truth (new architecture)
      await fileRepository.init();
      const projects = await fileRepository.getProjects();
      const project = projects.find(p => p.name === currentProjectName);
      if (!project) {
        console.error('[DEBUG] プロジェクトが見つかりません:', currentProjectName);
        setFileContent(`<h1>${t('webPreviewTab.notFound')}</h1>`);
        return;
      }

      // Use prefix search and single-file lookup rather than loading whole project
      const resolvedPath = resolveFilePath(filePath); // e.g. /projects/<project>/path
      const targetRel = resolvedPath.replace(`/projects/${currentProjectName}`, '') || '/';

      // get immediate children by prefix, then filter by parentPath
      const prefix = targetRel === '/' ? '/' : `${targetRel}/`;
      const childrenUnderPrefix = await fileRepository.getFilesByPrefix(project.id, prefix);
      const immediateChildren = childrenUnderPrefix.filter(f => f.parentPath === targetRel);

      const hasChildren = immediateChildren.length > 0;
      const isFolderEntry = await fileRepository
        .getFileByPath(project.id, targetRel)
        .catch(() => null);

      if (hasChildren || (isFolderEntry && (isFolderEntry as any).type === 'folder')) {
        const files = immediateChildren.map(f => f.name);
        if (files.length === 0) {
          console.warn('[DEBUG] ディレクトリが空です:', resolvedPath);
          setFileContent(`<h1>${t('webPreviewTab.emptyDirectory')}</h1>`);
          return;
        }

        try {
          const read = async (fullPath: string) => {
            const rel = fullPath.replace(`/projects/${currentProjectName}`, '') || '/';
            const f = await fileRepository.getFileByPath(project.id, rel);
            if (!f) throw new Error(`ファイルが見つかりません: ${rel}`);
            if ((f as any).isBufferArray && (f as any).bufferContent) {
              const decoder = new TextDecoder('utf-8');
              return decoder.decode((f as any).bufferContent as ArrayBuffer);
            }
            return (f as any).content || '';
          };

          const inlinedContent = await inlineHtmlAssets(files, resolvedPath, read);
          console.log('[DEBUG] inlineHtmlAssetsの結果:', inlinedContent);
          setFileContent(inlinedContent);
        } catch (err) {
          console.error('[DEBUG] HTMLアセットのインライン化に失敗しました:', err);
          setFileContent(`<h1>${t('webPreviewTab.inlineHtmlFailed')}</h1>`);
        }
      } else {
        try {
          const f = await fileRepository.getFileByPath(project.id, targetRel);
          if (!f) throw new Error(`ファイルが見つかりません: ${targetRel}`);
          const content =
            (f as any).isBufferArray && (f as any).bufferContent
              ? new TextDecoder('utf-8').decode((f as any).bufferContent as ArrayBuffer)
              : (f as any).content || '';
          console.log('[DEBUG] ファイル内容を取得しました:', content);
          setFileContent(content);
        } catch (e) {
          console.error('[DEBUG] ファイルまたはフォルダの取得中にエラーが発生しました:', e);
          setFileContent(`<h1>${t('webPreviewTab.notFound')}</h1>`);
        }
      }
    } catch (e) {
      console.error('[DEBUG] ファイルまたはフォルダの取得中にエラーが発生しました:', e);
      setFileContent(`<h1>${t('webPreviewTab.notFound')}</h1>`);
    }
  };

  useEffect(() => {
    fetchFileContent();
    console.log('file changed');
  }, [filePath, refreshTrigger]); // fileContentの依存関係を削除してrefreshTriggerを追加

  // ファイル変更監視の設定
  useEffect(() => {
    if (!currentProjectName) return;

    // 監視対象のパスを決定（ディレクトリの場合はそのまま、ファイルの場合は親ディレクトリ）
    const watchPath = filePath.endsWith('/')
      ? filePath
      : filePath.substring(0, filePath.lastIndexOf('/')) || '/';

    console.log(
      '[WebPreviewTab] Setting up file watcher for path:',
      watchPath,
      'in project:',
      currentProjectName
    );

    // FolderWatcherを作成
    const watcher = new FolderWatcher(watchPath, currentProjectName);
    folderWatcherRef.current = watcher;

    // ファイル変更リスナーを追加
    const handleFileChange = (event: FileChangeEvent) => {
      console.log('[WebPreviewTab] File change detected:', event.path, event.type);

      // 少し遅延してから更新（ファイル操作が完了するのを待つ）
      setTimeout(() => {
        setRefreshTrigger(prev => prev + 1);
      }, 100);
    };

    watcher.addListener(handleFileChange);

    // クリーンアップ
    return () => {
      if (folderWatcherRef.current) {
        folderWatcherRef.current.removeListener(handleFileChange);
        folderWatcherRef.current.destroy();
        folderWatcherRef.current = null;
      }
    };
  }, [filePath, currentProjectName]);

  // ファイル内容が変わったらiframeに反映
  useEffect(() => {
    // console.log('[DEBUG] fileContentの状態:', fileContent);
    if (iframeRef.current) {
      const iframeDocument = iframeRef.current.contentDocument;
      if (iframeDocument) {
        console.log('[DEBUG] iframeに書き込む内容:', fileContent);
        iframeDocument.open();
        iframeDocument.write(fileContent);
        iframeDocument.close();
      } else {
        console.warn('[DEBUG] iframeDocumentが取得できませんでした');
      }
    } else {
      console.warn('[DEBUG] iframeRefがnullです');
    }
  }, [fileContent]);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <iframe
        ref={iframeRef}
        style={{ border: 'none', width: '100%', height: '100%' }}
      />
    </div>
  );
};

export default WebPreviewTab;
