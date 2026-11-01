import type { Meta, StoryObj } from '@storybook/react-vite';
import DeliveryHistoryView from './DeliveryHistoryView';
import { project } from './stories/fixtures';

const meta = {
  title: 'Components/DeliveryHistoryView',
  component: DeliveryHistoryView,
  args: {
    scopeId: project.id,
    projects: [project],
    onOpenTicket: () => {},
  },
} satisfies Meta<typeof DeliveryHistoryView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectDeliveries: Story = {};
