import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { taskDraftInputSchema, taskDraftResultSchema } from '../../shared/types/taskDraft';
import { EntityError, type EntityStore } from '../db/entityStore';
import { RepositoryError } from '../git/repositoryService';
import type { WorkspaceService } from '../git/workspaceService';
import type { TaskGenerator } from '../agents/taskAssistant';

export function createTaskAssistantRouter(
  projects: Pick<EntityStore, 'project'>,
  workspaces: Pick<WorkspaceService, 'docsWorkspace'>,
  assistant?: TaskGenerator,
) {
  const router = Router();
  router.post('/projects/:projectId/tasks/assistant', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', abort);
    try {
      if (!assistant) throw new RepositoryError(503, 'The task assistant is not configured.');
      const input = taskDraftInputSchema.parse(req.body);
      const project = await projects.project(req.params.projectId);
      const workspace = project.repositoryUrl ? (await workspaces.docsWorkspace(project.id)).cwd : undefined;
      controller.signal.throwIfAborted();
      const proposal = taskDraftResultSchema.parse(await assistant.generate({
        input, project: { id: project.id, name: project.name, description: project.description },
        workspace, signal: controller.signal,
      }));
      if (!controller.signal.aborted) res.json(proposal);
    } catch (error) { if (!controller.signal.aborted) next(error); }
    finally { res.off('close', abort); }
  });
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof EntityError || error instanceof RepositoryError) res.status(error.status).json({ error: error.message });
    else if (error instanceof z.ZodError) res.status(400).json({ error: error.issues.map((issue) => issue.message).join(' ') });
    else {
      console.error('Task assistant request failed:', error);
      res.status(500).json({ error: 'Unable to generate the task specification' });
    }
  });
  return router;
}
