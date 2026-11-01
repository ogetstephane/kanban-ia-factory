import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { BoardStore } from './server/db/boardStore';
import { EntityStore } from './server/db/entityStore';
import { createBoardRouter } from './server/routes/board';
import { RepositoryService } from './server/git/repositoryService';
import { CopilotProvider } from './server/agents/copilotProvider';
import { SessionService } from './server/agents/sessionService';
import { createAgentRouter } from './server/routes/agents';
import { ReleaseService } from './server/releases/releaseService';
import { createReleaseRouter } from './server/routes/releases';
import { ActivityService } from './server/db/activityService';
import { createActivityRouter } from './server/routes/activity';
import { createWikiRouter } from './server/routes/wiki';
import { DocsService } from './server/wiki/docsService';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
const db = new PrismaClient();
const localRepositoryRoots = (process.env.LOCAL_REPOSITORY_ROOTS ?? '')
  .split(',').map((root) => root.trim()).filter(Boolean).map((root) => path.resolve(root));
const repositories = new RepositoryService(path.resolve(process.env.WORKSPACES_DIR || 'workspaces'), {
  localRoots: localRepositoryRoots,
});
const agentProvider = new CopilotProvider();
app.use('/api/board', createBoardRouter(new BoardStore(db), new EntityStore(db, agentProvider.id), repositories));
const sessions = new SessionService(db, repositories, agentProvider);
app.use('/api/board', createAgentRouter(sessions));
const releases = new ReleaseService(db, repositories);
app.use('/api/board', createReleaseRouter(releases));
app.use('/api/board', createActivityRouter(new ActivityService(db)));
app.use('/api/board', createWikiRouter(new DocsService(db, repositories)));

// Initialize Gemini SDK with User-Agent header as required
const apiKey = process.env.GEMINI_API_KEY;
const isValidKey = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim().length > 10);

let ai: GoogleGenAI | null = null;
if (isValidKey && apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function callWithTimeout<T>(promise: Promise<T>, timeoutMs = 30000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('AI request timed out, falling back')), timeoutMs)
    ),
  ]);
}

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    hasGeminiKey: isValidKey,
    timestamp: new Date().toISOString(),
  });
});

/**
 * 1. Auto-breakdown a Feature into multiple prioritized Kanban tasks
 */
