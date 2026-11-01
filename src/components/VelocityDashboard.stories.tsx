import type { Meta, StoryObj } from '@storybook/react-vite';
import { VelocityDashboard } from './VelocityDashboard';
import { feature, tasks } from './stories/fixtures';

const meta = {
  title: 'Components/VelocityDashboard',
  component: VelocityDashboard,
  args: {
    tasks,
    features: [feature],
    activeFeatureId: 'All',
    onSelectFeature: () => {},
    onOpenAdvisorModal: () => {},
  },
} satisfies Meta<typeof VelocityDashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
