import type { Meta, StoryObj } from '@storybook/react-vite';
import FileDiff from './FileDiff';

const meta = {
  title: 'Components/FileDiff',
  component: FileDiff,
  args: {
    files: [{ path: 'src/shortcuts.ts', status: 'modified' }],
    selected: 'src/shortcuts.ts',
    onSelect: () => {},
    baseCommit: '0123456789abcdef',
    file: {
      path: 'src/shortcuts.ts',
      patch: '@@ -1,2 +1,3 @@\n export const shortcuts = [];\n+export const openPalette = "Ctrl+K";\n',
      binary: false,
      truncated: false,
    },
    error: '',
  },
} satisfies Meta<typeof FileDiff>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithDiff: Story = {};
