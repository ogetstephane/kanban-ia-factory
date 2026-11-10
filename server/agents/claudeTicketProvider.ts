import { tool } from '@anthropic-ai/claude-agent-sdk';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentProvider, AgentRequest } from './provider';
import type { CodeGraph, PreparedCodeGraph } from './codeGraph';
import { RuntimeTelemetry } from './runtimeTelemetry';
import { ticketSession } from './ticketSession';
import { ticketWorkflowAgent } from './workflowRuntime';
import { agentMessage } from './contextFiles';
import { withClaudeQuery, CLAUDE_RUNTIME_VERSION, CLAUDE_SDK_VERSION, type ClaudeRuntimeOptions } from './adapters/claudeRuntime';
import { claudeToolSession, validateClaudeInitialization, claudeInventorySchema, claudeResultSchema } from './adapters/claudeToolSession';

export interface ClaudeTicketOptions extends ClaudeRuntimeOptions {
  enabled: boolean;
}

/** Experimental ticket runtime, separate from the read-only analysis port. */
export class ClaudeTicketProvider implements AgentProvider {
  readonly id = 'claude-code';
  constructor(private readonly runtimeOptions: ClaudeTicketOptions, private readonly codeGraph?: CodeGraph) {}

  private assertEnabled() {
    if (!this.runtimeOptions.enabled) throw new Error('Claude ticket execution is experimental and disabled.');
    if (!this.runtimeOptions.apiKey?.trim()) throw new Error('Explicit KANBAN_CLAUDE_API_KEY is required for Claude tickets.');
  }

  async health() {
    this.assertEnabled();
    return withClaudeQuery(this.runtimeOptions, {}, new AbortController().signal, async (session) => {
      const account = await session.accountInfo();
      return { authenticated: !!account.apiKeySource && account.apiKeySource !== 'none',
        issue: 'Explicit key source detected only; service credentials and billing are not validated.' };
    });
  }

  async models() {
    this.assertEnabled();
    return withClaudeQuery(this.runtimeOptions, {}, new AbortController().signal, async (session) =>
      (await session.supportedModels()).map(({ value, resolvedModel, displayName }) =>
        ({ id: resolvedModel ?? value, name: displayName })));
  }

