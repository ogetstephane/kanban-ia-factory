import { useEffect } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { TaskModal } from './TaskModal';
import { useBoard } from '../data/useBoard';
import { useProjects } from '../data/useProjects';
import { useOperation } from '../data/useOperation';
import { sessionActionFocusSchema } from '../types/agent';
import { canCreateTaskIn, KANBAN_STATUSES } from '../utils/kanbanLogic';
import { taskReturnPath } from '../utils/routes';

export default function TaskPage() {
  const { projectId = '', taskId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnPath = taskReturnPath(projectId, location.state);
  const [query] = useSearchParams();
  const projects = useProjects();
  const project = projects.projects.find((item) => item.id === projectId);
  const board = useBoard(projects.ready && project ? projectId : '');
  const operation = useOperation();
  const task = taskId ? board.tasks.find((item) => item.id === taskId) : null;
  const status = KANBAN_STATUSES.find((item) => item === query.get('status'));
  const action = sessionActionFocusSchema.safeParse(query.get('action'));

  useEffect(() => {
    const previousTitle = document.title;
    document.title = taskId ? 'Edit task - Kanban Flow' : 'New task - Kanban Flow';
    return () => { document.title = previousTitle; };
  }, [taskId]);

  const close = () => navigate(returnPath, { replace: true });

  const error = projects.error || board.error;
  const queryError = query.has('status') && !status ? 'Unknown task status in the URL.'
    : query.has('action') && !action.success ? 'Unknown session action in the URL.'
    : board.ready && query.has('featureId') && !board.features.some((item) => item.id === query.get('featureId'))
      ? 'This feature does not exist in this project.' : '';
  return <main className="min-h-screen min-w-0 bg-slate-950 p-4 text-slate-100">
    <header className="mb-4 flex w-full min-w-0 items-center justify-between gap-4">
      <span>{project?.name ?? 'Task editor'}</span>
      <Link to={returnPath} replace className="text-indigo-300 underline">Back to workspace</Link>
    </header>
    {error ? <div role="alert">{error}<button className="ml-4 underline" onClick={() => { projects.reload(); board.reload(); }}>Retry</button></div>
      : !projects.ready ? <p role="status">Loading projects...</p>
      : !project ? <p role="alert">This project does not exist.</p>
      : board.loading ? <p role="status">Loading task editor...</p>
      : queryError ? <p role="alert">{queryError}</p>
      : taskId && !task ? <p role="alert">This task no longer exists in this project.</p>
      : <TaskModal
        isOpen
        presentation="page"
        task={task ?? null}
        projectId={projectId}
        features={board.features}
        defaultStatus={status && canCreateTaskIn(status) ? status : 'To Do'}
        defaultFeatureId={query.get('featureId') ?? undefined}
        sessionAction={action.success ? action.data : undefined}
        pending={operation.pending}
        error={operation.error}
        onClose={close}
        onSave={(draft) => operation.run(async () => {
          await board.saveTask({ ...draft, projectId, revision: task?.revision ?? 0 }, !taskId);
        })}
      />}
  </main>;
}
