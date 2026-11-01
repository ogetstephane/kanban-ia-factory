# Sessions

## Purpose

Sessions is the overview for Copilot work on tickets. It exposes a filterable session list,
an action inbox and project diagnostics; selecting an item opens that session's details.

## How to open

Choose **Sessions** in the top navigation. The initial project follows the project switcher;
the view's project filter can be changed to **All projects**.

## What you can do

- Browse all sessions or focus on the Action inbox, with project, feature, state, priority
  and text filters plus pagination.
- Select a session to read its plan, questions and execution result, answer an open question,
  approve a plan or retry a failed/cancelled session.
- Open **Project health** and select a project to inspect repository/provider diagnostics,
  available npm scripts and retained ticket worktrees.
- Clean up only an eligible stopped worktree with no changes relative to its base; its branch
  and session history remain.

The list refreshes every two seconds and returns metadata; full session detail loads only when
selected. The plan is read-only until approval. Consult the detailed
[agent sessions guide](../../agent-sessions.md) before approving or delivering work.

## API

- `GET /api/board/agent-sessions` (filters, page, or `actionable=true`)
- `GET /api/board/tasks/:id/session` and session answer/approve/retry/cancel routes
- `GET /api/board/projects/:id/health`; `POST /api/board/tasks/:id/session/cleanup`

See exact request bodies in the [API reference](../../api.md).

## Source files

- [SessionsView.tsx](../../../src/components/SessionsView.tsx)
- [TaskAgentSession.tsx](../../../src/components/TaskAgentSession.tsx)
- [ProjectHealth.tsx](../../../src/components/ProjectHealth.tsx)
- [agents.ts](../../../server/routes/agents.ts)
- [sessionService.ts](../../../server/agents/sessionService.ts)

## Related features

[Copilot](../copilot/README.md) · [Tickets](../tickets/README.md) ·
[Deliveries](../deliveries/README.md) · [Git integration](../git-integration/README.md)
