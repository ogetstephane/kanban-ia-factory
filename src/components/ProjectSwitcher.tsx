import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, FolderKanban, Settings, Check, Briefcase } from 'lucide-react';
import { Project } from '../../shared/types/kanban';
import { ALL_PROJECTS } from '../utils/projectLogic';

interface ProjectSwitcherProps {
  projects: Project[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
  onOpenCreateModal: () => void;
  onOpenManagerModal: () => void;
}

export const ProjectSwitcher: React.FC<ProjectSwitcherProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onOpenCreateModal,
  onOpenManagerModal,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const allProjects = activeProjectId === ALL_PROJECTS;
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const selectionLabel = allProjects ? 'All projects' : activeProject?.name || 'Select Project';

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Switcher Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 hover:border-slate-600 transition-all text-slate-200 hover:text-white cursor-pointer shadow-sm group"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={`Current project: ${selectionLabel}`}
      >
        <span
          className="w-5 h-5 rounded-lg flex items-center justify-center text-xs shadow-sm ring-1 ring-white/10 shrink-0"
          style={{ backgroundColor: activeProject?.color || '#6366f1' }}
        >
          {allProjects ? <FolderKanban className="w-4 h-4" /> : activeProject?.icon || '💼'}
        </span>
        <div className="flex flex-col text-left max-w-[130px] sm:max-w-[170px]">
          <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider leading-none">
            Project
          </span>
          <span className="text-xs font-semibold text-slate-100 truncate mt-0.5">
            {selectionLabel}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 transition-transform ${
            isOpen ? 'rotate-180 text-indigo-400' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute left-0 mt-2 w-72 sm:w-80 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-2 z-50 text-slate-100 animate-in fade-in zoom-in-95 duration-100"
          role="menu"
        >
          <div className="px-2 py-2 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Switch Project ({projects.length})
            </span>
            <button type="button" aria-pressed={allProjects}
              onClick={() => { onSelectProject(ALL_PROJECTS); setIsOpen(false); }}
              className={`rounded px-2 py-1 text-[11px] font-medium ${allProjects ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-indigo-300 hover:bg-slate-700'}`}>
              Show all
            </button>
            <button
              onClick={() => {
                setIsOpen(false);
                onOpenManagerModal();
              }}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 cursor-pointer"
            >
              <Settings className="w-3 h-3" />
              <span>Manage</span>
            </button>
          </div>

          <div className="py-1 max-h-60 overflow-y-auto space-y-1 my-1 pr-1">
            {projects.map((project) => {
              const stats = project.stats ?? {
                totalTasks: 0, completedTasks: 0, inProgressTasks: 0, completionRate: 0, totalFeatures: 0,
              };
              const isSelected = project.id === activeProjectId;

              return (
                <button
                  key={project.id}
                  onClick={() => {
                    onSelectProject(project.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2.5 p-2.5 rounded-xl text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600/20 border border-indigo-500/40 text-white'
                      : 'hover:bg-slate-800/80 border border-transparent text-slate-300 hover:text-white'
                  }`}
                  role="menuitem"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shadow-sm ring-1 ring-white/10 shrink-0"
                      style={{ backgroundColor: project.color }}
                    >
                      {project.icon || '💼'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold truncate">
                          {project.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                        <span>{stats.totalTasks} tasks</span>
                        <span>•</span>
                        <span>{stats.totalFeatures} features</span>
                        <span>•</span>
                        <span className="text-indigo-300 font-medium">{stats.completionRate}% done</span>
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <Check className="w-4 h-4 text-indigo-400 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2 px-1">
            <button
              onClick={() => {
                setIsOpen(false);
                onOpenCreateModal();
              }}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-sm cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Project</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
