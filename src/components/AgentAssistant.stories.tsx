import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AgentAssistant } from './AgentAssistant';

const meta = {
  title: 'Components/AgentAssistant',
  component: AgentAssistant,
  args: {
    content: '# Getting started\n\nExisting introduction.\n',
    onGenerate: async ({ prompt, mode, approvedPlan }) => mode === 'plan' && !approvedPlan
      ? {
        kind: 'plan' as const,
        plan: '1. **Understanding** — restructure the getting-started page.\n2. **Proposed changes** — add a Setup section; keep the introduction.',
        reason: 'Plan mode was selected, so the outline is confirmed before the page is written.',
      }
      : {
        kind: 'proposal' as const,
        content: '# Getting started\n\nImproved introduction.\n\n## Setup\n\nFollow the project setup guide.\n',
        summary: `Mock ${mode} proposal for: ${prompt}${approvedPlan ? ' (from the approved plan)' : ''}`,
      },
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
