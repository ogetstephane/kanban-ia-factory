import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProjectSwitcher } from './ProjectSwitcher';
import { project } from './stories/fixtures';

const meta = {
  title: 'Components/ProjectSwitcher',
  component: ProjectSwitcher,
  args: {
    projects: [project],
    activeProjectId: project.id,
    onSelectProject: () => {},
    onOpenCreateModal: () => {},
    onOpenManagerModal: () => {},
  },
} satisfies Meta<typeof ProjectSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
