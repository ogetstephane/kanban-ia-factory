import type { Meta, StoryObj } from '@storybook/react-vite';
import WorkflowTimeline from './WorkflowTimeline';
import { getAgentWorkflow } from '../../shared/utils/agentWorkflow';
import { agentSession } from './stories/fixtures';

const meta = {
  title: 'Components/WorkflowTimeline',
  component: WorkflowTimeline,
  args: { workflow: getAgentWorkflow(agentSession) },
} satisfies Meta<typeof WorkflowTimeline>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AwaitingReview: Story = {};
export const NotStarted: Story = { args: { workflow: getAgentWorkflow() } };
export const AwaitingApproval: Story = {
  args: { workflow: getAgentWorkflow({ ...agentSession, status: 'awaiting_approval', output: '' }) },
};
export const Executing: Story = {
  args: { workflow: getAgentWorkflow({ ...agentSession, status: 'executing' }) },
};
export const FailedExecution: Story = {
  args: { workflow: getAgentWorkflow({ ...agentSession, status: 'failed', resumeStatus: 'executing' }) },
};
export const Published: Story = {
  args: { workflow: getAgentWorkflow({
    ...agentSession, reviewStatus: 'accepted',
    publication: { status: 'pushed', branch: 'main', commitHash: '0123456', error: '' },
  }) },
};
export const CompactTicket: Story = { args: { compact: true } };
