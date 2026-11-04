import { useEffect, useState } from 'react';
import { agentApi } from './agentApi';
import type { AgentWorkflow } from '../../shared/types/workflow';

export function useAgentWorkflows(projectId?: string) {
  const [state, setState] = useState<{ projectId?: string; workflows: Record<string, AgentWorkflow>; error: string }>({
    workflows: {}, error: '',
  });
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const workflows = await agentApi.agentWorkflows(projectId, controller.signal);
        if (!controller.signal.aborted) setState({ projectId, workflows, error: '' });
      } catch (cause) {
        if (!controller.signal.aborted) setState((previous) => ({
          projectId,
          workflows: previous.projectId === projectId ? previous.workflows : {},
          error: cause instanceof Error ? cause.message : 'Unable to load agent workflows',
        }));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void load(); }, 2000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId]);
  return state.projectId === projectId ? state : { workflows: {}, error: '' };
}
