import type { Meta, StoryObj } from '@storybook/react-vite';
import ReviewActions from './ReviewActions';

const meta = {
  title: 'Components/ReviewActions',
  component: ReviewActions,
  args: { title: 'Keyboard shortcuts', onReview: () => {} },
} satisfies Meta<typeof ReviewActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
