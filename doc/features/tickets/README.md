# Tickets

## Purpose

Tickets are the units of work on the Kanban board. Their editor captures workflow state,
priority, feature/release links, requirements and task-level review/session context.

## How to open

Choose **Add task** in the header or a column's add button; select a card to edit it. A card's
Copilot action also opens the task editor/session area.

## What you can do

- Set title, description, priority, story points, tags, subtasks, acceptance criteria,
  suggested workflow, blocked reason and parent feature.
- Assign a release version belonging to the ticket's project.
- Use Copilot Auto-Spec with the on-demand `ticket-graphify` skill to propose a
  description, criteria, subtasks, tags, workflow and points from the draft and
  project code. Inspect its expandable impact analysis before saving. This uses
  the selected Copilot model, not the legacy Gemini helper; authentication is required.
- Inspect the session plan and questions, review the worktree diff, accept human review,
  request feedback/replanning, then preview and explicitly commit or merge local delivery.
- Require a changed, non-empty Markdown document for human review acceptance. The path is
  `features/<feature-slug>/<ticket-slug>-<id-prefix>.md` under the project docs folder, or
  `features/tickets/...` when no feature is assigned. Delivered docs appear in the project Wiki.
- Run an advisory, read-only AI review on the current diff from the code-review panel.
- Use Workflow Advisor from AI tools or Analytics for a diagnosis and suggestions.

Allowed creation stages are Backlog and To Do. Moves obey the defined workflow: Backlog ↔ To Do,
To Do → In Progress → Review → Done, with Review → In Progress for corrections. Done is final.
Invalid transitions are rejected server-side. Task updates
use optimistic revisions; stale edits return a conflict and need reload. `blockedReason` is
informational, not an execution gate. Delivery requires human review acceptance and an active
release assignment plus the required ticket document; moving manually to Done does not count as
delivered. Human review acceptance is blocked until the dedicated page is part of the diff.

## API

- `POST /api/board/tasks`; `PUT|DELETE /api/board/tasks/:id`;
  `POST /api/board/tasks/:id/move`
- `PUT /api/board/projects/:projectId/tasks/:id/release`
- Session review/delivery endpoints under `/api/board/tasks/:id/session`.
- Ticket drafting: `POST /api/board/projects/:projectId/tasks/assistant`.
- Legacy Copilot helpers: `/api/copilot/generate-description`, `/api/copilot/suggest-workflow`,
  `/api/copilot/chat`.

Exact schemas, revision conflicts and workflow transitions are in the
[API reference](../../api.md), [task workflow](../../workflow.md) and
[agent sessions guide](../../agent-sessions.md).

## Source files

- [TaskModal.tsx](../../../src/components/TaskModal.tsx)
- [TaskAutoSpec.tsx](../../../src/components/TaskAutoSpec.tsx) and
  [useTaskAutoSpec.ts](../../../src/data/useTaskAutoSpec.ts) (Copilot Auto-Spec)
- [KanbanCard.tsx](../../../src/components/KanbanCard.tsx)
- [WorkflowAdvisorModal.tsx](../../../src/components/WorkflowAdvisorModal.tsx)
- [TicketReview.tsx](../../../src/components/TicketReview.tsx)
- [TicketDelivery.tsx](../../../src/components/TicketDelivery.tsx)
- [board.ts route](../../../server/routes/board.ts)
- [agents.ts route](../../../server/routes/agents.ts)

## Related features

[Board](../board/README.md) · [Features and epics](../features/README.md) ·
[Copilot](../copilot/README.md) · [Releases](../releases/README.md)

## Ticket pages

- [All views take 100% width](i-want-all-views-to-take-100-witdth-task-179.md)
