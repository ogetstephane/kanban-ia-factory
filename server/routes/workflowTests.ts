import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { workflowScopeSchema } from '../../shared/types/workflowEditor';
import { workflowTestLaunchSchema } from '../../shared/types/workflowTestRun';
import type { WorkflowTestService } from '../agents/workflowTestService';
import { RepositoryError } from '../git/repositoryService';

export function createWorkflowTestRouter(service: WorkflowTestService) {
  const router = Router();
  const root = '/workflow-editor/:scope/test-runs';
  router.use('/workflow-editor/:scope/test-runs', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const handle = (action: (req: Request) => unknown | Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try { res.json(await action(req)); } catch (error) { next(error); }
  };
  const scope = (req: Request) => workflowScopeSchema.parse(req.params.scope);
  const id = (req: Request) => z.string().uuid().parse(req.params.id);
  const revision = z.object({ revision: z.number().int().nonnegative() });
  router.get(`${root}/options`, handle((req) => { scope(req); return service.options(); }));
  router.get(root, handle((req) => service.list(scope(req))));
  router.post(root, handle((req) => service.launch(scope(req), workflowTestLaunchSchema.parse(req.body))));
  router.get(`${root}/:id`, handle((req) => service.get(scope(req), id(req))));
  router.post(`${root}/:id/approve`, handle((req) => {
    const body = revision.extend({ nodeId: z.string().min(1) }).strict().parse(req.body);
    return service.approve(scope(req), id(req), body.revision, body.nodeId);
  }));
  router.post(`${root}/:id/cancel`, handle((req) => service.cancel(scope(req), id(req), revision.strict().parse(req.body).revision)));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof RepositoryError) res.status(error.status).json({ error: error.message });
    else if (error instanceof z.ZodError) res.status(400).json({ error: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
    else { console.error('Workflow test request failed:', error); res.status(500).json({ error: 'Unable to load or execute workflow test.' }); }
  });
  return router;
}
