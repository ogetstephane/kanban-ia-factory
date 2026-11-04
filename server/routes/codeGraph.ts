import { Router, type NextFunction, type Request, type Response } from 'express';
import { EntityError } from '../db/entityStore';
import { RepositoryError } from '../git/repositoryService';
import type { CodeGraph } from '../agents/codeGraph';

/** Resolves a project's main clone folder, or throws a 404 EntityError/RepositoryError. */
export type ProjectClone = (projectId: string) => Promise<string>;

// The Graphify page is generated from repository symbol names; it runs in an opaque-origin
// sandboxed iframe and may only load its pinned (SRI) vis-network script.
const VIEW_POLICY = [
  "default-src 'none'", "script-src 'unsafe-inline' https://unpkg.com", "style-src 'unsafe-inline'",
  'img-src data:', "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-ancestors 'self'", 'sandbox allow-scripts',
].join('; ');

export function createCodeGraphRouter(graph: CodeGraph, clone: ProjectClone) {
  const router = Router();
  router.use('/projects/:projectId/code-graph', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  const snapshot = (rebuild: boolean) => async (req: Request, res: Response, next: NextFunction) => {
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', abort);
    try {
      const cwd = await clone(req.params.projectId);
      const result = await graph.snapshot(cwd, { rebuild, signal: controller.signal });
      if (!controller.signal.aborted) res.json(result);
    } catch (error) { if (!controller.signal.aborted) next(error); }
    finally { res.off('close', abort); }
  };
  router.get('/projects/:projectId/code-graph', snapshot(false));
  router.post('/projects/:projectId/code-graph/rebuild', snapshot(true));

  router.get('/projects/:projectId/code-graph/view', async (req, res, next) => {
    try {
      const html = await graph.visualization(await clone(req.params.projectId));
      if (!html) throw new RepositoryError(404, 'No code graph visualization is available. Build the graph first.');
      res.setHeader('Content-Security-Policy', VIEW_POLICY);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.type('html').send(html);
    } catch (error) { next(error); }
  });

  router.use('/projects/:projectId/code-graph', (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof EntityError || error instanceof RepositoryError) res.status(error.status).json({ error: error.message });
    else {
      console.error('Code graph request failed:', error);
      res.status(500).json({ error: 'Unable to load the code graph' });
    }
  });
  return router;
}
