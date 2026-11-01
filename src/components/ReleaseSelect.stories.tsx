import type { Meta, StoryObj } from '@storybook/react-vite';
import ReleaseSelect from './ReleaseSelect';
import { project, release } from './stories/fixtures';

const meta = {
  title: 'Components/ReleaseSelect',
  component: ReleaseSelect,
  args: { projectId: project.id, value: release.id, onChange: () => {} },
} satisfies Meta<typeof ReleaseSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Selected: Story = {};
