# Commands

All commands are defined in the [Makefile](../Makefile). Run them from the repository root;
`make` or `make help` lists every target.

The dev server, frontend build/preview, production startup, Storybook and Playwright targets,
and native Copilot tests use a temporary Node 22 runtime when the local Node version is below 22.12.0.
The tables show the underlying commands before this wrapper.

## Setup

| Target | Underlying command | Description |
|--------|--------------------|-------------|
| `make install` | `npx --yes bun install` | Install dependencies from `bun.lock` and generate the Prisma client. |
| `make env` | `cp .env.example .env` | Create `.env` if it does not exist (never overwrites). |
| `make setup` | `install` + `env` + `db-migrate` | First-time setup. |

The repository currently lacks `.env.example`. Until that template is restored,
`make env` and `make setup` require an existing `.env`.

## Development

| Target | Underlying command | Description |
|--------|--------------------|-------------|
| `make dev` | `npm run dev` | Express + Vite dev server with hot reload on port 3000. |
| `make test` | `npm test` | Unit, database integration and script tests. Database tests use isolated temporary SQLite databases. |
| `make test-agent-live` | `npm run test:agent:live` | Opt-in real Copilot test on disposable files; requires authentication and uses AI quota. |
| `make test-agent-skills` | `npm run test:agent:skills` | Verify native skill discovery, on-demand loading and rejection of other skills. Requires the Copilot runtime, but makes no model request. |
| `make test-agent-graphify` | `npm run test:agent:graphify` | Opt-in six-session Copilot benchmark: three planning pairs with/without Graphify tools on the same committed snapshot. Uses AI quota. Results and limitations: [Code graph](features/code_graph/README.md#token-consumption-benchmark). |
| `make lint` | `npm run lint` | TypeScript type check (`tsc --noEmit`). |
| `make check` | `lint` + `test` + `build` | Type-check, run the default test suite, and build the frontend. |

### Single-test commands

Tests use Node's test runner through `tsx`. Run a single file, or filter its test titles
with `--test-name-pattern`:

```sh
# One test file
npx tsx --test server/db/boardStore.test.ts

# One named test
npx tsx --test --test-name-pattern="initializes once and keeps seeded order" server/db/boardStore.test.ts
```

## Playwright browser tests

| Target | Underlying command | Description |
|--------|--------------------|-------------|
| `make playwright-install` | `npm run playwright:install` | Download Chromium and its headless shell for Playwright. |
| `make test-ui` | `npm run test:ui` | Serve Playwright UI at `http://127.0.0.1:9323`. |
| `make test-e2e` | `npm run test:e2e` | Run the Chromium browser smoke suite headlessly. |
| `make test-report` | `npm run test:report` | Open the last HTML report at `http://127.0.0.1:9323`. |

```sh
make install             # install project dependencies, including Playwright
make playwright-install  # first run, or after updating Playwright
make test-ui
```

Open `http://127.0.0.1:9323` in a browser. Select a test or run the full suite; enable
watch mode to rerun tests while editing. The UI provides action snapshots, locators,
console output and network details. Stop it with `Ctrl+C`.

[playwright.config.ts](../playwright.config.ts) starts a dedicated frontend-only Vite
server using the internal `npm run test:e2e:server` script at `http://127.0.0.1:3100`
and stops it when the runner exits. HMR stays enabled for this test server.
It does not reuse an existing server: port 3100 must be free. You do not need `make dev`, migrations,
an `.env` file or AI authentication. The normal app on port 3000 is not used.

The [browser smoke suite](../e2e/app.spec.ts) reuses [Storybook fixtures](../src/components/stories/fixtures.ts)
and intercepts API requests. Unmocked requests fail explicitly rather than contacting a
real backend; browser runtime and console errors also fail the test.
It covers board loading/filtering, opening/cancelling a new task and
unknown routes; it does not exercise Express, Prisma, Git or live AI. Add browser tests
as `*.spec.ts` files in [e2e/](../e2e/) and mock any API calls they need.

Browser tests remain opt-in: neither `make test` nor `make check` includes them.
Run `make test-e2e` before `make test-report`; stop UI mode first since both use port 9323.
HTML reports are written to `playwright-report/`; failure screenshots and traces are
stored in `test-results/`. Both generated folders are ignored by Git and TypeScript.

With Node 22.12+, the npm commands also work directly:

```sh
npm run test:e2e -- e2e/app.spec.ts
npm run test:e2e -- --grep "opens a new task"
npm run test:ui -- --ui-port=9324
```

On minimal Linux installations, Chromium may need system libraries. With Node 22.12+,
run `npm run playwright:install -- --with-deps` to install them (this may require sudo).
If the local Node is older, use
`npx --yes --package=node@22 -c 'npm run playwright:install -- --with-deps'`.

## Storybook

| Target | Underlying command | Description |
|--------|--------------------|-------------|
| `make storybook` | `npm run storybook` | Start the standalone component catalog at `http://localhost:6006`. |
| `make build-storybook` | `npm run build-storybook` | Build the static catalog into `storybook-static/`. |
| `make test-storybook` | `npm run test:storybook` | Run the standalone API mock tests (`tsx --test .storybook/handlers.test.ts`). |

These targets require the `.storybook/` configuration and `.storybook/handlers.test.ts`,
which are currently missing from this checkout. Restore them before running these targets.
Run `make test-storybook` separately: neither `make test` nor `make check` includes this suite.

## Build and run

| Target | Underlying command | Description |
|--------|--------------------|-------------|
| `make build` | `npm run build` | Build the frontend into `dist/`. |
| `make start` | `build`, then `NODE_ENV=production npm run start` | Serve the production app (API + built frontend). |
| `make preview` | `npm run preview` | Preview the static frontend only — no API or database. |
| `make clean` | `npm run clean` | Remove `dist/` and `server.js`. |

> `npm start` runs `tsx server.ts`. For production, prefer `make start`, which also builds
> the frontend, sets `NODE_ENV=production`, and supplies Node 22 if needed.

## Database

| Target | Underlying command | Description |
|--------|--------------------|-------------|
| `make db-migrate` | `npm run db:migrate` | Apply committed migrations (`prisma migrate deploy`). |
| `make db-dev NAME=<name>` | `npm run db:dev -- --name <name>` | After editing [schema.prisma](../prisma/schema.prisma), create and apply a new migration. |
| `make db-generate` | `npm run db:generate` | Regenerate the typed Prisma client. |
| `make db-studio` | `npm run db:studio` | Browse and edit entities in Prisma Studio. |
| `make db-reset` | `npx prisma migrate reset --force --skip-seed` | **Destructive.** Drop the local database and re-apply all migrations. |

## Archify

| Target | Underlying command | Description |
|--------|--------------------|-------------|
| `make archify-install` | `npx --yes --package=node@22 -c 'npx -y skills@latest add https://archify.si --skill archify --agent github-copilot --copy --yes'`, then `node .agents/skills/archify/bin/archify.mjs doctor` | Install the Archify skill in [.agents/skills/archify](../.agents/skills/archify/) and check its CLI. |
| `make archify-doctor` | `node .agents/skills/archify/bin/archify.mjs doctor` | Check the installed Archify CLI. |
| `make archify` | `node scripts/archify.mjs` | Analyze committed application code and render all automatic and hand-authored diagrams. |
| `make archify NAME=auto-react` | `node scripts/archify.mjs auto-react` | Generate only the named diagram. |

Hand-authored sources live in `doc/archify/*.json`. Generated HTML, automatic JSON sources and
validation receipts go under `doc/archify/generated/`. Automatic analysis uses the committed Git
revision, not uncommitted application changes. Rendering follows the skill's validated
`finalize` pipeline; see the [Archify skill](../.agents/skills/archify/SKILL.md).

## Overriding tools

Make variables can be overridden on the command line:

- `NPM` defaults to `npm`.
- `BUN` defaults to `npx --yes bun`.
- `ARCHIFY_CLI` defaults to `.agents/skills/archify/bin/archify.mjs`.

```sh
make install BUN=bun   # use a globally installed Bun
make archify-doctor ARCHIFY_CLI=/path/to/archify.mjs
```
