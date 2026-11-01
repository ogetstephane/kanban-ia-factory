import type { Meta, StoryObj } from '@storybook/react-vite';
import ReviewValidation from './ReviewValidation';
import { tasks } from './stories/fixtures';

const meta = {
  title: 'Components/ReviewValidation',
  component: ReviewValidation,
  args: { kind: 'tasks', id: tasks[0].id, onDone: async () => {} },
} satisfies Meta<typeof ReviewValidation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TaskPublication: Story = {};

export const FeaturePublication: Story = {
  args: { kind: 'features', id: 'storybook-feature' },
};
