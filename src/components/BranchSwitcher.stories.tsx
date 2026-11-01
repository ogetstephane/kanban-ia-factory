import type { Meta, StoryObj } from '@storybook/react-vite';
import { BranchSwitcher } from './BranchSwitcher';
import { project } from './stories/fixtures';

const meta = {
  title: 'Components/BranchSwitcher',
  component: BranchSwitcher,
  args: { project, onSwitch: async () => {} },
} satisfies Meta<typeof BranchSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
