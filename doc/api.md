# API reference

All board endpoints are under `/api/board` and defined in
[server/routes/board.ts](../server/routes/board.ts). Request bodies are JSON validated by the
zod schemas in [shared/types/board.ts](../shared/types/board.ts). Responses are sent with
`Cache-Control: no-store`.

## Workflow studio (configuration and preview tests)

The global studio uses `/workflow-editor/:scope`, where `scope` is
`ticket-authoring`, `ticket-processing`, `wiki` or `releases`. Configurations are
independent of project selection. Definitions and graph constraints are validated by
[workflowEditor.ts](../shared/types/workflowEditor.ts).

| Method | Path suffix | Body | Response |
|--------|-------------|------|----------|
| `GET` | none | — | `{ scope, revision, draft, selectedVersionId, versions }` |
| `PUT` | none | `{ revision, document }` | Saved draft and incremented revision |
| `POST` | `/publish` | `{ revision }` | Immutable numbered version, selected as default |
| `POST` | `/select` | `{ revision, versionId }` | Restored default without changing the draft |
| `POST` | `/resolve` | `{ versionId? }` | `{ scope, version, runtimeConnected: false }` |

Reads of an unconfigured scope return an editable template without writing to the
database. The template is not a reconstruction of current runtime behavior. Writes
reject stale revisions with `409`; invalid documents/scopes return `400`; missing
or cross-scope versions return `404`. Responses use `Cache-Control: no-store`.
Graphs must be connected and acyclic, with valid agent, prompt, skill and hook
references. Template placeholders must be declared in their prompt's variables.
Scripts require nonempty content and `approvalRequired: true`, but are stored as
**inert text**: saving, publishing and resolving never run scripts or AI.

The editor document is a design format, not an executable Core workflow catalog.
`/resolve` previews an immutable snapshot, explicitly selected or using the saved
default; it does not start or modify a session. Existing production authoring, ticket, wiki
and release runtimes do not consume these definitions yet. Future integration
must persist the selected snapshot at launch; restoring a default must affect only
future launches, never an already-running execution.

### Preview test runs

These endpoints extend `/workflow-editor/:scope/test-runs`. They use a separate
preview runner, never the production ticket queue or write services.

| Method | Path suffix | Body | Response |
|--------|-------------|------|----------|
| `GET` | `/options` | — | `{ realProviders, previewOnly: true }` |
| `GET` | none | — | Latest 20 run summaries for this scope |
| `POST` | none | Launch configuration below | Persisted pinned test run |
| `GET` | `/:id` | — | Run configuration, immutable document and per-node inputs/outputs/status/errors |
| `POST` | `/:id/approve` | `{ revision, nodeId }` | Continue a waiting preview approval |
| `POST` | `/:id/cancel` | `{ revision }` | Cancel without replay or late success |

A launch requires an explicit published `versionId`, `input` JSON object,
`authorizeRealAgents` boolean, and `agents` keyed by **agent node ID**, not by
definition ID. Every agent node must have exactly one configuration:

```json
{
  "versionId": "00000000-0000-4000-8000-000000000001",
  "input": { "request": "Draft the requested ticket" },
  "authorizeRealAgents": false,
  "agents": {
    "agent-step": {
      "mode": "mock",
      "delayMs": 0,
      "response": { "kind": "output", "output": { "title": "My exact mock" } }
    }
  }
}
```

Alternatively use `response: { kind: "error", error: "Chosen failure" }`, or
`{ mode: "real" }` for a real agent. Mixed runs are supported. Mocks are literal
JSON objects, never implicit fallbacks, and are saved with the run for reuse.
Delay is 0–30,000 ms; JSON objects are bounded at 64,000 characters; launch
configuration at 256,000 characters and 100 agent nodes. All prompt variables
must be supplied as input keys. Strings substitute directly into `{{variable}}`;
other values substitute as JSON. Each agent receives
`{ variables: input, upstream: { predecessorNodeId: output } }` separately.

