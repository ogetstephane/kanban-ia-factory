import { z } from 'zod';
import type { PreparedCodeGraph } from './codeGraph';
import type { WorkspaceTools } from './workspaceTools';

const graphTerm = z.string().min(1).max(200);

export interface TicketTool {
  name: string;
  description: string;
  parameters: z.ZodObject;
  invoke(input: unknown): Promise<unknown>;
}

export function ticketTool<T extends z.ZodObject>(name: string, description: string, parameters: T,
  handler: (input: z.infer<T>) => Promise<unknown>): TicketTool {
  return { name, description, parameters, invoke: (input) => handler(parameters.parse(input)) };
}

export function graphToolDefinitions(graph: PreparedCodeGraph): TicketTool[] {
  const note = 'The code graph reflects the workspace when this phase started; confirm details by reading files.';
  return [
    ticketTool('ticket_graph_query',
      `Ask the Graphify code knowledge graph a natural-language question (e.g. "how is a session approved?") and get the relevant symbols, files and relationships. Prefer it to broad text searches for architecture and dependency questions. ${note}`,
      z.object({ question: graphTerm, budget: z.number().int().min(200).max(6000).optional() }),
      ({ question, budget }) => graph.query(question, budget)),
    ticketTool('ticket_graph_explain', `Explain one code symbol or file from the code graph with its most connected neighbors. ${note}`,
      z.object({ node: graphTerm }), ({ node }) => graph.explain(node)),
    ticketTool('ticket_graph_path', `Find the shortest relationship path between two code symbols in the code graph. ${note}`,
      z.object({ from: graphTerm, to: graphTerm }), ({ from, to }) => graph.path(from, to)),
    ticketTool('ticket_graph_affected', `List code that calls, imports or references a symbol, to assess the impact of changing it. ${note}`,
      z.object({ node: graphTerm }), ({ node }) => graph.affected(node)),
  ];
}

export function readOnlyToolDefinitions(files: WorkspaceTools): TicketTool[] {
  return [
    ticketTool('ticket_list_files',
      'List files in a relative workspace directory, e.g. "src" or "./src"; use "." for the workspace root. Never pass an absolute path or "..". Hidden paths, node_modules, symlinks and paths in .copilotignore are excluded.',
      z.object({ path: z.string() }), ({ path }) => files.list(path)),
    ticketTool('ticket_read_file',
      'Read a UTF-8 file using a workspace-relative path, e.g. "src/App.tsx" or "./src/App.tsx", never an absolute path or "..". Hidden paths, node_modules and paths in .copilotignore are not accessible. For large files, provide startLine and optionally endLine; ranges return line numbers and can cover up to 500 lines.',
      z.object({
        path: z.string(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
      }), ({ path, startLine, endLine }) => files.read(path, startLine, endLine)),
    ticketTool('ticket_search_files',
      'Search for literal text under a workspace-relative directory, e.g. "src" or "./src"; use "." for the workspace root, never an absolute path, file path, glob or "..". Returns matching paths, line numbers and snippets. Hidden files, symlinks, binary files, node_modules and paths in .copilotignore are excluded.',
      z.object({ path: z.string(), query: z.string().min(1).max(200) }), ({ path, query }) => files.search(path, query)),
  ];
}
