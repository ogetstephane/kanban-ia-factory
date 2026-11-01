import { Router } from 'express';
import { z } from 'zod';
import { EntityError } from '../db/entityStore';
import type { SessionService } from '../agents/sessionService';
import { agentListQuerySchema, deliveryHistoryQuerySchema, deliveryRequestSchema, publicationRequestSchema } from '../../src/types/agent';
import { RepositoryError } from '../git/repositoryService';
import { finishRequestSchema } from '../../src/types/git';

export function createAgentRouter(sessions: SessionService) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  for (const kind of ['tasks', 'features'] as const) {
    router.get(`/${kind}/:id/finish`, async (req, res, next) => {
      try { res.json(await sessions.finish.preview(kind, req.params.id)); } catch (error) { next(error); }
    });
    router.post(`/${kind}/:id/finish`, async (req, res, next) => {
      try { res.json(await sessions.finish.execute(kind, req.params.id, finishRequestSchema.parse(req.body))); }
      catch (error) { next(error); }
    });
    router.get(`/${kind}/:id/review-publication`, async (req, res, next) => {
      try { res.json(await sessions.publication.preview(kind, req.params.id)); } catch (error) { next(error); }
    });
    router.post(`/${kind}/:id/review-publication`, async (req, res, next) => {
      try { res.json(await sessions.publication.execute(kind, req.params.id, publicationRequestSchema.parse(req.body))); }
      catch (error) { next(error); }
    });
  }
  router.get('/projects/:id/published-work', async (req, res, next) => {
    try { res.json(await sessions.finish.list(req.params.id)); } catch (error) { next(error); }
  });
  router.get('/agent-sessions', async (req, res, next) => {
    try { res.json(await sessions.list(agentListQuerySchema.parse(req.query))); } catch (error) { next(error); }
  });
  router.get('/agent-workflows', async (req, res, next) => {
    try {
      const { projectId } = z.object({ projectId: z.string().min(1).optional() }).parse(req.query);
      res.json(await sessions.workflows(projectId));
    } catch (error) { next(error); }
  });
  router.get('/delivery-history', async (req, res, next) => {
    try { res.json(await sessions.deliveryHistory(deliveryHistoryQuerySchema.parse(req.query))); } catch (error) { next(error); }
  });
  router.get('/tasks/:id/session', async (req, res, next) => {
    try { res.json(await sessions.get(req.params.id)); } catch (error) { next(error); }
  });
  router.get('/projects/:id/health', async (req, res, next) => {
    try { res.json(await sessions.health(req.params.id)); } catch (error) { next(error); }
  });
  router.get('/tasks/:id/session/review', async (req, res, next) => {
    try {
      const { path } = z.object({ path: z.string().min(1).max(2000).optional() }).parse(req.query);
      res.json(await sessions.review(req.params.id, path));
    } catch (error) { next(error); }
  });
  router.post('/tasks/:id/session/ai-review', async (req, res, next) => {
    try {
      const { token } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(req.body);
      res.json(await sessions.aiReview(req.params.id, token));
    } catch (error) { next(error); }
  });
  router.get('/tasks/:id/session/history', async (req, res, next) => {
    try { res.json(await sessions.history(req.params.id)); } catch (error) { next(error); }
  });
  router.get('/tasks/:id/session/delivery', async (req, res, next) => {
    try { res.json(await sessions.delivery.preview(req.params.id)); } catch (error) { next(error); }
  });
  for (const action of ['commit', 'merge'] as const) {
    router.post(`/tasks/:id/session/delivery/${action}`, async (req, res, next) => {
      try { res.json(await sessions.delivery.execute(req.params.id, action, deliveryRequestSchema.parse(req.body))); }
      catch (error) { next(error); }
    });
  }
  router.post('/tasks/:id/session/accept-review', async (req, res, next) => {
    try {
      const { sessionId, updatedAt, token } = z.object({
        sessionId: z.string().uuid(), updatedAt: z.string().datetime(), token: z.string().regex(/^[a-f0-9]{64}$/),
      }).parse(req.body);
      res.json(await sessions.acceptReview(req.params.id, sessionId, updatedAt, token));
    } catch (error) { next(error); }
  });
  router.post('/tasks/:id/session/feedback', async (req, res, next) => {
    try {
      const { sessionId, feedback, updatedAt } = z.object({
        sessionId: z.string().uuid(), feedback: z.string().trim().min(1).max(20_000), updatedAt: z.string().datetime(),
      }).parse(req.body);
      res.json(await sessions.retry(req.params.id, sessionId, feedback, updatedAt));
    } catch (error) { next(error); }
  });
  router.post('/tasks/:id/session/cleanup', async (req, res, next) => {
    try {
      const { sessionId, updatedAt } = z.object({ sessionId: z.string().uuid(), updatedAt: z.string().datetime() }).parse(req.body);
      res.json(await sessions.cleanup(req.params.id, sessionId, updatedAt));
    } catch (error) { next(error); }
  });
  router.post('/tasks/:id/session/cancel', async (req, res, next) => {
    try {
      const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(req.body);
      res.json(await sessions.cancel(req.params.id, sessionId));
    } catch (error) { next(error); }
  });
  for (const action of ['approve', 'retry'] as const) {
    router.post(`/tasks/:id/session/${action}`, async (req, res, next) => {
      try {
        const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(req.body);
        if (action === 'approve') {
          const { updatedAt } = z.object({ updatedAt: z.string().datetime() }).parse(req.body);
          res.json(await sessions.approve(req.params.id, sessionId, updatedAt));
        } else {
          const { updatedAt } = z.object({ updatedAt: z.string().datetime() }).parse(req.body);
          res.json(await sessions.retry(req.params.id, sessionId, undefined, updatedAt));
        }
      } catch (error) { next(error); }
    });
  }
  router.post('/tasks/:id/session/answer', async (req, res, next) => {
    try {
      const { sessionId, questionId, answer } = z.object({
        sessionId: z.string().uuid(), questionId: z.string().uuid(), answer: z.string().trim().min(1).max(20_000),
      }).parse(req.body);
      res.json(await sessions.answer(req.params.id, sessionId, questionId, answer));
    } catch (error) { next(error); }
  });
  router.use((error: unknown, _req: import('express').Request, res: import('express').Response, _next: import('express').NextFunction) => {
    if (error instanceof EntityError || error instanceof RepositoryError) res.status(error.status).json({ error: error.message });
    else if (error instanceof z.ZodError) res.status(400).json({ error: 'Invalid session request' });
    else {
      console.error('Agent session request failed:', error);
      res.status(500).json({ error: 'Unable to access the agent session' });
    }
  });
  return router;
}