The initial real preview adapter supports **Copilot only** (`inherit` resolves to
Copilot). Unsupported providers return `422`, absent live-call consent returns
`400`; authentication/output failures fail the step with no provider/mock fallback.
Real calls use isolated temporary SDK sessions, no repository context, disabled
ambient discovery, an empty verified tool inventory, and deny-all permission/tool
hooks. Role, prompt and selected skill text are supplied; tools, delegation,
production autonomy and production iteration settings are not enabled. Calls may
consume AI quota. No live calls are needed for offline validation.

Nodes execute sequentially in topological order; joins wait for all predecessors.
Approval nodes/hooks pause for explicit continuation. Log/validate hooks are
preview checkpoints (JSON structure/size only, not business-quality validation).
Lifecycle-event metadata does not dispatch hooks independently of their graph
position. **Script hooks are skipped**, explicitly marked, and never executed.
No ticket, repository, release or production-session mutation is reachable.

Runs persist their definition, mocks, inputs and outputs. Default restoration or
draft changes cannot modify a launched snapshot. Stale approvals/cancellations
return `409`; cross-scope run IDs return `404`. At most four runs may start/execute
concurrently (`429` otherwise). Active execution segments are limited to ten
minutes, each real call to two minutes, and results to 1,000,000 characters.
Restart marks interrupted running tests failed without replaying AI calls; waiting
approvals remain resumable. Shutdown cancels active tests. Responses are no-store.
Treat persisted test prompts and outputs as application data: do not supply secrets.

## Projects and board

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/projects` | — | Project summaries with `stats` |
| `GET` | `/projects/:id/board` | — | `{ features, tasks }` for that project |
| `GET` | `/board` | — | `{ features, tasks }` across all projects, each entity returned once with its original `projectId` |
| `POST` | `/projects` | Project | Created project |
| `PUT` | `/projects/:id` | Project with `revision` | Updated project |
| `GET` | `/projects/:id/branches` | — | `{ current, branches }` of the project's clone |
| `PUT` | `/projects/:id/branch` | `{ branch, revision }` | Updated project (`409` if the clone has uncommitted changes) |
| `DELETE` | `/projects/:id` | `{ revision }` | `204` (the last project cannot be deleted) |

## Git repositories

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/repositories/branches` | `{ url, token? }` | `{ defaultBranch?, branches }` |
| `GET` | `/repositories/local` | — | `{ enabled, folders }`: git folders found under `LOCAL_REPOSITORY_ROOTS` |
| `GET` | `/repositories/inventory` | — | `{ projects }`: all Git-backed application projects with stored source URL, configured branch, clone path, actual branch/HEAD, registered worktrees and ticket links |

The optional `projectId` query parameter scopes database reads and Git inspection
to that project. The Git screen supplies the selected project ID, or omits it for **All projects**.
Non-Git projects return an empty list; an empty/invalid parameter returns `400`.

Inventory worktrees include `path`, `head`, `branch` (null if detached), `main`,
`bare`, `detached`, nullable `locked`/`prunable` reasons, and nullable `task`
(`id`, `title`, `status`, `sessionStatus`). Each project has a nullable `error`:
an unreadable/missing clone does not hide healthy projects. No plans/reports or
ticket descriptions are loaded. This endpoint performs no remote access or Git mutation.

`POST /projects` also accepts an optional `repository: { url, branch?, token? }`. The server
clones it before creating the project; if the clone fails (`422`, or `504` on timeout), the
project is not created. Repository fields are read-only afterwards. See
[Git repositories](git-repositories.md).

## Features

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/features` | Feature | Created feature |
| `PUT` | `/features/:id` | Feature with `revision` | Updated feature |
| `DELETE` | `/features/:id` | `{ revision }` | `204`; linked tasks are unlinked |

Feature `status` uses the same workflow stages and transition rules as task status. Updating
an epic's status does not update linked tickets or queue a Copilot session.

## Tasks

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/tasks` | Task (with subtasks) | Created task |
| `PUT` | `/tasks/:id` | Task with `revision` | Updated task |
| `DELETE` | `/tasks/:id` | `{ revision }` | `204` |
| `POST` | `/tasks/:id/move` | `{ revision, status, index? }` | Updated task |

