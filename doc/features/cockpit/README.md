# Cockpit

## Purpose

Cockpit is the project command center for decisions that need attention. It combines Copilot
session actions with release progress and a small project pulse, rather than replacing the
board, session detail, or release editor.

## How to open

Choose **Cockpit** in the top navigation (desktop or mobile). It is the initial view at startup.
The project switcher scopes it to one project or **Show all**.

## What you can do

- See action counts, active projects, in-progress task counts and release blockers.
- Open a ticket focused on its unanswered question, plan approval, failure/retry, pending
  human review, or delivery action.
- Open a blocked in-progress release in Releases.
- Page through the action list; data refreshes automatically every 15 seconds.

The action list covers questions, approvals, failed sessions, pending review and accepted
reviews still awaiting local delivery. The endpoint returns metadata, not plans or question text.
Release blockers are in-progress releases with undelivered tickets or an error.

## API

- `GET /api/board/agent-sessions?actionable=cockpit` (also scoped with `projectId` and `page`)
- `GET /api/board/releases` or `/api/board/projects/:projectId/releases`

Payload and safety details are in the [API reference](../../api.md) and
[agent sessions guide](../../agent-sessions.md).

## Source files

- [CockpitView.tsx](../../../src/components/CockpitView.tsx)
- [App.tsx](../../../src/App.tsx)
- [agents.ts](../../../server/routes/agents.ts)
- [releaseService.ts](../../../server/releases/releaseService.ts)

## Related features

[Sessions](../sessions/README.md) · [Tickets](../tickets/README.md) ·
[Releases](../releases/README.md) · [Projects](../projects/README.md)
