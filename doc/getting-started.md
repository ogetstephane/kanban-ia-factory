# Getting started

## Prerequisites

- **GNU Make**
- **Node.js** — Vite 8 and the Copilot runtime require a modern Node; use **Node 22.12+**.
  When the local Node is older, `make dev`, `build`, `start`, `preview`, and `test-agent-live`
  automatically run with a temporary Node 22 via `npx`. Ordinary tests, lint, and Prisma
  commands also work on Node 18.
- **git** — used by the server to clone project repositories.
- **Bun** — dependencies are locked in `bun.lock`. `make install` runs Bun through `npx`,
  so a global install is optional.

## First-time setup

```sh
make setup
```

This runs, in order:

1. `make install` — installs dependencies; `postinstall` generates the Prisma client.
2. `make env` — copies [.env.example](../.env.example) to `.env` if it is missing.
3. `make db-migrate` — creates `prisma/kanban.db` and applies all migrations.

Then start the app:

```sh
make dev
```

Open http://localhost:3000. On the first load of an empty database, projects saved in the
browser's localStorage are imported; otherwise demo data is used.

## Environment variables

Defined in `.env` (template: [.env.example](../.env.example)).

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite connection string. `file:./kanban.db` is relative to `prisma/`, so the file is `prisma/kanban.db`. |
| `GEMINI_API_KEY` | No | Enables live responses for the existing Gemini endpoints (breakdown/spec/advisor). Independent of Copilot ticket sessions. |
| `APP_URL` | No | Public URL where the app is hosted. |
| `WORKSPACES_DIR` | No | Folder where project repositories are cloned. Default: `./workspaces`. |
| `LOCAL_REPOSITORY_ROOTS` | No | Comma-separated parent folders from which local git folders may be cloned. Empty disables local folders. |
| `COPILOT_MODEL` | No | Model for Copilot ticket sessions; empty uses the runtime default. Authenticate Copilot as the server user. See [agent sessions](./agent-sessions.md). |
| `GRAPHIFY_ENABLED` | No | `false` disables Graphify generation and ticket graph tools. Agents notify the user and continue with source-based analysis. Enabled by default when Graphify is installed. See [agent sessions](./agent-sessions.md#code-knowledge-graph-graphify). |
| `GRAPHIFY_BIN` | No | Path to the `graphify` executable when it is not on the server's `PATH`. |
| `GRAPHIFY_CACHE_DIR` | No | Where code graphs are stored. Default: `$TMPDIR/kanban-graphify`. |
