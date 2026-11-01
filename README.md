<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/b4d60938-ca08-4b92-9ce2-4f7d64b150ad

## Run Locally

**Prerequisites:** GNU Make, Node.js 18+ (`make` runs Vite with Node 22.12+ automatically when needed).

```sh
make setup   # install, create .env, apply migrations
make dev     # http://localhost:3000
make help    # list all commands
```

Full documentation: [doc/](doc/README.md) — [commands](doc/commands.md),
[architecture](doc/architecture.md), [git repositories](doc/git-repositories.md), [task workflow](doc/workflow.md), [agent sessions](doc/agent-sessions.md), [database](doc/database.md), [API](doc/api.md),
[troubleshooting](doc/troubleshooting.md).

Without Make:


1. Install dependencies:
   `bun install`
2. Copy [.env.example](.env.example) to `.env`. Set `GEMINI_API_KEY` if you want live AI responses; without a key, the existing demo responses still work.
3. Apply the database migrations:
   `npm run db:migrate`
4. Run the app:
   `npm run dev`

## Entity persistence

Projects, features, tasks, and subtasks are managed with **Prisma + SQLite**.
The server database replaces browser-only storage. Active project selection stays
local to each browser. The board view is lazy-loaded and project data is fetched
with effects when the selected project changes.

- [prisma/schema.prisma](prisma/schema.prisma): entity definitions and relationships.
- [server/db/boardStore.ts](server/db/boardStore.ts): initialization/reset operations.
- [server/db/entityStore.ts](server/db/entityStore.ts): atomic per-entity transactions.
- [server/routes/board.ts](server/routes/board.ts): validated board API.
- [src/data/boardApi.ts](src/data/boardApi.ts): HTTP client and legacy-data import.
- [src/data/useProjects.ts](src/data/useProjects.ts): project list loading and mutations.
- [src/data/useBoard.ts](src/data/useBoard.ts): project-scoped board loading and entity mutations.
- [src/components/KanbanBoard.tsx](src/components/KanbanBoard.tsx): lazy-loaded board surface.

These small, separate modules keep database changes scoped without requiring the
whole application as coding-assistant context. The lazy Cockpit is the landing
view, with a paginated action inbox, release watch and project progress; it loads
only metadata until a ticket is opened.

In the project switcher's menu, **Show all** selects **All projects** and remembers
that choice in the browser. Board, analytics, sessions, Git and releases aggregate
their projects without duplicating entities. Ticket/feature cards and release
lists identify their owning project. Edits and deliveries retain that ownership.
Creating a ticket/feature from this mode asks for a real project and switches to it;
release creation has an explicit target-project field.

