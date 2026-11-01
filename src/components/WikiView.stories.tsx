import type { Meta, StoryObj } from '@storybook/react-vite';
import { WikiView } from './WikiView';
import { project } from './stories/fixtures';

const meta = {
  title: 'Components/WikiView',
  component: WikiView,
  args: { project },
} satisfies Meta<typeof WikiView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectWiki: Story = {};
