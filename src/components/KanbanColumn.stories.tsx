import type { Meta, StoryObj } from '@storybook/react-vite';
import { KanbanColumn } from './KanbanColumn';
import { feature, tasks } from './stories/fixtures';

const meta = {
  title: 'Components/KanbanColumn',
  component: KanbanColumn,
  args: {
    status: 'In Progress',
    tasks,
    features: [feature],
    featureTasks: new Map([[feature.id, tasks]]),
    featuresMap: new Map([[feature.id, feature]]),
    projects: [],
    onMoveTask: () => {},
    onMoveFeature: () => {},
    onEditTask: () => {},
    onDeleteTask: () => {},
    onAddTask: () => {},
    onOpenCopilotSpec: () => {},
    onReviewTask: () => {},
    onReviewFeature: () => {},
    dropState: 'idle',
    onDragTask: () => {},
  },
} satisfies Meta<typeof KanbanColumn>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
