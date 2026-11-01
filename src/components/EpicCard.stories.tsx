import type { Meta, StoryObj } from '@storybook/react-vite';
import { EpicCard } from './EpicCard';
import { feature, tasks } from './stories/fixtures';

const meta = {
  title: 'Components/EpicCard',
  component: EpicCard,
  args: {
    feature,
    tasks,
    projectName: 'Atlas',
    onMoveStatus: () => {},
    onDragStatus: () => {},
    onOpenTask: () => {},
    onDeleteTask: () => {},
    onAddTask: () => {},
    onReviewFeature: () => {},
    onReviewTask: () => {},
  },
} satisfies Meta<typeof EpicCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
