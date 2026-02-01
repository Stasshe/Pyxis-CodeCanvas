import {
  Edit,
  FileArchive,
  Folder,
  FolderOpen,
  GitBranch,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/context/I18nContext';
import { fileRepository } from '@/engine/core/fileRepository';
import { authRepository } from '@/engine/user/authRepository';
import type { Project } from '@/types';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectSelect: (project: Project) => void;
  onProjectCreate?: (name: string, description?: string) => Promise<void>;
  currentProject: Project | null;
}

type CreationMethod = 'select' | 'new' | 'clone' | 'zip' | 'empty';

export default function ProjectModal({
  isOpen,
  onClose,
  onProjectSelect,
  onProjectCreate,
  currentProject,
}: ProjectModalProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [creationMethod, setCreationMethod] = useState<CreationMethod>('select');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneProjectName, setCloneProjectName] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipProjectName, setZipProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isGitHubAuthenticated, setIsGitHubAuthenticated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (isOpen) {
      loadProjects();
      checkGitHubAuth();
      setCreationMethod('select');
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

  const validateProjectName = (name: string): string => {
    // 英数字・ハイフンのみ、空白は-に置換、日本語不可
    const normalized = name.trim().replace(/\s+/g, '-');
    if (!/^[a-zA-Z0-9-]+$/.test(normalized)) {
      alert(t('projectModal.nameValidation'));
      return '';
    }
    return normalized;
  };

  const handleCreateProject = async (withInitialFiles: boolean) => {
    const name = validateProjectName(newProjectName);
    if (!name) return;

    setLoading(true);
    try {
      let project: Project;

      if (onProjectCreate) {
        await onProjectCreate(name, newProjectDescription.trim() || undefined);
        await loadProjects();
        const newProject = (await fileRepository.getProjects()).find(p => p.name === name);
        if (newProject) project = newProject;
        else throw new Error('Project not found after creation');
      } else {
        if (withInitialFiles) {
          project = await fileRepository.createProject(
            name,
            newProjectDescription.trim() || undefined
          );
        } else {
          project = await fileRepository.createEmptyProject(
            name,
            newProjectDescription.trim() || undefined
          );
        }
        onProjectSelect(project);
      }

      setNewProjectName('');
      setNewProjectDescription('');
      setCreationMethod('select');
      onClose();
      await loadProjects();
    } catch (error) {
      console.error('Failed to create project:', error);
      alert(`プロジェクト作成に失敗しました: ${(error as Error).message}`);
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

    name = validateProjectName(name);
    if (!name) return;

    setLoading(true);
    try {
      // 空のプロジェクトを作成（デフォルトファイル無し）
      const project = await fileRepository.createEmptyProject(name);

      // GitCommandsはregistry経由で取得（シングルトン管理）
      const { terminalCommandRegistry } = await import('@/engine/cmd/terminalRegistry');
      const git = terminalCommandRegistry.getGitCommands(project.name, project.id);

      // git cloneを実行（.gitを含む全ファイルがIndexedDBに同期される）
      await git.clone(url, '.', { maxGitObjects: 100 });

      // プロジェクトを選択して開く
      onProjectSelect(project);

      setCloneUrl('');
      setCloneProjectName('');
      setCreationMethod('select');
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
    if (file?.name.endsWith('.zip')) {
      setZipFile(file);
      // ファイル名からプロジェクト名を推測（.zipを除去）
      const suggestedName = file.name.replace(/\.zip$/i, '').replace(/\s+/g, '-');
      setZipProjectName(suggestedName);
    }
  };

  const handleImportZip = async () => {
    if (!zipFile) {
      alert(t('projectModal.selectZipFile'));
      return;
    }

    const name = validateProjectName(zipProjectName);
    if (!name) return;

    setLoading(true);
    try {
      const project = await fileRepository.importProjectFromZip(
        name,
        zipFile,
        newProjectDescription.trim() || undefined
      );

      onProjectSelect(project);

      setZipFile(null);
      setZipProjectName('');
      setNewProjectDescription('');
      setCreationMethod('select');
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

  const renderCreationMethodSelector = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
      <button type="button" type="button"
        onClick={() => setCreationMethod('new')}
        className="p-4 border border-border rounded-lg hover:bg-accent hover:border-primary transition-colors text-left group"
        disabled={loading}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 bg-primary/10 rounded group-hover:bg-primary/20 transition-colors">
            <Plus size={24} className="text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold mb-1">{t('projectModal.createWithInitial')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('projectModal.createWithInitialDescription')}
            </p>
          </div>
        </div>
      </button>

      <button type="button" type="button"
        onClick={() => setCreationMethod('clone')}
        className="p-4 border border-border rounded-lg hover:bg-accent hover:border-primary transition-colors text-left group"
        disabled={loading}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 bg-primary/10 rounded group-hover:bg-primary/20 transition-colors">
            <GitBranch size={24} className="text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold mb-1">{t('projectModal.gitClone')}</h3>
            <p className="text-sm text-muted-foreground">{t('projectModal.gitCloneDescription')}</p>
          </div>
        </div>
      </button>

      <button type="button" type="button"
        onClick={() => setCreationMethod('zip')}
        className="p-4 border border-border rounded-lg hover:bg-accent hover:border-primary transition-colors text-left group"
        disabled={loading}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 bg-primary/10 rounded group-hover:bg-primary/20 transition-colors">
            <FileArchive size={24} className="text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold mb-1">{t('projectModal.zipImport')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('projectModal.zipImportDescription')}
            </p>
          </div>
        </div>
      </button>

      <button type="button" type="button"
        onClick={() => setCreationMethod('empty')}
        className="p-4 border border-border rounded-lg hover:bg-accent hover:border-primary transition-colors text-left group"
        disabled={loading}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 bg-primary/10 rounded group-hover:bg-primary/20 transition-colors">
            <FolderOpen size={24} className="text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold mb-1">{t('projectModal.createEmpty')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('projectModal.createEmptyDescription')}
            </p>
          </div>
        </div>
      </button>
    </div>
  );

  const renderNewProjectForm = (withInitialFiles: boolean) => (
    <div className="bg-muted p-4 rounded border">
      <div className="mb-3">
        <label className="block text-sm font-medium mb-1">{t('projectModal.projectName')}</label>
        <input
          type="text"
          value={newProjectName}
          onChange={e => setNewProjectName(e.target.value)}
          placeholder={t('projectModal.projectNamePlaceholder')}
          className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
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
        <button type="button" type="button"
          onClick={() => handleCreateProject(withInitialFiles)}
          disabled={!newProjectName.trim() || loading}
          className="px-3 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
        >
          {t('projectModal.create')}
        </button>
        <button type="button" type="button"
          onClick={() => {
            setCreationMethod('select');
            setNewProjectName('');
            setNewProjectDescription('');
          }}
          className="px-3 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
        >
          {t('projectModal.cancel')}
        </button>
      </div>
    </div>
  );

  const renderCloneForm = () => (
    <div className="bg-muted p-4 rounded border">
      <div className="mb-3">
        <label className="block text-sm font-medium mb-1">{t('projectModal.repoUrl')}</label>
        <input
          type="text"
          value={cloneUrl}
          onChange={e => setCloneUrl(e.target.value)}
          placeholder={t('projectModal.repoUrlPlaceholder')}
          className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
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
        <button type="button" type="button"
          onClick={handleCloneProject}
          disabled={!cloneUrl.trim() || loading}
          className="px-3 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
        >
          {t('projectModal.clone')}
        </button>
        <button type="button" type="button"
          onClick={() => {
            setCreationMethod('select');
            setCloneUrl('');
            setCloneProjectName('');
          }}
          className="px-3 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
        >
          {t('projectModal.cancel')}
        </button>
      </div>
    </div>
  );

  const renderZipImportForm = () => (
    <div className="bg-muted p-4 rounded border">
      <div className="mb-3">
        <label className="block text-sm font-medium mb-1">{t('projectModal.uploadZip')}</label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          onChange={handleZipFileSelect}
          className="hidden"
        />
        <button type="button" type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full px-3 py-2 bg-background border border-border rounded hover:bg-accent flex items-center justify-center gap-2"
        >
          <Upload size={16} />
          {zipFile ? zipFile.name : t('projectModal.selectZipFile')}
        </button>
      </div>
      {zipFile && (
        <>
          <div className="mb-3">
            <label className="block text-sm font-medium mb-1">
              {t('projectModal.projectName')}
            </label>
            <input
              type="text"
              value={zipProjectName}
              onChange={e => setZipProjectName(e.target.value)}
              placeholder={t('projectModal.projectNamePlaceholder')}
              className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
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
        </>
      )}
      <div className="flex gap-2">
        <button type="button" type="button"
          onClick={handleImportZip}
          disabled={!zipFile || !zipProjectName.trim() || loading}
          className="px-3 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
        >
          {t('projectModal.create')}
        </button>
        <button type="button" type="button"
          onClick={() => {
            setCreationMethod('select');
            setZipFile(null);
            setZipProjectName('');
            setNewProjectDescription('');
          }}
          className="px-3 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
        >
          {t('projectModal.cancel')}
        </button>
      </div>
    </div>
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">{t('projectModal.title')}</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-accent rounded">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="mb-4">
            {creationMethod === 'select' && (
              <>
                <h3 className="text-sm font-medium mb-3 text-muted-foreground">
                  {t('projectModal.chooseCreationMethod')}
                </h3>
                {renderCreationMethodSelector()}
              </>
            )}

            {creationMethod === 'new' && renderNewProjectForm(true)}
            {creationMethod === 'empty' && renderNewProjectForm(false)}
            {creationMethod === 'clone' && renderCloneForm()}
            {creationMethod === 'zip' && renderZipImportForm()}
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
                      <button type="button" type="button"
                        onClick={() => setEditingProject(project)}
                        className="p-1 hover:bg-accent rounded"
                        title={t('projectModal.editProject')}
                      >
                        <Edit size={16} />
                      </button>
                      <button type="button" type="button"
                        onClick={e => handleDeleteProject(project.id, e)}
                        className="p-1 hover:bg-destructive hover:text-destructive-foreground rounded"
                        title={t('projectModal.deleteProject')}
                      >
                        <Trash2 size={16} />
                      </button>
                      <button type="button" type="button"
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
                <button type="button" type="button"
                  onClick={handleEditProject}
                  className="px-3 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
                >
                  {t('projectModal.save')}
                </button>
                <button type="button" type="button"
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