The lazy **Git** view inventories the selected project's repository and registered
worktrees, with source URLs, actual branches, paths and ticket links, including
external/stale worktrees. With **All projects**, it inventories all Git projects.
The tab is hidden when the selected scope contains no repository.
It reads local state only. See [Git inventory](doc/git-repositories.md#git-inventory).

`DATABASE_URL="file:./kanban.db"` stores the database in `prisma/kanban.db`.
Database files are ignored by version control. Back up this file and use persistent
storage when deploying; an ephemeral filesystem will lose data.

On first load of an empty database, the current browser's saved projects, features,
tasks, and subtasks are imported. If there is no saved data, demo data is used.
Existing browser keys remain untouched as a backup. Once initialized, the database
is authoritative: subsequent browsers do not overwrite it with their local data.
Invalid legacy data is reported instead of silently replaced with demo data.

### Commands

```sh
npm run db:studio    # Browse and edit all entities in Prisma Studio
npm run db:dev      # Create/apply a migration after editing the schema
npm run db:generate # Regenerate the typed Prisma client
npm run db:migrate  # Apply committed migrations in another environment
npm test
npm run lint
npm run build
make storybook       # Browse component stories at http://localhost:6006
make build-storybook # Build the static component catalog
make test-storybook  # Validate mock API contracts and in-memory workflows
```

### Standalone component catalog

Run `make storybook` to launch Storybook with mock API data at
http://localhost:6006. No application server, database, Git repository, or AI
credentials are needed. The Make command selects Node 22 when the local runtime
is too old; with Node 22.12+, `npm run storybook` also works.

Storybook uses [MSW handlers](.storybook/handlers.ts) and
[sample fixtures](src/components/stories/fixtures.ts) for API-backed components.
Mock state resets when switching stories. Unsupported API operations return an
explicit error instead of contacting a real backend. Individual stories can
override `parameters.msw.handlers` to demonstrate alternate responses.
`make build-storybook` includes these mocks in the static catalog as well.

### View URLs and task pages

Each main view has its own URL: `/projects/:projectId/:view`, where `view` is
`cockpit`, `board`, `analytics`, `sessions`, `delivery-history`, `activity`, `wiki`,
`releases`, or `git`. Use `All` as the project ID for aggregate views. Browser
back/forward and page reloads preserve the selected project and view. `/` and
short URLs such as `/board` select the remembered project.

New and edit task actions navigate to a dedicated full-page editor in the current tab:

- `/projects/:projectId/tasks/new`
- `/projects/:projectId/tasks/:taskId/edit`

The editor loads its own project data. Saving successfully or cancelling returns
to the originating view, which reloads fresh data. Save errors keep the editor and
draft open. No popup or separate browser window is used. Directly opened editor
URLs also work and return to the owning project board.
On wider screens, title and description occupy the left column and the remaining
fields occupy the right column. Small screens stack content above details.
Below **Description & Context**, **Upload context files** accepts any file type,
including PDFs and images (10 files maximum, 1 MiB each, 3 MiB combined).
Files can be downloaded or removed and are persisted when the task is saved.
Saved files are included in subsequent Copilot session context; see
[uploading task context](doc/agent-sessions.md#uploading-task-context).

Each project/feature/task row has its own optimistic revision. Updates, deletes,
and moves check that revision so stale clients fail with 409 instead of overwriting
newer changes.

### Board API

- `GET /api/board/projects`: list projects with stats for the switcher and manager.
- `POST /api/board/initialize`: initialize an empty database from browser/import data.
- `GET /api/board/projects/:id/board`: load only the selected project's board entities.
- `POST/PUT/DELETE /api/board/projects`: atomic project operations (revision-checked).
- `POST/PUT/DELETE /api/board/features`: atomic feature operations (revision-checked).
- `POST/PUT/DELETE /api/board/tasks`: atomic task operations (revision-checked).
- `POST /api/board/tasks/:id/move`: atomic status/order update for one task.
- `POST /api/board/breakdown`: create a feature (if needed) plus generated tasks in one transaction.
- `POST /api/board/reset`: reset to the demo dataset.

Feature deletion keeps tasks and clears their `featureId` link in the same transaction.
There is no authentication: all clients of this server share one board. Keep it
private until access controls are added. Tests use isolated temporary databases.

## Ticket delivery and review

For the complete Git workflow in French (ticket branches, worktrees, local integration and
release tags), see [gitflow.md](gitflow.md).

Entering In Progress starts an isolated Copilot planning session; execution requires explicit
approval. The lazy **Sessions** view includes an **Action inbox**, per-file **Code review**
with snapshot-bound human acceptance, structured npm test/lint outcomes, correction requests,
cancellation and on-demand attempt history.

**Review → In Progress** prepares a fresh plan in the same worktree. A ticket's optional
blocked reason is informational only. **Project health** checks repository/provider prerequisites
and supports conservative cleanup of unchanged stopped worktrees.

After accepting the human review, open **Local delivery**: explicitly commit on the ticket
branch, then **Merge & mark Done** into the original target branch in the managed project clone.
Assign a project release version before delivery (in the task editor or delivery panel).
Missing or failed test/lint checks require explicit acknowledgment. Conflicts preserve the
ticket commit without changing the target clone. Local delivery performs no push, pull request
or source-repository modification. Ticket dependencies are not implemented.
See [agent sessions](doc/agent-sessions.md) for setup, limits and recovery.

## Releases

The lazy **Releases** view manages SemVer versions per project: **Upcoming → In progress →
Published**, or **Cancelled**. Tickets have one release version; assignment is required before
local delivery. Release details show the assigned tickets and their delivery progress.

Publication only creates a lightweight tag `vX.Y.Z` and pushes **that tag alone** to the
project clone's HTTPS/SSH `origin`. Every attached ticket must have an actual successful
local delivery contained in the tagged commit; manually moving it to Done is not enough.
There is no deployment or branch push. Local-folder origins are refused.

If push fails, the tag and original commit are retained for explicit retry; the release
becomes Published only after remote verification. See [releases](doc/releases.md).
