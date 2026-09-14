---
appetite: Lean
appetite_source: setup
review_mode: Auto
product_type: software
assumptions_resolved:
  - core_flow: The Inbox is an attention queue; only unresolved human-action events belong in its default view.
  - history: Resolved and archived events remain queryable, but are distinct historical views.
appetite_fit: fits
approved: true
approved_via: auto
---

# Inbox as an attention queue

## Problem
The Inbox currently mixes work that needs a person with completed updates and an expandable “Resolved” history. Its “resolved automatically” wording is too broad: a question is resolved when its pending interaction disappears (usually after an answer), while errors/pauses resolve when the worker resumes or a card completes/archives. Those are real lifecycle transitions, but they should not be framed as new Inbox work.

## Solution
Make the Inbox a single filtered list with four explicit views: **Unread**, **Resolved automatically**, **Archived**, and **All**. Default to **Unread** and show only currently actionable, unread events. Historical views retain durable visibility without competing with attention work.

Use lifecycle-derived filtering rather than inventing a new persistence field:
- **Unread**: non-archived, unread events that still need human attention (`question`, `error`, `paused`, unresolved).
- **Resolved automatically**: non-archived action events whose lifecycle is resolved. Copy says why these are historical, not that every resolution happened without human participation.
- **Archived**: user-archived events.
- **All**: all non-archived events, including unread work, resolved history, and completions.

The resolver remains per-kind: questions stay open until their interaction is gone; errors and pauses clear only when work resumes; completion/archive resolves remaining action events. Do not create Inbox events solely for auto-resolution—events are created for pending questions, worker failures, pauses, and agent-driven completion updates.

## IN scope
- Replace the archive toggle and sectioned Inbox with an accessible filter control for Unread, Resolved automatically, Archived, and All.
- Keep existing durable event lifecycle storage and server APIs; filter client-side from the already supplied archived-inclusive list.
- Make default Inbox copy and empty states reinforce the human-attention contract.
- Rename resolved presentation to precise history language and preserve the event’s original summary so users can understand what changed.
- Add focused tests for filtering/lifecycle presentation and retain existing Inbox lifecycle coverage.

## OUT scope
- A new database lifecycle/status column.
- Changing how workers generate questions, errors, pauses, or completion events.
- Bulk archive, search, notification preferences, or separate completion filter.
- Claiming all resolved questions were automatically answered.

## Rabbit holes
- Do not infer “automatically resolved” from a generic `resolved_at` timestamp. It only means the event is no longer actionable; a user might have answered the question first.
- Do not hide completions from All; they are updates, but never default attention work.

## Risks
- “Unread” can be misread as every unread completion. Define it explicitly as unread work needing attention and keep completions in All.
- Fetching archived entries is necessary to make the four filters instantaneous; the current query is capped at 200 and appropriate for this compact history UI.

## Definition of Done (Product)
- [ ] Opening Inbox shows only unread, actionable work by default.
- [ ] Users can switch among all four named views without losing events.
- [ ] Resolved history is correctly described as no-longer-actionable rather than universally auto-resolved.
- [ ] Archived events can still be restored.

## Acceptance Criteria
1. Given a pending unread question, when Inbox opens, then it appears in Unread with an unread indicator.
2. Given a resolved question/error/pause, when “Resolved automatically” is selected, then it appears as historical and does not imply a human action was absent.
3. Given an archived event, when “Archived” is selected, then it appears with Restore available.
4. Given All is selected, when any non-archived event exists, then action events, resolved events, and completion updates are visible in one chronological list.
5. Given the default Unread filter has no entries, when Inbox opens, then the empty state says that Stelow will surface work only when human attention is required.
