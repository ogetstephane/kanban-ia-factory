# Board card simplification (task 179)

## User-visible behavior

- A standalone ticket card on the Board no longer has an action bar at the bottom: the
  previous/next arrows, Copilot sparkles, edit and delete buttons are gone.
- The only footer control is a **status selector** (`Current stage of <title>`). It appears
  only when the ticket can move to more than one status. A Done ticket, which has no
  reachable status, shows no footer and no border.
- To edit a ticket, click its title to open the task page. The page now also has a
  **Delete task** link (existing tickets only, with a confirmation) that deletes the ticket
  and returns to the workspace. Copilot Auto-Spec stays on the task page.
- Manual/AI review buttons on Review cards and epic cards are unchanged.

## Technical changes

- `src/components/KanbanCard.tsx`: removed the arrow/edit/delete/Copilot buttons, the
  `showMenu` state and unused icons. The footer renders only if `reachableStatuses(task.status).length > 1`.
  `onDelete` and `onOpenCopilotSpec` are now optional and unused, so `KanbanColumn` still compiles.
- `src/components/TaskPage.tsx`: added a **Delete task** button calling `board.deleteTask` after `window.confirm`.
- `src/components/KanbanCard.stories.tsx`: added a `SingleStatus` story (Done task).
- `src/utils/reviewActions.test.ts`: tests that a To Do card has the selector and none of the
  removed actions, and that a Done card has no `<select>`.
