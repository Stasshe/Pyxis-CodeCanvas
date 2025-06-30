import { useState, useEffect } from 'react';
import { X, Plus, Folder, Trash2 } from 'lucide-react';
import { Project, projectDB } from '@/utils/database';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectSelect: (project: Project) => void;
  currentProject: Project | null;
}

export default function ProjectModal({ 
  isOpen, 
  onClose, 
  onProjectSelect, 
  currentProject 
}: ProjectModalProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadProjects();
    }
  }, [isOpen]);

  const loadProjects = async () => {
    setLoading(true);
    try {
      await projectDB.init();
      const projectList = await projectDB.getProjects();
      setProjects(projectList);
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    setLoading(true);
    try {
      const project = await projectDB.createProject(
        newProjectName.trim(),
        newProjectDescription.trim() || undefined
      );
      setProjects(prev => [project, ...prev]);
      setNewProjectName('');
      setNewProjectDescription('');
      setIsCreating(false);
      onProjectSelect(project);
      onClose();
    } catch (error) {
      console.error('Failed to create project:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('このプロジェクトを削除しますか？この操作は取り消せません。')) {
      return;
    }

    setLoading(true);
    try {
      await projectDB.deleteProject(projectId);
      setProjects(prev => prev.filter(p => p.id !== projectId));
      
      // 現在のプロジェクトが削除された場合
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">プロジェクト管理</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded"
          >
            <X size={20} />
          </button>
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-auto p-4">
          {/* 新規作成ボタン */}
          <div className="mb-4">
            {!isCreating ? (
              <button
                onClick={() => setIsCreating(true)}
                className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
                disabled={loading}
              >
                <Plus size={16} />
                新しいプロジェクト
              </button>
            ) : (
              <div className="bg-muted p-4 rounded border">
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">プロジェクト名</label>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="マイプロジェクト"
                    className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">説明（オプション）</label>
                  <textarea
                    value={newProjectDescription}
                    onChange={(e) => setNewProjectDescription(e.target.value)}
                    placeholder="プロジェクトの説明..."
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
                    作成
                  </button>
                  <button
                    onClick={() => {
                      setIsCreating(false);
                      setNewProjectName('');
                      setNewProjectDescription('');
                    }}
                    className="px-3 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* プロジェクト一覧 */}
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              読み込み中...
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              プロジェクトがありません
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => {
                    onProjectSelect(project);
                    onClose();
                  }}
                  className={`group p-3 border rounded cursor-pointer hover:bg-accent transition-colors ${
                    currentProject?.id === project.id 
                      ? 'border-primary bg-accent' 
                      : 'border-border'
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
                          <span>作成: {formatDate(project.createdAt)}</span>
                          <span>更新: {formatDate(project.updatedAt)}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteProject(project.id, e)}
                      className="p-1 hover:bg-destructive hover:text-destructive-foreground rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="プロジェクトを削除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
