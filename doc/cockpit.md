# Cockpit

The Cockpit is the default landing view and follows the project selector. Choose
**Show all** to see actions, releases and progress across every project, or select
one project to focus the dashboard.

## What it shows

- **Next actions:** questions awaiting answers, plans awaiting approval, failed
  sessions, completed work awaiting human review, and accepted reviews awaiting
  local delivery. Items are ordered by recent activity and paginated.
- **Release watch:** in-progress releases, delivery progress and publication errors.
  Selecting a release opens its project-scoped detail, even when version numbers
  are shared between projects.
- **Project pulse:** server-computed counts, completion percentages and Git branch
  indicators for the current scope.
- **Refresh:** the data also refreshes every 15 seconds while this view is open.

Each action button describes the next step. Opening an action loads that ticket's project
board and opens the existing task/session panel; code review and delivery panels are expanded
automatically when relevant. Questions, plan approval, and session recovery remain explicit
actions inside the session panel. Editing keeps the ticket's original project and feature.
Opening a release preserves its project for all version and publication actions.

## Delivery history

The **Deliveries** view records local delivery attempts across the selected project or all
projects. It can filter by project and delivery status, search ticket/project/feature/version,
and open the ticket associated with an attempt. Commit and merge hashes, target branch, release,
attempt number, timestamps, and failure details are shown when available. The list is paginated
and queries only delivery records plus the metadata needed to identify each ticket.

## Context and API

The view is lazy-loaded. It uses paginated `/agent-sessions?actionable=cockpit`,
release summaries, and project summaries. It does not retrieve session plans,
execution reports, question contents, or all project boards for the dashboard.
The board for a single project is fetched only when opening a ticket.
The delivery history is a separate lazy-loaded view backed by `GET /delivery-history`.
