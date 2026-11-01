import type { Meta, StoryObj } from '@storybook/react-vite';
import BoardReview from './BoardReview';
import { tasks } from './stories/fixtures';

const meta = {
  title: 'Components/BoardReview',
  component: BoardReview,
  args: {
    title: 'Review sprint tasks',
    tasks,
    ai: false,
    onClose: () => {},
    onValidated: () => {},
  },
} satisfies Meta<typeof BoardReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ManualReview: Story = {};

export const FeatureReview: Story = {
  args: { title: 'Review workspace improvements', featureId: 'storybook-feature' },
};
