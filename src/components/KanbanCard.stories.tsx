import type { Meta, StoryObj } from '@storybook/react-vite';
import { KanbanCard } from './KanbanCard';
import { agentSession, feature, tasks } from './stories/fixtures';
import { getAgentWorkflow } from '../../shared/utils/agentWorkflow';

const meta = {
  title: 'Components/KanbanCard',
  component: KanbanCard,
  args: {
    task: tasks[0],
    feature,
    projectName: 'Atlas',
    onEdit: () => {},
    onDelete: () => {},
    onMoveStatus: () => {},
    onOpenCopilotSpec: () => {},
    onDragStatus: () => {},
    onReview: () => {},
  },
} satisfies Meta<typeof KanbanCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const ExecutingWorkflow: Story = {
  args: { workflow: getAgentWorkflow({ ...agentSession, status: 'executing' }) },
};
export const AwaitingApproval: Story = {
  args: { workflow: getAgentWorkflow({ ...agentSession, status: 'awaiting_approval', output: '' }) },
};
export const SingleStatus: Story = {
  args: { task: { ...tasks[0], status: 'Done' } },
};
