import type { Meta, StoryObj } from '@storybook/react-vite';
import { Navbar } from './Navbar';
import { feature, filters, project } from './stories/fixtures';

const meta = {
  title: 'Components/Navbar',
  component: Navbar,
  args: {
    projects: [project],
    activeProjectId: project.id,
    onSelectProject: () => {},
    onOpenCreateProjectModal: () => {},
    onOpenProjectManagerModal: () => {},
    features: [feature],
    filters,
    viewMode: 'board',
    onViewModeChange: () => {},
    onFilterChange: () => {},
    onOpenBreakdownModal: () => {},
    onOpenAdvisorModal: () => {},
    onOpenNewTaskModal: () => {},
    onOpenNewFeatureModal: () => {},
    onResetDemoData: async () => {},
    taskCount: 2,
  },
} satisfies Meta<typeof Navbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
