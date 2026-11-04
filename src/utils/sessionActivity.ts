import type { AgentRuntime } from '../../shared/types/agent';

type RuntimeEvent = AgentRuntime['events'][number];
type JsonValue = RuntimeEvent['data'][string];

type ActivityBase = {
  key: string;
  timestamp: string;
  agentId?: string;
};

type TextFields = ActivityBase & {
  text: string;
  complete: boolean;
};

export type TextActivity = (TextFields & { kind: 'message' }) | (TextFields & { kind: 'reasoning' });

export type ToolActivity = ActivityBase & {
  kind: 'tool';
  name: string;
  title?: string;
  arguments?: JsonValue;
  status: 'running' | 'completed' | 'failed' | 'unrecorded';
  progress?: string;
  partialOutput?: string;
  shellOutput?: string;
  result?: JsonValue;
  error?: string;
};

type SubagentActivity = ActivityBase & {
  kind: 'subagent';
  name: string;
  description?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'unrecorded';
  error?: string;
};

export type AgentActivity = TextActivity | ToolActivity | SubagentActivity
  | (ActivityBase & { kind: 'intent'; text: string })
  | (ActivityBase & { kind: 'skill'; name: string })
  | (ActivityBase & { kind: 'notice'; level: 'info' | 'warning' | 'error'; message: string });

