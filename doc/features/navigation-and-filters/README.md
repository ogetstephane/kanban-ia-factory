# Navigation and filters

## Purpose

The two-level header combines project selection, top-level view navigation, quick ticket
creation, board filters and AI tools. The lower sub-header is hidden or pared back in some views.

## How to use it

- Use the project switcher beside the brand for a project or **Show all**; **Manage** opens the
  project manager.
- Choose Cockpit, Board, Sessions, Deliveries, Activity, Releases, Wiki, Git or Velocity & Trends.
- **Add task** opens a ticket with To Do as the default stage (or prompts for a project in
  **Show all**).
- Board and Analytics show search, priority and feature filters plus the **AI tools** menu.
- When search, priority or feature filters are active, **Filtering by** chips clear individual
  search/priority/feature filters, and **Clear all** resets them.

The feature bar is shown only on Board and Analytics. The filter/action sub-header hides
completely on mobile for Releases, Git, Cockpit, Deliveries, Activity and Wiki; at larger widths,
its filter fields remain absent there and action controls are shown. Sessions has its own filters.
The top navigation is a horizontal desktop switcher and a second scrollable row on smaller screens.
Workspace save feedback appears in a bottom-right toast instead of a status strip above the
header. The success message disappears after three seconds and can also be dismissed.
No save notification is shown on initial page load; save failures keep their existing error UI.

## API

Navigation itself has no endpoint. Board filters operate on loaded data; actions use the relevant
board, project or Copilot endpoints documented in the [API reference](../../api.md).

## Source files

- [Navbar.tsx](../../../src/components/Navbar.tsx)
- [ProjectSwitcher.tsx](../../../src/components/ProjectSwitcher.tsx)
- [App.tsx](../../../src/App.tsx)
- [kanbanLogic.ts](../../../shared/utils/kanbanLogic.ts)

## Related features

[Projects](../projects/README.md) · [Board](../board/README.md) ·
[Features and epics](../features/README.md) · [Tickets](../tickets/README.md)
