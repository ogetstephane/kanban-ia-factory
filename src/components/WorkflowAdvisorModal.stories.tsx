import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkflowAdvisorModal } from './WorkflowAdvisorModal';
import { tasks } from './stories/fixtures';

const meta = {
  title: 'Components/WorkflowAdvisorModal',
  component: WorkflowAdvisorModal,
  args: { isOpen: true, onClose: () => {}, tasks },
} satisfies Meta<typeof WorkflowAdvisorModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
