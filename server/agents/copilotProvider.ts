import { CopilotClient, type SessionConfig } from '@github/copilot-sdk';
import type { AgentProvider, AgentRequest } from './provider';
import { agentMessage } from './contextFiles';
import type { CodeGraph } from './codeGraph';
import { RuntimeTelemetry } from './runtimeTelemetry';
import { GRAPHIFY_SKILL_INSTRUCTION, graphifySkillConfiguration } from './graphifySkill';
import { copilotTicketTools } from './ticketTools';
import { ticketSession } from './ticketSession';

async function accountQuota(client: CopilotClient) {
  const observedAt = new Date().toISOString();
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { quotaSnapshots } = await Promise.race([
      client.rpc.account.getQuota({}),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Quota request timed out')), 5_000); }),
    ]).finally(() => clearTimeout(timer));
    return { observedAt, quotaSnapshots };
  } catch (error) {
    return { observedAt, error: error instanceof Error ? error.message : String(error) };
  }
}

export function unavailableModelError(error: unknown, model: string | undefined, fromTicket: boolean) {
  if (!model || !(error instanceof Error) || !/model\b.*\bis not available/i.test(error.message)) return null;
  return new Error(fromTicket
    ? `Model "${model}" selected on this ticket is not available for your Copilot account. Edit the ticket, choose another model or the default, then retry.`
    : `Server default model "${model}" (COPILOT_MODEL) is not available for your Copilot account. Change or remove COPILOT_MODEL in .env and restart the server, or select a model on the ticket.`,
  { cause: error });
}

export class CopilotProvider implements AgentProvider {
  readonly id = 'copilot';

  constructor(private readonly codeGraph?: CodeGraph) {}

  async models() {
    const client = new CopilotClient();
    try {
      await client.start();
      const auth = await client.getAuthStatus();
      if (!auth.isAuthenticated) throw new Error('Authenticate the server user with Copilot CLI to load models.');
      return (await client.listModels())
        .filter((model) => model.policy?.state !== 'disabled')
        .map(({ id, name }) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } finally {
      await client.stop();
    }
  }

  async health() {
    const client = new CopilotClient();
    try {
      await client.start();
      const auth = await client.getAuthStatus();
      return { authenticated: auth.isAuthenticated };
    } finally { await client.stop(); }
  }

  async run(request: AgentRequest): Promise<string> {
    const telemetry = new RuntimeTelemetry(request);
    try {
      await telemetry.update({});
      const result = await this.runSession(request, telemetry);
      await telemetry.finish();
      return result;
    } catch (error) {
      await telemetry.finish(error);
      throw error;
    }
  }

  private async runSession(request: AgentRequest, telemetry: RuntimeTelemetry): Promise<string> {
    const graph = await this.codeGraph?.prepare(request.workspace, request.signal);
    const definition = ticketSession(request, graph, () => telemetry.setPhase('plan'));
    const tools = copilotTicketTools(definition.tools);
    const client = new CopilotClient();
    const abort = () => { void client.forceStop().catch((error: unknown) => console.error('Unable to stop Copilot:', error)); };
    request.signal?.addEventListener('abort', abort, { once: true });
    let authenticated = false;
    try {
      request.signal?.throwIfAborted();
      await client.start();
      const auth = await client.getAuthStatus();
      if (!auth.isAuthenticated) throw new Error('Copilot is not authenticated. Authenticate the server user with Copilot CLI first.');
      authenticated = true;
      await telemetry.update({ accountQuotaAtStart: await accountQuota(client) });
      const message = agentMessage(request);
      const ticketModel = request.context.task.agentModel;
      const requestedModel = request.resolvedModel || ticketModel || process.env.COPILOT_MODEL || undefined;
      const configuration = {
        onEvent: telemetry.event,
        workingDirectory: request.workspace,
        ...(requestedModel ? { model: requestedModel } : {}),
        ...graphifySkillConfiguration(tools),
        streaming: true,
        systemMessage: {
          mode: 'replace',
          content: [...definition.instructions, GRAPHIFY_SKILL_INSTRUCTION].join('\n'),
        },
      } satisfies SessionConfig;
      await telemetry.update({
        message, configuration,
        permissionPolicy: 'Only the bundled ticket-graphify skill may be loaded. Registered custom tools are approved; built-in permissions are denied.',
      });
      const session = await client.createSession(configuration).catch((error: unknown) => {
        throw unavailableModelError(error, requestedModel, !!ticketModel) ?? error;
      });
      await telemetry.update({}, session.sessionId);
      await request.onSession(session.sessionId);
      let content = '';
      let messageId: string | undefined;
      let contentWriteError: unknown;
      let contentWrites = Promise.resolve();
      let contentWriteTimer: ReturnType<typeof setTimeout> | undefined;
      const queueContentWrite = (snapshot: string) => {
        contentWrites = contentWrites.then(async () => {
          if (contentWriteError || !request.onContent) return;
          try { await request.onContent(snapshot); }
          catch (error) { contentWriteError = error; }
        });
      };
      const unsubscribe = session.on('assistant.message_delta', (event) => {
        if (event.agentId) return;
        if (messageId && messageId !== event.data.messageId) content += '\n\n';
        messageId = event.data.messageId;
        content += event.data.deltaContent;
        if (!contentWriteTimer) {
          contentWriteTimer = setTimeout(() => {
            contentWriteTimer = undefined;
            queueContentWrite(content);
          }, 250);
        }
      });
      let response;
      try {
        response = await session.sendAndWait(message, 3_600_000);
      } finally {
        unsubscribe();
        if (contentWriteTimer) clearTimeout(contentWriteTimer);
        contentWriteTimer = undefined;
        if (content) queueContentWrite(content);
        await contentWrites;
      }
      if (contentWriteError) throw contentWriteError;
      if (!response?.data.content?.trim()) throw new Error('Copilot returned no response');
      return response.data.content;
    } finally {
      request.signal?.removeEventListener('abort', abort);
      if (authenticated && !request.signal?.aborted) {
        await telemetry.update({ accountQuota: await accountQuota(client) })
          .catch((error: unknown) => console.warn('Unable to record Copilot quota:', error));
      }
      await client.stop();
      await graph?.dispose().catch((error: unknown) => console.warn('Unable to remove code graph:', error));
    }
  }
}