app.post('/api/copilot/breakdown', async (req: Request, res: Response) => {
  const { featureTitle, featureDescription, category } = req.body;

  if (!featureTitle) {
    return res.status(400).json({ error: 'featureTitle is required' });
  }

  // If Gemini API is available and valid, query gemini-3.8-flash with timeout
  if (ai) {
    try {
      const prompt = `You are a senior technical product manager and agile architect.
Break down the following software feature into 3 to 5 clear, concrete, and prioritized Kanban tasks.
Feature Title: "${featureTitle}"
Feature Description: "${featureDescription || 'Not specified'}"
Feature Category: "${category || 'General'}"

Return ONLY valid raw JSON with this exact schema:
{
  "summary": "Brief summary of the feature breakdown approach",
  "tasks": [
    {
      "title": "Clear actionable task title",
      "description": "Comprehensive task description with context, implementation guidance, and technical notes",
      "priority": "Critical" | "High" | "Medium" | "Low",
      "status": "Backlog" | "To Do" | "In Progress",
      "storyPoints": 1 | 2 | 3 | 5 | 8,
      "tags": ["frontend", "backend", "api", "design", "security"],
      "acceptanceCriteria": [
        "First measurable acceptance criterion",
        "Second measurable acceptance criterion"
      ],
      "subtasks": [
        "Checklist step 1",
        "Checklist step 2",
        "Checklist step 3"
      ],
      "suggestedWorkflow": "Specific tip on review checklist, testing, or dependencies"
    }
  ]
}
Ensure priorities are realistically spread across Critical/High/Medium/Low. Do not wrap in extra markdown if possible.`;

      const response = await callWithTimeout(
        ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.7,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
        30000
      );

      const responseText = response.text || '';
      try {
        const parsed = JSON.parse(responseText);
        return res.json(parsed);
      } catch {
        // Fall back to clean extraction
        const match = responseText.match(/\{[\s\S]*\}/);
        if (match) {
          return res.json(JSON.parse(match[0]));
        }
      }
    } catch (err: any) {
      console.warn('Gemini API call failed, falling back to intelligent template:', err?.message);
    }
  }

  // High quality fallback breakdown if no key or error
  const normalizedTitle = featureTitle.toLowerCase();
  let defaultTasks = [];

  if (normalizedTitle.includes('auth') || normalizedTitle.includes('login') || normalizedTitle.includes('user')) {
    defaultTasks = [
      {
        title: 'Design Authentication Schema & Session Storage',
        description: 'Define database tables or collection schemas for users, password hashes, OAuth tokens, and refresh sessions. Include token expiration and revocation policy.',
        priority: 'Critical',
        status: 'To Do',
        storyPoints: 3,
        tags: ['backend', 'security', 'db'],
        acceptanceCriteria: ['Users table supports email, password_hash, role', 'Sessions table tracks active JWTs / refresh tokens'],
        subtasks: ['Draft DDL schema', 'Add indexes on email and session_token', 'Set up encryption salts'],
        suggestedWorkflow: 'Ensure security lead reviews schema before frontend integration.'
      },
      {
        title: 'Build Login & Registration UI with Form Validation',
        description: 'Develop responsive login/signup modals or pages with client-side validation, password strength indicators, and accessible error messages.',
        priority: 'High',
        status: 'To Do',
        storyPoints: 5,
        tags: ['frontend', 'ui', 'accessibility'],
        acceptanceCriteria: ['WCAG AA accessible form controls', 'Instant validation for email format and password strength', 'Loading spinner on submission'],
        subtasks: ['Implement LoginForm component', 'Implement SignupForm component', 'Add show/hide password toggle'],
        suggestedWorkflow: 'Verify mobile keyboard behavior and autofill attributes.'
      },
      {
        title: 'Integrate Social OAuth Providers (Google & GitHub)',
        description: 'Implement OAuth 2.0 authorization code flow for Google and GitHub authentication, including callback handlers and profile sync.',
        priority: 'Medium',
        status: 'Backlog',
        storyPoints: 5,
        tags: ['backend', 'api', 'oauth'],
        acceptanceCriteria: ['Google OAuth button triggers popup/redirect', 'State param validated against CSRF attacks'],
        subtasks: ['Configure client credentials', 'Implement /api/auth/callback/google', 'Sync user profile avatar'],
        suggestedWorkflow: 'Test callback URL redirection in staging environment.'
      },
      {
        title: 'Auth E2E & Unit Test Coverage',
        description: 'Write end-to-end integration tests verifying login, logout, bad password rejection, and session token renewal.',
        priority: 'High',
        status: 'Backlog',
        storyPoints: 3,
        tags: ['testing', 'qa'],
        acceptanceCriteria: ['100% pass on login/signup matrix', 'Edge case tests for expired tokens'],
        subtasks: ['Write unit tests for token verification', 'Add Playwright journey for happy path login'],
        suggestedWorkflow: 'Run automated tests in CI pipeline before merging to main.'
      }
    ];
  } else {
    defaultTasks = [
      {
        title: `Architecture & Requirements Specification for ${featureTitle}`,
        description: `Outline technical design, data flows, and API contracts required to fulfill the feature: ${featureDescription || featureTitle}.`,
        priority: 'High',
        status: 'To Do',
        storyPoints: 2,
        tags: ['planning', 'architecture'],
        acceptanceCriteria: ['Technical RFC document approved', 'API endpoints defined in OpenAPI or TypeScript interfaces'],
        subtasks: ['Draft architecture diagram', 'Define error handling contracts', 'Identify third-party dependencies'],
        suggestedWorkflow: 'Review with team before writing implementation code.'
      },
      {
        title: `Core Backend & Business Logic for ${featureTitle}`,
        description: `Implement the foundational backend APIs, database mutations, and server logic required for ${featureTitle}.`,
        priority: 'Critical',
        status: 'To Do',
        storyPoints: 5,
        tags: ['backend', 'api'],
        acceptanceCriteria: ['Endpoints tested with valid and invalid payloads', 'Rate limiting and authorization checks enforced'],
        subtasks: ['Create route handlers', 'Write database queries', 'Add input validation with schema parser'],
        suggestedWorkflow: 'Ensure unit tests are written alongside controllers.'
      },
      {
        title: `Frontend Interface & Interactive State for ${featureTitle}`,
        description: `Create modern, accessible UI components with reactive state, loading skeletons, and polished empty/error states for ${featureTitle}.`,
        priority: 'High',
        status: 'Backlog',
        storyPoints: 5,
        tags: ['frontend', 'ui', 'ux'],
        acceptanceCriteria: ['Responsive layout across desktop and mobile', 'Keyboard navigable with clear focus outlines'],
        subtasks: ['Build interactive view components', 'Connect state store or hooks', 'Add optimistic updates'],
        suggestedWorkflow: 'Run screen reader and responsive viewport tests.'
      },
      {
        title: `QA, Edge Case Hardening & Performance Review`,
        description: `Audit edge conditions, latency benchmarks, telemetry, and error logging for ${featureTitle}.`,
        priority: 'Medium',
        status: 'Backlog',
        storyPoints: 3,
        tags: ['qa', 'performance', 'security'],
        acceptanceCriteria: ['Zero regression defects', 'Lighthouse/performance score remains above 90'],
        subtasks: ['Audit error boundaries', 'Check memory and network payloads', 'Verify documentation'],
        suggestedWorkflow: 'Move to Review status once automated test suite passes.'
      }
    ];
  }

  return res.json({
    summary: `Structured breakdown for "${featureTitle}" across development phases.`,
    tasks: defaultTasks
  });
});

