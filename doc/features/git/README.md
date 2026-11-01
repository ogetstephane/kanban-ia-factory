# Git inventory

## Purpose

The Git view is a read-only inventory of local Git-backed project clones and their registered
worktrees. It shows local Git state and ticket links without mutating repositories.

## How to open

Choose **Git** in the top navigation. This option is shown only when the selected project has a
repository; under **Show all**, it appears when at least one project is Git-backed.

## What you can do

- Search and explicitly refresh repository/worktree metadata.
- Inspect source URL, clone path, actual branch/HEAD, configured branch and worktree status.
- Follow a linked ticket into its project context.
- Choose **View task diff** on a linked ticket worktree to open a dedicated, read-only diff view.
  Select changed files, switch between side-by-side and unified layouts, wrap long lines or open
  the comparison full screen. Return to the inventory with the back button.
- Identify detached, locked and stale/prunable worktree registrations.

Inventory includes main clones, ticket worktrees and unlinked/external entries. A missing clone
is shown as a per-project error rather than suppressing healthy project entries. This view does
not fetch, prune, checkout or remove anything and does not load plans or reports. A worktree diff
is available after its agent session has stopped. Details are in
[Git repositories](../../git-repositories.md).

## API

- `GET /api/board/repositories/inventory?projectId=...` (omit the query for all projects)

## Source files

- [GitView.tsx](../../../src/components/GitView.tsx)
- [GitTaskDiffView.tsx](../../../src/components/GitTaskDiffView.tsx)
- [FileDiff.tsx](../../../src/components/FileDiff.tsx)
- [board.ts route](../../../server/routes/board.ts)
- [repositoryService.ts](../../../server/git/repositoryService.ts)
- [git.ts types](../../../src/types/git.ts)
- [App.tsx](../../../src/App.tsx)

## Related features

[Projects](../projects/README.md) · [Sessions](../sessions/README.md) ·
[Git integration](../git-integration/README.md)
