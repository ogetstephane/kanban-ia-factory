import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { PrismaClient } from '@prisma/client';
import type { WorkflowAgent, WorkflowScope } from '../../shared/types/workflowEditor';
import {
  workflowJsonObjectSchema, workflowTestLaunchSchema, workflowTestRunSchema,
  type WorkflowJsonObject, type WorkflowTestLaunch, type WorkflowTestRun, type WorkflowTestStep,
} from '../../shared/types/workflowTestRun';
import { WorkflowEditorStore } from '../db/workflowEditorStore';
import { RepositoryError } from '../git/repositoryService';
import { orderedWorkflowNodes, workflowGraphErrors } from '../../shared/utils/workflowGraph';

export interface WorkflowTestAgentExecutor {
  readonly providers: readonly string[];
  execute(request: {
    agent: WorkflowAgent; prompt: string; skills: string[];
    input: WorkflowJsonObject; signal: AbortSignal;
  }): Promise<WorkflowJsonObject>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 2000);
const terminal = (step: WorkflowTestStep) => step.status === 'completed' || step.status === 'skipped';

export class WorkflowTestService {
  private readonly active = new Map<string, { controller: AbortController; job: Promise<void> }>();
  private readonly starting = new Set<Promise<WorkflowTestRun>>();
  private started = false;
  constructor(private readonly db: PrismaClient, private readonly executor?: WorkflowTestAgentExecutor) {}

  options() { return { realProviders: this.executor?.providers ?? [], previewOnly: true as const }; }

  async start() {
    if (this.started) return;
    for (const row of await this.db.workflowTestRun.findMany({ where: { status: 'running' } })) {
      const run = workflowTestRunSchema.parse(row.snapshot);
      this.finish(run, 'failed', 'Server restarted during the run. No agent has been replayed; launch a new test explicitly.');
      await this.persist(run);
    }
    this.started = true;
  }

  async stop() {
    this.started = false;
    await Promise.allSettled([...this.starting]);
    const jobs = [...this.active.values()];
    for (const { controller } of jobs) controller.abort(new Error('Server stopped the test run.'));
    await Promise.all(jobs.map(({ job }) => job));
  }

  async get(scope: WorkflowScope, id: string) {
    const row = await this.db.workflowTestRun.findFirst({ where: { scope, id } });
    if (!row) throw new RepositoryError(404, 'Test run does not exist in this scope.');
    return workflowTestRunSchema.parse(row.snapshot);
  }

  async list(scope: WorkflowScope) {
    const rows = await this.db.workflowTestRun.findMany({ where: { scope }, orderBy: { createdAt: 'desc' }, take: 20 });
    return rows.map((row) => {
      const run = workflowTestRunSchema.parse(row.snapshot);
      return { id: run.id, status: run.status, versionNumber: run.versionNumber, createdAt: run.createdAt };
    });
  }

  async launch(scope: WorkflowScope, raw: WorkflowTestLaunch) {
    return this.withSlot(() => this.createRun(scope, raw));
  }

  private async withSlot(action: () => Promise<WorkflowTestRun>) {
    if (!this.started) throw new RepositoryError(503, 'Workflow test runner is not started.');
    if (this.active.size + this.starting.size >= 4) throw new RepositoryError(429, 'Four workflow tests are already running or starting. Wait or cancel one.');
    const operation = action();
    this.starting.add(operation);
    try { return await operation; }
    finally { this.starting.delete(operation); }
  }

