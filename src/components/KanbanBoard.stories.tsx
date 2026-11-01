import type { Meta, StoryObj } from '@storybook/react-vite';
import KanbanBoard from './KanbanBoard';
import { feature, filters, tasks } from './stories/fixtures';

const meta = {
  title: 'Components/KanbanBoard',
  component: KanbanBoard,
  args: {
    tasks,
    features: [feature],
    projects: [],
    filters,
    onMoveTask: async () => {},
    onMoveFeature: async () => {},
    onDeleteTask: async () => {},
    onEditTask: () => {},
    onAddTask: () => {},
    onReviewValidated: () => {},
  },
} satisfies Meta<typeof KanbanBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ResponsiveColumns: Story = {
  render: (args) => (
    <div className="w-full p-4 sm:p-6 lg:p-8">
      <KanbanBoard {...args} />
    </div>
  ),
};
