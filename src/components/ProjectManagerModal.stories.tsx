import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProjectManagerModal } from './ProjectManagerModal';
import { project } from './stories/fixtures';

const meta = {
  title: 'Components/ProjectManagerModal',
  component: ProjectManagerModal,
  args: {
    isOpen: true,
    onClose: () => {},
    projects: [project],
    activeProjectId: project.id,
    onSelectProject: () => {},
    onCreateProject: async () => {},
    onUpdateProject: () => {},
    onSwitchBranch: async () => {},
    onDeleteProject: () => {},
  },
} satisfies Meta<typeof ProjectManagerModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
