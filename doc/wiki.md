# Wiki

The **Wiki** view edits the Markdown files of a project's documentation folder and keeps them in
git. It appears only when the selected project has a git repository; it is not available in the
"Show all" scope.

The wiki opens in **Preview** mode by default. Select **Edit** or **Split** to edit
Markdown. Applying an AI proposal switches to **Split** for reviewing the draft.

## Documentation folder

- Set when creating a project that has a repository (default `doc`) and editable later from
  **Manage projects**. The value is stored in `Project.docsPath`.
- It must be a relative folder inside the repository (for example `doc` or `docs/wiki`). Absolute
  paths, `..`, backslashes and `.git` are rejected.
- The folder is created on the first save if it does not exist. Existing projects without a stored
  value use `doc`.

## Ticket documentation

Copilot adds a dedicated Markdown page to each ticket worktree under the configured docs folder:
`features/<feature-slug>/<ticket-slug>-<ticket-id-prefix>.md`, or
`features/tickets/<ticket-slug>-<ticket-id-prefix>.md` when no feature is assigned. Human review
cannot be accepted until that exact file has changed in the ticket and contains non-empty text.
The review panel shows the required path; Copilot is instructed to write the page during execution,
and a correction plan can add it if it is missing.

The page travels with the ticket's code changes. Once the reviewed ticket is delivered to the
project branch, it appears in the Wiki's folder tree. Use Wiki **Save** and **Sync** for later edits.
The optional AI review can inspect this document alongside the code diff.

## Saving and syncing

### Agent assistant

Open an existing page, or use **New page** to choose a path for a new document.
Click **AI assistant** next to **Save** to show the assistant above the page content,
before the Markdown editor and preview.
It is hidden by default on each page; click the button again to hide it without
losing its prompt, attachments or proposal while staying on that page.
The **Agent assistant** accepts an **Assistant prompt** and optional
context files (any type, including PDFs and images; up to 10 files, 1 MiB each and
3 MiB total). Describe the page to create or improvements to make, then select
**Generate proposal**.

Wiki generation has a separate conservative context limit: **100,000 bytes combined**
for the UTF-8 page path, draft and prompt plus all attached file bytes. The upload
limits alone do not guarantee a request fits the model's token budget. The browser
and server reject oversized context before calling Copilot; reduce attachments or
shorten the draft. Nothing is silently truncated or summarized. Binary attachment
processing may expand beyond this estimate; a model-budget rejection also shows
guidance to reduce context. Custom repository/user instructions are not loaded
into wiki writing sessions.

Copilot receives the current unsaved Markdown draft, page path, prompt and attachments.
Review the proposed content and change summary, then **Apply to editor** or
**Discard proposal**. Applying replaces only the editor draft: it does not write a
file, commit or push. Use **Save** and **Sync** explicitly afterward.
If you edit the draft while generation is running or before applying, application
is blocked until you generate a fresh proposal. Switching pages discards the
assistant prompt, files and proposal and cancels any active generation.

The reusable `AgentAssistant` component accepts generation/application callbacks
and current content. Attached files are transient, not stored with the wiki page.
Text is supplied directly; binary files use Copilot SDK attachments. Do not attach
secrets or files you cannot share with Copilot. Unsupported attachment formats must
be reported in the proposal summary.

The server user must be authenticated with Copilot CLI. `COPILOT_MODEL` optionally
selects the model. Generation has a two-minute response timeout and a cancel button.
Authentication, runtime and invalid-output errors are displayed; there is no demo
fallback. Runtime failures include the underlying error message (up to 1,000
characters) in the assistant panel; the full error is logged in the server terminal.
The writing session has no tools or approved permissions and cannot
modify the repository. The endpoint validates the project and Markdown path before
requesting a proposal.

Saving and syncing are separate steps.

```mermaid
flowchart TD
    A["Save (Ctrl/Cmd+S)"] --> C{Document unchanged<br/>since it was opened?}
    C -- no --> Y[409: reload the document]
    C -- yes --> D[Write file atomically in the clone]
    D --> P[File marked as waiting for sync]
    P --> S["Sync"]
    S --> B{Branch checked out,<br/>no merge/rebase,<br/>git identity set?}
    B -- no --> X[Refused, files stay saved]
    B -- yes --> E[Commit all saved documents]
    E --> F[Push the branch to origin]
    F -- ok --> G[Everything is synced]
    F -- fails --> H[Commit kept locally,<br/>reason shown]
```

**Save** only writes the file in the project clone, atomically. Nothing is committed.

**Sync** commits every pending document of the docs folder in one commit on the branch currently
checked out (`docs: add|update <path>` or `docs: update N documents`), leaving any other local
change untouched, then pushes that branch to `origin` without forcing. Sync is disabled while the
open document has unsaved edits.

Knowing when to sync: the Wiki header shows **Everything is synced** or an amber summary such as
`2 saved changes to commit · 1 commit to push`, with a counter on the Sync button. Files waiting for
sync have an amber dot in the file tree, and the open document reads "Saved, waiting for sync".
"Commits to push" is computed against `origin/<branch>`; it is not shown when the origin is a
local folder, which is never pushed to.

If the push fails (no credentials, remote ahead, origin is a local folder), the commit is kept
locally and the UI shows why; sync again to retry. The push uses the server's SSH keys or git
credentials, never a stored token, and also sends any earlier unpushed commits of that branch.

Sync is refused when a merge/rebase is in progress, HEAD is detached, git `user.name`/`user.email`
are not configured, or a ticket delivery holds the project lock. Saved files remain on disk. Saved
but unsynced documents are uncommitted changes, so switching the project branch is refused until
you sync.

## Safety

- The file list is a folder tree: folders collapse, and the folder button creates one. Git does not track empty folders, so a new folder starts as a `README.md` page that exists once saved.
- ```` ```mermaid ```` blocks render as diagrams in the preview (lazy-loaded; an invalid diagram shows its error and source).
- Only `.md`, `.markdown` and `.mdx` files, up to 1 MB, at most 8 folders deep and 500 files listed.
- Hidden files/folders and `node_modules` are ignored; symbolic links are refused.
- Concurrent edits are detected with a content hash: saving a document that changed since it was
  opened returns `409` and offers to reload it.
- The preview renders Markdown with a built-in renderer that only creates React elements, so raw HTML
  in a document is displayed as text. Images are shown as placeholders.

Each sync is recorded in the project's [Activity history](activity-history.md) (`docs_saved`) with
branch, short commit and whether it was pushed. Document contents are not stored there.

## API

| Method | Path | Body / query | Result |
| --- | --- | --- | --- |
| `GET` | `/projects/:id/wiki` | | `{ docsPath, branch, files: [{ path, size, modifiedAt }] }` |
| `GET` | `/projects/:id/wiki/file` | `path` | `{ path, content, sha }` |
| `GET` | `/projects/:id/wiki/status` | | `{ pending: [{ path, status }], ahead }` (`ahead` is `null` when unknown or origin is local) |
| `PUT` | `/projects/:id/wiki/file` | `{ path, content, expectedSha }` (`null` for a new file) | `{ path, sha, unchanged }`; writes only, no commit |
| `POST` | `/projects/:id/wiki/sync` | `{}` | `{ branch, commit, files, pushed, pushError? }` |
| `POST` | `/projects/:id/wiki/assistant` | `{ path, content, prompt, files: [{ id, name, mimeType, size, data }] }` (base64 data) | `{ content, summary }`; proposal only, no write |

Paths are relative to the documentation folder. Apply the migration with `make db-migrate`.
