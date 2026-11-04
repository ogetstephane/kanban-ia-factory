import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { releaseEditSchema, releaseUpdateSchema, releasePublishSchema } from '../../shared/types/release';
import { EntityError } from '../db/entityStore';
import { RepositoryError } from '../git/repositoryService';
import type { ReleaseService } from '../releases/releaseService';

export function createReleaseRouter(releases: ReleaseService) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/releases', async (_req, res, next) => {
    try { res.json(await releases.list()); } catch (error) { next(error); }
  });
  router.get('/projects/:projectId/releases', async (req, res, next) => {
    try { res.json(await releases.list(req.params.projectId)); } catch (error) { next(error); }
  });
  router.post('/projects/:projectId/releases', async (req, res, next) => {
    try { res.json(await releases.create(req.params.projectId, releaseEditSchema.parse(req.body))); } catch (error) { next(error); }
  });
  router.get('/projects/:projectId/releases/:id', async (req, res, next) => {
    try { res.json(await releases.detail(req.params.projectId, req.params.id)); } catch (error) { next(error); }
  });
  router.put('/projects/:projectId/releases/:id', async (req, res, next) => {
    try { res.json(await releases.update(req.params.projectId, req.params.id, releaseUpdateSchema.parse(req.body))); } catch (error) { next(error); }
  });
  router.get('/projects/:projectId/releases/:id/preview', async (req, res, next) => {
    try { res.json(await releases.preview(req.params.projectId, req.params.id)); } catch (error) { next(error); }
  });
  router.post('/projects/:projectId/releases/:id/publish', async (req, res, next) => {
    try { res.json(await releases.publish(req.params.projectId, req.params.id, releasePublishSchema.parse(req.body))); } catch (error) { next(error); }
  });
  router.put('/projects/:projectId/tasks/:id/release', async (req, res, next) => {
    try {
      const { releaseId, revision } = z.object({ releaseId: z.string().min(1).nullable(), revision: z.number().int().nonnegative() }).parse(req.body);
      res.json(await releases.assign(req.params.projectId, req.params.id, releaseId, revision));
    } catch (error) { next(error); }
  });
  router.use((error: unknown, _req: import('express').Request, res: import('express').Response, _next: import('express').NextFunction) => {
    if (error instanceof EntityError || error instanceof RepositoryError) res.status(error.status).json({ error: error.message });
    else if (error instanceof z.ZodError) res.status(400).json({ error: 'Invalid release request', issues: error.issues });
    else if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2025', 'P2034'].includes(error.code)) res.status(409).json({ error: 'The release version already exists or changed. Reload before retrying.' });
    else {
      console.error('Release request failed:', error);
      res.status(500).json({ error: 'Unable to access the release. Reload its status before retrying publication.' });
    }
  });
  return router;
}
