import { defineTool, type ToolResultObject } from '@github/copilot-sdk';
import { z } from 'zod';
import type { PreparedCodeGraph } from './codeGraph';
import type { WorkspaceTools } from './workspaceTools';

const graphTerm = z.string().min(1).max(200);

export function graphTools(graph: PreparedCodeGraph) {
  const note = 'The code graph reflects the workspace when this phase started; confirm details by reading files.';
  return [
    defineTool('ticket_graph_query', {
      description: `Ask the Graphify code knowledge graph a natural-language question (e.g. "how is a session approved?") and get the relevant symbols, files and relationships. Prefer it to broad text searches for architecture and dependency questions. ${note}`,
      parameters: z.object({ question: graphTerm, budget: z.number().int().min(200).max(6000).optional() }),
      handler: ({ question, budget }) => toolResult(() => graph.query(question, budget)),
    }),
    defineTool('ticket_graph_explain', {
      description: `Explain one code symbol or file from the code graph with its most connected neighbors. ${note}`,
      parameters: z.object({ node: graphTerm }),
      handler: ({ node }) => toolResult(() => graph.explain(node)),
    }),
    defineTool('ticket_graph_path', {
      description: `Find the shortest relationship path between two code symbols in the code graph. ${note}`,
      parameters: z.object({ from: graphTerm, to: graphTerm }),
      handler: ({ from, to }) => toolResult(() => graph.path(from, to)),
    }),
    defineTool('ticket_graph_affected', {
      description: `List code that calls, imports or references a symbol, to assess the impact of changing it. ${note}`,
      parameters: z.object({ node: graphTerm }),
      handler: ({ node }) => toolResult(() => graph.affected(node)),
    }),
  ];
}

export function readOnlyTools(files: WorkspaceTools) {
  return [
    defineTool('ticket_list_files', {
      description: 'List files in a relative workspace directory, e.g. "src" or "./src"; use "." for the workspace root. Never pass an absolute path or "..". Hidden paths, node_modules, symlinks and paths in .copilotignore are excluded.',
      parameters: z.object({ path: z.string() }),
      handler: ({ path }) => toolResult(() => files.list(path)),
    }),
    defineTool('ticket_read_file', {
      description: 'Read a UTF-8 file using a workspace-relative path, e.g. "src/App.tsx" or "./src/App.tsx", never an absolute path or "..". Hidden paths, node_modules and paths in .copilotignore are not accessible. For large files, provide startLine and optionally endLine; ranges return line numbers and can cover up to 500 lines.',
      parameters: z.object({
        path: z.string(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
      }),
      handler: ({ path, startLine, endLine }) => toolResult(() => files.read(path, startLine, endLine)),
    }),
    defineTool('ticket_search_files', {
      description: 'Search for literal text under a workspace-relative directory, e.g. "src" or "./src"; use "." for the workspace root, never an absolute path, file path, glob or "..". Returns matching paths, line numbers and snippets. Hidden files, symlinks, binary files, node_modules and paths in .copilotignore are excluded.',
      parameters: z.object({ path: z.string(), query: z.string().min(1).max(200) }),
      handler: ({ path, query }) => toolResult(() => files.search(path, query)),
    }),
  ];
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
