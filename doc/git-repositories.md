# Git repositories

A project can be created from a git repository. The server clones the sources into
`WORKSPACES_DIR/<project-slug>` (default `./workspaces/<project-slug>`, ignored by version control). The folder is the slugged project name (`Mon Projet Été` → `mon-projet-ete`), suffixed with the start of the project ID if that name is taken. It is fixed at creation, so renaming the project does not move it. The project ID is stored in `.git/kanban-project-id`, and the server reads it at startup; workspaces created earlier keep their `<projectId>` folder.

## Creating a project from a repository

1. Open the project manager and click **Create New Project**.
2. Fill in **Repository URL or local folder** in the *Git repository* section.
3. Optionally click **Load branches** and pick a branch; leave it empty for the default branch.
4. Click **Clone & Create Project**. The form stays open while cloning and keeps your input if
   the clone fails.

The project card then shows the source and `branch@commit` that was checked out
(`branch (empty)` for a repository without commits).

## Supported repositories

| Repository | URL format | Credentials |
|------------|-----------|-------------|
| Public | `https://host/org/repo.git` | None |
| Private over HTTPS | `https://host/org/repo.git` | **Access token** field, or the server's git credential helper |
| Private over SSH | `git@host:org/repo.git` or `ssh://git@host/org/repo.git` | SSH keys of the user running the server |
| Local folder | `/home/me/projects/repo` or `file:///home/me/projects/repo` | None (must be inside `LOCAL_REPOSITORY_ROOTS`) |

`http://` and other transports are rejected, as are passwords embedded in URLs.

## Local folders

An existing git folder on the server machine can be used as the source. It is **copied**
into the project's workspace (`git clone --no-local`, so no hard links are shared); the
original folder is not modified by cloning or AI execution, and deleting the project
only deletes the copy. Explicit review publication and Finish can push to this origin.

Local folders are disabled unless allowed parent folders are configured in `.env`:

```sh
LOCAL_REPOSITORY_ROOTS="/home/me/projects,/srv/repos"
```

The path is resolved with `realpath` before the check, so `..` segments and symlinks cannot
reach folders outside these roots (`403`).

The project form offers a **Local git folder** select listing the repositories found under
these roots (up to 3 levels deep; hidden folders, `node_modules`, and symlinks are skipped;
nested repositories inside a repository are not listed). You can still type any path. Only committed history is copied: uncommitted
changes in the source folder are not included.

## Security

- The access token is used for that single git operation and is **never stored**: not in the
  database, not in the clone's `.git/config`, and not on the git command line. It is passed as
  an HTTP header scoped to the repository's origin.
- Git runs without interactive prompts (`GIT_TERMINAL_PROMPT=0`, SSH `BatchMode=yes`), with
  only the `https` and `ssh` protocols allowed (`file` only for allowed local folders) and a
  10-minute timeout.
- Branch names and project IDs are validated before being passed to git or used in paths.
- There is no authentication in this app: anyone who can reach the server can make it clone
  repositories its SSH keys or credential helper can access. Keep the server private.

## Switching branch

When editing a project that has a repository, the **Git branch** section lists the branches
available in its clone and lets you switch the checked-out branch. The switch is its own atomic
operation (separate from *Save Changes*) and bumps the project's `revision`.

- Branches come from the clone itself (local branches and `origin/*` fetched at clone time);
  nothing is fetched from the remote, so branches created after the clone are not listed.
- The switch is refused (`409`) if the clone has uncommitted changes.
- Repositories without commits have no branch to switch to.

## Git inventory

Open **Git** in the desktop or mobile navigation to see the currently selected
project's repository and worktrees. The tab is hidden for projects without a Git
repository; switching to one while viewing Git returns to the board.
Use **Show all** in the main project switcher's menu to display **All projects**
and inventory all Git-backed projects together. In this mode, the Git tab is
available if at least one project has a repository.
The screen is loaded on demand, with search and an explicit refresh. It follows
the main project switcher, without a separate project filter, and requests only
the selected scope's Git inventory.

- Repository URL/source, managed clone path, actual current branch and commit, and
  separately the configured project branch.
- Every worktree registered by `git worktree list --porcelain -z`, including the
  main clone, AI ticket worktrees, external/unlinked worktrees and stale registrations.
- Detached HEAD, locked worktrees (with reason), and missing/prunable entries are
  shown explicitly. A missing clone produces a project-level error without hiding others.
- Known worktrees link to their ticket using the same project's session path or branch;
  deleted tickets/unlinked worktrees remain visible without a ticket link.
  Opening a ticket loads its owning project's context before enabling editing;
  in **All projects**, the global selection is retained.

The inventory contains only metadata: no session plans/reports or all-project boards.
It reads local Git state only: no remote access, fetch, checkout, prune or removal.
The URL shown is the project's stored source, not a fresh remote lookup; manually
editing a clone's `origin` does not update this source.

### Published work and Finish

The Git view also lists **Done epics and standalone tasks**, their `feature/...`
branch and assigned release, even after their worktrees have been removed.
An epic is one entry with its child tickets; children are not finished independently.
Entries stay visible as **Finished - branch closed** after integration.

1. Select **Finish** to fetch and inspect the published feature and project branch.
2. Read the exact origin, project branch, reviewed head and release. A missing release
   blocks Finish; create the next Upcoming release in Releases first. Existing assignments
   are preserved and may be changed in Git before the first Finish attempt. All children
   of an epic must use the same release.
3. Confirm **merge, push & close branch**. The server prepares a conflict-free merge,
   merges into the configured project branch, pushes that branch without force, verifies
   origin contains the merge, then deletes only the feature branch locally and on origin.
   The remote deletion is conditional on its unchanged head, protecting concurrent work.

The main clone must be clean and on the configured project branch. Synchronize a
behind/diverged project branch locally before retrying. Conflicts never trigger automatic
resolution or reset. A checked-out feature branch or unmerged local branch is preserved.
Finish does **not** publish a release or delete a release branch/tag. It records a delivered
merge for each ticket, which counts toward the assigned release's publication readiness.
Ticket branches, pinned commits and session history remain available.

Finish is durable: a failed push keeps the feature branch, and a retry reuses the saved
merge. A failure during branch closure is explicitly reported and can be retried even if
origin already deleted that branch. Restart records failure without replaying Git writes.
The branch, origin, reviewed commits and release assignment stay pinned once Finish starts.
Project edits and ticket/release context changes are blocked while Finish is running.

## Lifecycle

| Event | Effect on the workspace |
|-------|-------------------------|
| Create with repository | Cloned into a temporary folder, moved to `<project-slug>`, then the project is saved. If any step fails, nothing is kept. |
| Edit project | The URL is read-only; the branch can be switched (see below). |
| Switch branch | `git switch` in the clone, then the project's branch/commit are saved. If saving fails, the previous branch is restored. |
| Delete project | The workspace folder is deleted. |
| Reset demo data | Workspaces of removed projects are deleted. |

Repository fields (`repositoryUrl`, `repositoryBranch`, `repositoryCommit`) are stored on the
`Project` model. Clones, worktrees and branch switches are implemented in
[server/git/workspaceService.ts](../server/git/workspaceService.ts).
[server/git/repositoryService.ts](../server/git/repositoryService.ts) composes it with
[gitOperationsService.ts](../server/git/gitOperationsService.ts) (docs and ticket commits,
delivery merges, release tags) and [gitPublicationService.ts](../server/git/gitPublicationService.ts)
(pushes).
