# Deliveries

## Purpose

Delivery history is a searchable, paginated record of local ticket delivery attempts, including
unfinished and failed attempts. It is not the Git inventory and does not itself deliver work.

## How to open

Choose **Deliveries** in the top navigation. The initial scope follows the project switcher.
With **Show all**, choose a project or leave the filter on all projects.

## What you can do

- Filter by project and delivery status, and search ticket, project, feature or release version.
- Inspect commit/merge hashes, target branch, errors, timestamps and related ticket context.
- Open a listed ticket; the app loads its owning project's context before opening the ticket.
- Page through the newest attempts first.

Statuses include committing, committed (not yet merged), merging, delivered and failed.
History includes local delivery attempts only; it does not expose plans, reports or file contents.
Use the ticket's delivery panel for preview, commit or merge actions.

## API

- `GET /api/board/delivery-history` with optional project, status, search and page filters.

The response is metadata-only and paginated; see the [API reference](../../api.md).

## Source files

- [DeliveryHistoryView.tsx](../../../src/components/DeliveryHistoryView.tsx)
- [App.tsx](../../../src/App.tsx)
- [agents.ts](../../../server/routes/agents.ts)
- [sessionService.ts](../../../server/agents/sessionService.ts)
- [agent.ts types](../../../shared/types/agent.ts)

## Related features

[Sessions](../sessions/README.md) · [Tickets](../tickets/README.md) ·
[Git integration](../git-integration/README.md) · [Releases](../releases/README.md)
