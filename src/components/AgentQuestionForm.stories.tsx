import type { Meta, StoryObj } from '@storybook/react-vite';
import AgentQuestionForm from './AgentQuestionForm';
import { agentQuestion } from './stories/fixtures';

const meta = {
  title: 'Components/AgentQuestionForm',
  component: AgentQuestionForm,
  args: {
    question: agentQuestion,
    pending: false,
    onAnswer: async () => {},
  },
} satisfies Meta<typeof AgentQuestionForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithChoices: Story = {};

export const Pending: Story = {
  args: { pending: true },
};