`status` is one of `Backlog`, `To Do`, `In Progress`, `Review`, `Done`. `index` is the target
position in the column; omit it to append. Status changes must follow the
[task workflow](./workflow.md) (`422` otherwise); new tasks start in `Backlog` or `To Do`.

### Ticket drafting

`POST /projects/:projectId/tasks/assistant` proposes a specification for an unsaved
new or existing ticket. It does not create/update a task or queue a ticket workflow.
The server resolves the owning project's clone; callers cannot choose a filesystem path.

Input is validated by [taskDraft.ts](../shared/types/taskDraft.ts): `title` is required;
`currentDescription`, `featureTitle`, `priority`, `agentModel`, `acceptanceCriteria`,
`subtasks` (text array), `suggestedWorkflow`, `tags`, and `contextFiles` supply the draft.
Attachments follow the existing task upload limits and are forwarded to Copilot.

`mode` is `auto` (default) or `plan`. In `auto`, Copilot specifies the ticket directly
unless it judges that a plan is needed first. In `plan`, it always returns a plan.
Send the reviewed plan as `approvedPlan` (Markdown, up to 20,000 characters) to get the
specification without planning again. The modes are the Copilot SDK custom agents
`kanban-auto-assistant` and `kanban-plan-assistant`. Both preload the bundled
[`assistant-planning`](../server/skills/assistant-planning/SKILL.md) skill.

The read-only Copilot SDK session loads the shared `ticket-graphify` skill on demand.
A plan response is `{ kind: 'plan', plan, reason, graphAvailable }`. A specification
response has `kind: 'proposal'` and contains `title`, `description`, `acceptanceCriteria`, `subtasks`,
`suggestedWorkflow`, `estimatedStoryPoints` (1, 2, 3, 5 or 8), `suggestedTags`,
`impactAnalysis` (Markdown), and `graphAvailable` (whether this run had a graph,
not proof that a particular dependency was verified).
Single-ticket proposals may also include `openQuestions` (up to 30 nonempty
strings, 2,000 characters each); generation requests this field, while older
responses without it remain accepted. Auto-Spec appends these decisions to the
editable description so a manual save preserves them.

Invalid input returns `400`; an unknown project returns `404`; unavailable Copilot
authentication/configuration returns `503`; invalid responses or generation failures
return `502`; rejected model context size returns `413`. There is no template
fallback. Graph unavailability does not block drafting but is explicitly reported.
Disconnecting or cancelling aborts generation. Saving the returned draft remains manual.

In Auto mode, before drafting, essential missing user decisions may instead
produce `{ kind: 'clarification', reason, questions, graphAvailable }`. There are
1–5 unique nonempty questions (2,000 characters each); `reason` has the same limit.
No ticket proposal accompanies this response. The form collects answers and sends
them only on **Generate from answers**, using `clarificationAnswers`:
`[{ question, answer }]` (1–5 entries; question up to 2,000 characters, answer up to
4,000; both trimmed and nonempty). These are reference data, not permissions or
plan approval. Responses use the original project and current draft context.

Clarification is a single round: after answers, the assistant must produce a
proposal or a plan, listing any remaining uncertainty in `openQuestions` rather
than asking again. Another clarification then returns `502`. Plan mode still
requires a plan; `approvedPlan` still requires a proposal. Questions are not
enabled for wiki generation. Invalid question responses return `502`; invalid
answer input returns `400`. No dedicated endpoint or persisted assistant session
is introduced.

Both drafting modes also preload the technology-neutral `ticket-framing`,
`ticket-writing`, `ticket-decomposition` and `ticket-quality` skills. They guide
scope, measurable acceptance criteria, verification, evidence and a final
self-check; structural validation is still enforced by the host.

