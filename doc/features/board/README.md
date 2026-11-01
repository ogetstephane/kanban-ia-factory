# Board

## Purpose

The Board is the project's Kanban workspace. It groups epics and standalone tickets into
Backlog, To Do, In Progress, Review and Done columns. Tickets that belong to an epic are
nested inside its card instead of appearing as separate cards in the columns.

## How to open

Choose **Board** or **Kanban Board** in the top navigation. Select a project first, or choose
**Show all** to view tickets across projects.

## What you can do

- Drag epics and standalone tickets between columns where workflow rules permit.
- Expand an epic to view and open its tickets, or create a ticket directly inside the epic.
- An epic's status is independent of its tickets; changing it does not change their statuses.
- Open or delete epic tickets from the expanded card, or open/delete standalone tickets from
  their own cards; add standalone tickets to an eligible column.
- Search ticket titles, descriptions and tags, and filter by priority or feature.
- Review each column's epic and standalone-ticket count.

In **Show all**, new tickets still need an owning project, so the app asks you to choose one.
The board data is loaded lazily when Board or Analytics is needed. A transition of a ticket
from To Do to In Progress queues a Copilot session; moving an epic does not. A missing
repository or an empty clone can leave that session failed; see the
[task workflow](../../workflow.md) and [agent sessions guide](../../agent-sessions.md).

## API

- `GET /api/board/projects/:id/board` or `GET /api/board/board`
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
- [App.tsx](../../../src/App.tsx)
- [board.ts route](../../../server/routes/board.ts)
- [kanban.ts types](../../../src/types/kanban.ts)

## Related features

[Tickets](../tickets/README.md) · [Features and epics](../features/README.md) ·
[Navigation and filters](../navigation-and-filters/README.md) · [Analytics](../analytics/README.md)
