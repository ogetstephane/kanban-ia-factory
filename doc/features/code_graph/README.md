# Code graph (Graphify)

## Purpose

[Graphify](https://github.com/safishamsi/graphify) maps repository code into a knowledge
graph of symbols, files, dependencies and communities. This integration provides:

- A project **Code graph** view with an interactive visualization and a Markdown report.
- An on-demand `ticket-graphify` skill and four read-only tools for ticket drafting and Copilot ticket agents.
- On-demand graph queries instead of automatic graph-summary injection into agent prompts.

Extraction uses local tree-sitter AST parsing, not an LLM. The integration does not
send code to an external labeling service or grant agents a Graphify shell tool.
The selected Copilot model is independent of Graphify configuration.

## How to open

1. Select a project with a Git repository.
2. Choose **Code graph** next to Wiki and Git in the navigation.
3. Wait for the first extraction and clustering to finish; this can take a few seconds
   or longer for a large repository.

The shareable page URL is `/projects/<projectId>/code-graph`. The tab is unavailable
under **Show all** and for projects without a repository.

### What you can do

- **Visualization**: search symbols, inspect nodes and explore community relationships
  using Graphify's generated interactive page.
- **Report**: read the graph summary, highly connected symbols, communities and
  surprising connections.
- **Full screen**: open the visualization in its own browser tab.
- **Rebuild**: force extraction and clustering again.
- Inspect the graph's build time and short commit hash in the header.

The visualization requires internet access to load the SRI-pinned `vis-network`
script from unpkg.com. The report does not require that script.
Large graphs can be rendered as a community-level graph instead of showing every
symbol, depending on the installed Graphify version. If no HTML is generated, the
app shows the report and disables the visualization tab.

## Installation and configuration

Install the `graphifyy` Python package as the user running the server:

```sh
uv tool install graphifyy
# Alternatively:
pipx install graphifyy
```

If neither tool is available, install into a virtual environment:

```sh
python3 -m venv ~/.local/share/graphify-venv
~/.local/share/graphify-venv/bin/pip install graphifyy
```

For the virtual environment option, set `GRAPHIFY_BIN` to the absolute path of
`~/.local/share/graphify-venv/bin/graphify` (expand `~` yourself in the configuration).
Verify the executable with `graphify --help`, or use its full path if it is not on
`PATH`. Restart the application server after changing the environment.

| Variable | Default | Description |
|---|---|---|
| `GRAPHIFY_ENABLED` | enabled | `0`, `false`, `off` or `no` disables Graphify for ticket agents and the project view. |
| `GRAPHIFY_BIN` | `graphify` | Executable name or absolute path on the server. |
| `GRAPHIFY_CACHE_DIR` | `<OS temp directory>/kanban-graphify` | Cache location outside analyzed repositories. Set an absolute path for a custom location. |

Graphify runs with a restricted environment containing `PATH`, `HOME`, `LANG` and
`PYTHONIOENCODING`. The application's API keys are not forwarded.
There is currently no environment setting for custom community names or automatic
LLM naming.

## Analysis scope and exclusions

The shared extraction command is equivalent to:

```sh
graphify extract <workspace> --code-only --force --exclude 'node_modules/' --exclude 'graphify-out/' --out <staging-directory>
```

- `node_modules/` is explicitly excluded at any depth, including nested packages.
- `graphify-out/` is excluded so published graph outputs are not analyzed again.
- Docs, PDFs and images are outside this code-only analysis.
- Graphify applies its own built-in exclusions and repository ignore rules.
- Add a `.graphifyignore` file to the analyzed repository for additional exclusions.
  It uses gitignore-style patterns, for example:

  ```gitignore
  node_modules/
  generated/
  fixtures/large/
  ```

For project graphs, these rules must be present in the project's main clone. For
ticket graphs, they must be present in the ticket worktree; commit shared ignore
rules so they travel with the repository. Rebuild the project graph after changing
ignore rules without changing `HEAD`.

## Agent integration

### Shared on-demand skill

The harness registers the bundled
[`ticket-graphify` skill](../../../.github/skills/ticket-graphify/SKILL.md) with the
Copilot SDK's `skillDirectories` and enables its native `skill` tool. Initial
context contains the skill catalog metadata and a short activation instruction,
not the full workflow or graph report. The agent loads the skill body on demand
by calling `skill` with `{"skill":"ticket-graphify"}`. It is not a separate agent
or session: once activated, its instructions and requested results enter the
current agent's context.

The skill directory is resolved from the harness installation, not the analyzed
repository. Automatic configuration discovery and custom instructions are disabled.
A tool hook rejects other skill names; loading this skill grants no shell, write,
network, or additional filesystem permissions.

The skill requires this workflow for every ticket, including simple ones:

1. Understand the business concepts, technical components and keywords.
2. Query Graphify, explain important components and trace dependencies using the tools below.
3. Identify direct and indirect impacts, incoming/outgoing dependencies, interfaces,
   handlers, database changes, tests and configuration.
4. Verify files exist, inspect sources, distinguish extracted from inferred relationships,
   and supplement incomplete graph results with searches.
5. Before edits, present task understanding, queries executed, impacted files and reasons,
   indirect impacts, uncertainties and an implementation plan.
6. Implement only after analysis, include tests, and compare actual changes with the report.

### Ticket agents

Each planning, execution and automated-review phase builds a fresh graph from its
ticket worktree before creating the Copilot session, then loads the shared skill.
Planning remains read-only. Execution rechecks the approved plan before edits.
Automated review applies impact analysis to the supplied diff without modifying files,
running commands or asking questions. The impact-analysis workflow is skill-guided,
not an enforcement hook that blocks writes until analysis is complete.

If Graphify is unavailable, disabled or a query fails, instructions require an explicit
user notification and source-based analysis instead; the ticket run continues.

The agent also receives these read-only tools:

| Tool | Parameters | Purpose |
|---|---|---|
| `ticket_graph_query` | `question`, optional `budget` | Find relevant symbols, files and relationships for a question. Budget defaults to 2,000 tokens and accepts 200-6,000. |
| `ticket_graph_explain` | `node` | Inspect a symbol or file and its neighbors. |
| `ticket_graph_path` | `from`, `to` | Find a shortest relationship path; this integration uses undirected traversal. |
| `ticket_graph_affected` | `node` | Inspect callers, importers and references to assess impact. |

Tool terms must contain 1-200 printable characters and cannot start with `-`.
Results are capped at 30,000 characters. Ambiguous names and missing matches are
returned as informative answers rather than treated as Graphify process failures.

The graph is a snapshot at phase start, not a live index of subsequent agent edits.
Agents must confirm details by reading the source. Graph-derived content is treated
as untrusted repository data. Phase graphs omit HTML and are disposed of when the
agent run finishes.

### Ticket drafting

**Copilot Auto-Spec** in the new/edit ticket form uses a read-only Copilot SDK
session with the same skill. It sends the unsaved description, existing criteria
and subtasks, tags, workflow, selected model, parent feature title and attachments.
The selected ticket model takes precedence over `COPILOT_MODEL`.

The graph and source tools inspect the project's main clone, not a ticket worktree.
No ticket is saved and no source can be changed. The response fills the editable
specification fields and includes an expandable **Code impact analysis**. Saving
remains manual. The form can cancel generation; closing it or switching tickets
aborts the request, and cancelled results cannot overwrite the draft.

For a project without a repository, only the skill and supplied draft/attachments
are available. If Graphify is disabled or fails, source-based analysis remains
available when there is a repository. The UI explicitly reports graph unavailability.
Copilot authentication, timeouts, and invalid proposals are errors; this drafting
path does not silently fall back to template specifications.

The endpoint is `POST /api/board/projects/:projectId/tasks/assistant`; see the
[API reference](../../api.md#ticket-drafting). The legacy
`/api/copilot/generate-description` helper remains available for existing callers,
but the ticket form no longer uses it.

### Wiki assistant

The Wiki assistant receives only the user's instruction, document and attachments.
It does not build, fetch or inject a project graph, and remains tool-free.

## Cache and rebuild behavior

Project graphs describe the main clone's currently checked-out branch, not an
individual ticket worktree. Opening the view builds
the graph if the report is absent or the clone's `HEAD` differs from the cached commit.
This does not automatically fetch the remote repository.

Uncommitted changes do not change `HEAD`; use **Rebuild** to include them.
The HTML endpoint only serves the last generated visualization and does not build
one itself.

Project cache directories use a hash of the absolute workspace path. Ticket-phase
and draft graphs also have a unique run suffix, so simultaneous drafts inspecting
the same project cannot dispose of each other's graph. Each build runs in a staging
directory, writes commit/build-time metadata, then swaps the completed output into
place. Concurrent project-view requests share the in-progress snapshot build.

Typical project cache contents:

```text
<cache>/<hash>/
  .kanban-version
  graphify-out/
    .graphify_root
    graph.json
    GRAPH_REPORT.md
    graph.html
    .graphify_analysis.json
```

Graphify may produce additional files. Opening or rebuilding the project graph
also copies the generated `graphify-out/` contents to
`<main-clone>/graphify-out/`, including `graph.json`, `GRAPH_REPORT.md` and, when
available, `graph.html`. Existing generated files are overwritten; unrelated files
are preserved. A cached graph is republished without extraction, so deleting the
local copy does not require a rebuild. A publication failure is reported as an error
in the project view.
Identical files are not rewritten on subsequent snapshots or rebuilds. The application's
Vite development watcher ignores `graphify-out/` directories so publishing generated
HTML does not trigger a page-reload loop; source-code hot reload remains enabled.

The destination is the project's main clone resolved by the application, not
necessarily the application server's working directory. Copilot running in that
clone can use the local graph. These files can appear in the clone's Git status;
add `graphify-out/` to its `.gitignore` if they should remain untracked.
Ticket-phase graphs stay exclusively in the external cache and do not enter ticket
diffs. Cached reports shown by the app are capped at 500,000
characters; the placeholder navigation section and report-title date are removed.

## Naming communities

The app runs clustering with `--no-label`, so new graphs use placeholders such as
**Community 0**. The current UI does not provide a rename action.

### Manual names for an existing cached graph

1. Locate the project's directory under `GRAPHIFY_CACHE_DIR`. Inspect
   `graphify-out/.graphify_root` to identify the analyzed workspace.
2. In that directory's `graphify-out`, create or edit `.graphify_labels.json`:

   ```json
   {
     "0": "Agent workflow",
     "1": "Board and tickets"
   }
   ```

   Keys are the community IDs shown in the graph; values are your chosen names.
   These example names are illustrative, not a fixed mapping for every graph.
3. Regenerate the report and visualization without LLM naming:

   ```sh
   graphify cluster-only /absolute/path/to/cache/hash --no-label
   ```

4. Refresh the Code graph page.

The installed Graphify version reuses saved names even with `--no-label`.
Unlisted or changed communities may receive names derived from their central node.

**These edits are temporary:** the application's next forced build or build after
a `HEAD` change replaces the cache, including manually saved labels. Community
membership and IDs can change. Durable names would require an application feature
that stores names outside the cache and matches them to community membership.

Graphify also offers a separate `label` command for LLM-assisted naming. It is not
enabled by this integration: do not supply an external backend without first deciding
whether sending graph-derived code metadata to that backend is acceptable.

## API

All routes are mounted under `/api/board`.

| Method and path | Behavior |
|---|---|
| `GET /api/board/projects/:projectId/code-graph` | Ensure a current project graph and return its snapshot. |
| `POST /api/board/projects/:projectId/code-graph/rebuild` | Force a build and return the new snapshot. |
| `GET /api/board/projects/:projectId/code-graph/view` | Serve the existing HTML visualization. |

Snapshot shape:

```json
{
  "generatedAt": "2026-11-03T10:00:39.494Z",
  "commit": "e93778201ae3fec523f585a908c5ff228aae8d9d",
  "report": "# Graph Report\n...",
  "visualization": true
}
```

`commit` can be `null` when `HEAD` cannot be resolved. The frontend adds a `v` query
parameter based on `generatedAt` to refresh the iframe after a new snapshot.
Responses use `Cache-Control: no-store`; the server-side graph cache is separate
from browser caching.

## Security and troubleshooting

Repository symbols can influence generated HTML. The visualization is served with
a restrictive CSP and runs in an iframe with `sandbox="allow-scripts"`, without
`allow-same-origin`. The response also applies `nosniff` and `no-referrer`.
The CSP permits inline scripts/styles and script loading from unpkg.com, but blocks
network connections, forms and base URLs. The generated external script uses SRI.
These protections isolate the visualization; they are not a process sandbox for
Graphify.

| Symptom | Explanation / action |
|---|---|
| No Code graph tab | Select one project with a repository, not **Show all**. |
| Graphify disabled or missing | Snapshot routes return 503 with a configuration/install hint. Enable it or correct `GRAPHIFY_BIN`, then restart the server. |
| Build fails | The view displays the server error. Check server logs, executable access and repository language support. Builds have a 180-second timeout per command. |
| Visualization returns 404 | Build a snapshot first; HTML may not have been generated for this graph. |
| Blank visualization but a readable report | Check access to unpkg.com and browser script/CSP errors. |
| Graph omits recent local edits | Force **Rebuild**; cache invalidation checks `HEAD`, not working-tree contents. |
| Ticket agent continues without a graph | The fallback instructions require user notification and source-based impact analysis. Build failures also log a warning. Wiki does not use a graph. |

Graph queries have a 30-second timeout. Client disconnection aborts the associated
snapshot request/build signal. Repository lookup errors retain their HTTP status;
unexpected route errors return 500.

## Source files and tests

- [CodeGraph service](../../../server/agents/codeGraph.ts): CLI execution, exclusions,
  caching, snapshots, reports and graph queries.
- [Copilot provider](../../../server/agents/copilotProvider.ts) and
  [context files](../../../server/agents/contextFiles.ts): ticket tools and prompt context.
- [Impact-analysis skill](../../../.github/skills/ticket-graphify/SKILL.md) and
  [SDK registration](../../../server/agents/graphifySkill.ts): on-demand workflow,
  trusted skill selection and unavailable-graph fallback.
- [Task assistant](../../../server/agents/taskAssistant.ts) and
  [drafting route](../../../server/routes/taskAssistant.ts): read-only specification
  generation with the shared skill.
- [Code graph routes](../../../server/routes/codeGraph.ts): snapshot/rebuild/HTML API and CSP.
- [Server composition](../../../server/app.ts): shared service and workspace resolution.
- [CodeGraphView](../../../src/components/CodeGraphView.tsx),
  [API client](../../../src/data/graphApi.ts) and
  [snapshot types](../../../shared/types/codeGraph.ts): frontend integration.
- [Service tests](../../../server/agents/codeGraph.test.ts) and
  [route tests](../../../server/routes/codeGraph.test.ts): graph behavior and HTTP protections.
  The real-Graphify test verifies dependency exclusion and is skipped if Graphify is absent.

Run the focused backend tests with an installed executable:

```sh
GRAPHIFY_BIN=/absolute/path/to/graphify npx tsx --test server/agents/codeGraph.test.ts server/routes/codeGraph.test.ts
```

Validate skill registration, phase permissions and the drafting API without an LLM:

```sh
npx tsx --test server/agents/graphifySkill.test.ts server/agents/copilotProvider.test.ts server/agents/taskAssistant.test.ts server/routes/taskAssistant.test.ts
make test-agent-skills
```

The Make target uses the real Copilot runtime to load the bundled skill through
the native tool, rejects other skill names and checks that a repository-local
replacement cannot override it. It makes no model request. The ordinary test
suite skips that runtime-dependent check unless `COPILOT_SKILL_TEST=1` is set.

## Related features

[Copilot](../copilot/README.md) · [Wiki](../wiki/README.md) ·
[Git](../git/README.md) · [Agent sessions](../../agent-sessions.md)