`POST /projects/:projectId/tasks/breakdown` accepts the same draft input, mode and
approved plan. It uses the same project-scoped read-only tools and cancellation.
It returns a plan, or `{ kind: 'proposal', summary, impactAnalysis, openQuestions,
tasks, graphAvailable }`. Each of 1–20 tasks contains the single-ticket proposal
fields plus `id` (local lowercase slug), `priority`, and `dependsOn` (local IDs).
IDs must be unique; prerequisites must be unique earlier tickets. Missing/self/
forward references and cycles are rejected. Proposals are limited to 150,000
JSON characters. No database writes occur during generation.
It also supports the same clarification response and answer input before
drafting; answers remain attached when a subsequent plan is approved.

The UI requires all prerequisites of selected tickets to remain selected and
saves only on **Add Selected Tasks to Board**, through the existing atomic
`POST /breakdown`. Tickets share the selected feature; prerequisite titles,
per-ticket impact and open questions are preserved in descriptions. Dependency
references are planning metadata, not scheduler-enforced execution gates.
Only Backlog/To Do features can be used in this authoring UI, avoiding immediate
execution when adding tickets to an active epic. A failed save keeps the proposal.

The client derives a deterministic review report through the shared
[proposal checks](../shared/utils/ticketProposalQuality.ts); it is not a
model-authored field or a new API response property. The report reuses the
canonical schemas and flags repeated criteria/subtasks, repeated ticket titles/
descriptions, and declared open decisions (including per-ticket decisions).
Repeated text is compared after Unicode normalization, lowercasing and
whitespace normalization, not semantic similarity. These warnings do not prevent
manual saving; invalid API responses and invalid selected prerequisites still do.
No inference request is needed to compute the report.

## Agent sessions

