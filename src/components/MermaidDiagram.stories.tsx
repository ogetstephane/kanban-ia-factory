import type { Meta, StoryObj } from '@storybook/react-vite';
import { MermaidDiagram } from './MermaidDiagram';

const meta = {
  title: 'Components/MermaidDiagram',
  component: MermaidDiagram,
  args: {
    code: 'graph TD\n  Backlog --> "To Do"\n  "To Do" --> "In Progress"\n  "In Progress" --> Review\n  Review --> Done',
  },
} satisfies Meta<typeof MermaidDiagram>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Workflow: Story = {};
