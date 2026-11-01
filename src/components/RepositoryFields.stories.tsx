import type { Meta, StoryObj } from '@storybook/react-vite';
import { EMPTY_REPOSITORY, RepositoryFields } from './RepositoryFields';

const meta = {
  title: 'Components/RepositoryFields',
  component: RepositoryFields,
  args: { value: { ...EMPTY_REPOSITORY }, onChange: () => {} },
} satisfies Meta<typeof RepositoryFields>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Configured: Story = {
  args: {
    value: {
      url: 'https://github.com/example/atlas',
      branch: 'main',
      token: '',
    },
  },
};
