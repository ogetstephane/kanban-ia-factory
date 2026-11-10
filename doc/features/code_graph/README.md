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
[`ticket-graphify` skill](../../../server/skills/ticket-graphify/SKILL.md) with the
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

## Token consumption benchmark

Graphify's local AST extraction uses no model tokens, but loading the skill, graph
tool definitions and query results does. An agent can also keep searching broadly
after querying the graph. Enabling Graphify therefore does **not** guarantee lower
end-to-end token consumption.

### Reproduce the controlled comparison

```sh
make test-agent-graphify
# Optional overrides:
GRAPHIFY_BENCHMARK_MODEL=mai-code-1.1-flash \
GRAPHIFY_BENCHMARK_OUTPUT=test-results/graphify-benchmark.json \
make test-agent-graphify
```

Requires authenticated Copilot and a working Graphify executable (`GRAPHIFY_BIN`
can override it). This opt-in test consumes AI quota and is excluded from
`make test` / `make check`; its accounting unit tests run normally. No dependencies
are installed in the analyzed repository and no application database is opened.

The [benchmark](../../../server/agents/graphifyBenchmark.test.ts) uses the real
production provider, tools and telemetry:

- Extract one committed `HEAD` snapshot into a disposable directory, excluding
  the application database and `.env`. Working-tree edits are not analyzed.
- Run three pairs of fresh, read-only planning sessions on that same snapshot,
  ticket, model and skill. Order alternates: baseline/graph, graph/baseline,
  baseline/graph. Graph extraction is real, code-only and disposable.
- Toggle only graph availability using `CodeGraph.enabled`. The baseline keeps
  the same skill and its source-only fallback, as production does when Graphify
  is disabled. This measures the marginal effect of graph tools, **not** removal
  of the skill or comparison with an unrestricted coding agent.
- Use an explicitly display-only version of "Rename InProgress to Processing on
  Board". Both variants must read and cite the column renderer and canonical
  status definition (either the TypeScript domain type or its Zod validation
  schema). These are minimum evidence checks, not a complete automated
  judgment of plan quality; inspect the saved plans before accepting a benefit.
- Reject missing usage, missing source inspections and graph-enabled runs without
  a successful graph call. Record tool failures rather than hiding them.
- Save per-run usage, provider/runtime IDs, plans, timings and paired comparisons
  in `test-results/graphify-benchmark.json` (ignored by Git). Partial failures
  produce a report marked `failed`, never a successful savings claim.

Positive `savingsPercentage` means fewer tokens with Graphify; negative means
more. The test validates the experiment and accounting, not an assumed positive
result. It can pass while reporting a regression.

Report **cumulative input**, **cache-read input**, **uncached input**
(`inputTokens - cacheReadTokens`) and **output** separately. Cached input is
already included in input tokens: do not add it again. Repeated context is counted
on each model call. Neither input metric alone is a currency cost or a count of
unique source tokens.

Sessions have fresh histories but can share provider-side caches. Alternating
order reduces, but does not eliminate, cache/order effects. Three pairs on one
ticket are exploratory evidence, not a statistically established saving for all
tickets. Execution and review phases are not measured.

### Measured results: 2026-11-04

The complete six-session experiment passed its evidence and telemetry checks.
It analyzed commit `228f6fce64a0803596bd52e46ac89998dab13f04`, with
`mai-code-1.1-flash`, Graphify `0.9.101` and Node `22.23.4`.
The bundled skill's SHA-256 was
`bc627fdc9d7ee93977b28d549b961e1fb93220044b3f07a0f10e0232056ed601`.
Measurement ran from 14:43:16 to 14:49:20 UTC. All six sessions had zero tool
failures, and every graph-enabled session successfully queried the real graph.
Saved plans were inspected: both variants identify the column label rendering
site, preserve the canonical status and propose implementation, tests and docs.
This does not validate implementation quality: no plan was executed.

| Pair | Input without graph | Input with graph | Uncached without graph | Uncached with graph | Model calls without / with |
|---|---:|---:|---:|---:|---:|
| 1 | 211,718 | 254,522 | 24,198 | 28,602 | 12 / 14 |
| 2 | 264,668 | 221,526 | 28,764 | 37,462 | 16 / 15 |
| 3 | 302,806 | 94,058 | 29,654 | 18,282 | 16 / 9 |
| **Total** | **779,192** | **570,106** | **82,616** | **84,346** | **44 / 38** |

| Metric, summed across three runs per variant | Without graph | With graph | Change with graph |
|---|---:|---:|---:|
| Cumulative input tokens, including cache | 779,192 | 570,106 | **26.83% fewer** |
| Cache-read tokens (already included above) | 696,576 | 485,760 | 210,816 fewer |
| Uncached input tokens | 82,616 | 84,346 | **2.09% more** |
| Output tokens | 17,385 | 15,421 | 11.30% fewer |
| Model calls | 44 | 38 | 6 fewer |
| Sum of run wall times, including graph preparation | 175.5 s | 187.7 s | About 7% longer |

**Conclusion:** on this task, Graphify reduced cumulative input by 209,086 tokens,
but did not reduce uncached input. The reduction is in cached-context processing,
not evidence of less new input or lower currency cost. Graphify wins cumulative
input in two of three pairs, and uncached input in only one. The aggregate benefit
is driven by pair 3; pair 1 regresses. Do not promise a general or reliable 26.83%
saving from this small, variable experiment.

Provider session IDs, for correlating the saved report with local Copilot traces:

| Pair | Without graph | With graph |
|---|---|---|
| 1 | `38707c95-51b0-4cb8-9ea6-62937bbd3239` | `a65505fd-96f9-4236-be92-084c37414809` |
| 2 | `f5269a90-be27-46e8-8966-aeb4b5780966` | `b3e8a9e8-4907-4937-b689-5f3b221a047c` |
| 3 | `0e17bcce-974b-4cd4-8bc3-c494ea57e00f` | `63fa8f2a-cfeb-4790-8992-89a088833082` |

An initial pilot was stopped after five sessions because its evidence check
required reading `shared/types/kanban.ts` specifically. The fifth plan had instead
read `shared/types/board.ts`, which also defines the canonical status. The gate
was corrected to accept either source; the complete experiment was restarted
rather than selectively rerunning a high-consumption variant. The pilot's two
completed pairs also showed higher cumulative input with Graphify
(216,361 vs 146,351, and 226,925 vs 210,299). They are not pooled with the final
experiment. The local pilot report is `test-results/graphify-benchmark-pilot.json`.

### Historical runs are not an A/B test

The two inspected planning runtimes both used Graphify, on different commits,
tickets and configurations:

| Runtime | Input | Cache read | Uncached input | Output | Model calls |
|---|---:|---:|---:|---:|---:|
| `ccedc1cf-43d5-4226-a9c1-bd6d658a8a23` | 239,736 | 205,440 | 34,296 | 6,467 | 13 |
| `e8ffcce6-f69f-4f77-8294-cae60f96121f` | 145,191 | 103,936 | 41,255 | 5,123 | 10 |

These observations cannot establish a Graphify saving. The first loaded the
skill but made only one graph query (400-token budget), then broad text searches;
the second also used graph explanation and affected-symbol tools. Higher cache
reuse in the first must not be presented as proof of Graphify efficiency.

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
- [Impact-analysis skill](../../../server/skills/ticket-graphify/SKILL.md) and
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
