import type { Meta, StoryObj } from '@storybook/react-vite';
import GitTaskDiffView from './GitTaskDiffView';
import { tasks } from './stories/fixtures';

const meta = {
  title: 'Components/GitTaskDiffView',
  component: GitTaskDiffView,
  args: {
    taskId: tasks[0].id,
    title: tasks[0].title,
    status: tasks[0].status,
    onBack: () => {},
  },
} satisfies Meta<typeof GitTaskDiffView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TaskChanges: Story = {};
