import type { Meta, StoryObj } from '@storybook/react-vite';
import CockpitView from './CockpitView';
import { project } from './stories/fixtures';

const meta = {
  title: 'Components/CockpitView',
  component: CockpitView,
  args: {
    scopeId: project.id,
    projects: [project],
    onOpenTicket: () => {},
    onOpenRelease: () => {},
  },
} satisfies Meta<typeof CockpitView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectScope: Story = {};
