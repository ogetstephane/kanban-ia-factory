# Commands

All commands are defined in the [Makefile](../Makefile). Run `make` or `make help` to list them.

## Setup

| Target | Underlying command | Description |
|--------|--------------------|-------------|
| `make install` | `npx --yes bun install` | Install dependencies from `bun.lock` and generate the Prisma client. |
| `make env` | `cp .env.example .env` | Create `.env` if it does not exist (never overwrites). |
| `make setup` | `install` + `env` + `db-migrate` | First-time setup. |

## Development

| Target | Underlying command | Description |
|--------|--------------------|-------------|
| `make dev` | `npm run dev` | Express + Vite dev server with hot reload on port 3000. Uses a temporary Node 22 if the local Node is older than 22.12. |
| `make test` | `npm test` | Unit tests and database integration tests (isolated temporary SQLite databases). |
| `make test-agent-live` | `npm run test:agent:live` | Opt-in real Copilot test on disposable files; requires authentication, uses AI quota. Node 22 fallback. |
| `make lint` | `npm run lint` | TypeScript type check (`tsc --noEmit`). |
| `make check` | `lint` + `test` + `build` | Full verification before shipping. |

## Build and run

| Target | Underlying command | Description |
|--------|--------------------|-------------|
| `make build` | `npm run build` | Build the frontend into `dist/`. Uses a temporary Node 22 if the local Node is older. |
| `make start` | `build`, then `NODE_ENV=production npm run start` | Serve the production app (API + built frontend). Node 22 fallback. |
| `make preview` | `npm run preview` | Preview the static frontend only — no API or database. Same Node 22 fallback. |
| `make clean` | `npm run clean` | Remove build output. |

> `npm start` runs `tsx server.ts`. For production, prefer `make start`, which also builds
> the frontend, sets `NODE_ENV=production`, and supplies Node 22 if needed.

## Database

| Target | Underlying command | Description |
|--------|--------------------|-------------|
| `make db-migrate` | `npm run db:migrate` | Apply committed migrations (`prisma migrate deploy`). Safe for any environment. |
| `make db-dev NAME=<name>` | `npm run db:dev -- --name <name>` | After editing [schema.prisma](../prisma/schema.prisma), create and apply a new migration. |
| `make db-generate` | `npm run db:generate` | Regenerate the typed Prisma client. |
| `make db-studio` | `npm run db:studio` | Browse and edit entities in Prisma Studio. |
| `make db-reset` | `npx prisma migrate reset --force --skip-seed` | **Destructive.** Drop the local database and re-apply all migrations. |

## Overriding tools

`NPM` and `BUN` are variables, for example:

```sh
make install BUN=bun   # use a globally installed Bun
```
