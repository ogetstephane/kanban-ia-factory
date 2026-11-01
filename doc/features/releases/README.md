# Releases

## Purpose

Releases manages project versions, their ticket membership and publication of a Git version
tag. Publication is intentionally narrower than a deployment or branch release.

## How to open

Choose **Releases** in the top navigation. The page follows the project selection; with
**Show all**, the list aggregates releases across projects. Create a release from an explicit
project when using that aggregate view.

## What you can do

- Create and edit versions, update eligible statuses, cancel where permitted, and inspect details.
- Assign or remove tickets and see local delivery status and merge hashes.
- Prepare a publication preview, then explicitly create and push the release tag.
- Open a listed ticket in its task editor.

Versions use SemVer without `v`; the Git tag is `v<version>`. A release can be published only
after its tickets have been delivered locally. Publication creates and pushes the version tag;
it does not push a branch, deploy, run tests or start an AI session. A pinned publication freezes
the version and membership; retries reuse the pinned tag. See [Project releases](../../releases.md).

## API

- `GET|POST /api/board/projects/:projectId/releases`
- `GET|PUT /api/board/projects/:projectId/releases/:id`
- `GET /api/board/projects/:projectId/releases/:id/preview`
- `POST /api/board/projects/:projectId/releases/:id/publish`
- `PUT /api/board/projects/:projectId/tasks/:id/release`

## Source files

- [ReleasesView.tsx](../../../src/components/ReleasesView.tsx)
- [ReleaseSelect.tsx](../../../src/components/ReleaseSelect.tsx)
- [releases.ts route](../../../server/routes/releases.ts)
- [releaseService.ts](../../../server/releases/releaseService.ts)
- [release.ts types](../../../src/types/release.ts)

## Related features

[Tickets](../tickets/README.md) · [Deliveries](../deliveries/README.md) ·
[Git integration](../git-integration/README.md) · [Activity](../activity/README.md)
