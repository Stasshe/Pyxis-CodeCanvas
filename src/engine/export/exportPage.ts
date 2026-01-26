import { inlineHtmlAssets } from './inlineHtmlAssets';

import { fileRepository } from '@/engine/core/fileRepository';
import type { ProjectFile } from '@/types';

export const exportPage = async (
  path: string,
  writeOutput: (output: string) => Promise<void>,
  unixCommandsRef: any
) => {
  try {
    // Determine projectName and relative path from an absolute path like /projects/<projectName>/...
    const parts = path.split('/').filter(p => p !== '');
    if (parts.length < 2 || parts[0] !== 'projects') {
      await writeOutput('無効なパスです。/projects/<projectName>/... の形式で指定してください。');
      return;
    }
    const projectName = parts[1];
    const relativePath = `/${parts.slice(2).join('/')}`;

    // Lookup projectId from fileRepository
    await fileRepository.init();
    const projects = await fileRepository.getProjects();
    const project = projects.find(p => p.name === projectName);
    if (!project) {
      await writeOutput(`プロジェクトが見つかりません: ${projectName}`);
      return;
    }
    const projectId = project.id;

    // Load all project files once via prefix search (efficient)
    const projectFiles = await fileRepository.getFilesByPrefix(projectId, '/');

    // Helper to read a fullPath (/projects/<projectName>/...)
    const repoRead = async (fullPath: string) => {
      const rel = fullPath.replace(`/projects/${projectName}`, '') || '/';
      // Prefer indexed single-file lookup for each read
      const f = await fileRepository.getFileByPath(projectId, rel);
      if (!f) throw new Error(`ファイルが見つかりません: ${rel}`);
      const file = f as ProjectFile;
      if (file.isBufferArray && file.bufferContent) {
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(file.bufferContent as ArrayBuffer);
      }
      return file.content || '';
    };
    const newWindow = window.open('about:blank', '_blank');
    if (!newWindow) {
      await writeOutput('新しいタブを開けませんでした。ポップアップブロックを確認してください。');
      return;
    }

    const iframe = newWindow.document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.top = '0';
    iframe.style.left = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    newWindow.document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      await writeOutput('iframeのドキュメントを取得できませんでした。');
      return;
    }

    // Determine whether the path refers to a directory or file inside the project
    const targetRel = relativePath === '/' ? '/' : relativePath.replace(/\\/g, '/');
    const hasChildren = projectFiles.some(f => f.parentPath === targetRel);
    const isFolderEntry = projectFiles.find(f => f.path === targetRel && f.type === 'folder');

    if (hasChildren || isFolderEntry) {
      // Directory
      const childFiles = projectFiles.filter(f => f.parentPath === targetRel).map(f => f.name);
      let htmlContent: string;
      try {
        htmlContent = await inlineHtmlAssets(childFiles, path, repoRead);
      } catch (err: any) {
        await writeOutput(err.message || 'HTMLインライン化中にエラーが発生しました。');
        return;
      }

      iframeDoc.open();
      iframeDoc.write(htmlContent);
      iframeDoc.close();

      // eruda
      const erudaScript = iframeDoc.createElement('script');
      erudaScript.src = 'https://cdn.jsdelivr.net/npm/eruda';
      erudaScript.onload = () => {
        const initScript = iframeDoc.createElement('script');
        initScript.textContent = 'eruda.init();';
        iframeDoc.body.appendChild(initScript);
      };
      iframeDoc.body.appendChild(erudaScript);

      // index.htmlまたは最初のhtmlファイル名を取得
      let htmlFile = childFiles.find((f: string) => f.toLowerCase() === 'index.html');
      if (!htmlFile) {
        htmlFile = childFiles.find((f: string) => f.endsWith('.html'));
      }
      const htmlPath = htmlFile ? `${path}/${htmlFile}` : path;
      await writeOutput(`フォルダ内のページが新しいタブのiframe内で開かれました: ${htmlPath}`);
    } else {
      let content: string;
      try {
        content = await repoRead(path);
      } catch (err: any) {
        await writeOutput(`指定されたファイルが見つかりません: ${path}`);
        return;
      }

      iframeDoc.open();
      iframeDoc.write(content);
      iframeDoc.close();

      // eruda
      const erudaScript = iframeDoc.createElement('script');
      erudaScript.src = 'https://cdn.jsdelivr.net/npm/eruda';
      erudaScript.onload = () => {
        const initScript = iframeDoc.createElement('script');
        initScript.textContent = 'eruda.init();';
        iframeDoc.body.appendChild(initScript);
      };
      iframeDoc.body.appendChild(erudaScript);

      await writeOutput(`ページが新しいタブのiframe内で開かれました: ${path}`);
    }
  } catch (error) {
    await writeOutput(`エクスポート中にエラーが発生しました: ${(error as Error).message}`);
  }
};
