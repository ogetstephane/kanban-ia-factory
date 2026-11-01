import type { Meta, StoryObj } from '@storybook/react-vite';
import { MarkdownPreview } from './MarkdownPreview';

const meta = {
  title: 'Components/MarkdownPreview',
  component: MarkdownPreview,
  args: {
    source: '# Release notes\n\nA **faster** workspace with:\n\n- Keyboard shortcuts\n- Better empty states',
  },
} satisfies Meta<typeof MarkdownPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FormattedMarkdown: Story = {};
