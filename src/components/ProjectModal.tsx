import { Archive, Edit, FileText, Folder, GitBranch, Plus, Trash2, X } from 'lucide-react';
import JSZip from 'jszip';
import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/context/I18nContext';
import { fileRepository } from '@/engine/core/fileRepository';
import { authRepository } from '@/engine/user/authRepository';
import type { Project } from '@/types';

type CreationMode = 'none' | 'new' | 'empty' | 'clone' | 'zip';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectSelect: (project: Project) => void;
  onProjectCreate?: (name: string, description?: string) => Promise<void>;
  currentProject: Project | null;
}

export default function ProjectModal({
  isOpen,
  onClose,
  onProjectSelect,
  onProjectCreate,
  currentProject,
}: ProjectModalProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [creationMode, setCreationMode] = useState<CreationMode>('none');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneProjectName, setCloneProjectName] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipProjectName, setZipProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isGitHubAuthenticated, setIsGitHubAuthenticated] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (isOpen) {
      loadProjects();
      checkGitHubAuth();
    }
  }, [isOpen]);

  const checkGitHubAuth = async () => {
    try {
      const isAuth = await authRepository.isAuthenticated();
      setIsGitHubAuthenticated(isAuth);
    } catch (error) {
      console.error('Failed to check GitHub auth:', error);
      setIsGitHubAuthenticated(false);
    }
  };

  const loadProjects = async () => {
    setLoading(true);
    try {
      await fileRepository.init();
      const projectList = await fileRepository.getProjects();
      setProjects(projectList);
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const validateProjectName = (name: string): string | null => {
    const sanitized = name.trim().replace(/\s+/g, '-');
    if (!sanitized) return null;
    if (!/^[a-zA-Z0-9-]+$/.test(sanitized)) {
      alert(t('projectModal.nameValidation'));
      return null;
    }
    return sanitized;
  };

  const handleCreateProject = async () => {
    const name = validateProjectName(newProjectName);
    if (!name) return;

    setLoading(true);
    try {
      if (onProjectCreate) {
        await onProjectCreate(name, newProjectDescription.trim() || undefined);
      } else {
        const project = await fileRepository.createProject(
          name,
          newProjectDescription.trim() || undefined
        );
        onProjectSelect(project);
      }
      setNewProjectName('');
      setNewProjectDescription('');
      setCreationMode('none');
      onClose();
      await loadProjects();
    } catch (error) {
      console.error('Failed to create project:', error);
      alert(`プロジェクト作成に失敗しました: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEmptyProject = async () => {
    const name = validateProjectName(newProjectName);
    if (!name) return;

    setLoading(true);
    try {
      const project = await fileRepository.createEmptyProject(
        name,
        newProjectDescription.trim() || undefined
      );
      onProjectSelect(project);
      setNewProjectName('');
      setNewProjectDescription('');
      setCreationMode('none');
      onClose();
      await loadProjects();
    } catch (error) {
      console.error('Failed to create empty project:', error);
      alert(`空のプロジェクト作成に失敗しました: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCloneProject = async () => {
    const url = cloneUrl.trim();
    let name = cloneProjectName.trim();

    if (!url) {
      alert(t('projectModal.inputRepoUrl'));
      return;
    }

    // プロジェクト名が未入力の場合、URLから推測
    if (!name) {
      const repoName = url.split('/').pop()?.replace('.git', '') || '';
      name = repoName.replace(/\s+/g, '-');
    }

    const validatedName = validateProjectName(name);
    if (!validatedName) return;

    setLoading(true);
    try {
      // 空のプロジェクトを作成（デフォルトファイル無し）
      const project = await fileRepository.createEmptyProject(validatedName);

      // GitCommandsはregistry経由で取得（シングルトン管理）
      const { terminalCommandRegistry } = await import('@/engine/cmd/terminalRegistry');
      const git = terminalCommandRegistry.getGitCommands(project.name, project.id);

      // git cloneを実行（.gitを含む全ファイルがIndexedDBに同期される）
      // ProjectModalで作成した空プロジェクトのルートに直接クローンするため targetDir='.' を渡す
      // 最大100件まで.gitオブジェクトを読み込む
      await git.clone(url, '.', { maxGitObjects: 100 });

      // プロジェクトを選択して開く
      onProjectSelect(project);

      setCloneUrl('');
      setCloneProjectName('');
      setCreationMode('none');
      onClose();
      await loadProjects();

      alert(t('projectModal.cloneSuccess'));
    } catch (error) {
      console.error('Failed to clone project:', error);
      alert(`クローンに失敗しました: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleZipFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setZipFile(file);
      // ZIPファイル名からプロジェクト名を推測
      const suggestedName = file.name.replace(/\.zip$/i, '').replace(/\s+/g, '-');
      if (!zipProjectName) {
        setZipProjectName(suggestedName);
      }
    }
  };

  const handleImportZip = async () => {
    if (!zipFile) {
      alert(t('projectModal.selectZipFile'));
      return;
    }

    let name = zipProjectName.trim();
    if (!name) {
      name = zipFile.name.replace(/\.zip$/i, '').replace(/\s+/g, '-');
    }

    const validatedName = validateProjectName(name);
    if (!validatedName) return;

    setLoading(true);
    try {
      // ZIPファイルを読み込む
      const arrayBuffer = await zipFile.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      // 空のプロジェクトを作成
      const project = await fileRepository.createEmptyProject(validatedName);

      // ZIPのルート構造を分析（単一フォルダの場合は中身を展開）
      const entries = Object.keys(zip.files);
      let rootPrefix = '';
      
      // 全エントリが同一フォルダ配下かチェック（例: repo-name/src/... の場合）
      const topLevelDirs = new Set<string>();
      for (const entry of entries) {
        const parts = entry.split('/');
        if (parts[0] && parts.length > 1) {
          topLevelDirs.add(parts[0]);
        }
      }
      
      // 単一のトップレベルフォルダがあり、他にルート直下ファイルがない場合
      if (topLevelDirs.size === 1) {
        const singleDir = [...topLevelDirs][0];
        const hasRootFiles = entries.some(e => !e.startsWith(singleDir + '/') && e !== singleDir + '/');
        if (!hasRootFiles) {
          rootPrefix = singleDir + '/';
        }
      }

      // .gitディレクトリが存在するかチェック
      const hasGitDir = entries.some(e => {
        const path = rootPrefix ? e.replace(rootPrefix, '') : e;
        return path.startsWith('.git/') || path === '.git';
      });

      // ファイルを展開してプロジェクトに登録
      for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
        // rootPrefixを除去してルートに展開
        let filePath = rootPrefix ? relativePath.replace(rootPrefix, '') : relativePath;
        
        // 空のパスやrootPrefix自体はスキップ
        if (!filePath || filePath === '/') continue;

        // 先頭にスラッシュを付ける（AppPath形式）
        if (!filePath.startsWith('/')) {
          filePath = '/' + filePath;
        }

        // 末尾のスラッシュを削除（フォルダの場合）
        if (filePath.endsWith('/')) {
          filePath = filePath.slice(0, -1);
        }

        if (zipEntry.dir) {
          // フォルダの場合
          await fileRepository.createFile(project.id, filePath, '', 'folder');
        } else {
          // ファイルの場合
          // バイナリファイルかテキストファイルか判断
          const isBinary = isBinaryFile(filePath);
          
          if (isBinary) {
            const content = await zipEntry.async('arraybuffer');
            await fileRepository.createFile(project.id, filePath, '', 'file', true, content);
          } else {
            const content = await zipEntry.async('string');
            await fileRepository.createFile(project.id, filePath, content, 'file');
          }
        }
      }

      // .gitがある場合はGitFileSystemに同期
      if (hasGitDir) {
        const { terminalCommandRegistry } = await import('@/engine/cmd/terminalRegistry');
        const git = terminalCommandRegistry.getGitCommands(project.name, project.id);
        // ステータスを取得して同期を促す
        try {
          await git.status();
        } catch (e) {
          console.warn('Git status after zip import failed:', e);
        }
      }

      onProjectSelect(project);

      setZipFile(null);
      setZipProjectName('');
      if (zipInputRef.current) {
        zipInputRef.current.value = '';
      }
      setCreationMode('none');
      onClose();
      await loadProjects();

      alert(t('projectModal.zipImportSuccess'));
    } catch (error) {
      console.error('Failed to import ZIP:', error);
      alert(`ZIPインポートに失敗しました: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEditProject = async () => {
    if (!editingProject) return;

    setLoading(true);
    try {
      await fileRepository.updateProject(editingProject.id, {
        description: editingProject.description,
      });
      setEditingProject(null);
      await loadProjects();
    } catch (error) {
      console.error('Failed to edit project:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!confirm(t('projectModal.deleteConfirm'))) {
      return;
    }

    setLoading(true);
    try {
      await fileRepository.deleteProject(projectId);
      setProjects(prev => prev.filter(p => p.id !== projectId));

      if (currentProject?.id === projectId) {
        const remainingProjects = projects.filter(p => p.id !== projectId);
        if (remainingProjects.length > 0) {
          onProjectSelect(remainingProjects[0]);
        }
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const resetCreationMode = () => {
    setCreationMode('none');
    setNewProjectName('');
    setNewProjectDescription('');
    setCloneUrl('');
    setCloneProjectName('');
    setZipFile(null);
    setZipProjectName('');
    if (zipInputRef.current) {
      zipInputRef.current.value = '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">{t('projectModal.title')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="mb-4">
            {creationMode === 'none' ? (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setCreationMode('new')}
                  className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
                  disabled={loading}
                >
                  <Plus size={16} />
                  {t('projectModal.newProject')}
                </button>
                <button
                  onClick={() => setCreationMode('empty')}
                  className="flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
                  disabled={loading}
                >
                  <FileText size={16} />
                  {t('projectModal.emptyProject')}
                </button>
                <button
                  onClick={() => setCreationMode('clone')}
                  className="flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
                  disabled={loading}
                >
                  <GitBranch size={16} />
                  {t('projectModal.cloneFromGitHub')}
                </button>
                <button
                  onClick={() => setCreationMode('zip')}
                  className="flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
                  disabled={loading}
                >
                  <Archive size={16} />
                  {t('projectModal.importZip')}
                </button>
              </div>
            ) : creationMode === 'new' ? (
              <div className="bg-muted p-4 rounded border">
                <h3 className="text-sm font-medium mb-3">{t('projectModal.newProject')}</h3>
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">
                    {t('projectModal.projectName')}
                  </label>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    placeholder={t('projectModal.projectNamePlaceholder')}
                    className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">
                    {t('projectModal.descriptionOptional')}
                  </label>
                  <textarea
                    value={newProjectDescription}
                    onChange={e => setNewProjectDescription(e.target.value)}
                    placeholder={t('projectModal.descriptionPlaceholder')}
                    rows={2}
                    className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateProject}
                    disabled={!newProjectName.trim() || loading}
                    className="px-3 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                  >
                    {t('projectModal.create')}
                  </button>
                  <button
                    onClick={resetCreationMode}
                    className="px-3 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
                  >
                    {t('projectModal.cancel')}
                  </button>
                </div>
              </div>
            ) : creationMode === 'empty' ? (
              <div className="bg-muted p-4 rounded border">
                <h3 className="text-sm font-medium mb-3">{t('projectModal.emptyProject')}</h3>
                <p className="text-xs text-muted-foreground mb-3">{t('projectModal.emptyProjectHint')}</p>
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">
                    {t('projectModal.projectName')}
                  </label>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    placeholder={t('projectModal.projectNamePlaceholder')}
                    className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">
                    {t('projectModal.descriptionOptional')}
                  </label>
                  <textarea
                    value={newProjectDescription}
                    onChange={e => setNewProjectDescription(e.target.value)}
                    placeholder={t('projectModal.descriptionPlaceholder')}
                    rows={2}
                    className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateEmptyProject}
                    disabled={!newProjectName.trim() || loading}
                    className="px-3 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                  >
                    {t('projectModal.create')}
                  </button>
                  <button
                    onClick={resetCreationMode}
                    className="px-3 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
                  >
                    {t('projectModal.cancel')}
                  </button>
                </div>
              </div>
            ) : creationMode === 'clone' ? (
              <div className="bg-muted p-4 rounded border">
                <h3 className="text-sm font-medium mb-3">{t('projectModal.cloneFromGitHub')}</h3>
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">
                    {t('projectModal.repoUrl')}
                  </label>
                  <input
                    type="text"
                    value={cloneUrl}
                    onChange={e => setCloneUrl(e.target.value)}
                    placeholder={t('projectModal.repoUrlPlaceholder')}
                    className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">
                    {t('projectModal.projectNameOptional')}
                  </label>
                  <input
                    type="text"
                    value={cloneProjectName}
                    onChange={e => setCloneProjectName(e.target.value)}
                    placeholder={t('projectModal.projectNameOptionalPlaceholder')}
                    className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{t('projectModal.nameHint')}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCloneProject}
                    disabled={!cloneUrl.trim() || loading}
                    className="px-3 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                  >
                    {t('projectModal.clone')}
                  </button>
                  <button
                    onClick={resetCreationMode}
                    className="px-3 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
                  >
                    {t('projectModal.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-muted p-4 rounded border">
                <h3 className="text-sm font-medium mb-3">{t('projectModal.importZip')}</h3>
                <p className="text-xs text-muted-foreground mb-3">{t('projectModal.zipImportHint')}</p>
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">
                    {t('projectModal.zipFile')}
                  </label>
                  <input
                    ref={zipInputRef}
                    type="file"
                    accept=".zip"
                    onChange={handleZipFileSelect}
                    className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  {zipFile && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('projectModal.selectedFile')}: {zipFile.name}
                    </p>
                  )}
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">
                    {t('projectModal.projectNameOptional')}
                  </label>
                  <input
                    type="text"
                    value={zipProjectName}
                    onChange={e => setZipProjectName(e.target.value)}
                    placeholder={t('projectModal.projectNameOptionalPlaceholder')}
                    className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{t('projectModal.nameHint')}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleImportZip}
                    disabled={!zipFile || loading}
                    className="px-3 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                  >
                    {t('projectModal.import')}
                  </button>
                  <button
                    onClick={resetCreationMode}
                    className="px-3 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
                  >
                    {t('projectModal.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              <div className="loader" />
              {t('projectModal.loading')}
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('projectModal.noProjects')}
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map(project => (
                <div
                  key={project.id}
                  className={`group p-3 border rounded transition-colors ${
                    currentProject?.id === project.id ? 'border-primary bg-accent' : 'border-border'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <Folder size={20} className="text-primary mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate">{project.name}</h3>
                        {project.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {project.description}
                          </p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
                          <span>
                            {t('projectModal.created')}: {formatDate(project.createdAt)}
                          </span>
                          <span>
                            {t('projectModal.updated')}: {formatDate(project.updatedAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditingProject(project)}
                        className="p-1 hover:bg-accent rounded"
                        title={t('projectModal.editProject')}
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={e => handleDeleteProject(project.id, e)}
                        className="p-1 hover:bg-destructive hover:text-destructive-foreground rounded"
                        title={t('projectModal.deleteProject')}
                      >
                        <Trash2 size={16} />
                      </button>
                      <button
                        onClick={() => {
                          onProjectSelect(project);
                          onClose();
                        }}
                        className="px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90"
                      >
                        {t('projectModal.open')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {editingProject && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-md mx-4 p-4">
              <h3 className="text-lg font-semibold mb-4">{t('projectModal.editProject')}</h3>
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1">
                  {t('projectModal.description')}
                </label>
                <textarea
                  value={editingProject.description || ''}
                  onChange={e =>
                    setEditingProject({ ...editingProject, description: e.target.value })
                  }
                  rows={2}
                  className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleEditProject}
                  className="px-3 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
                >
                  {t('projectModal.save')}
                </button>
                <button
                  onClick={() => setEditingProject(null)}
                  className="px-3 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
                >
                  {t('projectModal.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * ファイルパスからバイナリファイルかどうかを判断
 */
function isBinaryFile(path: string): boolean {
  const binaryExtensions = [
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.webm',
    '.ttf', '.otf', '.woff', '.woff2', '.eot',
    '.exe', '.dll', '.so', '.dylib',
    '.bin', '.dat', '.db', '.sqlite',
  ];
  const ext = path.toLowerCase().substring(path.lastIndexOf('.'));
  return binaryExtensions.includes(ext);
}
