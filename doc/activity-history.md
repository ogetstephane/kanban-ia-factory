# Activity history

The **Activity** view is a chronological change log for the selected project, or for all projects
when the project switcher is set to **All projects**. Search matches project/entity titles,
summaries, and actor categories. The entity filter narrows the timeline to projects, features,
tickets, or releases. Each entry can be expanded to browse the rest of that entity's history.
Both timeline and entity history are paginated.

## What is recorded

- Project, feature, and ticket creation, selected field edits, status changes, reorderings, and
  deletions.
- Copilot session queueing, planning/execution transitions, questions being asked/answered,
  approvals, retries, cancellations, review acceptance, failures, and worktree cleanup.
- Ticket release assignment, local commit/merge delivery progress and failures, and release
  creation/updates/tag publication outcomes.

Entries contain a short summary and selected before/after values. They are append-only and keep
the recorded project and entity names after deletion. They are not full snapshots: descriptions,
prompts, generated reports, question text/answers, and delivery messages are intentionally not
copied into this log. Existing changes from before the activity-history migration are not
backfilled.

`User`, `Copilot`, and `System` are source categories. The application does not currently have
authenticated user identities, so `User` does not identify a particular person.

Apply database migrations with the normal deployment flow (`make db-migrate`) before using the
activity API or view.
