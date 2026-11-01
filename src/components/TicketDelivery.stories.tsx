import type { Meta, StoryObj } from '@storybook/react-vite';
import TicketDelivery from './TicketDelivery';
import { agentSession } from './stories/fixtures';

const meta = {
  title: 'Components/TicketDelivery',
  component: TicketDelivery,
  args: {
    session: agentSession,
    onChange: () => {},
    onTaskChange: () => {},
  },
} satisfies Meta<typeof TicketDelivery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DeliveryForm: Story = {};
