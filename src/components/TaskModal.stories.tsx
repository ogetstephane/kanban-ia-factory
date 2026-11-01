import type { Meta, StoryObj } from '@storybook/react-vite';
import { TaskModal } from './TaskModal';
import { feature, project, tasks } from './stories/fixtures';

const meta = {
  title: 'Components/TaskModal',
  component: TaskModal,
  args: {
    isOpen: true,
    onClose: () => {},
    task: tasks[0],
    features: [feature],
    projectId: project.id,
    onSave: () => {},
    onSessionTaskChange: () => {},
  },
} satisfies Meta<typeof TaskModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EditingTask: Story = {};

export const CreatingTask: Story = {
  args: { task: null, defaultStatus: 'To Do', defaultFeatureId: feature.id },
};