`GET /agent-options` returns `{ providers }`, with `id` (`copilot` or `claude-code`),
`name`, `defaultModel`, `models`, `available`, `experimental`, and nullable `issue`
for each registered ticket runtime. Catalogue failures are reported per provider.
Tasks accept either provider ID in `agentProvider` (default `copilot`); provider
and explicit model selection are captured with each queued/replanned session.
An empty model selection resolves that runtime's server default per phase.
Plan, execution and
AI review use that runtime without fallback. A stored runtime/context mismatch
is refused. Claude requires explicit experimental activation and a dedicated
server key; options expose it as unavailable otherwise. See
[experimental ticket runtime](./agent-sessions.md#experimental-claude-ticket-runtime).
The project health endpoint still diagnoses the default Copilot runtime, not all
selected ticket runtimes. Auto-Spec and wiki remain separate Copilot assistants.

| Method | Path | Body / query | Response |
|--------|------|--------------|----------|
| `GET` | `/agent-sessions` | `projectId?`, `featureId?`, `status?`, `priority?`, `search?`, `page?`, `actionable=true|cockpit?` | `{ items, total, actionCount, page, pageSize, projects, features }` (metadata only) |
| `GET` | `/agent-workflows` | `projectId?` | Object keyed by ticket ID with `plan`, `approval`, `execution`, `review`, `delivery` states; all scoped runs, without plans, agent output, paths or context |
| `GET` | `/delivery-history` | `projectId?`, `status?`, `search?`, `page?` | `{ items, total, page, pageSize }`, newest delivery attempts first |
| `GET` | `/tasks/:id/session` | — | Session with plan, questions, current-attempt checks, review state, output and errors, or `null` |
| `POST` | `/tasks/:id/session/approve` | `{ sessionId, updatedAt }` (version of the plan read) | Session queued for approved execution |
| `POST` | `/tasks/:id/session/retry` | `{ sessionId, updatedAt }` | Failed/cancelled/unapproved session queued for a fresh read-only plan |
| `POST` | `/tasks/:id/session/answer` | `{ sessionId, questionId, answer }` | Session with the answer persisted |
| `POST` | `/tasks/:id/session/cancel` | `{ sessionId }` | Session stopping or cancelled; partial files retained |
| `POST` | `/tasks/:id/session/feedback` | `{ sessionId, updatedAt, feedback }` | New read-only correction attempt; Review returns to In Progress |
| `GET` | `/tasks/:id/session/history` | — | Archived attempts with context, plans, questions, checks and reports |
| `GET` | `/tasks/:id/session/review` | `path?` | File list, base commit, fingerprint token, criteria and required ticket documentation path/status; full-context Git text diff only for `path`, bounded to 128,000 characters |
| `POST` | `/tasks/:id/session/ai-review` | `{ token }` | Advisory AI review report bound to the current diff fingerprint |
| `POST` | `/tasks/:id/session/accept-review` | `{ sessionId, updatedAt, token }` | Human acceptance bound to this execution and file fingerprint |
| `GET` | `/tasks/:id/session/delivery` | — | Reviewed snapshot/target preview, warnings, current-attempt durable delivery result |
| `POST` | `/tasks/:id/session/delivery/commit` | Delivery request below | Commit the reviewed snapshot on the isolated ticket branch; no merge or task transition |
| `POST` | `/tasks/:id/session/delivery/merge` | Delivery request below | Conflict-preflighted merge into the managed project clone; mark Done only after success |
| `GET` | `/projects/:id/health` | — | Repository/provider diagnostics, available scripts and retained session worktrees |
| `POST` | `/tasks/:id/session/cleanup` | `{ sessionId, updatedAt }` | Removes only a stopped unchanged worktree, preserving branch/history |

Entering In Progress queues a session in the task's own transaction. An already answered
question, stale plan, duplicate approval or mutation of an active session's context returns
`409`. See [agent sessions](./agent-sessions.md) for states, trust boundaries and runtime limits.
Workflow states are `pending`, `active`, `waiting`, `completed`, `failed` or `stopped`.
Session-list metadata includes the same `workflow` object. The board polls the compact
workflow endpoint every two seconds; omitted tickets have no agent run and display pending
steps. Project-scoped results include unassigned tickets, like the project board.
The lazy Cockpit uses `actionable=cockpit` to list waiting questions, plan approvals, failed
sessions, pending human reviews, and accepted reviews awaiting local delivery; its summaries
include only the current delivery status, never plans, reports or question contents.
`/delivery-history` includes local delivery attempts (including failures and unfinished
commits/merges), with ticket/project/feature/release metadata and commit hashes, but no plans
or file contents. Results are filtered and paginated in the database.
Tasks accept `blockedReason` (empty by default, maximum 2,000 characters). This is an
informational indicator, not a workflow or AI-execution gate.
Tasks also accept optional `releaseId`, restricted to a version of their own project.
An Upcoming/In progress version is required for local delivery. The session detail
includes its current `projectId` and `releaseId` for lazy version assignment.

Delivery requests contain `{ sessionId, updatedAt, targetHead, ticketHead, tree, reviewToken,
message, acknowledgeChecks }`, using the values returned by the preview. `message` is trimmed,
required, and limited to 4,000 characters; it is fixed once the delivery record is created.
The server checks accepted human review, scoped context, exact version/content/heads and
latest current-attempt npm test/lint results on each action. Failed/missing checks require
`acknowledgeChecks: true`. Stale previews, dirty/wrong-branch targets and conflicts return
`409`. Missing Git identity returns `422`. Both actions return the refreshed delivery preview.
The session is `delivering` while Git operations run, blocking context edits/replanning.
An interrupted operation retains immutable commit hashes; reload and explicitly retry to
reconcile it without duplicate commits. There is no automatic Git replay on restart.

## Wiki

`GET /projects/:id/wiki`, `GET|PUT /projects/:id/wiki/file`, `GET /projects/:id/wiki/status` and
`POST /projects/:id/wiki/sync` list, read and save documentation files, report what is waiting for
sync, and commit and push saved files. See [Wiki](wiki.md).

## Activity history

| Method | Path | Body / query | Response |
|--------|------|--------------|----------|
| `GET` | `/activity-events` | `projectId?`, `entityType?`, `search?`, `page?` | `{ items, total, page, pageSize }`, newest changes first |
| `GET` | `/activity-events/:entityType/:entityId` | `page?` | Paginated history for one project, feature, ticket, or release |

Activity entries are append-only and retain the entity title/project name captured at the time
of each change, so history remains readable after an entity is deleted. They record selected
field changes and lifecycle summaries, not full entity snapshots. Long descriptions, prompts,
Copilot reports, and question answers are not copied into the log. Actor values (`User`,
`Copilot`, `System`) describe the source category; they are not authenticated user identities.
See [Activity history](activity-history.md) for tracked changes and data-retention details.

## Releases

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/projects/:projectId/releases` | — | Release metadata with ticket/delivered counts (no ticket contents) |
| `GET` | `/releases` | — | Same metadata across all projects; `projectId` identifies the owner even when versions match |
| `POST` | `/projects/:projectId/releases` | `{ version, status }` | Refreshed release list |
| `GET` | `/projects/:projectId/releases/:id` | — | Release details and ticket summaries/merge hashes |
| `PUT` | `/projects/:projectId/releases/:id` | `{ version, status, revision }` | Updated release |
| `PUT` | `/projects/:projectId/tasks/:id/release` | `{ releaseId: string \| null, revision }` | Updated task |
| `GET` | `/projects/:projectId/releases/:id/preview` | — | `{ releaseId, revision, tag, branch, commit, remoteUrl, ticketCount, alreadyTagged }` |
| `POST` | `/projects/:projectId/releases/:id/publish` | `{ revision, branch, commit, remoteUrl }` from preview | Release published only after exact remote tag verification |

Versions use SemVer without the `v` prefix. `status` for creation/edit is `upcoming`,
`in_progress`, or `cancelled`; only publication can set `published`. Versions are unique
per project. Published/cancelled releases are final; a pinned publication can be retried or,
after failure, cancelled with the same version (tags are retained).
Ticket membership changes increment release revisions and are refused after publication is
pinned (cancelled releases allow tickets to be removed/reassigned).

Publication requires all tickets to have a successful latest-attempt local delivery
contained in the target commit. Local/multiple push origins, stale previews and conflicting
tags return `409`; Git/authentication errors return `422`, timeouts `504`. Failed push
retains the local tag and pinned commit, with `error` and `publishing: false`; reload/retry.
There is no force overwrite, branch push, deployment or automatic retry.
See [releases](./releases.md) for credentials and recovery.

## Bulk operations

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/breakdown` | `{ feature, tasks }` | Create the feature if needed plus all tasks in one transaction. |
| `POST` | `/initialize` | `{ projects, features, tasks, releases? }` | Seed an empty database (legacy import); release links must match included project releases. |
| `POST` | `/initialize` | `{ legacy: { projects?, features?, tasks? } }` | Import old browser storage; the server fills absent collections with demo data and normalizes legacy project/feature links. `{ legacy: {} }` selects the full demo seed. Explicit empty arrays are preserved (projects must remain nonempty); invalid data returns 400. |
| `POST` | `/reset` | — | Replace everything with the demo dataset. |

## Errors

All errors return `{ error: string }`.

| Status | Meaning |
|--------|---------|
| `400` | Invalid body (also includes zod `issues`) or a business rule violation, e.g. deleting the last project. |
| `404` | Entity not found. |
| `403` | Local folder outside `LOCAL_REPOSITORY_ROOTS`. |
| `422` | Git clone or branch lookup failed (bad URL, branch, or credentials), or a forbidden [workflow](./workflow.md) transition. |
| `409` | Revision mismatch, duplicate id, or concurrent write. Reload the entity and retry. |
| `500` | Database/unexpected failure. Git may already have completed: reload delivery/release state before retrying. |

## Example

```sh
curl -X POST localhost:3000/api/board/tasks/t1/move \
  -H 'Content-Type: application/json' \
  -d '{"revision": 3, "status": "In Progress"}'
```
