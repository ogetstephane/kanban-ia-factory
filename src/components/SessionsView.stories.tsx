import type { Meta, StoryObj } from '@storybook/react-vite';
import SessionsView from './SessionsView';
import { project } from './stories/fixtures';

const meta = {
  title: 'Components/SessionsView',
  component: SessionsView,
  args: { initialProjectId: project.id },
} satisfies Meta<typeof SessionsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectSessions: Story = {};
