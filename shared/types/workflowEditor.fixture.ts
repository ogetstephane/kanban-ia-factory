export const documentFixture = () => ({
  schemaVersion: 1 as const, name: 'Authoring', description: 'Offline workflow fixture',
  prompts: [{ id: 'prompt', name: 'Prompt', template: 'Draft {{request}}', variables: ['request'] }],
  skills: [{ id: 'skill', name: 'Framing', description: 'Frame requests', instructions: 'Preserve user intent.' }],
  agents: [{ id: 'agent', name: 'Writer', role: 'Write a bounded draft', promptId: 'prompt', skillIds: ['skill'],
    provider: 'inherit' as const, model: '', autonomy: 'semi' as const, tools: [], maxIterations: 5 }],
  hooks: [{ id: 'hook', name: 'Check', event: 'after-agent' as const, action: 'script' as const,
    script: 'echo "do not execute"', timeoutMs: 1000, approvalRequired: true as const }],
  nodes: [
    { id: 'writer', kind: 'agent' as const, label: 'Writer', referenceId: 'agent', x: 50, y: 80 },
    { id: 'check', kind: 'hook' as const, label: 'Check', referenceId: 'hook', x: 350, y: 80 },
    { id: 'review', kind: 'approval' as const, label: 'Review', referenceId: '', x: 650, y: 80 },
  ],
  edges: [{ from: 'writer', to: 'check' }, { from: 'check', to: 'review' }],
});
