import type { Meta, StoryObj } from '@storybook/react-vite';
import ReleasesView from './ReleasesView';
import { project, tasks } from './stories/fixtures';

const meta = {
  title: 'Components/ReleasesView',
  component: ReleasesView,
  args: {
    projectId: project.id,
    projects: [project],
    onOpenTask: () => {},
    refreshKey: 0,
  },
} satisfies Meta<typeof ReleasesView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectReleases: Story = {};

export const AllProjects: Story = {
  args: { projectId: 'All', projects: [project] },
};
