# Copilot instructions

## Build, test, and lint

Use the [Makefile](../Makefile) targets; Vite/Storybook and live Copilot targets select Node 22
when the local version is below 22.12.0. See [commands](../doc/commands.md) for all targets and overrides.

- `make setup` — install dependencies with Bun from `bun.lock`, create `.env` if missing, and apply migrations.
- `make dev` — run the Express/Vite app at `http://localhost:3000`.
- `make test` — run unit, database integration and script tests.
- `npx tsx --test server/db/boardStore.test.ts` — run one test file; replace the path with the test to target.
- `npx tsx --test --test-name-pattern="initializes once and keeps seeded order" server/db/boardStore.test.ts` — run one named test.
- `make lint` — TypeScript check (`tsc --noEmit`).
- `make build` — build the frontend.
- `make start` — build and serve the production API and frontend; `make preview` serves only the frontend.
- `make check` — run lint, tests, and build.
- `make storybook` / `make build-storybook` — run / build the standalone component catalog.
- `make test-storybook` — check Storybook mocks; this suite is separate from `make test` and `make check`.
- `make archify` — render all diagrams; `make archify NAME=auto-react` selects one. Automatic analysis uses committed code, not working-tree changes. Use `make archify-install` / `make archify-doctor` to install / check the CLI.

Current setup gaps: `.env.example` and `.storybook/` are absent. `make setup` needs an
existing `.env`; restore the Storybook configuration/tests before using its targets.

The opt-in `make test-agent-live` uses Copilot authentication and AI quota; do not run it as a routine test.
For Prisma schema changes, use `make db-dev NAME=migration_name` and commit the generated migration.

## Architecture

- `server/app.ts` (`createApp`) composes the Express API from injected dependencies, with no listening or background work; `server.ts` builds production dependencies, serves the React/Vite app and owns startup/shutdown. API routers are mounted under `/api/board`; feature logic is kept in route, service, and store modules under `server/`. `server/app.test.ts` exercises the composed API with a temporary SQLite database and a simulated agent provider.
- The React app uses project-scoped routes. `App.tsx` loads project summaries, while views and project boards are lazy-loaded/on-demand. `src/data/apiClient.ts` is the HTTP boundary; domain clients (`boardApi`, `agentApi`, `wikiApi`, `releaseApi`, `gitApi`, `graphApi`, `activityApi`) each wrap one API area, so import only the one a view needs. Hooks such as `useProjects` and `useBoard` own client loading and mutation state.
- `prisma/schema.prisma` defines the SQLite model. `EntityStore` owns atomic entity updates; `BoardStore` handles board initialization/reset. Shared Zod schemas in `shared/types/` validate data on both client and server. Entities use `revision` for optimistic concurrency; stale writes return `409`.
- `shared/utils/kanbanLogic.ts` is the source of truth for task workflow and creation transitions, used by both UI and API. Keep UI choices and server enforcement aligned there.
- Production `src/` and `server/` never import one another; both use `shared/types/` and pure `shared/utils/`. Shared production code must not import either layer. Keep `shared/data/initialData.ts` out of browser imports; `/initialize` and `/reset` resolve demo data on the server.
- Ticket agents are queued and persisted through the session services and database. `AgentProvider` abstracts the runtime; the Copilot adapter executes in a ticket-specific Git worktree. Standalone ticket planning is read-only until explicit approval; epic tickets are planned and executed sequentially without per-ticket approval. Delivery into the project clone is a separate action. See `doc/agent-sessions.md` and `doc/git-repositories.md`.
- The architecture and data-flow details are documented in `doc/architecture.md`; API and workflow contracts are in `doc/api.md` and `doc/workflow.md`.

## Repository conventions

- Keep writes scoped to the entity/operation being changed and inside its transaction. Use the existing revision checks; a stale revision must not overwrite data or discard the user's draft.
- Keep workflow rules in `kanbanLogic.ts`, rather than duplicating transition logic in components or routes. The API remains authoritative for invalid transitions.
- Client mutations use the server response (including its new revision) to update local state. Follow existing hooks' per-operation pending/error handling and abort/stale-response guards when adding asynchronous data flows.
- Add Prisma changes as committed migrations; regenerate the Prisma client when needed. Use isolated temporary SQLite databases for database tests, following existing test patterns.
- Tests use Node's test runner through `tsx`; Storybook API-backed stories use MSW handlers and fixtures rather than a live server.
- For Archify-specific work, follow `.agents/skills/archify/SKILL.md`; for graphify workflows, follow `.copilot/skills/graphify/SKILL.md`.
