# Interfaces — what each direction means in practice

This is the plain-language companion to `contrast.json` and `alternatives.md`. The question is one
of placement on the Build board, and everything else about the surface is already settled by the
approved plan: one fixed-height line, a slide-over with the last five releases per project, five
absence sentences plus a row-level "no notes" phrase, and one read call serving a single project or
the whole fleet.

## What every direction shows

The line itself is identical in all four: `Releases · newest v0.99.0 · 28 Oct` with a project
selected, and `Releases · newest v0.99.0 · 4 projects shipped` with none. The slide-over lists the
last five releases of the selected project, each row a version, a date and a takeaway clamped to
two lines, expanding in place to the full text. A release whose notes are missing says so; a project
with no repo, no tags, no release record, a missing path or an unreadable read says which of those
it is.

## A — Sibling line

The reader sees a second bordered box directly under the finished-card strip. It is the most
findable placement because it sits in the band the reader already scans, and it is completely
independent: its own component, its own toggle, its own slide-over.

Scope coverage: **scope-4 served.** The line and the slide-over both live in the new component, and
nothing about the flow strip has to change.

The cost is vertical: the board grows a third stacked band above the kanban, and the kanban's height
is already fixed. On a laptop that is the difference between seeing three card rows and two.

## B — Segment inside the flow strip

The reader sees one strip with two readings in it: `Flow · 12 finished · lead 3d │ Releases
v0.99.0`. The existing slide-over gains a Releases tab.

Scope coverage: **scope-4 friction.** The flow strip returns nothing at all when the finished-card
count is zero, so a project with releases and no finished cards would show no release line until
that early return changes. That is real work outside the approved plan, and it is the one option
that collides with the plan's own requirement that the release reading be independent.

The benefit is genuine: no added height, and one toggle for both readings.

## C — Chip in the control strip

The reader sees a chip beside the filters — `[ Releases › ]` — and nothing else changes on the
board.

Scope coverage: **scope-4 friction.** The line is unchanged; the cost is findability. A chip that
does not name the release reads as one more filter, and a reader who never opens it has no release
information at all — which is the failure this whole card exists to fix.

## D — Hybrid: labelled chip with its own slide-over

The reader sees a chip that states the release — `[ Releases · v0.99.0 · 28 Oct › ]` — placed with
the filters, opening a slide-over that belongs to the chip rather than to the flow strip.

Scope coverage: **scope-4 served.** No band is added, no guard is shared, and the label carries the
release so the entry cannot be mistaken for a filter.

The cost is attention: the board now has two places to look for recency, the metrics band and the
control strip, and the chip must be a full touch target to stay usable on a narrow screen.

## Why the hybrid is offered

It is the only direction that takes both recorded facts seriously at once: the board cannot afford
another band (which rules out A as a default), and a line nobody finds is not a line (which rules
out C). It recombines two options rather than inventing a fifth placement — the chip is C's, the
independence and the label are A's.

## What is not being decided here

The release rows, the absence sentences, the read, the ordering and the slide-over's contents are
all fixed. This choice moves a surface; it does not change what the surface says.
