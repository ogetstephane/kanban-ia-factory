import React, { useState } from 'react';
import { Sparkles, Plus, Activity, Search, RotateCcw, LayoutGrid, TrendingUp, Gauge, History, ChevronDown, X } from 'lucide-react';
import { Feature, KanbanFilters, TaskPriority, KanbanStatus, Project } from '../types/kanban';
import { TASK_PRIORITIES } from '../utils/kanbanLogic';
import { ProjectSwitcher } from './ProjectSwitcher';
import { ALL_PROJECTS } from '../utils/projectLogic';

interface NavbarProps {
  projects: Project[];
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  onOpenCreateProjectModal: () => void;
  onOpenProjectManagerModal: () => void;
  features: Feature[];
  filters: KanbanFilters;
  viewMode: 'cockpit' | 'board' | 'analytics' | 'sessions' | 'delivery-history' | 'activity' | 'wiki' | 'releases' | 'git';
  onViewModeChange: (mode: 'cockpit' | 'board' | 'analytics' | 'sessions' | 'delivery-history' | 'activity' | 'wiki' | 'releases' | 'git') => void;
  onFilterChange: (filters: Partial<KanbanFilters>) => void;
  onOpenBreakdownModal: (featureId?: string) => void;
  onOpenAdvisorModal: () => void;
  onOpenNewTaskModal: (status?: KanbanStatus) => void;
  onOpenNewFeatureModal: () => void;
  onResetDemoData: () => Promise<void>;
  taskCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onOpenCreateProjectModal,
  onOpenProjectManagerModal,
  features,
  filters,
  viewMode,
  onViewModeChange,
  onFilterChange,
  onOpenBreakdownModal,
  onOpenAdvisorModal,
  onOpenNewTaskModal,
  onOpenNewFeatureModal,
  onResetDemoData,
  taskCount,
}) => {
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const hasWiki = projects.some((project) => project.id === activeProjectId && project.repositoryUrl && project.docsPath);
  const hasGitRepository = projects.some((project) => (activeProjectId === ALL_PROJECTS || project.id === activeProjectId) && project.repositoryUrl);
  return (
    <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-slate-100">
      <div className="w-full min-w-0 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          {/* Logo, Brand & Project Switcher */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/10 shrink-0">
              <LayoutGrid className="w-5 h-5 text-white" />
            </div>
            <div className="hidden lg:block">
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                  Kanban Flow
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  <Sparkles className="w-2.5 h-2.5" /> Copilot
                </span>
              </div>
            </div>

            {/* Interactive Project Switcher */}
            <ProjectSwitcher
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={onSelectProject}
              onOpenCreateModal={onOpenCreateProjectModal}
              onOpenManagerModal={onOpenProjectManagerModal}
            />
          </div>

          {/* View Mode Switcher (Board vs Velocity Dashboard) */}
          <div className="hidden xl:flex max-w-full items-center overflow-x-auto whitespace-nowrap p-0.5 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs">
            <button onClick={() => onViewModeChange('cockpit')} aria-label="Switch to Cockpit view"
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium ${viewMode === 'cockpit' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
              <Gauge className="h-3.5 w-3.5" /><span>Cockpit</span>
            </button>
            <button
              onClick={() => onViewModeChange('board')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                viewMode === 'board'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              aria-label="Switch to Kanban Board view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Board</span>
            </button>
            <button
              onClick={() => onViewModeChange('sessions')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                viewMode === 'sessions' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
              aria-label="Switch to AI Sessions view"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Sessions</span>
            </button>
            <button onClick={() => onViewModeChange('delivery-history')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium cursor-pointer ${viewMode === 'delivery-history' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              aria-label="Switch to delivery history view">
              <History className="h-3.5 w-3.5" /><span>Deliveries</span>
            </button>
            <button onClick={() => onViewModeChange('activity')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium cursor-pointer ${viewMode === 'activity' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              aria-label="Switch to activity view">
              <Activity className="h-3.5 w-3.5" /><span>Activity</span>
            </button>
            <button
              onClick={() => onViewModeChange('releases')}
              className={`px-3 py-1 rounded-lg font-medium cursor-pointer ${viewMode === 'releases' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              aria-label="Switch to Releases view"
            >Releases</button>
            {hasWiki && <button onClick={() => onViewModeChange('wiki')} aria-label="Switch to Wiki view"
              className={`px-3 py-1 rounded-lg font-medium cursor-pointer ${viewMode === 'wiki' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Wiki</button>}
            {hasGitRepository && <button onClick={() => onViewModeChange('git')} aria-label="Switch to Git repositories view"
              className={`px-3 py-1 rounded-lg font-medium cursor-pointer ${viewMode === 'git' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Git</button>}
            <button
              onClick={() => onViewModeChange('analytics')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                viewMode === 'analytics'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              aria-label="Switch to Velocity and Bottleneck Analytics view"
            >
              <TrendingUp className="w-3.5 h-3.5 text-indigo-300" />
              <span>Velocity & Trends</span>
            </button>
          </div>

          <button onClick={() => onOpenNewTaskModal('To Do')}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-500 px-2.5 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-950/30 transition hover:bg-indigo-400 active:scale-[.98] focus:outline-none focus:ring-2 focus:ring-indigo-300 sm:px-3 sm:text-sm"
            aria-label="Create new task">
            <Plus className="h-4 w-4" /><span className="hidden sm:inline">Add task</span>
          </button>
        </div>

        <div className="border-t border-slate-800/70 py-2.5 xl:hidden">
          <div className="flex items-center overflow-x-auto p-0.5 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs w-full">
            <button onClick={() => onViewModeChange('cockpit')}
              className={`shrink-0 px-3 py-1.5 rounded-lg ${viewMode === 'cockpit' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Cockpit</button>
            <button
              onClick={() => onViewModeChange('board')}
              className={`shrink-0 px-3 py-1.5 rounded-lg font-medium text-center transition-all cursor-pointer ${
                viewMode === 'board'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Kanban Board
            </button>
            <button
              onClick={() => onViewModeChange('sessions')}
              className={`shrink-0 px-3 py-1.5 rounded-lg ${viewMode === 'sessions' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
            >Sessions</button>
            <button onClick={() => onViewModeChange('delivery-history')}
              className={`shrink-0 px-3 py-1.5 rounded-lg ${viewMode === 'delivery-history' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Deliveries</button>
            <button onClick={() => onViewModeChange('activity')}
              className={`shrink-0 px-3 py-1.5 rounded-lg ${viewMode === 'activity' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Activity</button>
            <button
              onClick={() => onViewModeChange('releases')}
              className={`shrink-0 px-3 py-1.5 rounded-lg ${viewMode === 'releases' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
            >Releases</button>
            {hasWiki && <button onClick={() => onViewModeChange('wiki')}
              className={`shrink-0 px-3 py-1.5 rounded-lg ${viewMode === 'wiki' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Wiki</button>}
            {hasGitRepository && <button onClick={() => onViewModeChange('git')}
              className={`shrink-0 px-3 py-1.5 rounded-lg ${viewMode === 'git' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Git</button>}
            <button
              onClick={() => onViewModeChange('analytics')}
              className={`shrink-0 px-3 py-1.5 rounded-lg font-medium text-center transition-all cursor-pointer ${
                viewMode === 'analytics'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Velocity & Trends
            </button>
          </div>
      </div>

      <div aria-label="Board filters and actions"
        className={`${['releases', 'git', 'cockpit', 'delivery-history', 'activity', 'wiki'].includes(viewMode) ? 'hidden sm:block' : 'block'} border-t border-slate-800/70 bg-slate-950/35 shadow-inner shadow-black/10`}>
        <div className="flex w-full min-w-0 flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:px-8">
          {['board', 'analytics'].includes(viewMode) && <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 md:flex md:items-center">
            <div className="relative col-span-2 min-w-0 md:flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => onFilterChange({ search: e.target.value })}
              placeholder="Search tickets, descriptions, tags..."
              className="w-full rounded-xl border border-slate-700/80 bg-slate-900 py-2 pl-9 pr-9 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/20"
              aria-label="Search tasks"
            />
              {filters.search && <button type="button" onClick={() => onFilterChange({ search: '' })}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Clear search">×</button>}
            </div>
            <select value={filters.priority}
              onChange={(e) => onFilterChange({ priority: e.target.value as TaskPriority | 'All' })}
              className="min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/20"
              aria-label="Filter by priority">
              <option value="All">All priorities</option>
              {TASK_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
            <select value={filters.featureId} onChange={(e) => onFilterChange({ featureId: e.target.value })}
              className="min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/20 md:max-w-56"
              aria-label="Filter by feature">
              <option value="All">All features</option>
              {features.map((feature) => <option key={feature.id} value={feature.id}>{feature.title}</option>)}
            </select>
          </div>}

          <div className={`${['releases', 'git', 'cockpit', 'delivery-history', 'activity', 'wiki'].includes(viewMode) ? 'hidden sm:flex' : 'flex'} flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-3 lg:ml-auto lg:justify-end lg:border-0 lg:pt-0`}>
            <details className="group relative" open={aiMenuOpen} onToggle={(event) => setAiMenuOpen(event.currentTarget.open)}>
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-indigo-400/40 hover:bg-slate-800 [&::-webkit-details-marker]:hidden">
                <Sparkles className="h-4 w-4 text-indigo-300" /><span>AI tools</span>
                <ChevronDown className={`h-3.5 w-3.5 text-slate-500 transition-transform ${aiMenuOpen ? 'rotate-180' : ''}`} />
              </summary>
              <div className="absolute left-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 p-1.5 shadow-2xl shadow-black/40 sm:left-auto sm:right-0">
                <button type="button" onClick={() => { setAiMenuOpen(false); onOpenBreakdownModal(); }}
                  className="flex w-full items-start gap-3 rounded-xl p-3 text-left transition hover:bg-indigo-500/10">
                  <span className="rounded-lg bg-indigo-400/10 p-2 text-indigo-200"><Sparkles className="h-4 w-4" /></span>
                  <span><span className="block text-sm font-medium text-slate-100">Copilot Breakdown</span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-400">Turn a feature into actionable tickets.</span></span>
                </button>
                <button type="button" onClick={() => { setAiMenuOpen(false); onOpenAdvisorModal(); }}
                  className="flex w-full items-start gap-3 rounded-xl p-3 text-left transition hover:bg-emerald-400/10">
                  <span className="rounded-lg bg-emerald-400/10 p-2 text-emerald-200"><Activity className="h-4 w-4" /></span>
                  <span><span className="block text-sm font-medium text-slate-100">Workflow Advisor</span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-400">Review bottlenecks and suggested next steps.</span></span>
                </button>
              </div>
            </details>
            <button onClick={onResetDemoData}
              className="rounded-xl border border-slate-700 p-2 text-slate-400 transition hover:border-rose-400/40 hover:bg-rose-400/10 hover:text-rose-200"
              title="Reset sample features & tasks" aria-label="Reset demo data">
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </header>
);
};
