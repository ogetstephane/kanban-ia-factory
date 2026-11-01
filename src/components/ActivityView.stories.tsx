import type { Meta, StoryObj } from '@storybook/react-vite';
import { ActivityView } from './ActivityView';
import { project } from './stories/fixtures';

const meta = {
  title: 'Components/ActivityView',
  component: ActivityView,
  args: { scopeId: project.id, projects: [project] },
} satisfies Meta<typeof ActivityView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectActivity: Story = {};
