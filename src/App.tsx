import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { Project, Feature, Task, KanbanFilters, KanbanStatus } from './types/kanban';
import { ALL_PROJECTS, createProject, deleteProject, filterByProject } from './utils/projectLogic';
import { Navbar } from './components/Navbar';
import { FeatureBar } from './components/FeatureBar';
import TaskPage from './components/TaskPage';
import { FeatureBreakdownModal } from './components/FeatureBreakdownModal';
import { WorkflowAdvisorModal } from './components/WorkflowAdvisorModal';
import { NewFeatureModal } from './components/NewFeatureModal';
import { VelocityDashboard } from './components/VelocityDashboard';
import { ProjectManagerModal, type NewProjectInput } from './components/ProjectManagerModal';
import { boardApi } from './data/boardApi';
import { useProjects } from './data/useProjects';
import { useBoard } from './data/useBoard';
import { useOperation } from './data/useOperation';
import { calculateProjectStats } from './utils/projectLogic';
import type { SessionActionFocus } from './types/agent';
import { isViewMode, taskEditorPath, viewPath, type ViewMode } from './utils/routes';

const KanbanBoard = lazy(() => import('./components/KanbanBoard'));
const SessionsView = lazy(() => import('./components/SessionsView'));
const ReleasesView = lazy(() => import('./components/ReleasesView'));
const GitView = lazy(() => import('./components/GitView'));
const CockpitView = lazy(() => import('./components/CockpitView'));
const DeliveryHistoryView = lazy(() => import('./components/DeliveryHistoryView'));
const ActivityView = lazy(() => import('./components/ActivityView').then((module) => ({ default: module.ActivityView })));
const WikiView = lazy(() => import('./components/WikiView'));
const STORAGE_ACTIVE_PROJECT_KEY = 'kanban_flow_active_project_id_v1';
type ProjectAction = { kind: 'task'; status: KanbanStatus } | { kind: 'feature' } | { kind: 'breakdown' };

export default function App() {
  return <BrowserRouter><Routes>
    <Route path="/" element={<Workspace />} />
    <Route path="/:view" element={<Workspace />} />
    <Route path="/projects/:projectId/:view" element={<Workspace />} />
    <Route path="/projects/:projectId/tasks/new" element={<TaskPage />} />
    <Route path="/projects/:projectId/tasks/:taskId/edit" element={<TaskPage />} />
    <Route path="*" element={<NotFound />} />
  </Routes></BrowserRouter>;
}

function NotFound() {
  return <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
    <h1 className="text-xl font-semibold">Page not found</h1>
    <Link to="/" className="text-indigo-300 underline">Return to the cockpit</Link>
  </main>;
}

