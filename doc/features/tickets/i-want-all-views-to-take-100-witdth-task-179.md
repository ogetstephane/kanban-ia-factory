# All views take 100% width

## Behavior

Every top-level view now fills the full width of the window instead of being centred in a
capped column. The page padding (`p-4 sm:p-6 lg:p-8`) is kept. The header, feature bar and
filter strip use the same full width, so they line up with the content below them.

## Width rules changed

| Area | Before | After |
| --- | --- | --- |
| Cockpit, Delivery history, Git, Git task diff, Releases, Wiki, Velocity | `mx-auto max-w-7xl` | `w-full min-w-0` |
| Activity | `mx-auto max-w-5xl` | `w-full min-w-0` |
| Sessions, Kanban board | `mx-auto max-w-[1700px]` | `w-full min-w-0` |
| Task page (header and editor) | `mx-auto max-w-6xl` | `w-full min-w-0` |
| Navbar, FeatureBar, filter strip | `mx-auto max-w-7xl` | `w-full min-w-0` |
| Board column | `flex-1 max-w-[340px]` | `flex-1` (min width 280/310px kept) |

## Technical notes

- CSS-only change. No types, data flow or API changed.
- `<main>` in `App.tsx` gets `w-full min-w-0` and keeps `overflow-x-auto`, so narrow screens
  scroll the board horizontally and nothing else overflows.
- Left unchanged on purpose: modal dialogs (`max-w-md`, `max-w-3xl`, the task editor in modal
  presentation at `max-w-6xl`), the full-screen board review, and inner text or chip
  truncation limits.
- `src/utils/fullWidthViews.test.ts` checks that the views and chrome no longer carry the
  old caps.

## Verification

- `npm run lint` (`tsc --noEmit`) passes.
- `npm test` runs the new width tests. Some existing git and delivery tests in the suite
  failed in this environment and were not investigated.
- Not performed: `npm run build` and manual browser checks at 375, 768, 1440 and 2560px.
