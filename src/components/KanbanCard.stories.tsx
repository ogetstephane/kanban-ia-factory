import type { Meta, StoryObj } from '@storybook/react-vite';
import { KanbanCard } from './KanbanCard';
import { feature, tasks } from './stories/fixtures';

const meta = {
  title: 'Components/KanbanCard',
  component: KanbanCard,
  args: {
    task: tasks[0],
    feature,
    projectName: 'Atlas',
    onEdit: () => {},
    onDelete: () => {},
    onMoveStatus: () => {},
    onOpenCopilotSpec: () => {},
    onDragStatus: () => {},
    onReview: () => {},
  },
} satisfies Meta<typeof KanbanCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
