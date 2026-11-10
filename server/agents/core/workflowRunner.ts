import type { Artifact, ReadonlyWorkflowDefinition, ReadonlyWorkflowStep, WorkflowStep } from './index';

export type WorkflowStepResult =
  | { status: 'succeeded'; artifacts: Artifact[] }
  | { status: 'failed'; reason: string }
  | { status: 'rejected'; reason: string }
  | { status: 'cancelled'; reason: string };

export interface WorkflowStepContext {
  inputs: Record<string, Artifact>;
  signal: AbortSignal;
}

export type WorkflowStepHandler = (
  step: ReadonlyWorkflowStep,
  context: WorkflowStepContext,
) => Promise<WorkflowStepResult>;

export interface WorkflowHandlers {
  agent: WorkflowStepHandler;
  verification: WorkflowStepHandler;
  approval: WorkflowStepHandler;
}

export interface WorkflowStepEvent {
  type: 'started' | 'completed' | 'failed' | 'cancelled';
  stepId: string;
  kind: WorkflowStep['kind'];
  occurredAt: string;
  result?: WorkflowStepResult;
}

export type WorkflowRunResult =
  | { status: 'succeeded'; completedStepIds: string[]; artifacts: Artifact[] }
  | {
      status: 'failed';
      completedStepIds: string[];
      failedStepId: string;
      reason: string;
      artifacts: Artifact[];
    }
  | { status: 'cancelled'; completedStepIds: string[]; reason: string; artifacts: Artifact[] };

function resolveStepInputs(
  step: WorkflowStep,
  artifactsByStep: Map<string, Map<string, Artifact>>,
): { inputs: Record<string, Artifact> } | { error: string } {
  const resolved: Record<string, Artifact> = {};
  for (const [inputName, binding] of Object.entries(step.inputs)) {
    const artifact = artifactsByStep.get(binding.stepId)?.get(binding.artifactName);
    if (!artifact) {
      return {
        error: `Workflow step ${step.id} requires missing artifact ${binding.artifactName} from ${binding.stepId}.`,
      };
    }
    resolved[inputName] = artifact;
  }
  return { inputs: resolved };
}

export async function runWorkflow(
  definition: ReadonlyWorkflowDefinition,
  handlers: WorkflowHandlers,
  options: {
    signal: AbortSignal;
    onStepEvent?: (event: WorkflowStepEvent) => Promise<void>;
  },
): Promise<WorkflowRunResult> {
  const completedStepIds: string[] = [];
  const artifacts: Artifact[] = [];
  const artifactsByStep = new Map<string, Map<string, Artifact>>();

  for (const step of definition.steps) {
    if (options.signal.aborted) {
      return {
        status: 'cancelled',
        completedStepIds,
        reason: 'Workflow was aborted before the next step started.',
        artifacts,
      };
    }

    const resolved = resolveStepInputs(step, artifactsByStep);
    if ('error' in resolved) {
      await options.onStepEvent?.({
        type: 'failed',
        stepId: step.id,
        kind: step.kind,
        occurredAt: new Date().toISOString(),
      });
      return {
        status: 'failed',
        completedStepIds,
        failedStepId: step.id,
        reason: resolved.error,
        artifacts,
      };
    }
    await options.onStepEvent?.({
      type: 'started',
      stepId: step.id,
      kind: step.kind,
      occurredAt: new Date().toISOString(),
    });

    let result: WorkflowStepResult;
    try {
      result = await handlers[step.kind](step, { inputs: resolved.inputs, signal: options.signal });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await options.onStepEvent?.({
        type: 'failed',
        stepId: step.id,
        kind: step.kind,
        occurredAt: new Date().toISOString(),
      });
      return { status: 'failed', completedStepIds, failedStepId: step.id, reason, artifacts };
    }
    if (options.signal.aborted || result.status === 'cancelled') {
      if (result.status === 'succeeded') artifacts.push(...result.artifacts);
      await options.onStepEvent?.({
        type: 'cancelled',
        stepId: step.id,
        kind: step.kind,
        occurredAt: new Date().toISOString(),
        result,
      });
      return {
        status: 'cancelled',
        completedStepIds,
        reason: result.status === 'cancelled' ? result.reason : 'Workflow was aborted during a step.',
        artifacts,
      };
    }
    if (result.status !== 'succeeded') {
      await options.onStepEvent?.({
        type: 'failed',
        stepId: step.id,
        kind: step.kind,
        occurredAt: new Date().toISOString(),
        result,
      });
      return {
        status: 'failed',
        completedStepIds,
        failedStepId: step.id,
        reason: result.reason,
        artifacts,
      };
    }

    const stepArtifacts = new Map<string, Artifact>();
    for (const artifact of result.artifacts) {
      if (stepArtifacts.has(artifact.name)) {
        const reason = `Workflow step ${step.id} produced duplicate artifact name: ${artifact.name}`;
        await options.onStepEvent?.({
          type: 'failed',
          stepId: step.id,
          kind: step.kind,
          occurredAt: new Date().toISOString(),
        });
        return { status: 'failed', completedStepIds, failedStepId: step.id, reason, artifacts };
      }
      stepArtifacts.set(artifact.name, artifact);
    }
    artifactsByStep.set(step.id, stepArtifacts);
    artifacts.push(...result.artifacts);
    completedStepIds.push(step.id);
    await options.onStepEvent?.({
      type: 'completed',
      stepId: step.id,
      kind: step.kind,
      occurredAt: new Date().toISOString(),
      result,
    });
  }

  return { status: 'succeeded', completedStepIds, artifacts };
}
