---
name: ticket-quality
description: "Check ticket proposals for completeness, measurable outcomes, scope duplication, dependency consistency and invented evidence before returning Auto-Spec or a feature breakdown."
---

# Ticket proposal quality

Before returning the final structured proposal:

- Check coverage against the original request and approved plan.
- Check that each ticket has a clear outcome, bounded scope, measurable acceptance
  criteria, verification steps and useful subtasks.
- Distinguish facts verified in sources from assumptions and unverified impacts.
- Surface missing context and unreadable attachments instead of fabricating details.
- For a breakdown, check unique IDs, valid prerequisite order, no duplicate scope,
  no missing prerequisite, and no dependency cycle.
- Do not claim code was changed, tests passed, tickets were saved or a review
  constitutes a security guarantee.

Correct issues within the proposal. Leave decisions requiring human input explicit.
Return only the JSON shape requested by the host. This self-check is guidance;
the host must still validate structural constraints deterministically.