  async run(request: AgentRequest) {
    this.assertEnabled();
    const model = request.resolvedModel || request.context.task.agentModel || ticketWorkflowAgent(request)?.model;
    if (!model) throw new Error('Select an explicit Claude model on the ticket or configure KANBAN_CLAUDE_MODEL.');
    const message = agentMessage(request);
    if (message.attachments?.length) throw new Error('Experimental Claude tickets accept UTF-8 text context only. Replace binary attachments with readable text.');
    const signal = AbortSignal.any([request.signal ?? new AbortController().signal, AbortSignal.timeout(3_600_000)]);
    signal.throwIfAborted();
    const telemetry = new RuntimeTelemetry(request);
    let graph: PreparedCodeGraph | undefined;
    let callbackError: unknown;
    const persist = async <T>(action: () => Promise<T>) => {
      try { return await action(); } catch (error) { callbackError ??= error; throw error; }
    };
    try {
      graph = await this.codeGraph?.prepare(request.workspace, signal);
      const definition = ticketSession({
        ...request, signal,
        ask: (question) => persist(() => request.ask(question)),
        recordCheck: request.recordCheck ? (check) => persist(() => request.recordCheck!(check)) : undefined,
        requestPlanApproval: request.requestPlanApproval
          ? (proposal) => persist(() => request.requestPlanApproval!(proposal)) : undefined,
      }, graph, () => telemetry.setPhase('plan'));
      const skill = request.context.workflow?.versionId || request.context.workflow?.document.execution ? ''
        : await readFile(new URL('../skills/ticket-graphify/SKILL.md', import.meta.url), 'utf8');
      const tools = definition.tools.map((item) => tool(item.name, item.description, item.parameters.shape,
        async (args) => {
          const callId = randomUUID();
          telemetry.event({ id: randomUUID(), type: 'tool.execution_start', timestamp: new Date().toISOString(),
            data: { toolCallId: callId, toolName: item.name, arguments: args } });
          try {
            if (callbackError) throw callbackError;
            signal.throwIfAborted();
            const output = await item.invoke(args);
            const text = typeof output === 'string' ? output : JSON.stringify(output);
            telemetry.event({ id: randomUUID(), type: 'tool.execution_complete', timestamp: new Date().toISOString(),
              data: { toolCallId: callId, success: true, result: { content: text } } });
            return { content: [{ type: 'text', text }] };
          } catch (error) {
            console.error('Claude ticket tool failed:', error);
            const message = error instanceof Error ? error.message : 'Ticket tool failed.';
            telemetry.event({ id: randomUUID(), type: 'tool.execution_complete', timestamp: new Date().toISOString(),
              data: { toolCallId: callId, success: false, error: { message } } });
            return { isError: true, content: [{ type: 'text', text: message }] };
          }
        }));
      const configuration = claudeToolSession(tools, [
        ...definition.instructions, 'Delegation and all native tools are forbidden.',
        `Tool aliases: ${tools.map(({ name }) => `${name} -> mcp__analysis__${name}`).join(', ')}.`,
        ...(skill ? ['The following bundled skill is injected once; do not invoke native skills:', skill] : []),
      ].join('\n'), signal, async (name, callId, reason) => {
        telemetry.event({ id: randomUUID(), type: 'tool.denied', timestamp: new Date().toISOString(), data: { name, callId, reason } });
      });
      await telemetry.update({
        provider: this.id, experimental: true, sdkVersion: CLAUDE_SDK_VERSION,
        runtimeVersion: CLAUDE_RUNTIME_VERSION, requestedModel: model,
        permissionPolicy: 'Only host ticket tools via SDK MCP; native tools, ambient settings and delegation denied. No strict billing cap.',
        skill: request.context.workflow?.versionId || request.context.workflow?.document.execution ? 'workflow step skills (injected)' : 'ticket-graphify (injected)',
        tools: tools.map(({ name }) => name),
        configuration: {
          systemPrompt: configuration.options.systemPrompt,
          tools: definition.tools.map(({ name, description, parameters }) => ({
            name, description, parameters: z.toJSONSchema(parameters),
          })),
        },
      });
      const output = await withClaudeQuery(this.runtimeOptions, {
        ...configuration.options, model, includePartialMessages: true, maxTurns: 40,
      }, signal, async (session, send, directory) => {
        validateClaudeInitialization(await session.initializationResult());
        configuration.validateBroker(await session.mcpServerStatus());
        signal.throwIfAborted();
        send(message.prompt);
        let sessionId: string | undefined;
        let result: z.infer<typeof claudeResultSchema> | undefined;
        let content = '';
        let lastContentWrite = 0;
        for await (const input of session) {
          configuration.assertNoRefusal();
          if (callbackError) throw callbackError;
          signal.throwIfAborted();
          const envelope = z.object({ type: z.string(), subtype: z.string().optional() }).parse(input);
          if (envelope.type === 'system' && envelope.subtype === 'init') {
            const inventory = claudeInventorySchema.parse(input);
            configuration.validateInventory(inventory, directory, CLAUDE_RUNTIME_VERSION, model);
            if (sessionId) throw new Error('Claude emitted multiple ticket session inventories.');
            sessionId = inventory.session_id;
            await telemetry.update({}, sessionId);
            telemetry.event({ id: randomUUID(), type: 'session.start', timestamp: new Date().toISOString(),
              data: { selectedModel: model, runtimeVersion: CLAUDE_RUNTIME_VERSION } });
            await request.onSession(sessionId);
          } else if (envelope.type === 'assistant') {
            const assistant = z.object({ parent_tool_use_id: z.string().nullable(),
              message: z.object({ content: z.array(z.object({ type: z.string(), name: z.string().optional(), id: z.string().optional() })) }),
            }).parse(input);
            if (assistant.parent_tool_use_id) await configuration.assertToolAllowed('Agent', assistant.parent_tool_use_id);
            for (const block of assistant.message.content) {
              if (block.type === 'tool_use') {
                if (!block.name || !block.id) throw new Error('Invalid Claude ticket tool call.');
                await configuration.assertToolAllowed(block.name, block.id);
              }
            }
          } else if (envelope.type === 'system' && envelope.subtype === 'task_started') {
            await configuration.assertToolAllowed('Agent', 'unexpected-task');
          } else if (envelope.type === 'stream_event') {
            const partial = z.object({ parent_tool_use_id: z.string().nullable(), event: z.object({
              type: z.string(), delta: z.object({ type: z.string(), text: z.string().optional() }).optional(),
            }) }).parse(input);
            if (partial.parent_tool_use_id) await configuration.assertToolAllowed('Agent', partial.parent_tool_use_id);
            if (partial.event.type === 'content_block_delta' && partial.event.delta?.type === 'text_delta') {
              content += partial.event.delta.text ?? '';
              if (Date.now() - lastContentWrite >= 250) {
                await request.onContent?.(content);
                lastContentWrite = Date.now();
              }
            }
          } else if (envelope.type === 'result') {
            if (result) throw new Error('Claude emitted multiple ticket results.');
            result = claudeResultSchema.parse(input);
          }
        }
        configuration.assertNoRefusal();
        if (callbackError) throw callbackError;
        signal.throwIfAborted();
        if (!sessionId || !result || result.session_id !== sessionId) throw new Error('Claude ticket ended without a matching inventory and terminal result.');
        if (result.permission_denials.length || result.is_error || result.subtype !== 'success') {
          throw new Error(`Claude ticket failed: ${result.errors?.join('; ') || result.subtype}; denied tools: ${result.permission_denials.length}.`);
        }
        if (!result.result?.trim()) throw new Error('Claude returned no ticket response.');
        await request.onContent?.(result.result);
        return result.result;
      }).catch((error: unknown) => { configuration.assertNoRefusal(); throw error; });
      signal.throwIfAborted();
      await telemetry.finish();
      return output;
    } catch (error) {
      await telemetry.finish(error);
      throw error;
    } finally {
      await graph?.dispose();
    }
  }
}
