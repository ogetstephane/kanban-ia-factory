import type { Meta, StoryObj } from '@storybook/react-vite';
import { FeatureBreakdownModal } from './FeatureBreakdownModal';
import { feature } from './stories/fixtures';

const meta = {
  title: 'Components/FeatureBreakdownModal',
  component: FeatureBreakdownModal,
  args: {
    isOpen: true,
    onClose: () => {},
    features: [feature],
    projectId: feature.projectId ?? 'story-project',
    initialFeatureId: feature.id,
    onApplyBreakdown: () => {},
  },
} satisfies Meta<typeof FeatureBreakdownModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
