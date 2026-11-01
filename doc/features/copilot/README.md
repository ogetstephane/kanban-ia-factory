# Copilot

## Purpose

Copilot is the ticket-focused agent workflow. It prepares a read-only plan, can ask questions,
and only executes after explicit plan approval. Sessions also provide human code review and
separate local delivery controls.

## How to open

Move a ticket from To Do to In Progress to queue its session, then open the ticket editor or
the **Sessions** view. AI tools also include feature breakdown and Workflow Advisor, which are
separate helpers.

## What you can do

- Inspect the plan, answer an agent question, approve the plan, retry or cancel.
- Review structured npm test/lint outcomes and inspect a bounded file diff.
- Generate an on-demand AI review of the diff and relevant files. It is read-only and advisory;
  it does not run checks, change files or accept the human review.
- Require a dedicated changed Markdown page under the project's docs folder before human review
  can be accepted. The page is delivered with the ticket and then appears in the Wiki.
- Accept a human review, provide correction feedback, view previous attempts, and explicitly
  commit or merge reviewed work through local delivery.
- See the selected provider and project health diagnostics.

Planning is read-only and has no write or shell tool. Approval permits file changes and the
repository's npm test/lint scripts in the ticket worktree; those scripts are not sandboxed.
Successful execution automatically moves the ticket to **Review**, and its feature too if
it contains only that ticket. This does not accept human review or commit/push/merge changes;
**Done** still requires delivery or an explicit manual transition.
The provider abstraction currently uses the Copilot adapter; `COPILOT_MODEL` optionally selects
the model, with the runtime default when empty. See [Agent sessions](../../agent-sessions.md).

## API

- `GET /api/board/agent-sessions`, `GET /api/board/tasks/:id/session`
- Answer/approve/retry/cancel/review/AI-review/delivery routes below `/api/board/tasks/:id/session`
- Feature/task helpers are `/api/copilot/breakdown`, `/api/copilot/generate-description`,
  `/api/copilot/suggest-workflow` and `/api/copilot/chat`.

## Source files

- [TaskAgentSession.tsx](../../../src/components/TaskAgentSession.tsx)
- [AgentQuestionForm.tsx](../../../src/components/AgentQuestionForm.tsx)
- [agents.ts route](../../../server/routes/agents.ts)
- [sessionService.ts](../../../server/agents/sessionService.ts)
- [provider.ts](../../../server/agents/provider.ts)
- [copilotProvider.ts](../../../server/agents/copilotProvider.ts)
- [agent.ts types](../../../src/types/agent.ts)

## Related features

[Sessions](../sessions/README.md) · [Tickets](../tickets/README.md) ·
[Git integration](../git-integration/README.md) · [Features and epics](../features/README.md)
