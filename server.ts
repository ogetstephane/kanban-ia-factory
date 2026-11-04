import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { RepositoryService } from './server/git/repositoryService';
import { CopilotProvider } from './server/agents/copilotProvider';
import { CodeGraph } from './server/agents/codeGraph';
import { WikiAssistant } from './server/wiki/wikiAssistant';
import { TaskAssistant } from './server/agents/taskAssistant';
import { createApp } from './server/app';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

const db = new PrismaClient();
const localRepositoryRoots = (process.env.LOCAL_REPOSITORY_ROOTS ?? '')
  .split(',').map((root) => root.trim()).filter(Boolean).map((root) => path.resolve(root));
const repositories = new RepositoryService(path.resolve(process.env.WORKSPACES_DIR || 'workspaces'), {
  localRoots: localRepositoryRoots,
});
const codeGraph = CodeGraph.fromEnv();

// Initialize Gemini SDK with User-Agent header as required
const apiKey = process.env.GEMINI_API_KEY;
const isValidKey = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim().length > 10);

let gemini: GoogleGenAI | null = null;
if (isValidKey && apiKey) {
  gemini = new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const { app, sessions, releases } = createApp({
  db,
  repositories,
  agentProvider: new CopilotProvider(codeGraph),
  codeGraph,
  archifyDir: path.resolve(process.env.ARCHIFY_DIR || 'doc/archify'),
  wikiAssistant: new WikiAssistant(),
  taskAssistant: new TaskAssistant(codeGraph),
  gemini,
});

// Vite Middleware for development, or static build for production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const listener = createHttpServer(app);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: process.env.DISABLE_HMR === 'true' ? false : { server: listener },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  await repositories.workspaces.init();
  await new Promise<void>((resolve, reject) => {
    listener.once('listening', resolve);
    listener.once('error', reject);
    listener.listen(PORT);
  });
  try {
    await releases.recover();
    await sessions.start();
  } catch (error) {
    listener.close();
    throw error;
  }
  console.log(`Kanban Flow Copilot server running on port ${PORT}`);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    listener.close();
    await sessions.stop();
    await releases.stop();
    await db.$disconnect();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown().catch((error: unknown) => {
        console.error('Server shutdown failed:', error);
        process.exit(1);
      });
    });
  }
}

startServer().catch(async (error) => {
  console.error('Server startup failed:', error);
  await db.$disconnect();
  process.exitCode = 1;
});
