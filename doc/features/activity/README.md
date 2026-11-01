# Activity

## Purpose

Activity is a chronological change log for projects, features, tickets and releases, including
recorded Copilot lifecycle and local delivery events. It is an event history, not a snapshot of
current entity state.

## How to open

Choose **Activity** in the top navigation. It follows the active project or **Show all** scope.

## What you can do

- Search event/entity titles, summaries and actor categories; filter by project, feature, ticket
  or release entity type.
- Browse paginated results in **List** or **3D timeline** layout.
- Open an event's entity history and page through earlier events for that same entity.
- Inspect summaries and selected before/after fields.

Actor labels are categories (User, Copilot, System), not authenticated identities. Entries are
append-only, keep recorded names after deletion and do not contain descriptions, prompts,
question text/answers, generated reports or delivery messages. Pre-migration changes are not
backfilled. Full details are in [Activity history](../../activity-history.md).

## API

- `GET /api/board/activity-events` (project, entity type, search and page query)
- `GET /api/board/activity-events/:entityType/:entityId` (entity history)

## Source files

- [ActivityView.tsx](../../../src/components/ActivityView.tsx)
- [activity.ts route](../../../server/routes/activity.ts)
- [activityService.ts](../../../server/db/activityService.ts)
- [activity.ts types](../../../src/types/activity.ts)

## Related features

[Projects](../projects/README.md) · [Tickets](../tickets/README.md) ·
[Sessions](../sessions/README.md) · [Deliveries](../deliveries/README.md)
