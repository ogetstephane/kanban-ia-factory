import { Router } from 'express';
import { z } from 'zod';
import { EntityError } from '../db/entityStore';
import { ActivityService } from '../db/activityService';

export function createActivityRouter(activity: ActivityService) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/activity-events', async (req, res, next) => {
    try { res.json(await activity.list(req.query)); } catch (error) { next(error); }
  });
  router.get('/activity-events/:entityType/:entityId', async (req, res, next) => {
    try { res.json(await activity.history(req.params.entityType, req.params.entityId, req.query.page)); } catch (error) { next(error); }
  });
  router.use((error: unknown, _req: import('express').Request, res: import('express').Response, _next: import('express').NextFunction) => {
    if (error instanceof EntityError) res.status(error.status).json({ error: error.message });
    else if (error instanceof z.ZodError) res.status(400).json({ error: 'Invalid activity history request' });
    else {
      console.error('Activity history request failed:', error);
      res.status(500).json({ error: 'Unable to load activity history' });
    }
  });
  return router;
}
