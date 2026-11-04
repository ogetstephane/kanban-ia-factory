# Git integration

## Purpose

Git integration manages project clones and isolated ticket worktrees, and gates local delivery
behind review. It separates the source repository, managed clone and per-ticket worktree.

## How to use it

- In **Manage projects**, create a project from a supported Git URL or allowed local folder.
- Inspect clone/worktree state in **Git**, or use project edit to switch the managed clone branch.
- Start ticket work by moving it to In Progress; after plan approval, Copilot works in its own
  ticket branch/worktree.
- Open the ticket's delivery panel after human review acceptance to preview, commit, and merge.

Project clones live under the configured workspace root, named from the slugged project name
(with an ID fallback/suffix on collisions). Ticket worktrees live under the clone's
`.git/kanban-worktrees/` directory, named from the slugged task title with a session suffix if
needed. Agent changes do not modify the source repository or main clone until explicit local
delivery. Branch switch is refused for a dirty clone.

Delivery creates a commit on the ticket branch; it does not merge or change ticket status.
Merge is a separate explicit action into the managed project clone, with preflight checks.
Push is not part of ticket delivery. Wiki saves push their own file commit, and Releases pushes
only a version tag; neither behavior is a generic delivery push policy. Local folder sources are
copied and never modified. See [Git repositories](../../git-repositories.md),
[Agent sessions](../../agent-sessions.md) and [Releases](../../releases.md).

## API

- Project clone/source: `POST /api/board/projects`, `/api/board/repositories/branches`,
  `/api/board/repositories/local`
- Inventory: `GET /api/board/repositories/inventory`
- Ticket session worktree/review/delivery: `/api/board/tasks/:id/session/...`
- Project branch: `GET /api/board/projects/:id/branches`, `PUT /api/board/projects/:id/branch`

## Source files

- [RepositoryFields.tsx](../../../src/components/RepositoryFields.tsx)
- [ProjectManagerModal.tsx](../../../src/components/ProjectManagerModal.tsx)
- [GitView.tsx](../../../src/components/GitView.tsx)
- [repositoryService.ts](../../../server/git/repositoryService.ts) (composition of the services below)
- [workspaceService.ts](../../../server/git/workspaceService.ts)
- [gitOperationsService.ts](../../../server/git/gitOperationsService.ts)
- [gitPublicationService.ts](../../../server/git/gitPublicationService.ts)
- [deliveryService.ts](../../../server/agents/deliveryService.ts)
- [TicketDelivery.tsx](../../../src/components/TicketDelivery.tsx)
- [board.ts route](../../../server/routes/board.ts)

## Related features

[Projects](../projects/README.md) · [Git inventory](../git/README.md) ·
[Copilot](../copilot/README.md) · [Deliveries](../deliveries/README.md) ·
[Wiki](../wiki/README.md) · [Releases](../releases/README.md)
