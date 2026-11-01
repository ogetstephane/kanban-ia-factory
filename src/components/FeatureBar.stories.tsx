import type { Meta, StoryObj } from '@storybook/react-vite';
import { FeatureBar } from './FeatureBar';
import { feature, tasks } from './stories/fixtures';

const meta = {
  title: 'Components/FeatureBar',
  component: FeatureBar,
  args: {
    features: [feature],
    tasks,
    projects: [],
    activeFeatureId: 'All',
    onSelectFeature: () => {},
    onOpenNewFeatureModal: () => {},
    onOpenBreakdownModal: () => {},
    onDeleteFeature: () => {},
  },
} satisfies Meta<typeof FeatureBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
