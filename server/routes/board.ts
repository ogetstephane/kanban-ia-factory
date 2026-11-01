import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  boardDataSchema, projectSchema, featureSchema, taskSchema, revisionSchema, switchBranchSchema,
  moveTaskSchema, breakdownSchema, createProjectSchema, repositoryInputSchema, DEFAULT_DOCS_PATH,
} from '../../src/types/board';
import { INITIAL_PROJECTS, INITIAL_FEATURES, INITIAL_TASKS } from '../../src/data/initialData';
import { BoardStore } from '../db/boardStore';
import { EntityError, EntityStore } from '../db/entityStore';
import { RepositoryError, RepositoryService } from '../git/repositoryService';
import path from 'node:path';
import { gitInventorySchema } from '../../src/types/git';

export function createBoardRouter(store: BoardStore, entities: EntityStore, repositories: RepositoryService) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const handle = (operation: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      const result = await operation(req);
      if (result === undefined) res.status(204).end();
      else res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid entity data', issues: error.issues });
      } else if (error instanceof EntityError || error instanceof RepositoryError) {
        res.status(error.status).json({ error: error.message });
      } else if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2025', 'P2034'].includes(error.code)) {
        res.status(409).json({ error: 'This entity changed or already exists. Reload it before retrying.' });
      } else {
        console.error('Entity persistence failed:', error);
        res.status(500).json({ error: 'Unable to access the database. Your changes have not been saved.' });
      }
    }
  };

  router.get('/projects', handle(() => entities.projects()));
  router.get('/board', handle(() => entities.board()));
  router.get('/repositories/inventory', handle(async (req) => {
    const projectId = z.string().min(1).optional().parse(req.query.projectId);
    const projects = await entities.gitProjects(projectId);
    const result = [];
    for (const project of projects) {
      const base = {
        id: project.id, name: project.name, url: project.repositoryUrl!, configuredBranch: project.repositoryBranch,
        clonePath: repositories.pathFor(project.id),
      };
      try {
        const inventory = await repositories.inventory(project.id);
        result.push({ ...base, ...inventory, error: null, worktrees: inventory.worktrees.map((worktree) => {
          const task = worktree.main ? undefined : project.tasks.find((task) =>
            (task.agentSession?.workspace && path.resolve(task.agentSession.workspace) === path.resolve(worktree.path)) ||
            (worktree.branch !== null && task.agentSession?.branch === worktree.branch));
          return { ...worktree, task: task ? {
            id: task.id, title: task.title, status: task.status, sessionStatus: task.agentSession!.status,
          } : null };
        }) });
      } catch (error) {
        if (!(error instanceof RepositoryError)) throw error;
        console.error(`Unable to inventory repository ${project.id}:`, error);
        result.push({ ...base, branch: null, head: null, worktrees: [], error: error.message });
      }
    }
    return gitInventorySchema.parse({ projects: result });
  }));
  router.post('/initialize', handle(async (req) => {
    await store.initialize(boardDataSchema.parse(req.body));
    return { initialized: true };
  }));
  router.post('/reset', handle(async () => {
    const result = await store.reset({ projects: INITIAL_PROJECTS, features: INITIAL_FEATURES, tasks: INITIAL_TASKS });
    await repositories.removeAllExcept(INITIAL_PROJECTS.map((project) => project.id))
      .catch((error: unknown) => console.error('Unable to remove workspaces after reset:', error));
    return result;
  }));
  router.post('/repositories/branches', handle((req) => {
    const { url, token } = repositoryInputSchema.parse(req.body);
    return repositories.branches({ url, token });
  }));
  router.get('/repositories/local', handle(async () => ({
    enabled: repositories.localRoots.length > 0,
    folders: await repositories.localRepositories(),
  })));
  router.get('/projects/:id/board', handle((req) => entities.board(req.params.id)));
  router.post('/projects', handle(async (req) => {
    const {
      repository, repositoryUrl: _url, repositoryBranch: _branch, repositoryCommit: _commit, ...project
    } = createProjectSchema.parse(req.body);
    if (!repository) return entities.createProject({ ...project, docsPath: undefined });
    const cloned = await repositories.clone(project.id, repository, project.name);
    try {
      return await entities.createProject({
        ...project, docsPath: project.docsPath ?? DEFAULT_DOCS_PATH, repositoryUrl: cloned.url, repositoryBranch: cloned.branch, repositoryCommit: cloned.commit,
      });
    } catch (error) {
      await repositories.remove(project.id);
      throw error;
    }
  }));
  router.put('/projects/:id', handle((req) => {
    const project = projectSchema.parse(req.body);
    if (project.id !== req.params.id) throw new EntityError(400, 'Project ID mismatch');
    return entities.updateProject(project);
  }));
  router.get('/projects/:id/branches', handle(async (req) => {
    await entities.project(req.params.id);
    return repositories.workspaceBranches(req.params.id);
  }));
  router.put('/projects/:id/branch', handle(async (req) => {
    const { branch, revision } = switchBranchSchema.parse(req.body);
    const project = await entities.checkedProject(req.params.id, revision);
    if (!project.repositoryUrl) throw new EntityError(400, 'This project has no git repository');
    await repositories.switchBranch(project.id, branch, (switched) =>
      entities.setProjectBranch(project.id, revision, switched.branch, switched.commit));
    return entities.project(project.id);
  }));
  router.delete('/projects/:id', handle(async (req) => {
    await entities.deleteProject(req.params.id, revisionSchema.parse(req.body).revision);
    await repositories.remove(req.params.id)
      .catch((error: unknown) => console.error(`Unable to remove workspace of ${req.params.id}:`, error));
  }));
  router.post('/features', handle((req) => entities.createFeature(featureSchema.parse(req.body))));
  router.put('/features/:id', handle((req) => {
    const feature = featureSchema.parse(req.body);
    if (feature.id !== req.params.id) throw new EntityError(400, 'Feature ID mismatch');
    return entities.updateFeature(feature);
  }));
  router.delete('/features/:id', handle((req) => entities.deleteFeature(req.params.id, revisionSchema.parse(req.body).revision)));
  router.post('/tasks', handle((req) => entities.createTask(taskSchema.parse(req.body))));
  router.put('/tasks/:id', handle((req) => {
    const task = taskSchema.parse(req.body);
    if (task.id !== req.params.id) throw new EntityError(400, 'Task ID mismatch');
    return entities.updateTask(task);
  }));
  router.delete('/tasks/:id', handle((req) => entities.deleteTask(req.params.id, revisionSchema.parse(req.body).revision)));
  router.post('/tasks/:id/move', handle((req) => entities.moveTask(req.params.id, moveTaskSchema.parse(req.body))));
  router.post('/breakdown', handle((req) => entities.breakdown(breakdownSchema.parse(req.body))));
  return router;
}
