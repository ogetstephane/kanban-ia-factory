import { BUILTIN_TOOL_NAMES, createSdkMcpServer, type Options, type McpServerStatus, type SDKSystemMessage, type SDKControlInitializeResponse } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export const claudeInventorySchema = z.object({
  type: z.literal('system'), subtype: z.literal('init'), session_id: z.string().min(1),
  claude_code_version: z.string().min(1), cwd: z.string(), model: z.string(),
  tools: z.array(z.string()), permissionMode: z.literal('default'),
  skills: z.array(z.string()), plugins: z.array(z.object({ name: z.string(), path: z.string() })),
  agents: z.array(z.string()).optional(),
  mcp_servers: z.array(z.object({ name: z.string(), status: z.string(), source: z.string().optional() })),
});
export const claudeResultSchema = z.object({
  type: z.literal('result'), subtype: z.string(), session_id: z.string().min(1),
  is_error: z.boolean(), permission_denials: z.array(z.unknown()),
  result: z.string().optional(), errors: z.array(z.string()).optional(),
});

export function validateClaudeInitialization(initialized: Pick<SDKControlInitializeResponse,
  'hooks_applied' | 'hook_on_failure_supported' | 'agents'>) {
  if (!initialized.hooks_applied || !initialized.hook_on_failure_supported) {
    throw new Error('Claude analysis requires applied fail-closed hooks.');
  }
}

export function claudeToolSession(
  tools: NonNullable<Parameters<typeof createSdkMcpServer>[0]['tools']>,
  instructions: string, signal: AbortSignal, onDenied: (name: string, callId: string, reason: string) => Promise<void>,
) {
  let refusal: Error | undefined;
  const names = tools.map(({ name }) => `mcp__analysis__${name}`);
  const refuse = async (name: string, callId: string, reason: string) => {
    refusal ??= new Error(reason);
    await onDenied(name, callId, refusal.message);
  };
  const options: Options = {
    tools: [], disallowedTools: [...BUILTIN_TOOL_NAMES, 'Task'], allowedTools: [], agents: {}, skills: [], plugins: [],
    additionalDirectories: [], settingSources: [], strictMcpConfig: true,
    mcpServers: { analysis: createSdkMcpServer({ name: 'analysis', tools }) },
    permissionMode: 'default', allowDangerouslySkipPermissions: false,
    persistSession: false, enableFileCheckpointing: false,
    settings: {
      autoMemoryEnabled: false, syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableBundledSkills: true,
      skillOverrides: { doctor: 'off', 'plugin-authoring': 'off' },
      enabledPlugins: {
        'cc-plugin-agents-md@builtin': false, 'cc-plugin-privacy@builtin': false,
        'cc-plugin-plugin-authoring@builtin': false,
      },
    },
    systemPrompt: instructions,
    canUseTool: async (name, _input, context) => {
      await refuse(name, context.toolUseID, `Non-broker tool or managed permission refused: ${name}`);
      return { behavior: 'deny', message: refusal!.message };
    },
    hooks: {
      SubagentStart: [{ onFailure: 'block', hooks: [async (input, callId) => {
        await refuse('Agent', callId ?? 'subagent', `Unexpected subagent lifecycle: ${input.hook_event_name}`);
        return { continue: false, stopReason: refusal!.message };
      }] }],
      PreToolUse: [{ onFailure: 'block', hooks: [async (input, callId) => {
        if (input.hook_event_name === 'PreToolUse' && !signal.aborted && names.includes(input.tool_name)
          && input.mcp_server?.name === 'analysis' && input.mcp_server.source === 'sdk') {
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
        }
        const name = input.hook_event_name === 'PreToolUse' ? input.tool_name : input.hook_event_name;
        await refuse(name, callId ?? 'native', `Non-broker tool refused: ${name}`);
        return { hookSpecificOutput: {
          hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: refusal!.message,
        } };
      }] }],
    },
  };
  return {
    options,
    assertNoRefusal: () => { if (refusal) throw refusal; },
    refuse,
    assertToolAllowed: async (name: string, callId: string) => {
      if (!names.includes(name)) { await refuse(name, callId, `Non-broker tool requested: ${name}`); throw refusal; }
    },
    validateBroker: (servers: Pick<McpServerStatus, 'name' | 'source' | 'status' | 'tools'>[]) => {
      const broker = servers[0];
      if (servers.length !== 1 || broker.name !== 'analysis' || broker.source !== 'sdk'
        || broker.status !== 'connected' || !broker.tools
        || JSON.stringify(broker.tools.map(({ name }) => `mcp__analysis__${name}`).sort()) !== JSON.stringify([...names].sort())) {
        throw new Error('Claude analysis MCP inventory differs from the exclusive broker.');
      }
    },
    validateInventory: (inventory: Pick<SDKSystemMessage, 'skills' | 'plugins' | 'tools' | 'mcp_servers' | 'permissionMode' | 'model' | 'cwd' | 'claude_code_version'>,
      directory: string, runtimeVersion: string, modelId: string) => {
      if (inventory.skills.length || inventory.plugins.length) {
        throw new Error(`Claude analysis runtime inventory contains unexpected skills or plugins: ${[
          ...inventory.skills, ...inventory.plugins.map(({ name }) => name),
        ].join(', ')}.`);
      }
      if (inventory.claude_code_version !== runtimeVersion || inventory.cwd !== directory
        || inventory.model !== modelId || inventory.permissionMode !== 'default'
        || JSON.stringify([...inventory.tools].sort()) !== JSON.stringify([...names].sort())
        || inventory.mcp_servers.length !== 1 || inventory.mcp_servers[0].name !== 'analysis'
        || inventory.mcp_servers[0].source !== 'sdk' || inventory.mcp_servers[0].status !== 'connected') {
        throw new Error('Claude analysis runtime inventory differs from the qualified exclusive broker.');
      }
    },
  };
}