/**
 * 2. Auto-generate or Enhance a Task Description & Acceptance Criteria
 */
app.post('/api/copilot/generate-description', async (req: Request, res: Response) => {
  const { title, currentDescription, featureTitle, priority } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Task title is required' });
  }

  if (ai) {
    try {
      const prompt = `You are an expert technical product manager and software engineer.
Enhance and generate an outstanding, professional task specification for a Kanban card.
Task Title: "${title}"
Parent Feature: "${featureTitle || 'General backlog'}"
Priority: "${priority || 'Medium'}"
User notes / rough description: "${currentDescription || ''}"

Return ONLY valid raw JSON with this exact schema:
{
  "title": "${title}",
  "description": "Rich markdown formatted description detailing the objective, technical background, edge cases, and implementation guidelines.",
  "acceptanceCriteria": [
    "Clear, testable Given-When-Then or bullet acceptance criteria",
    "Another measurable acceptance criterion"
  ],
  "subtasks": [
    "Atomic step 1",
    "Atomic step 2",
    "Atomic step 3"
  ],
  "suggestedWorkflow": "Concrete recommendations on which stage to start in, dependencies to check, and testing tips.",
  "estimatedStoryPoints": 1 | 2 | 3 | 5 | 8,
  "suggestedTags": ["tag1", "tag2", "tag3"]
}`;

      const response = await callWithTimeout(
        ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.7,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
        30000
      );

      const responseText = response.text || '';
      try {
        const parsed = JSON.parse(responseText);
        return res.json(parsed);
      } catch {
        const match = responseText.match(/\{[\s\S]*\}/);
        if (match) {
          return res.json(JSON.parse(match[0]));
        }
      }
    } catch (err: any) {
      console.warn('Gemini generate-description failed, using smart fallback:', err?.message);
    }
  }

  // Fallback rich description
  return res.json({
    title,
    description: `### Objective\nImplement **${title}** to ensure reliable operation and seamless user experience.\n\n### Technical Scope\n- Review current implementation patterns in the codebase.\n- Implement core functionality with strict TypeScript types.\n- Handle loading states, validation errors, and network timeouts gracefully.\n\n### Implementation Guidelines\n- Keep methods idempotent where applicable.\n- Write unit tests for core logical branches.`,
    acceptanceCriteria: [
      `Feature fulfills all functional requirements for "${title}".`,
      'All unit tests pass with clean assertions.',
      'No visual regressions or uncaught console errors.',
      'Mobile responsive reflow tested and verified.'
    ],
    subtasks: [
      'Define data contracts and state interface',
      'Implement business logic and edge-case handlers',
      'Verify with unit tests and browser checks'
    ],
    suggestedWorkflow: 'Start in "To Do", move to "In Progress" once assigned. Create PR for "Review" upon test passing.',
    estimatedStoryPoints: 3,
    suggestedTags: ['feature', 'core', 'frontend']
  });
});

/**
 * 3. Suggest Kanban Workflow Improvements & Bottleneck Resolution
 */
