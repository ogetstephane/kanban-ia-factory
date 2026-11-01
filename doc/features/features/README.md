# Features and epics

## Purpose

Features (epics) group related tickets into larger deliverables. On the Kanban board, each
epic is shown as one card in its own workflow status; its tickets are nested and expandable
inside that card. Existing epics receive an initial status based on their tickets when the
migration runs. Moving an epic to **Backlog**, **To Do**, or **In Progress** synchronizes its
tickets to that stage.

The feature bar is a shared project overview on Board and Analytics, with progress and a
shortcut to AI-assisted ticket breakdown.

## How to open

Open **Board** or **Velocity & Trends**. The **Active Features & Epics** bar appears above the
view; expand it if collapsed. Use **New Feature** or the **AI tools** menu in the header.

## What you can do

- Select a feature to filter tickets or clear the feature filter to show all.
- Move an epic through the workflow; moving it to **In Progress** queues every ticket for
  automatic sequential planning and execution, without per-ticket plan approval.
- Review a multi-ticket epic only after every ticket is **Done**. The epic moves to **Review**
  automatically when its last ticket becomes **Done**; its tickets remain **Done**.
- A feature with only one ticket moves to **Review** when that ticket enters **Review**
  after successful agent execution. Requesting corrections reopens both to **In Progress**.
- Expand an epic card to open its tickets or add a ticket directly to that epic.
- Create a feature with title, description, category, target date and accent color.
- View associated task completion/progress; delete a feature (linked tickets are unlinked).
- Open **Copilot Breakdown** from a feature card or AI tools menu. Choose an existing feature
  or draft a new one, generate proposed tasks, select tasks and adjust priority before applying.

The breakdown is a proposal: selected tasks are saved to the board only when applied. In
**Show all**, a new feature must be assigned to a specific project. Its category and color
do not establish ticket workflow or Git association.

## API

- `POST /api/board/features`; `PUT|DELETE /api/board/features/:id`
- `POST /api/board/breakdown` applies a feature and tasks in one transaction.
- The UI also calls `POST /api/copilot/breakdown` to generate the proposal.

See the [API reference](../../api.md); breakdown is a separate Copilot feature helper.

## Source files

- [FeatureBar.tsx](../../../src/components/FeatureBar.tsx)
- [EpicCard.tsx](../../../src/components/EpicCard.tsx)
- [NewFeatureModal.tsx](../../../src/components/NewFeatureModal.tsx)
- [FeatureBreakdownModal.tsx](../../../src/components/FeatureBreakdownModal.tsx)
- [board.ts route](../../../server/routes/board.ts)
- [kanban.ts types](../../../src/types/kanban.ts)

## Related features

[Board](../board/README.md) · [Analytics](../analytics/README.md) ·
[Tickets](../tickets/README.md) · [Copilot](../copilot/README.md)
