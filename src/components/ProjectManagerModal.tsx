import React, { useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  FolderKanban,
  CheckCircle2,
  AlertCircle,
  Edit2,
  Check,
  Briefcase,
  GitBranch,
  Loader2
} from 'lucide-react';
import { Project } from '../types/kanban';
import type { RepositoryInput } from '../types/board';
import { DEFAULT_PROJECT_COLORS } from '../utils/projectLogic';
import { useOperation } from '../data/useOperation';
import { BranchSwitcher } from './BranchSwitcher';
import { EMPTY_REPOSITORY, RepositoryFields, type RepositoryDraft } from './RepositoryFields';

export interface NewProjectInput {
  name: string;
  description: string;
  color: string;
  icon?: string;
  repository?: RepositoryInput;
  docsPath?: string;
}

interface ProjectManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  onCreateProject: (input: NewProjectInput) => Promise<void>;
  onUpdateProject: (project: Project) => void;
  onSwitchBranch: (project: Project, branch: string) => Promise<void>;
  onDeleteProject: (projectId: string) => void;
}

const PRESET_ICONS = ['💼', '📱', '🤖', '⚡', '🚀', '🌐', '🛡️', '📊', '🎨', '🔥'];

export const ProjectManagerModal: React.FC<ProjectManagerModalProps> = ({
  isOpen,
  onClose,
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onUpdateProject,
  onSwitchBranch,
  onDeleteProject,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [icon, setIcon] = useState('💼');
  const [repository, setRepository] = useState<RepositoryDraft>(EMPTY_REPOSITORY);
  const [docsPath, setDocsPath] = useState('doc');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const creation = useOperation();

  if (!isOpen) return null;

  const editedProject = editingProjectId ? projects.find((p) => p.id === editingProjectId) : undefined;

  const handleStartCreate = () => {
    setName('');
    setDescription('');
    setColor('#6366f1');
    setIcon('💼');
    setRepository(EMPTY_REPOSITORY);
    setDocsPath('doc');
    creation.clearError();
    setIsCreating(true);
    setEditingProjectId(null);
    setErrorMsg(null);
  };

  const handleStartEdit = (project: Project) => {
    setName(project.name);
    setDescription(project.description);
    setColor(project.color);
    setIcon(project.icon || '💼');
    setDocsPath(project.docsPath ?? 'doc');
    setEditingProjectId(project.id);
    setIsCreating(false);
    setErrorMsg(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Project name is required.');
      return;
    }

    if (isCreating) {
      const url = repository.url.trim();
      const created = await creation.run(() => onCreateProject({
        name: name.trim(), description: description.trim(), color, icon,
        docsPath: url ? docsPath.trim() || 'doc' : undefined,
        repository: url ? { url, branch: repository.branch.trim() || undefined, token: repository.token.trim() || undefined } : undefined,
      }));
      if (!created) return;
      setRepository(EMPTY_REPOSITORY);
      setIsCreating(false);
    } else if (editingProjectId) {
      const existing = projects.find((p) => p.id === editingProjectId);
      if (existing) {
        onUpdateProject({
          ...existing,
          name: name.trim(),
          description: description.trim(),
          color,
          icon,
          docsPath: existing.repositoryUrl ? docsPath.trim() || 'doc' : undefined,
          updatedAt: new Date().toISOString(),
        });
      }
      setEditingProjectId(null);
    }

    setName('');
    setDescription('');
    setErrorMsg(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-manager-title"
    >
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 text-slate-100 my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center">
              <FolderKanban className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 id="project-manager-title" className="text-lg font-bold">
                Project Portfolio Manager
              </h2>
              <p className="text-xs text-slate-400">
                Organize, switch between, and manage multiple software projects
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Your Projects ({projects.length})
            </span>
            {!isCreating && !editingProjectId && (
              <button
                onClick={handleStartCreate}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all cursor-pointer shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create New Project</span>
              </button>
            )}
          </div>

          {/* Form for Create / Edit */}
          {(isCreating || editingProjectId) && (
            <form onSubmit={(e) => { void handleSave(e); }} className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/80 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                  {isCreating ? 'Create New Project' : 'Edit Project Details'}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setEditingProjectId(null);
                  }}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
              </div>

              {(errorMsg || creation.error) && (
                <div className="p-2 rounded bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                  <span>{errorMsg || creation.error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label htmlFor="project-name-input" className="text-xs font-semibold text-slate-300 block mb-1">
                    Project Name *
                  </label>
                  <input
                    id="project-name-input"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. NextGen Mobile App"
                    className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Icon / Emoji
                  </label>
                  <div className="flex items-center gap-1 flex-wrap">
                    {PRESET_ICONS.map((ic) => (
                      <button
                        type="button"
                        key={ic}
                        onClick={() => setIcon(ic)}
                        className={`w-7 h-7 rounded-lg text-sm flex items-center justify-center transition-transform cursor-pointer ${
                          icon === ic ? 'bg-indigo-600 scale-110 shadow' : 'bg-slate-900 hover:bg-slate-700'
                        }`}
                      >
                        {ic}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="project-desc-input" className="text-xs font-semibold text-slate-300 block mb-1">
                  Description
                </label>
                <textarea
                  id="project-desc-input"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Goals, target deliverables, or architecture notes..."
                  className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Brand Color
                </label>
                <div className="flex items-center gap-2">
                  {DEFAULT_PROJECT_COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform cursor-pointer ${
                        color === c ? 'border-white scale-110 shadow' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`Select color ${c}`}
                    />
                  ))}
                </div>
              </div>

              {isCreating && (
                <RepositoryFields value={repository} onChange={setRepository} disabled={creation.pending} />
              )}
              {(isCreating ? repository.url.trim() : editedProject?.repositoryUrl) && (
                <div>
                  <label htmlFor="project-docs-path" className="text-xs font-medium text-slate-300">Documentation folder (Wiki)</label>
                  <input id="project-docs-path" value={docsPath} onChange={(e) => setDocsPath(e.target.value)} required
                    placeholder="doc" maxLength={200} disabled={creation.pending}
                    className="mt-1 w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60" />
                  <p className="mt-1 text-[11px] text-slate-500">Folder inside the repository, created on the first save. Wiki edits are committed to the project branch and pushed.</p>
                </div>
              )}
              {editedProject?.repositoryUrl && (
                <BranchSwitcher project={editedProject} onSwitch={(branch) => onSwitchBranch(editedProject, branch)} />
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setEditingProjectId(null);
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creation.pending}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 disabled:opacity-60"
                >
                  {creation.pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {!isCreating ? 'Save Changes'
                    : creation.pending ? (repository.url.trim() ? 'Cloning repository…' : 'Creating…')
                      : repository.url.trim() ? 'Clone & Create Project' : 'Create Project'}
                </button>
              </div>
            </form>
          )}

          {/* Project List Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
            {projects.map((proj) => {
              const stats = proj.stats ?? {
                totalTasks: 0, completedTasks: 0, inProgressTasks: 0, completionRate: 0, totalFeatures: 0,
              };
              const isActive = proj.id === activeProjectId;

              return (
                <div
                  key={proj.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isActive
                      ? 'bg-slate-800/90 border-indigo-500 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/40'
                      : 'bg-slate-800/40 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-sm ring-1 ring-white/10 shrink-0"
                        style={{ backgroundColor: proj.color }}
                      >
                        {proj.icon || '💼'}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-sm font-bold text-slate-100 truncate">
                            {proj.name}
                          </h4>
                          {isActive && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                          {proj.description || 'No description provided.'}
                        </p>
                        {proj.repositoryUrl && (
                          <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1 min-w-0" title={proj.repositoryUrl}>
                            <GitBranch className="w-3 h-3 shrink-0 text-indigo-400" />
                            <span className="truncate">{proj.repositoryUrl}</span>
                            <span className="shrink-0 text-slate-300">
                              {proj.repositoryBranch}{proj.repositoryCommit ? `@${proj.repositoryCommit.slice(0, 7)}` : ' (empty)'}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleStartEdit(proj)}
                        className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                        title="Edit project"
                        aria-label={`Edit ${proj.name}`}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {projects.length > 1 && (
                        <button
                          onClick={() => onDeleteProject(proj.id)}
                          className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                          title="Delete project"
                          aria-label={`Delete ${proj.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Stats Bar */}
                  <div className="mt-3 pt-2 border-t border-slate-700/50">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span>{stats.completedTasks} of {stats.totalTasks} tasks done</span>
                      <span className="font-semibold text-slate-200">{stats.completionRate}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${stats.completionRate}%`,
                          backgroundColor: proj.color,
                        }}
                      />
                    </div>
                  </div>

                  {/* Switch to this project button */}
                  {!isActive && (
                    <button
                      onClick={() => {
                        onSelectProject(proj.id);
                        onClose();
                      }}
                      className="mt-3 w-full py-1.5 px-3 text-xs font-semibold text-indigo-300 hover:text-white bg-indigo-950/40 hover:bg-indigo-600/30 rounded-lg border border-indigo-800/50 transition-colors cursor-pointer"
                    >
                      Switch to this Project
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end pt-4 mt-4 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
