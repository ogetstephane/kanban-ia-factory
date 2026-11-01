import type { Meta, StoryObj } from '@storybook/react-vite';
import TicketReview from './TicketReview';
import { agentSession } from './stories/fixtures';

const meta = {
  title: 'Components/TicketReview',
  component: TicketReview,
  args: {
    session: agentSession,
    onChange: () => {},
    onValidated: () => {},
  },
} satisfies Meta<typeof TicketReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ManualReview: Story = {};

export const EpicReview: Story = {
  args: { epicReview: true },
};
