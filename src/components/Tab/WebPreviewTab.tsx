import React, { useEffect, useRef, useState } from 'react';

// Lightning-FSの仮想ファイルシステム取得関数
import { getFileSystem } from '@/utils/core/filesystem';
import { inlineHtmlAssets } from '@/utils/export/inlineHtmlAssets';
import { FolderWatcher, type FileChangeEvent } from '@/utils/fileWatcher';

interface WebPreviewTabProps {
  filePath: string;
  currentProjectName?: string;
}

const WebPreviewTab: React.FC<WebPreviewTabProps> = ({ filePath, currentProjectName }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fileContent, setFileContent] = useState('');
  const folderWatcherRef = useRef<FolderWatcher | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  console.log('[web previewtab]',filePath)

  // ファイルパスを仮想ファイルシステムのルートに基づいて解決
  const resolveFilePath = (path: string): string => {
    const root = '/projects/' + currentProjectName; // 仮想ファイルシステムのルートを指定
    return path.startsWith('/') ? `${root}${path}` : `${root}/${path}`;
  };

  // ファイルシステムから直接ファイル内容を取得
  const fetchFileContent = async () => {
    try {
      const fs = getFileSystem();
      if (!fs) {
        console.error('[DEBUG] ファイルシステムが初期化されていません');
        return;
      }

      const resolvedPath = resolveFilePath(filePath); // パスを解決
      const stats = await fs.promises.stat(resolvedPath);
      console.log('[DEBUG] ファイルパス:', resolvedPath, 'ステータス:', stats);

      if (stats.isDirectory()) {
        const files = await fs.promises.readdir(resolvedPath);

        if (files.length === 0) {
          console.warn('[DEBUG] ディレクトリが空です:', resolvedPath);
          setFileContent('<h1>ディレクトリが空です</h1>');
          return;
        }

        try {
          console.log('[DEBUG] inlineHtmlAssetsを呼び出します:', { files, resolvedPath });
          const inlinedContent = await inlineHtmlAssets(files, resolvedPath, fs);
          console.log('[DEBUG] inlineHtmlAssetsの結果:', inlinedContent);
          setFileContent(inlinedContent);
        } catch (err) {
          console.error('[DEBUG] HTMLアセットのインライン化に失敗しました:', err);
          setFileContent('<h1>HTMLアセットのインライン化に失敗しました</h1>');
        }
      } else {
        const content = await fs.promises.readFile(resolvedPath, { encoding: 'utf8' });
        console.log('[DEBUG] ファイル内容を取得しました:', content);
        setFileContent(content);
      }
    } catch (e) {
      console.error('[DEBUG] ファイルまたはフォルダの取得中にエラーが発生しました:', e);
      setFileContent('<h1>ファイルまたはフォルダが見つかりません</h1>');
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
    const watchPath = filePath.endsWith('/') ? filePath : filePath.substring(0, filePath.lastIndexOf('/')) || '/';
    
    console.log('[WebPreviewTab] Setting up file watcher for path:', watchPath, 'in project:', currentProjectName);
    
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
    console.log('[DEBUG] fileContentの状態:', fileContent);
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
      <iframe ref={iframeRef} style={{ border: 'none', width: '100%', height: '100%' }} />
    </div>
  );
};

export default WebPreviewTab;
