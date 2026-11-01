import type { Meta, StoryObj } from '@storybook/react-vite';
import ProjectHealth from './ProjectHealth';
import { project } from './stories/fixtures';

const meta = {
  title: 'Components/ProjectHealth',
  component: ProjectHealth,
  args: { projectId: project.id },
} satisfies Meta<typeof ProjectHealth>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HealthSummary: Story = {};
