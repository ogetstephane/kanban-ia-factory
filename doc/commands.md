# Commands

All commands are defined in the [Makefile](../Makefile). Run them from the repository root;
`make` or `make help` lists every target.

The dev server, frontend build/preview, production startup, Storybook and Playwright targets,
and native Copilot/Claude tests use a temporary Node 22 runtime when the local Node version is below 22.12.0.
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
| `make test-analysis-native` | `npm run test:analysis:native` | Linux-only native analysis probes inside bubblewrap. No network, host credentials, model request, or AI quota; fails if isolation or the runtime is unavailable. |
| `make test-analysis-claude-native` | `npm run test:analysis:claude-native` | Linux-only Claude handshake, synthetic delegation refusals, inventory gates and idle-abort probes in bubblewrap. Isolated loopback HTTP only; no external network, real credentials, model inference or AI quota. |
| `make test-analysis-claude-prepare` | `npm run test:analysis:claude-prepare` | Offline rehearsal of Claude analysis and active-stream cancellation, using the native isolated suite. Does not read host credentials or permit paid execution. |
| `make test-analysis-live` | `npm run test:analysis:live` | Opt-in cancellation of one real analysis turn after model output. Linux, bubblewrap, `gh` authentication and explicit `COPILOT_ANALYSIS_MODEL` required; uses AI quota. |
| `make test-agent-graphify` | `npm run test:agent:graphify` | Opt-in six-session Copilot benchmark: three planning pairs with/without Graphify tools on the same committed snapshot. Uses AI quota. Results and limitations: [Code graph](features/code_graph/README.md#token-consumption-benchmark). |
| `make lint` | `npm run lint` | TypeScript type check (`tsc --noEmit`). |
| `make check` | `lint` + `test` + `build` | Type-check, run the default test suite, and build the frontend. |

### Single-test commands

The analysis native target requires `bwrap` (bubblewrap) and the installed SDK runtime.
Its launcher mounts only system binaries, dependencies and the explicit analysis sources
read-only, clears the environment, creates a disposable home and `/tmp`, and unshares
network and process namespaces. It never falls back to running probes on the host.
The test verifies broker reads, rejected native tools and out-of-snapshot reads, empty
ambient inventories, contaminated-session rejection, fixture integrity, and runtime child
exit after shutdown. It does **not** qualify active model turns or billing cancellation.
It is excluded from `make test` and `make check`; the launcher contract is tested normally.

For the separately approved live test:

```sh
COPILOT_ANALYSIS_MODEL=claude-haiku-4.5 make test-analysis-live
```

Select an available model explicitly; the test does not infer a price when billing data is
missing. Authentication is obtained with `gh auth token --hostname github.com`, captured
without printing, and sent on stdin to the isolated process. No personal configuration
directory or credential file is mounted. The SDK forwards this credential to its runtime.
Unlike the native probes, this target **shares the host network** for Copilot authentication
and inference (DNS and CA certificates are mounted read-only); it does not validate network
confinement. Only a synthetic prompt is sent, and streaming is enabled for observing the
first real model delta before abort. The adapter's actual SDK send, abort and stop are used.
The test checks its terminal result, runtime child exit and ephemeral-directory removal.
It never writes a production qualification or claims that billing has stopped.
Neither `make test` nor `make check` runs this paid test.

Tests use Node's test runner through `tsx`. Run a single file, or filter its test titles
with `--test-name-pattern`:

Delivery/release fixture commands and shared source-repository creation disable
commit/tag signing per command, without changing your Git configuration. Their
synchronous Git commands time out after 30 seconds. This prevents personal signing
settings from opening a tag editor or waiting for signing credentials during tests.

```sh
# One test file
npx tsx --test server/db/boardStore.test.ts

# One named test
npx tsx --test --test-name-pattern="initializes once and keeps seeded order" server/db/boardStore.test.ts
```

The [Claude Code adapter tests](../server/agents/claudeAnalysisProvider.test.ts)
are offline and included in `make test`. To run only this contract scenario:

```sh
npx tsx --test server/agents/claudeAnalysisProvider.test.ts
```

They use an in-memory MCP client/server exchange and an inert Node child, not Claude Code
or a model. No authentication or AI quota is needed.

For the separate real-runtime checks:

```sh
make test-analysis-claude-native
```

Linux, bubblewrap and the installed SDK native binary are required. The launcher fails
rather than running on the host if isolation is unavailable. It mounts the same explicit
source/dependency allowlist as the Copilot probes, with only the Claude test entrypoint.
Four probes check hook registration, the host MCP inventory, exclusion of hostile project
extensions, native child exit after idle abort, and pre-prompt rejection of an altered MCP
inventory. A synthetic turn sends controlled input to a local Anthropic-compatible SSE
fixture on namespace loopback: a broker read succeeds, while calls targeting the five
built-in agents, legacy `Task` and `Workflow` return explicit tool errors without child
execution. These are protocol fixtures, not model-generated answers. Native registry
entries are no longer rejected merely for existing; executable tools are checked instead.
Empty plugin/skill options and `disableBundledSkills` alone leave bundled entries.
The documented `enabledPlugins` settings disable the three observed built-in plugins;
`skillOverrides` set `doctor` and `plugin-authoring` to `off`. With these settings,
the native adapter sees empty skill/plugin inventories, completes a broker-only synthetic
turn and preserves a delegation refusal even if the host aborts. The same canonical
`runAnalysis` scenario validates the report and observed broker evidence through the real
SDK/runtime, using a locally advertised resolved model ID only as a protocol fixture.
Unexpected context entries are still rejected, with no exception list. `system/init` does not prove that
no inference preceded it.
Tests use placeholder keys and process-local qualifications, never real credentials.
Passing these checks does not grant production qualification.
The experimental **ticket** runtime is a separate application adapter, disabled
by default; see [activation and permissions](./agent-sessions.md#experimental-claude-ticket-runtime).
The native analysis probes do not qualify write-capable ticket execution.
There is no Claude live-model test target yet. Neither `make test` nor `make check` starts
the native probes; both native suites are opt-in.

To prepare without authorizing any paid call:

```sh
make test-analysis-claude-prepare
```

This runs the same native suite, including a deliberately unfinished synthetic SSE response.
The actual adapter observes a partial text delta, aborts the SDK, and verifies runtime PID
exit, HTTP stream closure and temporary-directory cleanup within five seconds of abort.
The response cannot finish before cancellation; no retry or extra request is permitted.
This is a cancellation rehearsal against loopback, not a live-model test.
The launcher only accepts `--prepare`; `--run` and other arguments fail before reading
credentials or starting a runtime. It does not read `.env` or the host API-key variable.
The SDK's `maxBudgetUsd` stops a query **after** its budget is exceeded, and reported
cost is estimated, not a billing statement. It does not establish a strict billing cap.
Paid execution remains blocked under a strict zero-dollar requirement; this preparation
does not grant authorization or provide a live-execution switch.

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
