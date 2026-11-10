import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { workflowDocumentSchema, workflowScopeSchema } from '../../shared/types/workflowEditor';
import type { WorkflowEditorStore } from '../db/workflowEditorStore';
import { RepositoryError } from '../git/repositoryService';

const revisionSchema = z.object({ revision: z.number().int().nonnegative() });

export function createWorkflowEditorRouter(store: WorkflowEditorStore) {
  const router = Router();
  router.use('/workflow-editor', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const handle = (action: (req: Request) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try { res.json(await action(req)); } catch (error) { next(error); }
  };
  router.get('/workflow-editor/:scope', handle((req) => store.get(workflowScopeSchema.parse(req.params.scope))));
  router.get('/workflow-editor/:scope/current-orchestration', handle((req) => store.currentOrchestration(workflowScopeSchema.parse(req.params.scope))));
  router.get('/workflow-editor/:scope/base', handle((req) => store.base(workflowScopeSchema.parse(req.params.scope))));
  router.put('/workflow-editor/:scope', handle((req) => {
    const { revision, document } = revisionSchema.extend({ document: workflowDocumentSchema }).parse(req.body);
    return store.save(workflowScopeSchema.parse(req.params.scope), revision, document);
  }));
  router.post('/workflow-editor/:scope/publish', handle((req) => {
    const { revision } = revisionSchema.parse(req.body);
    return store.publish(workflowScopeSchema.parse(req.params.scope), revision);
  }));
  router.post('/workflow-editor/:scope/select', handle((req) => {
    const { revision, versionId } = revisionSchema.extend({ versionId: z.string().uuid() }).parse(req.body);
    return store.select(workflowScopeSchema.parse(req.params.scope), revision, versionId);
  }));
  router.post('/workflow-editor/:scope/activate', handle((req) => {
    const { revision, versionId } = revisionSchema.extend({ versionId: z.string().uuid().nullable() }).parse(req.body);
    return store.activate(workflowScopeSchema.parse(req.params.scope), revision, versionId);
  }));
  router.post('/workflow-editor/:scope/resolve', handle((req) => {
    const { versionId } = z.object({ versionId: z.string().uuid().optional() }).parse(req.body);
    return store.resolve(workflowScopeSchema.parse(req.params.scope), versionId);
  }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof RepositoryError) res.status(error.status).json({ error: error.message });
    else if (error instanceof z.ZodError) res.status(400).json({ error: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
    else {
      console.error('Workflow editor request failed:', error);
      res.status(500).json({ error: 'Unable to load or save workflow configuration.' });
    }
  });
  return router;
}