function Workspace() {
  const navigate = useNavigate();
  const params = useParams();
  const projectsState = useProjects();
  const projectOps = useOperation();
  const boardOps = useOperation();
  const [rememberedProjectId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_ACTIVE_PROJECT_KEY) || '';
    } catch {
      return '';
    }
  });
  const [filters, setFilters] = useState<KanbanFilters>({
    search: '', featureId: 'All', priority: 'All', status: 'All', tag: '',
  });
  const selectedViewMode = isViewMode(params.view) ? params.view : 'cockpit';
  const activeProjectId = params.projectId ?? rememberedProjectId;
  const setActiveProjectId = (id: string) => navigate(viewPath(id, selectedViewMode));
  const setViewMode = (mode: ViewMode) => navigate(viewPath(activeProjectId, mode));
  const [gitOpenError, setGitOpenError] = useState('');
  const [releaseRefresh, setReleaseRefresh] = useState(0);
  const [focusReleaseId, setFocusReleaseId] = useState('');
  const [isBreakdownModalOpen, setIsBreakdownModalOpen] = useState(false);
  const [breakdownFeatureId, setBreakdownFeatureId] = useState<string | undefined>();
  const [isAdvisorModalOpen, setIsAdvisorModalOpen] = useState(false);
  const [isNewFeatureModalOpen, setIsNewFeatureModalOpen] = useState(false);
  const [isProjectManagerModalOpen, setIsProjectManagerModalOpen] = useState(false);
  const [projectAction, setProjectAction] = useState<ProjectAction | null>(null);

  const projects = projectsState.projects;
  const allProjects = activeProjectId === ALL_PROJECTS;
  const hasGitRepository = projects.some((project) => (allProjects || project.id === activeProjectId) && project.repositoryUrl);
  const wikiProject = projects.find((project) => project.id === activeProjectId && project.repositoryUrl && project.docsPath);
  const viewMode = (selectedViewMode === 'git' && !hasGitRepository) || (selectedViewMode === 'wiki' && !wikiProject) ? 'board' : selectedViewMode;
  useEffect(() => {
    if (!projectsState.ready || projects.length === 0) return;
    if (params.view && !isViewMode(params.view)) return;
    if (params.projectId) return;
    const id = activeProjectId === ALL_PROJECTS || projects.some((project) => project.id === activeProjectId)
      ? activeProjectId : projects[0].id;
    navigate(viewPath(id, selectedViewMode), { replace: true });
  }, [projectsState.ready, projects, activeProjectId, params.projectId, params.view, selectedViewMode, navigate]);

  useEffect(() => {
    if (projectsState.ready && viewMode !== selectedViewMode) {
      navigate(viewPath(activeProjectId, viewMode), { replace: true });
    }
  }, [projectsState.ready, viewMode, selectedViewMode, activeProjectId, navigate]);

  useEffect(() => {
    if (!activeProjectId) return;
    try {
      localStorage.setItem(STORAGE_ACTIVE_PROJECT_KEY, activeProjectId);
    } catch (error) {
      console.warn('Failed to save active project ID', error);
    }
  }, [activeProjectId]);

  // Wait for the project list so a stale remembered ID is never requested.
  const knownProjectId = projectsState.ready && (allProjects || projects.some((project) => project.id === activeProjectId)) ? activeProjectId : '';
  const needsBoard = ['board', 'analytics'].includes(viewMode) || isBreakdownModalOpen ||
    isNewFeatureModalOpen || isAdvisorModalOpen;
  const board = useBoard(needsBoard ? knownProjectId : '');
  const currentProjectFeatures = useMemo(() => filterByProject(board.features, activeProjectId), [board.features, activeProjectId]);
  const currentProjectTasks = useMemo(() => filterByProject(board.tasks, activeProjectId), [board.tasks, activeProjectId]);
  const { updateStats } = projectsState;
  useEffect(() => {
    if (!activeProjectId || !board.ready) return;
    for (const project of projects) {
      if (activeProjectId !== ALL_PROJECTS && project.id !== activeProjectId) continue;
      const stats = calculateProjectStats(project.id, currentProjectTasks, currentProjectFeatures);
      updateStats(project.id, {
        totalTasks: stats.totalTasks,
        completedTasks: stats.doneTasks,
        inProgressTasks: stats.inProgressTasks,
        completionRate: stats.completionRate,
        totalFeatures: stats.totalFeatures,
      });
    }
  }, [activeProjectId, board.ready, currentProjectTasks, currentProjectFeatures, projects, updateStats]);

  const persistenceStatus = projectOps.pending || boardOps.pending ? 'Saving changes...' : 'All changes saved';
  const persistenceError = projectOps.error || boardOps.error || projectsState.error || board.error;

  const handleSelectProject = (projectId: string) => {
    setGitOpenError('');
    const nextView = (selectedViewMode === 'git' && !projects.some((project) => (projectId === ALL_PROJECTS || project.id === projectId) && project.repositoryUrl))
      || (selectedViewMode === 'wiki' && !projects.some((project) => project.id === projectId && project.repositoryUrl && project.docsPath))
      ? 'board' : selectedViewMode;
    navigate(viewPath(projectId, nextView));
    setFilters((prev) => ({ ...prev, featureId: 'All' }));
  };

  // Throws so the project form keeps its draft and shows the error (e.g. a failed clone).
  const handleCreateProject = async ({ name, description, color, icon, repository, docsPath }: NewProjectInput) => {
    const { newProject } = createProject(projects, name, description, color, icon);
    const saved = await projectsState.save({ ...newProject, docsPath }, true, repository);
    setActiveProjectId(saved.id);
    setFilters((prev) => ({ ...prev, featureId: 'All' }));
  };

  const handleUpdateProject = async (updated: Project) => {
    await projectOps.run(async () => {
      const current = projects.find((project) => project.id === updated.id);
      if (!current) throw new Error('Project not loaded. Reload and try again.');
      await projectsState.save({ ...updated, revision: current.revision }, false);
    });
  };

  const handleSwitchBranch = async (project: Project, branch: string) => {
    const current = projects.find((item) => item.id === project.id);
    if (!current) throw new Error('Project not loaded. Reload and try again.');
    await projectsState.switchBranch(current, branch);
  };

  const handleDeleteProject = async (projectIdToDelete: string) => {
    await projectOps.run(async () => {
      const target = projects.find((project) => project.id === projectIdToDelete);
      if (!target) throw new Error('Project not loaded. Reload and try again.');
      const { nextActiveId } = deleteProject(projects, projectIdToDelete, activeProjectId);
      await projectsState.remove(target);
      setActiveProjectId(nextActiveId);
      setFilters((prev) => ({ ...prev, featureId: 'All' }));
    });
  };

  const handleFilterChange = (partial: Partial<KanbanFilters>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
  };

  const handleOpenNewTask = (status: KanbanStatus = 'To Do', featureId?: string) => {
    let projectId = activeProjectId;
    if (allProjects) {
      const feature = currentProjectFeatures.find((item) => item.id === featureId);
      if (!feature?.projectId) { setProjectAction({ kind: 'task', status }); return; }
      projectId = feature.projectId;
    }
    openTaskEditor(projectId, { status, featureId });
  };

  const openTaskEditor = (projectId: string, options: Parameters<typeof taskEditorPath>[1]) => {
    navigate(taskEditorPath(projectId, options), {
      state: { returnProjectId: activeProjectId, returnView: viewMode },
    });
  };

  const handleEditTask = (task: Task) => openTaskEditor(task.projectId || activeProjectId, { taskId: task.id });

  const handleOpenCockpitTask = (projectId: string, taskId: string, action?: SessionActionFocus) =>
    openTaskEditor(projectId, { taskId, action });

  const handleDeleteTask = async (taskId: string) => {
    await board.deleteTask(taskId);
  };

  const handleMoveTask = async (taskId: string, targetStatus: KanbanStatus, targetIndex?: number) => {
    await board.moveTask(taskId, targetStatus, targetIndex);
  };

  const handleMoveFeature = async (featureId: string, targetStatus: KanbanStatus) => {
    await board.updateFeatureStatus(featureId, targetStatus);
  };

  const handleOpenBreakdown = (featureId?: string) => {
    if (allProjects) {
      const projectId = currentProjectFeatures.find((feature) => feature.id === featureId)?.projectId;
      if (!projectId) { setProjectAction({ kind: 'breakdown' }); return; }
      handleSelectProject(projectId);
    }
    setBreakdownFeatureId(featureId);
    setIsBreakdownModalOpen(true);
  };

  const handleApplyBreakdown = (feature: Feature, tasksToAdd: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'order'>[]) => {
    void boardOps.run(async () => {
      const projectId = feature.projectId || activeProjectId;
      if (!projects.some((project) => project.id === projectId)) throw new Error('Select a project before creating a breakdown.');
      const now = new Date().toISOString();
      const existing = currentProjectFeatures.find((item) => item.id === feature.id);
      await board.breakdown(
        {
          ...feature,
          revision: existing?.revision ?? 0,
          projectId,
        },
        tasksToAdd.map((task, index) => ({
          ...task,
          id: `task-${Date.now()}-${index}`,
          revision: 0,
          projectId,
          order: index,
          createdAt: now,
          updatedAt: now,
        })),
      );
    });
  };

  const handleSaveNewFeature = (newFeature: Feature) => {
    void boardOps.run(async () => {
      if (allProjects) throw new Error('Select a project before creating a feature.');
      await board.saveFeature({
        ...newFeature, revision: 0, projectId: newFeature.projectId || activeProjectId,
      });
    });
  };

  const handleOpenNewFeature = () => {
    if (allProjects) { setProjectAction({ kind: 'feature' }); return; }
    setIsNewFeatureModalOpen(true);
  };

  const handleDeleteFeature = (featureId: string) => {
    void boardOps.run(async () => {
      await board.deleteFeature(featureId);
      if (filters.featureId === featureId) {
        setFilters((prev) => ({ ...prev, featureId: 'All' }));
      }
    });
  };

  const handleResetDemoData = async () => {
    await projectOps.run(async () => {
      await boardApi.reset();
      projectsState.reload();
      board.reload();
      setFilters({ search: '', featureId: 'All', priority: 'All', status: 'All', tag: '' });
    });
  };

  if (params.view && !isViewMode(params.view)) return <NotFound />;
  if (projectsState.ready && params.projectId && !knownProjectId) return <NotFound />;

  if (!projectsState.ready || !activeProjectId || (needsBoard && board.loading)) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <p role="status">{projectsState.error || board.error || 'Loading board...'}</p>
      </div>
    );
  }

  if (persistenceError) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4 p-6">
        <p role="alert">{persistenceError}</p>
        <div className="flex gap-4">
          <button onClick={() => { projectsState.reload(); board.reload(); }} className="underline">Retry</button>
          <button onClick={() => window.location.reload()} className="underline">Reload saved board</button>
        </div>
      </div>
    );
  }

  const activeProjectFeatures = currentProjectFeatures;
  const activeProjectTasks = currentProjectTasks;
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      <p role="status" className="px-4 py-1 text-xs text-slate-400">{persistenceStatus}</p>
      <Navbar
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
        onOpenCreateProjectModal={() => setIsProjectManagerModalOpen(true)}
        onOpenProjectManagerModal={() => setIsProjectManagerModalOpen(true)}
        features={activeProjectFeatures}
        filters={filters}
        viewMode={viewMode}
        onViewModeChange={(mode) => { if (['sessions', 'releases', 'git'].includes(viewMode) && mode !== viewMode) { board.reload(); projectsState.reload(); } setGitOpenError(''); setViewMode(mode); }}
        onFilterChange={handleFilterChange}
        onOpenBreakdownModal={handleOpenBreakdown}
        onOpenAdvisorModal={() => setIsAdvisorModalOpen(true)}
        onOpenNewTaskModal={handleOpenNewTask}
        onOpenNewFeatureModal={handleOpenNewFeature}
        onResetDemoData={handleResetDemoData}
        taskCount={activeProjectTasks.length}
      />

      {['board', 'analytics'].includes(viewMode) && <FeatureBar
        features={activeProjectFeatures}
        tasks={activeProjectTasks}
        projects={allProjects ? projects : undefined}
        activeFeatureId={filters.featureId}
        onSelectFeature={(id) => handleFilterChange({ featureId: id })}
        onOpenNewFeatureModal={handleOpenNewFeature}
        onOpenBreakdownModal={handleOpenBreakdown}
        onDeleteFeature={handleDeleteFeature}
      />}

      {['board', 'analytics'].includes(viewMode) && (filters.search || filters.priority !== 'All' || filters.featureId !== 'All') && (
        <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-2.5 sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Filtering by</span>
            {filters.search && <button type="button" onClick={() => handleFilterChange({ search: '' })}
              aria-label={`Remove search filter ${filters.search}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-indigo-400/20 bg-indigo-400/10 px-2.5 py-1 text-xs text-indigo-200 transition hover:border-indigo-300/50 hover:bg-indigo-400/15">
              <span className="text-indigo-300">Search</span><span className="max-w-[200px] truncate">&ldquo;{filters.search}&rdquo;</span>
              <span className="ml-0.5 rounded-full bg-indigo-300/15 p-0.5"><X className="h-3 w-3" /></span>
            </button>}
            {filters.priority !== 'All' && <button type="button" onClick={() => handleFilterChange({ priority: 'All' })}
              aria-label={`Remove ${filters.priority} priority filter`}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-100 transition hover:border-amber-300/50 hover:bg-amber-400/15">
              <span className="text-amber-300">Priority</span><span>{filters.priority}</span>
              <span className="ml-0.5 rounded-full bg-amber-300/15 p-0.5"><X className="h-3 w-3" /></span>
            </button>}
            {filters.featureId !== 'All' && <button type="button" onClick={() => handleFilterChange({ featureId: 'All' })}
              aria-label={`Remove feature filter ${activeProjectFeatures.find((feature) => feature.id === filters.featureId)?.title || filters.featureId}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-xs text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-400/15">
              <span className="text-cyan-300">Feature</span><span className="max-w-[200px] truncate">{activeProjectFeatures.find((feature) => feature.id === filters.featureId)?.title || filters.featureId}</span>
              <span className="ml-0.5 rounded-full bg-cyan-300/15 p-0.5"><X className="h-3 w-3" /></span>
            </button>}
            <button type="button" onClick={() => setFilters({ search: '', featureId: 'All', priority: 'All', status: 'All', tag: '' })}
              className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-100">
              Clear all
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-auto">
        {viewMode === 'cockpit' ? (
          <Suspense fallback={<p role="status">Loading cockpit...</p>}>
            <CockpitView key={`${activeProjectId}:${releaseRefresh}`} scopeId={activeProjectId} projects={projects}
              onOpenTicket={handleOpenCockpitTask}
              onOpenRelease={(release) => {
                setFocusReleaseId(release.id);
                setViewMode('releases');
              }} />
          </Suspense>
        ) : viewMode === 'board' ? (
          <Suspense fallback={<p role="status">Loading board view...</p>}>
            <KanbanBoard
              tasks={activeProjectTasks}
              features={activeProjectFeatures}
              projects={allProjects ? projects : undefined}
              filters={filters}
              onMoveTask={handleMoveTask}
              onMoveFeature={handleMoveFeature}
              onReviewValidated={() => { board.reload(); projectsState.reload(); setReleaseRefresh((value) => value + 1); }}
              onDeleteTask={handleDeleteTask}
              onEditTask={handleEditTask}
              onAddTask={handleOpenNewTask}
            />
          </Suspense>
        ) : viewMode === 'sessions' ? (
          <Suspense fallback={<p role="status">Loading sessions view…</p>}>
            <SessionsView key={`${activeProjectId}:${releaseRefresh}`} initialProjectId={activeProjectId} />
          </Suspense>
        ) : viewMode === 'delivery-history' ? (
          <Suspense fallback={<p role="status">Loading delivery history...</p>}>
            <DeliveryHistoryView key={`${activeProjectId}:${releaseRefresh}`} scopeId={activeProjectId} projects={projects}
              onOpenTicket={handleOpenCockpitTask} />
          </Suspense>
        ) : viewMode === 'activity' ? (
          <Suspense fallback={<p role="status">Loading activity...</p>}>
            <ActivityView key={`${activeProjectId}:${releaseRefresh}`} scopeId={activeProjectId} projects={projects} />
          </Suspense>
        ) : viewMode === 'wiki' && wikiProject ? (
          <Suspense fallback={<p role="status">Loading wiki...</p>}>
            <WikiView key={wikiProject.id} project={wikiProject} />
          </Suspense>
        ) : viewMode === 'releases' ? (
          <Suspense fallback={<p role="status">Loading releases...</p>}>
            <ReleasesView key={activeProjectId} projectId={activeProjectId} projects={projects} onOpenTask={handleEditTask} refreshKey={releaseRefresh} focusReleaseId={focusReleaseId} />
          </Suspense>
        ) : viewMode === 'git' ? (
          <Suspense fallback={<p role="status">Loading Git inventory...</p>}>
            <GitView key={`${activeProjectId}:${releaseRefresh}`} projectId={activeProjectId} openingTicket={false} ticketError={gitOpenError} onOpenTask={(projectId, taskId) => {
              setGitOpenError('');
              if (!projects.some((project) => project.id === projectId)) {
                setGitOpenError('This project is no longer loaded. Refresh the application.'); return;
              }
              openTaskEditor(projectId, { taskId });
            }} />
          </Suspense>
        ) : (
          <VelocityDashboard
            tasks={activeProjectTasks}
            features={activeProjectFeatures}
            activeFeatureId={filters.featureId}
            onSelectFeature={(id) => handleFilterChange({ featureId: id })}
            onOpenAdvisorModal={() => setIsAdvisorModalOpen(true)}
          />
        )}
      </main>

      {projectAction && <div role="dialog" aria-modal="true" aria-labelledby="choose-project-title"
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
        <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-5">
          <h2 id="choose-project-title" className="text-lg font-semibold">Choose a project</h2>
          <p className="text-sm text-slate-400">New tickets and features must belong to a project. Select it to continue.</p>
          <div className="max-h-72 space-y-2 overflow-y-auto">{projects.map((project) =>
            <button type="button" key={project.id} className="w-full rounded bg-slate-800 px-3 py-2 text-left hover:bg-indigo-700"
              onClick={() => {
                handleSelectProject(project.id);
                if (projectAction.kind === 'task') {
                  openTaskEditor(project.id, { status: projectAction.status });
                } else if (projectAction.kind === 'feature') setIsNewFeatureModalOpen(true);
                else { setBreakdownFeatureId(undefined); setIsBreakdownModalOpen(true); }
                setProjectAction(null);
              }}>{project.name}</button>)}</div>
          <button type="button" className="text-sm text-slate-400 underline" onClick={() => setProjectAction(null)}>Cancel</button>
        </div>
      </div>}

      <FeatureBreakdownModal
        isOpen={isBreakdownModalOpen}
        onClose={() => setIsBreakdownModalOpen(false)}
        features={activeProjectFeatures}
        initialFeatureId={breakdownFeatureId}
        onApplyBreakdown={handleApplyBreakdown}
      />

      <WorkflowAdvisorModal
        isOpen={isAdvisorModalOpen}
        onClose={() => setIsAdvisorModalOpen(false)}
        tasks={activeProjectTasks}
      />

      <NewFeatureModal
        isOpen={isNewFeatureModalOpen}
        onClose={() => setIsNewFeatureModalOpen(false)}
        onSave={handleSaveNewFeature}
      />

      <ProjectManagerModal
        isOpen={isProjectManagerModalOpen}
        onClose={() => setIsProjectManagerModalOpen(false)}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
        onCreateProject={handleCreateProject}
        onUpdateProject={(project) => { void handleUpdateProject(project); }}
        onSwitchBranch={handleSwitchBranch}
        onDeleteProject={(id) => { void handleDeleteProject(id); }}
      />
    </div>
  );
}
