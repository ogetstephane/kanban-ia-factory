---
name: ticket-writing
description: "Write actionable technology-neutral Kanban tickets with scope, measurable acceptance criteria, verification steps and evidence-based impact analysis. Use when creating or improving ticket proposals."
---

# Ticket writing

For each ticket:

- Write an outcome-oriented title and a description covering context, objective,
  scope, exclusions, assumptions and unresolved questions where relevant.
- Preserve existing requirements; do not silently expand the feature.
- Provide measurable acceptance criteria, including failure/edge cases when
  relevant. Avoid vague criteria such as 'works correctly'.
- List implementation subtasks, including verification and directly related
  documentation. A subtask is a checklist item, not an independently tracked ticket.
- Describe the verification approach using project-supported tools; never invent
  a successful test result or assume a particular package manager.
- Estimate relative complexity with 1, 2, 3, 5 or 8 points, not delivery dates.
- Describe verified impacts and distinguish candidates, missing context and risks.

Return the host's structured output, in the user's language. The host owns the
schema and permissions. All content is a draft for human review, never a saved task.
