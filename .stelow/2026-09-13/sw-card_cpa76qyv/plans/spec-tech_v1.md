---
product_spec: .stelow/2026-09-13/sw-card_cpa76qyv/plans/spec-product_v1.md
selected_interface: .stelow/2026-09-13/sw-card_cpa76qyv/interfaces/selected-interface.md
tech_stack: TypeScript, React, better-sqlite3
appetite: Lean
review_mode: Auto
---

# Technical plan — Inbox filters

## Scope 1 — feature: Filter the Inbox around attention

**Files:** `app.tsx`, `lib/inbox-event-presentation.mjs`

Implement a typed client-side filter over the existing archived-inclusive notifications query. Default to `unread` (non-archived unresolved question/error/paused events that are unread). Add `resolved`, `archived`, and `all` predicates. Replace section/details layout with a single chronological list and accessible segmented controls. Keep archive/restore actions and card navigation unchanged.

| Task | Outcome |
|---|---|
| Add inbox filter type and predicate | Four views map precisely to existing lifecycle fields |
| Request archived-inclusive data | All four views update instantly without server/API changes |
| Replace sectioned panel | One selected filter and list with clear empty states |
| Refine history copy | “Resolved automatically” explains no-longer-actionable history without misleading causal claim |

**Definition of done:** Default view contains only unread human-attention events; all requested views work; controls are keyboard-accessible and have 44px targets.

## Scope 2 — test: Protect lifecycle/filter semantics

**Files:** `tests/inbox-flows.test.mjs`, optionally a focused presentation test

Add tests for the new filter predicate/presentation semantics or equivalent pure helper. Confirm unresolved action events are default work, resolved action events are history, archived events remain restorable/visible only in archive filter, and completions stay informational rather than unread action work.

| Task | Outcome |
|---|---|
| Test four classifications | No regression in attention queue rules |
| Retain lifecycle tests | Per-kind resolution and durable history remain covered |

**Definition of done:** Test suite fails if a resolved event becomes default work or a question is treated as automatically solved merely from `resolved_at`.

## Alignment
The plan retains all product scope, uses existing storage/API, and deliberately avoids a schema change. Two scopes fit Lean appetite: UI/presentation plus semantic tests.