  private async createRun(scope: WorkflowScope, raw: WorkflowTestLaunch) {
    const configuration = workflowTestLaunchSchema.parse(raw);
    const { version } = await new WorkflowEditorStore(this.db).resolve(scope, configuration.versionId);
    const document = version.document;
    if (document.runtimeReference || document.nodes.some((node) => node.kind === 'host')) {
      throw new RepositoryError(422, 'Current orchestration imports are reference-only. Reference models and release host operations cannot run in the inference-only preview runner.');
    }
    if (document.execution) {
      const errors = workflowGraphErrors(document, scope);
      if (errors.length) throw new RepositoryError(422, errors.join(' '));
      if (!configuration.phase || !document.nodes.some((node) => node.run?.phases.includes(configuration.phase!))) throw new RepositoryError(400, 'Choose a supported execution phase for this workflow preview.');
    }
    const nodes = document.nodes.filter((node) => node.kind === 'agent');
    if (Object.keys(configuration.agents).some((id) => !nodes.some((node) => node.id === id))
      || nodes.some((node) => !configuration.agents[node.id])) {
      throw new RepositoryError(400, 'Specify exactly one real/mock configuration for every agent step, keyed by node ID.');
    }
    for (const node of nodes) {
      if (document.execution && !node.run?.phases.includes(configuration.phase!)) continue;
      const agent = document.agents.find((item) => item.id === node.referenceId)!;
      const prompt = document.prompts.find((item) => item.id === agent.promptId)!;
      for (const variable of prompt.variables) {
        if (!Object.hasOwn(configuration.input, variable)) throw new RepositoryError(400, `Missing test input variable: ${variable}`);
      }
      if (configuration.agents[node.id].mode === 'real') {
        if (!configuration.authorizeRealAgents) throw new RepositoryError(400, 'Explicit authorization is required for real-agent calls and possible AI charges.');
        const provider = agent.provider === 'inherit' ? 'copilot' : agent.provider;
        if (!this.executor?.providers.includes(provider)) throw new RepositoryError(422, `Real preview provider ${provider} is unavailable. Select a supported provider or mock this step.`);
      }
    }
    const now = new Date().toISOString();
    const run: WorkflowTestRun = {
      id: randomUUID(), scope, revision: 0, versionId: version.id, versionNumber: version.number,
      document, configuration, status: 'running', previewOnly: true, createdAt: now, updatedAt: now,
      steps: (document.execution ? orderedWorkflowNodes(document) : document.nodes).map((node) => ({
        nodeId: node.id, status: document.execution && !node.run?.phases.includes(configuration.phase!) ? 'skipped' : 'pending',
        mode: node.kind === 'agent' ? configuration.agents[node.id].mode : 'control',
      })),
    };
    await this.db.workflowTestRun.create({ data: { id: run.id, scope, status: run.status, snapshot: run } });
    await this.scheduleOrStop(run);
    return run;
  }

  async approve(scope: WorkflowScope, id: string, revision: number, nodeId: string) {
    return this.withSlot(() => this.resume(scope, id, revision, nodeId));
  }

  private async resume(scope: WorkflowScope, id: string, revision: number, nodeId: string) {
    const run = await this.get(scope, id);
    const step = run.steps.find((item) => item.nodeId === nodeId);
    if (run.revision !== revision || run.status !== 'waiting' || step?.status !== 'waiting') {
      throw new RepositoryError(409, 'The approval is stale or this step is not waiting.');
    }
    if (this.active.has(id)) throw new RepositoryError(409, 'Test runner is busy. Refresh and retry approval.');
    step.status = 'completed'; step.finishedAt = new Date().toISOString();
    step.output = { approved: true };
    run.status = 'running';
    await this.persist(run);
    await this.scheduleOrStop(run);
    return run;
  }

  async cancel(scope: WorkflowScope, id: string, revision: number) {
    const run = await this.get(scope, id);
    if (run.revision !== revision) throw new RepositoryError(409, 'Test run changed. Refresh before cancelling.');
    if (run.status !== 'running' && run.status !== 'waiting') throw new RepositoryError(409, 'Test run is already finished.');
    this.finish(run, 'cancelled', 'Cancelled by user.');
    await this.persist(run);
    this.active.get(id)?.controller.abort(new Error('Cancelled by user.'));
    return run;
  }

  private schedule(run: WorkflowTestRun) {
    const controller = new AbortController();
    // Keep the response snapshot separate from the asynchronously evolving execution.
    const execution = structuredClone(run);
    const job = Promise.resolve().then(() => this.execute(execution, controller)).catch((error: unknown) => {
      console.error(`Workflow test ${run.id} could not persist its result:`, error);
    }).finally(() => { this.active.delete(run.id); });
    this.active.set(run.id, { controller, job });
  }

  private async scheduleOrStop(run: WorkflowTestRun) {
    if (this.started) this.schedule(run);
    else {
      this.finish(run, 'cancelled', 'Server stopped before the test run could start.');
      await this.persist(run);
    }
  }

  private async persist(run: WorkflowTestRun) {
    const previous = run.revision;
    run.revision++; run.updatedAt = new Date().toISOString();
    const validated = workflowTestRunSchema.parse(run);
    const updated = await this.db.workflowTestRun.updateMany({
      where: { id: run.id, revision: previous },
      data: { revision: run.revision, status: run.status, snapshot: validated },
    });
    if (!updated.count) throw new RepositoryError(409, 'Test run changed during execution.');
  }

  private finish(run: WorkflowTestRun, status: 'failed' | 'cancelled', error: string) {
    run.status = status; run.error = error;
    for (const step of run.steps) {
      if (['pending', 'running', 'waiting'].includes(step.status)) {
        step.status = status === 'cancelled' ? 'cancelled' : step.status === 'running' ? 'failed' : 'skipped';
        step.note = error; step.finishedAt = new Date().toISOString();
      }
    }
  }

