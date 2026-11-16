---
stage: selection
selected: D-hybrid-chip-with-own-drawer
label: Labelled chip with its own slide-over
rejected: [A-sibling-line, B-segment-in-flow-strip, C-control-strip-chip]
receipt: dec_xpc78x6q
shape_version: spec-product_v2
scope_map_version: card-rbkbfyqy-scope-map-v1
chosen_by: human
chosen_at: 2026-10-28
covers_scopes: [scope-3-project-releases-rpc, scope-4-board-strip-and-drawer]
---

# Selected interface — labelled chip with its own slide-over

The reader picked the hybrid: a chip in the Build board's control strip that names the release,
opening a slide-over that belongs to the chip rather than to the finished-card strip.

## What the surface is

- **Entry**: a chip beside the board's project and intent filters, carrying the release itself:
  `Releases · v0.99.0 · 28 Oct` when a project is selected, and
  `Releases · v0.99.0 · 4 projects shipped` when none is. It is a full touch target
  (`min-h-11`), it takes the text cursor nowhere, and it carries `cursor-pointer`.
- **Expansion**: a right-side slide-over (`ResponsiveDrawerShell side="right"`, the pattern the
  flow strip already uses) that leaves the board mounted behind it. Never an inline expander.
- **Rows**: the last five releases of the selected project, each a version, a calendar day and
  one takeaway clamped to two lines, expanding in place to the full text.
- **Absence**: each project state has its own sentence — no repo, no tags, no release record,
  path missing, unreadable — and a row whose changelog entry does not exist says so in a fixed
  phrase. None of them can read as "nothing shipped".

## Why this one

The board cannot afford a third stacked band above a kanban whose height is already spent, and a
bare chip would have been the least findable entry on the screen. The hybrid takes the chip's zero
height and the sibling line's independence — its own component and its own slide-over, so it never
inherits the finished-card strip's `count === 0` early return — and puts the release in the label so
the entry cannot be mistaken for a filter.

## What it costs, accepted

Attention splits between two places that report recency: the metrics band and the control strip. The
chip must stay a full touch target on a narrow screen, which means the control strip has to wrap
rather than compress.

## What it does not change

The read, the ordering (tag day descending, version text as tie-break), the takeaway extraction,
the five absence sentences and the single call serving one project or the fleet are fixed by the
approved plan. This pick moves a surface and nothing else.
