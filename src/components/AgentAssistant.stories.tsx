import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AgentAssistant } from './AgentAssistant';

const meta = {
  title: 'Components/AgentAssistant',
  component: AgentAssistant,
  args: {
    content: '# Getting started\n\nExisting introduction.\n',
    onGenerate: async ({ prompt }) => ({
      content: '# Getting started\n\nImproved introduction.\n\n## Setup\n\nFollow the project setup guide.\n',
      summary: `Mock proposal for: ${prompt}`,
    }),
    onApply: () => {},
  },
  render: (args) => {
    const [content, setContent] = useState(args.content);
    return <div className="space-y-4 p-4">
      <label className="block text-sm">Document draft
        <textarea value={content} onChange={(event) => setContent(event.target.value)}
          className="block w-full bg-slate-900 p-3 text-slate-100" />
      </label>
      <AgentAssistant {...args} content={content} onApply={setContent} />
    </div>;
  },
} satisfies Meta<typeof AgentAssistant>;

export default meta;
type Story = StoryObj<typeof meta>;
export const ImproveContent: Story = {};
export const CreateContent: Story = { args: { content: '' } };
export const Unavailable: Story = {
  args: { onGenerate: async () => { throw new Error('Copilot is not authenticated. Authenticate the server user with Copilot CLI first.'); } },
};
