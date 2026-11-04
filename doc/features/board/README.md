# Board

## Purpose

The Board is the project's Kanban workspace. It groups epics and standalone tickets into
Backlog, To Do, In Progress, Review and Done columns. Tickets that belong to an epic are
nested inside its card instead of appearing as separate cards in the columns.
The five columns share the available width on desktop (1024 px and above), with no horizontal
scrolling. On smaller screens they wrap into two columns (640–1023 px), then a single column
on mobile. Page margins remain visible on both sides, including after Done.

## How to open

Choose **Board** or **Kanban Board** in the top navigation. Select a project first, or choose
**Show all** to view tickets across projects.

## What you can do

- Drag epics and standalone tickets between columns where workflow rules permit.
- Expand an epic to view and open its tickets, or create a ticket directly inside the epic.
- An epic's status is independent of its tickets; changing it does not change their statuses.
- Open or delete epic tickets from the expanded card. For standalone tickets, open the card
  to edit or delete it from the task page; add standalone tickets to an eligible column.
- Standalone ticket cards show a status selector only when the ticket can move to more than
  one status (see [board card](../tickets/board-card-task-179.md)).
- Search ticket titles, descriptions and tags, and filter by priority or feature.
- Review each column's epic and standalone-ticket count.
- Each ticket shows the shared agent workflow timeline: Plan, Approval, Execution, Review
  and Delivery. This also appears on tickets inside expanded epics. Completed steps are green,
  active steps are highlighted, steps waiting for you are amber, and upcoming steps are grey.
  Hover an icon for its step and state; the same labels are available to screen readers.
  Tickets without an agent run keep all five steps grey, regardless of their Kanban stage.
  Workflow summaries refresh every two seconds in one scoped request, not one request per card.

In **Show all**, new tickets still need an owning project, so the app asks you to choose one.
The board data is loaded lazily when Board or Analytics is needed. A transition of a ticket
from To Do to In Progress queues a Copilot session; moving an epic does not. A missing
repository or an empty clone can leave that session failed; see the
[task workflow](../../workflow.md) and [agent sessions guide](../../agent-sessions.md).

## API

- `GET /api/board/projects/:id/board` or `GET /api/board/board`
- `GET /api/board/agent-workflows?projectId=:id` (omit the project for Show all)
- `POST /api/board/features`; `PUT|DELETE /api/board/features/:id`
- `POST /api/board/tasks`
- `PUT|DELETE /api/board/tasks/:id`; `POST /api/board/tasks/:id/move`

Moves are validated against workflow rules and entity revisions; see the
[API reference](../../api.md).

## Source files

- [KanbanBoard.tsx](../../../src/components/KanbanBoard.tsx)
- [KanbanColumn.tsx](../../../src/components/KanbanColumn.tsx)
- [KanbanCard.tsx](../../../src/components/KanbanCard.tsx)
- [EpicCard.tsx](../../../src/components/EpicCard.tsx)
- [WorkflowTimeline.tsx](../../../src/components/WorkflowTimeline.tsx)
- [App.tsx](../../../src/App.tsx)
- [board.ts route](../../../server/routes/board.ts)
- [kanban.ts types](../../../shared/types/kanban.ts)

## Related features

[Tickets](../tickets/README.md) · [Features and epics](../features/README.md) ·
[Navigation and filters](../navigation-and-filters/README.md) · [Analytics](../analytics/README.md)
