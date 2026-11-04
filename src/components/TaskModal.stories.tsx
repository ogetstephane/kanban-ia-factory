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

export const WithContextFiles: Story = {
  args: {
    task: {
      ...tasks[0],
      contextFiles: [{
        id: '83b55352-1a04-4fb7-9ec0-72cd6ca7269b', name: 'requirements.md',
        mimeType: 'text/markdown', size: 12, data: 'IyBSZXF1aXJlZApY',
      }],
    },
  },
};
