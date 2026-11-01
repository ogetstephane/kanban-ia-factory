import type { Meta, StoryObj } from '@storybook/react-vite';
import GitView from './GitView';
import { project } from './stories/fixtures';

const meta = {
  title: 'Components/GitView',
  component: GitView,
  args: {
    projectId: project.id,
    onOpenTask: () => {},
    openingTicket: false,
    ticketError: '',
  },
} satisfies Meta<typeof GitView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RepositoryOverview: Story = {};