  private async execute(run: WorkflowTestRun, controller: AbortController) {
    const timeout = setTimeout(() => controller.abort(new Error('Test run exceeded its ten-minute limit.')), 600_000);
    try {
      while (run.steps.some((step) => !terminal(step))) {
        controller.signal.throwIfAborted();
        const step = run.steps.find((candidate) => candidate.status === 'pending'
          && run.document.edges.filter((edge) => edge.to === candidate.nodeId)
            .every((edge) => run.steps.some((previous) => previous.nodeId === edge.from && terminal(previous))));
        if (!step) throw new Error('No executable step remains in this graph.');
        const node = run.document.nodes.find((item) => item.id === step.nodeId)!;
        const upstreamIds = (id: string): string[] => {
          const previous = run.steps.find((step) => step.nodeId === id);
          if (run.document.execution && previous?.status === 'skipped') return run.document.edges.filter((edge) => edge.to === id).flatMap((edge) => upstreamIds(edge.from));
          return [id];
        };
        const upstream = Object.fromEntries([...new Set(run.document.edges.filter((edge) => edge.to === node.id).flatMap((edge) => upstreamIds(edge.from)))]
          .map((id) => [id, run.steps.find((previous) => previous.nodeId === id)?.output ?? null]));
        step.input = workflowJsonObjectSchema.parse({ variables: run.configuration.input, upstream });
        step.startedAt = new Date().toISOString();
        const hook = node.kind === 'hook' ? run.document.hooks.find((item) => item.id === node.referenceId) : undefined;
        if (node.kind === 'approval' || hook?.action === 'approval') {
          step.status = 'waiting'; step.note = 'Approve to continue this preview. This grants no production write permissions.';
          this.assertResultBudget(run);
          run.status = 'waiting'; await this.persist(run); return;
        }
        this.assertResultBudget(run);
        step.status = 'running'; await this.persist(run);
        if (node.kind === 'agent') {
          const agent = run.document.agents.find((item) => item.id === node.referenceId)!;
          const settings = run.configuration.agents[node.id];
          if (settings.mode === 'mock') {
            await delay(settings.delayMs, undefined, { signal: controller.signal });
            if (settings.response.kind === 'error') throw new Error(settings.response.error);
            step.output = structuredClone(settings.response.output);
          } else {
            const template = run.document.prompts.find((item) => item.id === agent.promptId)!.template;
            const prompt = template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
              (_match, variable: string) => {
                const value = run.configuration.input[variable];
                return typeof value === 'string' ? value : JSON.stringify(value);
              });
            step.output = workflowJsonObjectSchema.parse(await this.executor!.execute({
              agent, prompt, skills: run.document.skills.filter((skill) => agent.skillIds.includes(skill.id)).map((skill) => skill.instructions),
              input: step.input, signal: controller.signal,
            }));
          }
          step.note = settings.mode === 'mock' ? 'User-defined mock response; no AI call.' : 'Real inference; all tools and host writes denied.';
        } else if (hook?.action === 'script') {
          step.status = 'skipped'; step.note = 'Custom scripts are disabled in preview-only test runs.';
          step.output = { skipped: true, reason: 'preview-only', upstream };
        } else {
          step.output = { upstream };
          step.note = hook?.action === 'validate'
            ? 'JSON shape and size validated only. No custom quality rule was executed.'
            : 'Preview log checkpoint; no external action.';
        }
        controller.signal.throwIfAborted();
        this.assertResultBudget(run);
        if (step.status === 'running') step.status = 'completed';
        step.finishedAt = new Date().toISOString();
        if (run.document.execution && ['author', 'plan'].includes(run.configuration.phase ?? '')
          && ['plan', 'clarification'].includes(String(step.output?.kind))) {
          for (const remaining of run.steps.filter((item) => item.status === 'pending')) {
            remaining.status = 'skipped'; remaining.note = 'Returned to the host for human confirmation.'; remaining.finishedAt = step.finishedAt;
          }
        }
        await this.persist(run);
      }
      run.status = 'completed'; await this.persist(run);
    } catch (error) {
      const current = await this.get(run.scope, run.id);
      if (current.status === 'cancelled') return;
      if (current.revision !== run.revision && !(error instanceof RepositoryError && error.status === 409)) throw error;
      // Use the last durable state if a transition failed, avoiding stale-result overwrites.
      const failedStep = current.steps.find((step) => step.status === 'running');
      if (failedStep) failedStep.error = message(error);
      this.finish(current, controller.signal.aborted && !String(controller.signal.reason).includes('ten-minute') ? 'cancelled' : 'failed', message(controller.signal.aborted ? controller.signal.reason : error));
      await this.persist(current);
    } finally { clearTimeout(timeout); }
  }

  private assertResultBudget(run: WorkflowTestRun) {
    if (JSON.stringify(run).length > 1_000_000) throw new Error('Test run exceeds its 1,000,000-character result budget.');
  }
}
