import { defineTool, type ToolResultObject } from '@github/copilot-sdk';
import type { PreparedCodeGraph } from './codeGraph';
import type { WorkspaceTools } from './workspaceTools';
import { graphToolDefinitions, readOnlyToolDefinitions, type TicketTool } from './ticketToolDefinitions';

export function copilotTicketTools(tools: TicketTool[]) {
  return tools.map((item) => defineTool(item.name, {
    description: item.description, parameters: item.parameters,
    handler: (input) => toolResult(() => item.invoke(input)),
  }));
}

export function graphTools(graph: PreparedCodeGraph) {
  return copilotTicketTools(graphToolDefinitions(graph));
}

export function readOnlyTools(files: WorkspaceTools) {
  return copilotTicketTools(readOnlyToolDefinitions(files));
}

export async function toolResult(operation: () => Promise<unknown>): Promise<ToolResultObject> {
  try {
    const result = await operation();
    return { resultType: 'success', textResultForLlm: typeof result === 'string' ? result : JSON.stringify(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ticket tool failed';
    console.error('Ticket agent tool failed:', error);
    return { resultType: 'failure', textResultForLlm: message, error: message };
  }
}