app.post('/api/copilot/suggest-workflow', async (req: Request, res: Response) => {
  const { summaryData } = req.body;

  if (ai) {
    try {
      const prompt = `You are an agile agile coach and Kanban workflow optimizer.
Analyze this Kanban board status:
${JSON.stringify(summaryData || {}, null, 2)}

Provide actionable workflow suggestions, identify potential bottlenecks (WIP overload, stuck review items, unprioritized backlog), and recommend 3-4 specific productivity actions for the team.

Return ONLY raw JSON with schema:
{
  "healthScore": 85,
  "statusSummary": "Short 1-2 sentence overall diagnosis of the board flow",
  "bottlenecks": [
    "Specific bottleneck or risk observed"
  ],
  "recommendations": [
    {
      "title": "Actionable recommendation title",
      "action": "Concrete step the team should take right now",
      "impact": "High" | "Medium" | "Quick Win"
    }
  ],
  "workflowTip": "One punchy principle to maintain optimal Kanban velocity"
}`;

      const response = await callWithTimeout(
        ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.6,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
        30000
      );

      const responseText = response.text || '';
      try {
        const parsed = JSON.parse(responseText);
        return res.json(parsed);
      } catch {
        const match = responseText.match(/\{[\s\S]*\}/);
        if (match) {
          return res.json(JSON.parse(match[0]));
        }
      }
    } catch (err: any) {
      console.warn('Gemini suggest-workflow failed, using smart fallback:', err?.message);
    }
  }

  // Fallback diagnostic
  const wip = summaryData?.wipCount || 0;
  const review = summaryData?.reviewQueueCount || 0;
  const total = summaryData?.totalTasks || 0;

  const recommendations = [];
  if (review > 2) {
    recommendations.push({
      title: 'Clear the Review Queue Congestion',
      action: `Dedicate the next engineering sprint block to reviewing the ${review} pending items before pulling new work from 'To Do'.`,
      impact: 'High'
    });
  }
  if (wip > 4) {
    recommendations.push({
      title: 'Enforce Work-In-Progress (WIP) Limits',
      action: 'Limit active In Progress items to 3 per developer to prevent context switching.',
      impact: 'High'
    });
  }
  recommendations.push({
    title: 'Prioritize Critical Items in Backlog',
    action: 'Review cards tagged Critical in Backlog and promote them to To Do for the upcoming cycle.',
    impact: 'Medium'
  });
  recommendations.push({
    title: 'Decompose Large 8+ Point Tasks',
    action: 'Use the Copilot Feature Breakdown tool on large tasks to slice them into sub-tasks under 3 story points.',
    impact: 'Quick Win'
  });

  return res.json({
    healthScore: review > 3 || wip > 5 ? 72 : 91,
    statusSummary: `Board holds ${total} total tasks with ${wip} in progress and ${review} awaiting review.`,
    bottlenecks: review > 2 ? [`${review} tasks awaiting review may delay release cycle.`] : [],
    recommendations,
    workflowTip: 'Stop starting, start finishing. Pull cards forward only when downstream capacity is clear.'
  });
});

/**
 * 4. General Copilot Assistant Chat/Advice endpoint
 */
app.post('/api/copilot/chat', async (req: Request, res: Response) => {
  const { message, context } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  if (ai) {
    try {
      const prompt = `You are a helpful Kanban & Software Engineering Copilot embedded in a Kanban board app.
Context about the project:
${JSON.stringify(context || {}, null, 2)}

User Question: "${message}"

Give a concise, helpful, and insightful response with markdown formatting, bullet points where appropriate, and actionable guidance for managing features and tasks.`;

      const response = await callWithTimeout(
        ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            temperature: 0.7,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
        30000
      );

      return res.json({ reply: response.text });
    } catch (err: any) {
      console.warn('Gemini chat failed, fallback response:', err?.message);
    }
  }

  return res.json({
    reply: `I am your Kanban Flow Copilot! I can help you:
1. **Break down high-level features** into bite-sized user stories and technical tasks.
2. **Auto-generate crisp descriptions** with acceptance criteria and checklist steps.
3. **Optimize your workflow** by flagging congested stages (Review / In Progress) and recommending next actions.

Try clicking **"Breakdown Feature"** or open any task card and click **"Copilot Auto-spec"**!`
  });
});

app.use('/api', (req: Request, res: Response) => {
  res.status(404).json({ error: `Unknown API route: ${req.method} ${req.originalUrl}` });
});

// Vite Middleware for development, or static build for production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  await repositories.init();
  const listener = app.listen(PORT);
  await new Promise<void>((resolve, reject) => {
    listener.once('listening', resolve);
    listener.once('error', reject);
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
