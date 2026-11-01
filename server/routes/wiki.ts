import { Router } from 'express';
import { z } from 'zod';
import { docSaveInputSchema, wikiAssistantInputSchema, wikiAssistantResultSchema } from '../../src/types/wiki';
import { EntityError } from '../db/entityStore';
import { RepositoryError } from '../git/repositoryService';
import type { DocsService } from '../wiki/docsService';
import { checkDocPath } from '../wiki/docsService';
import type { WikiGenerator } from '../wiki/wikiAssistant';

export function createWikiRouter(docs: DocsService, assistant?: WikiGenerator) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.post('/projects/:projectId/wiki/assistant', async (req, res, next) => {
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', abort);
    try {
      if (!assistant) throw new RepositoryError(503, 'The wiki assistant is not configured.');
      const input = wikiAssistantInputSchema.parse(req.body);
      checkDocPath(input.path);
      await docs.list(req.params.projectId);
      const proposal = wikiAssistantResultSchema.parse(await assistant.generate(input, controller.signal));
      if (!controller.signal.aborted) res.json(proposal);
    } catch (error) { if (!controller.signal.aborted) next(error); }
    finally { res.off('close', abort); }
  });
  router.get('/projects/:projectId/wiki', async (req, res, next) => {
    try { res.json(await docs.list(req.params.projectId)); } catch (error) { next(error); }
  });
  router.get('/projects/:projectId/wiki/file', async (req, res, next) => {
    try { res.json(await docs.read(req.params.projectId, z.string().parse(req.query.path))); } catch (error) { next(error); }
  });
  router.get('/projects/:projectId/wiki/status', async (req, res, next) => {
    try { res.json(await docs.status(req.params.projectId)); } catch (error) { next(error); }
  });
  router.post('/projects/:projectId/wiki/sync', async (req, res, next) => {
    try { res.json(await docs.sync(req.params.projectId)); } catch (error) { next(error); }
  });
  router.put('/projects/:projectId/wiki/file', async (req, res, next) => {
    try {
      const { path, content, expectedSha } = docSaveInputSchema.parse(req.body);
      res.json(await docs.save(req.params.projectId, path, content, expectedSha));
    } catch (error) { next(error); }
  });
  router.use((error: unknown, _req: import('express').Request, res: import('express').Response, _next: import('express').NextFunction) => {
    if (error instanceof EntityError || error instanceof RepositoryError) res.status(error.status).json({ error: error.message });
    else if (error instanceof z.ZodError) res.status(400).json({ error: error.issues.map((issue) => issue.message).join(' ') });
    else {
      console.error('Wiki request failed:', error);
      res.status(500).json({ error: 'Unable to access the project documentation' });
    }
  });
  return router;
}
