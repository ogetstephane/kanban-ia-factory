import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TaskPage from './TaskPage';
import { project, tasks } from './stories/fixtures';

const meta = {
  title: 'Components/TaskPage',
  component: TaskPage,
  decorators: [(Story, context) => <MemoryRouter initialEntries={[context.parameters.editorPath]}>
    <Routes>
      <Route path="/projects/:projectId/tasks/new" element={<Story />} />
      <Route path="/projects/:projectId/tasks/:taskId/edit" element={<Story />} />
      <Route path="/projects/:projectId/board" element={<p role="status">Returned to the project board</p>} />
    </Routes>
  </MemoryRouter>],
  parameters: { editorPath: `/projects/${project.id}/tasks/new` },
} satisfies Meta<typeof TaskPage>;

export default meta;
type Story = StoryObj<typeof meta>;
export const NewTask: Story = {};
export const EditTask: Story = {
  parameters: { editorPath: `/projects/${project.id}/tasks/${tasks[0].id}/edit` },
};
