import type { Meta, StoryObj } from '@storybook/react-vite';
import TaskAgentSession from './TaskAgentSession';
import { agentSession } from './stories/fixtures';

const meta = {
  title: 'Components/TaskAgentSession',
  component: TaskAgentSession,
  args: { taskId: agentSession.taskId, onTaskChange: () => {} },
} satisfies Meta<typeof TaskAgentSession>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SessionPanel: Story = {};
