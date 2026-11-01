import type { Meta, StoryObj } from '@storybook/react-vite';
import PublishedWork from './PublishedWork';
import { project, tasks } from './stories/fixtures';

const meta = {
  title: 'Components/PublishedWork',
  component: PublishedWork,
  args: {
    work: {
      id: 'storybook-work',
      kind: 'tasks',
      title: tasks[0].title,
      branch: 'story/keyboard-shortcuts',
      tasks: [{ id: tasks[0].id, title: tasks[0].title, revision: 1, releaseId: null, releaseVersion: null }],
      finishStatus: null,
      finishError: '',
    },
    projectId: project.id,
    onRefresh: () => {},
    onOpenTask: () => {},
  },
} satisfies Meta<typeof PublishedWork>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyToFinish: Story = {};
