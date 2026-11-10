# Kanban Flow Copilot — Documentation

| Guide | Contents |
|-------|----------|
| [Getting started](getting-started.md) | Prerequisites, first-time setup, environment variables |
| [Commands](commands.md) | Every `make` target and its npm equivalent |
| [Architecture](architecture.md) | Lazy-loaded board, data hooks, atomic entity persistence |
| [AI orchestrator](ai-orchestrator.md) | Proposed provider-neutral contracts, resolution, lifecycle, security and MVP |
| [Cockpit](cockpit.md) | Cross-project action inbox, release watch and project pulse |
| [Activity history](activity-history.md) | Chronological ticket, feature, release, project and Copilot lifecycle changes |
| [Wiki](wiki.md) | Markdown editor for the project's documentation folder, committed and pushed on save |
| [Git repositories](git-repositories.md) | Cloning sources when creating a project |
| [Task workflow](workflow.md) | Allowed column moves (Backlog ⇄ To Do → In Progress → Review → Done) |
| [Agent sessions](agent-sessions.md) | Copilot execution, read-only plans, questions, approvals and the Sessions view |
| [Database](database.md) | Prisma schema, migrations, revisions, backups |
| [API reference](api.md) | `/api/board` endpoints, payloads, and error codes |
| [Features](features/README.md) | One folder per view and per cross-cutting feature |
| [Troubleshooting](troubleshooting.md) | Common install, build, and runtime problems |

Quick start:

```sh
make setup   # install dependencies, create .env, apply migrations
make dev     # http://localhost:3000
```

Run `make` (or `make help`) to list all commands.