function string(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function object(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function errorMessage(value: JsonValue | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (value == null) return undefined;
  return string(object(value)?.message) ?? JSON.stringify(value);
}

export function sessionActivity(runtimes: AgentRuntime[], phase: AgentRuntime['phase']): AgentActivity[] {
  const items: AgentActivity[] = [];

  for (const runtime of runtimes) {
    if (runtime.phase !== phase) continue;
    const texts = new Map<string, TextActivity>();
    const tools = new Map<string, ToolActivity>();
    const subagents = new Map<string, SubagentActivity>();
    const scope = (event: RuntimeEvent, id: string) => JSON.stringify([event.agentId ?? null, id]);
    const base = (event: RuntimeEvent, key: string): ActivityBase => ({
      key: `${runtime.id}:${key}`, timestamp: event.timestamp,
      ...(typeof event.agentId === 'string' ? { agentId: event.agentId } : {}),
    });
    const textFor = (event: RuntimeEvent, kind: TextActivity['kind'], key: string): TextActivity => {
      const existing = texts.get(key);
      if (existing) return existing;
      const fields = { ...base(event, key), text: '', complete: false };
      const item: TextActivity = kind === 'reasoning'
        ? { ...fields, kind: 'reasoning' }
        : { ...fields, kind: 'message' };
      texts.set(key, item);
      items.push(item);
      return item;
    };
    const toolFor = (event: RuntimeEvent): ToolActivity => {
      const id = string(event.data.toolCallId) ?? event.id;
      const key = scope(event, id);
      let item = tools.get(key);
      if (!item) {
        item = {
          ...base(event, `tool:${key}`), kind: 'tool', name: 'Tool',
          status: runtime.status === 'running' ? 'running' : 'unrecorded',
        };
        tools.set(key, item);
        items.push(item);
      }
      return item;
    };

    for (const event of runtime.events) {
      const { data } = event;
      if (event.type === 'assistant.message' || event.type === 'assistant.message_delta'
        || event.type === 'assistant.reasoning' || event.type === 'assistant.reasoning_delta') {
        const kind = event.type.startsWith('assistant.reasoning') ? 'reasoning' : 'message';
        const delta = event.type.endsWith('_delta');
        const value = string(delta ? data.deltaContent : data.content);
        if (value === undefined) continue;
        const id = string(kind === 'reasoning' ? data.reasoningId : data.messageId) ?? event.id;
        const key = `${kind}:${scope(event, id)}`;
        const item = textFor(event, kind, key);
        if (delta) {
          if (!item.complete) item.text += value;
        } else {
          item.text = value;
          item.complete = true;
        }
      } else if (event.type === 'tool.execution_start') {
        const item = toolFor(event);
        item.name = string(data.toolName) ?? item.name;
        item.title = string(data.toolTitle);
        item.arguments = data.arguments;
      } else if (event.type === 'tool.execution_progress') {
        toolFor(event).progress = string(data.progressMessage);
      } else if (event.type === 'tool.execution_partial_result') {
        toolFor(event).partialOutput = string(data.partialOutput);
      } else if (event.type === 'tool.shell_output') {
        const item = toolFor(event);
        item.shellOutput = (item.shellOutput ?? '') + (string(data.text) ?? '');
      } else if (event.type === 'tool.execution_complete') {
        const item = toolFor(event);
        item.status = data.success === true ? 'completed' : data.success === false ? 'failed' : 'unrecorded';
        item.result = data.result;
        item.error = errorMessage(data.error);
      } else if (event.type === 'assistant.intent') {
        const text = string(data.intent);
        if (text) items.push({ ...base(event, `intent:${event.id}`), kind: 'intent', text });
      } else if (event.type === 'skill.invoked') {
        items.push({ ...base(event, `skill:${event.id}`), kind: 'skill', name: string(data.name) ?? 'Skill' });
      } else if (event.type === 'subagent.started' || event.type === 'subagent.completed' || event.type === 'subagent.failed') {
        const id = string(data.toolCallId) ?? event.id;
        let item = subagents.get(id);
        if (!item) {
          item = {
            ...base(event, `subagent:${id}`), kind: 'subagent',
            name: string(data.agentDisplayName) ?? string(data.agentName) ?? 'Subagent',
            status: runtime.status === 'running' ? 'running' : 'unrecorded',
          };
          subagents.set(id, item);
          items.push(item);
        }
        if (event.type === 'subagent.started') item.description = string(data.agentDescription);
        if (event.type === 'subagent.completed') item.status = data.cancelled === true ? 'cancelled' : 'completed';
        if (event.type === 'subagent.failed') {
          item.status = 'failed';
          item.error = errorMessage(data.error);
        }
      } else if (event.type === 'session.info' || event.type === 'session.warning' || event.type === 'session.error') {
        const message = string(data.message);
        if (message) items.push({
          ...base(event, `notice:${event.id}`), kind: 'notice',
          level: event.type === 'session.error' ? 'error' : event.type === 'session.warning' ? 'warning' : 'info',
          message,
        });
      }
    }
  }

  return items.filter((item) => item.kind !== 'message' && item.kind !== 'reasoning' || item.text.trim());
}

export function showActivityReport(items: AgentActivity[], output: string, active: boolean): boolean {
  const report = output.trim();
  if (!report) return false;
  const messages = items.filter((item): item is TextActivity =>
    item.kind === 'message' && !item.agentId);
  if (!messages.length) return true;
  if (active) return false;
  return !messages.some((message) => message.text.trim() === report)
    && messages.map((message) => message.text).join('\n\n').trim() !== report;
}

const TOOL_LABELS: Record<string, string> = {
  ticket_list_files: 'List files',
  ticket_read_file: 'Read file',
  ticket_search_files: 'Search files',
  ticket_graph_query: 'Query code graph',
  ticket_graph_explain: 'Explain code graph',
  ticket_graph_path: 'Find graph path',
  ticket_graph_affected: 'Find affected code',
  ticket_create_directory: 'Create directory',
  ticket_delete_file: 'Delete file',
  ticket_write_file: 'Write file',
  ticket_run_checks: 'Run checks',
  ticket_ask_user: 'Ask a question',
};

export function toolLabel(item: ToolActivity): string {
  return TOOL_LABELS[item.name] ?? item.title ?? item.name;
}

export function toolArgumentSummary(value: JsonValue | undefined): string {
  const args = object(value);
  if (!args) return '';
  return ['path', 'query', 'question', 'node', 'from', 'to', 'script', 'command']
    .map((key) => string(args[key]))
    .filter((part): part is string => !!part)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .join(' · ')
    .slice(0, 180);
}
