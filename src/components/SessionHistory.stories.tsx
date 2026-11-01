import type { Meta, StoryObj } from '@storybook/react-vite';
import SessionHistory from './SessionHistory';
import { agentSession } from './stories/fixtures';

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
