import type { Meta, StoryObj } from '@storybook/react-vite';
import { CodeGraphView } from './CodeGraphView';
import { project } from './stories/fixtures';

const meta = {
  title: 'Components/CodeGraphView',
  component: CodeGraphView,
  args: { project },
} satisfies Meta<typeof CodeGraphView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectCodeGraph: Story = {};
