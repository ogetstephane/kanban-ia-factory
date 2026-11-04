# Projects

## Purpose

Projects provide the scope for board data and Git-backed workspaces. The project switcher
selects one project or **Show all**; the project manager creates, edits and deletes projects.

## How to open

Open the **Project** switcher beside the app brand. Use **New Project** to create, or **Manage**
to open the portfolio manager, edit a project or delete it.

## What you can do

- Switch project scope or choose **Show all** for multi-project views; the active selection is
  remembered locally.
- Create/edit name, description, brand color, emoji icon and (for Git-backed projects) docs path.
- Associate a new project with a remote Git URL or allowed local repository folder; clone before
  project creation completes.
- Switch the managed clone's branch in the edit form. Project health in Sessions diagnoses
  repository/provider readiness and retained worktrees.
- See task/feature totals and completion rate in the project switcher.

The project data model has an optional category, but the project form does not currently expose
it for editing. Features/epics have their own editable category. A repository URL is read-only after creation. Clone workspace directories use
the slugged project name, falling back/suffixing with the ID when needed; renaming does not move
the existing workspace. Branch switching is refused when the clone has uncommitted changes.
The last remaining project cannot be deleted. Health diagnostics report readiness and do not run
tests. See [Git repositories](../../git-repositories.md) for source and workspace policy.

## API

- `GET|POST /api/board/projects`; `PUT|DELETE /api/board/projects/:id`
- `GET /api/board/projects/:id/branches`; `PUT /api/board/projects/:id/branch`
- `POST /api/board/repositories/branches`; `GET /api/board/repositories/local`
- `GET /api/board/projects/:id/health`

## Source files

- [ProjectSwitcher.tsx](../../../src/components/ProjectSwitcher.tsx)
- [ProjectManagerModal.tsx](../../../src/components/ProjectManagerModal.tsx)
- [BranchSwitcher.tsx](../../../src/components/BranchSwitcher.tsx)
- [ProjectHealth.tsx](../../../src/components/ProjectHealth.tsx)
- [workspaceService.ts](../../../server/git/workspaceService.ts)
- [board.ts route](../../../server/routes/board.ts)

## Related features

[Git integration](../git-integration/README.md) · [Git inventory](../git/README.md) ·
[Wiki](../wiki/README.md) · [Cockpit](../cockpit/README.md)
