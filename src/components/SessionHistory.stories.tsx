import type { Meta, StoryObj } from '@storybook/react-vite';
import SessionHistory from './SessionHistory';
import { agentSession } from './stories/fixtures';
import { agentRuntimeSchema } from '../../shared/types/agent';

const meta = {
  title: 'Components/SessionHistory',
  component: SessionHistory,
  args: {
    taskId: agentSession.taskId,
    session: agentSession,
    actions: <button type="button">View session</button>,
  },
} satisfies Meta<typeof SessionHistory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CompletedSession: Story = {};
export const Planning: Story = {
  args: { session: { ...agentSession, status: 'planning', output: '', plan: '# Implementation plan\n\n1. Inspect the code\n2. Add tests' } },
};
export const AwaitingApproval: Story = {
  args: { session: { ...agentSession, status: 'awaiting_approval', output: '' } },
};
export const Executing: Story = {
  args: { session: { ...agentSession, status: 'executing', resumeStatus: 'executing' } },
};
export const WithAgentTelemetry: Story = {
  args: {
    session: {
      ...agentSession,
      runtimes: [agentRuntimeSchema.parse({
        id: 'runtime-with-telemetry', phase: 'execute', providerSessionId: 'copilot-session-123',
        status: 'completed', startedAt: agentSession.createdAt, endedAt: agentSession.updatedAt, error: '',
        metadata: {
          requestedModel: 'fixture-model', workspace: agentSession.workspace,
          configuration: { systemMessage: { mode: 'replace', content: 'Implement only the approved ticket.' }, availableTools: ['ticket_read_file'] },
          message: { prompt: 'Full ticket context and approved plan.' },
        },
        events: [
          { id: 'start', type: 'session.start', timestamp: agentSession.createdAt, data: { selectedModel: 'fixture-model', copilotVersion: 'fixture', reasoningEffort: 'high', contextTier: 'default' } },
          { id: 'usage', type: 'assistant.usage', timestamp: agentSession.updatedAt, ephemeral: true, data: { model: 'fixture-model', inputTokens: 12500, outputTokens: 1800, cacheReadTokens: 9000, cacheWriteTokens: 1000, cost: 0.5, duration: 4500 } },
          { id: 'context', type: 'session.usage_info', timestamp: agentSession.updatedAt, ephemeral: true, data: { currentTokens: 18000, tokenLimit: 128000, messagesLength: 12, systemTokens: 2000, conversationTokens: 15000, toolDefinitionsTokens: 1000 } },
        ],
      })],
    },
  },
};
