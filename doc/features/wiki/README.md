# Wiki

## Purpose

Wiki edits Markdown documentation directly in a Git-backed project's configured documentation
folder. It provides a folder/file tree and an editor with Markdown preview.

## How to open

Choose **Wiki** in the top navigation. The tab appears only for the selected project when it has
both a Git repository and a documentation folder; it is unavailable in **Show all** scope.
The folder is configured in project create/edit (default `doc`).

## What you can do

- Search files, expand/collapse folders, open pages, and create Markdown documents.
- Create a folder by entering its path; it starts with `README.md` because Git does not track
  empty directories.
- Edit in Edit, Split or Preview mode. Preview renders Mermaid diagrams and Markdown.
- **Save** (Ctrl/Cmd+S) writes the file in the project clone only.
- **Sync** commits all saved documents and pushes the project branch to `origin`. The header shows
  whether a sync is needed (saved changes to commit, commits to push), and files waiting for sync
  have an amber dot.

Saving is limited to Markdown-family files, size and folder-depth limits apply, and concurrent
changes are guarded by a content hash. Failed pushes keep the local commit (sync again to retry) and report the reason.
The preview displays raw HTML as text. See the detailed [Wiki guide](../../wiki.md).

## API

- `GET /api/board/projects/:id/wiki`
- `GET /api/board/projects/:id/wiki/file?path=...`
- `PUT /api/board/projects/:id/wiki/file`

## Source files

- [WikiView.tsx](../../../src/components/WikiView.tsx)
- [MarkdownPreview.tsx](../../../src/components/MarkdownPreview.tsx)
- [MermaidDiagram.tsx](../../../src/components/MermaidDiagram.tsx)
- [wiki.ts route](../../../server/routes/wiki.ts)
- [docsService.ts](../../../server/wiki/docsService.ts)
- [wiki.ts types](../../../src/types/wiki.ts)

## Related features

[Projects](../projects/README.md) · [Git integration](../git-integration/README.md) ·
[Activity](../activity/README.md)
