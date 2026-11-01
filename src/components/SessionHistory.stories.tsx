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
