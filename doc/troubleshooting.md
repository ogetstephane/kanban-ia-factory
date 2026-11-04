# Troubleshooting

## `npm install` fails with `ERESOLVE`

The esbuild version conflicts with Vite 8's peer range. Install from the Bun lockfile:

```sh
make install
```

## Dev server or build fails with a Node version error

Vite 8 requires Node 22.12+. On older Node, `npm run dev` crashes with
`The requested module 'node:util' does not provide an export named 'styleText'`.
`make dev`, `make build`, and `make preview` detect older versions and run with a temporary
Node 22 (`npx --package=node@22`). If you call the npm scripts directly, upgrade Node first.

## `EADDRINUSE: address already in use :::3000`

Another dev server is already running. Stop it (Ctrl+C in its terminal) before starting a new one.
To run another instance, choose a different application port: `PORT=3001 make dev`.

## `WebSocket server error: Port 24678 is already in use`

The application's Vite HMR WebSocket now shares the Express HTTP server and its
`PORT` (3000 by default), instead of opening Vite's separate default port 24678.
Restart this application's dev server to use the updated configuration; other
projects can keep using port 24678. `DISABLE_HMR=true` still disables hot reload
and file watching.

## Vite native config warning about `__dirname`

The Vite config uses `import.meta.dirname`, which works with Vite's native config
loader on Node 22.12+. Restart with `make dev` after updating; there is no need to
suppress the warning with `VITE_CONFIG_NATIVE_IGNORE_WARNING`.

## Starting the production app

Use `make start`: it builds the frontend and runs `server.ts` with `tsx` in production mode
under Node 22 when needed. `npm start` alone does not build the frontend.

## `Unexpected token '<', "<!doctype "... is not valid JSON`

An API request received the frontend HTML page instead of JSON. This can happen when
an old backend is still running after new API routes were added, while the browser
has loaded the updated frontend. Stop the existing server with Ctrl+C, restart with
`make dev` (or `make start` for production), and reload the page. Do not use
`make preview` as the application server: it only serves the frontend.

Unknown `/api` routes now return a JSON 404 instead of falling through to the frontend.
The client also reports non-JSON responses with the affected route and restart guidance.

## Agent session failed / waiting for an answer

Open **Sessions**, filter by **Failed** or **Waiting for your answer**, and select the ticket.
The detail panel shows the error or question. Reply there, or authenticate Copilot and click
**Regenerate plan** to retry. A project needs a cloned repository with commits.
See [agent sessions](./agent-sessions.md) for setup and approval.

## `@prisma/client did not initialize yet`

The client was not generated (for example, install scripts were skipped) or the schema
changed:

```sh
make db-generate
```

## `The table ... does not exist`

Migrations have not been applied to the database:

```sh
make db-migrate
```

## "This entity changed in another client" (HTTP 409)

Another tab or client modified the entity since you loaded it. Reopen the entity (or reload
the board) and retry. Only that operation is rejected; your draft and other changes are kept.

## "Git authentication failed" when creating a project

- HTTPS private repository: provide an access token with read access (GitHub: `repo` /
  contents read; GitLab: `read_repository`).
- SSH URL: the user running the server needs an SSH key accepted by the host, and the host in
  `~/.ssh/known_hosts` (prompts are disabled, so unknown hosts fail).

## "Local folders are disabled" / "Local folders must be inside"

Set `LOCAL_REPOSITORY_ROOTS` in `.env` to the parent folder(s) of your repositories and
restart the server. The folder must also be readable by the user running the server.

## Start over with a clean database

```sh
make db-reset   # deletes all data
```
