---
name: ticket-decomposition
description: "Split a feature or broad software need into small linked Kanban ticket proposals with explicit prerequisites. Use for feature breakdown, not implementation execution."
---

# Ticket decomposition

1. Apply ticket-framing, then identify the smallest useful delivery slices.
2. Prefer independently testable outcomes over one ticket per technical layer.
   Keep a small need in one ticket rather than manufacturing extra work.
3. Apply ticket-writing to every ticket. Avoid duplicate scope and preserve all
   explicit requirements across the complete proposal.
4. Give each ticket a unique local ID. List only real prerequisites in dependsOn.
   Emit prerequisites before dependants. No self references, missing IDs or cycles.
5. Explain integration boundaries and the rationale for the order. Include testing
   within each slice; add a separate integration ticket only when genuinely needed.
6. Expose unresolved product decisions in openQuestions. Do not invent decisions.

Propose at most 20 tickets. IDs describe this proposal only; they are not saved
ticket IDs. Dependencies are planning references, not permission to start execution.
Do not create features, tickets or implementation work automatically.
