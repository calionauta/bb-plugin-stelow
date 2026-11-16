# Interface directions — the release line on the Build board

The plan is approved and its five pieces are confirmed. One question is still the interface's:
**where the release line lives** so a reader finds it, it keeps a fixed height, and it does not
become a second finished-card reading. Four directions follow, three of them different placements
of the same line, and one that recombines two.

Fixed constraints, from the approved plan and the board's own code: the surface reports releases
and never card counts; it opens a slide-over rather than pushing the kanban; it is independent of
the flow strip's `count === 0` early return; it shows one fixed-height line plus a slide-over with
the last five releases per project; and it carries the fleet reading the plan chose — the newest
release across projects, and how many shipped.

## Option A — Sibling line

A second bordered line directly under the flow strip: its own surface, its own toggle, its own
slide-over.

```
┌───────────────────────────────────────────────┐
│ Flow · 12 finished · lead 3d · cycle 2d    ›  │
└───────────────────────────────────────────────┘
┌───────────────────────────────────────────────┐
│ Releases · newest v0.99.0 · 28 Oct         ›  │
└───────────────────────────────────────────────┘
┌───────────┬───────────┬───────────┬───────────┐
│ Inbox     │ Shaping   │ Build     │ Done      │
└───────────┴───────────┴───────────┴───────────┘
```

With no project selected the same line reads `Releases · newest v0.99.0 · 4 projects shipped`, and
opening it slides the list over the board from the right.

**Benefit:** the most findable of the four — a labelled line in the band the reader already looks
at, with nothing shared and nothing to unshare.
**Cost:** a third stacked band above a kanban whose height is already spent.

## Option B — Segment inside the flow strip

No new band. A releases segment joins the flow strip's summary row, and the existing slide-over
gains a Releases tab.

```
┌───────────────────────────────────────────────┐
│ Flow · 12 finished · lead 3d │ Releases v0.99.0 ›│
└───────────────────────────────────────────────┘
┌───────────┬───────────┬───────────┬───────────┐
│ Inbox     │ Shaping   │ Build     │ Done      │
└───────────┴───────────┴───────────┴───────────┘
```

**Benefit:** zero added height, one toggle for both readings.
**Cost:** couples releases to finished cards. It inherits `count === 0 → null`, so a project with
releases and no finished cards would show nothing until that guard changes, and one row would carry
two different recencies.

## Option C — Chip in the control strip

A chip beside the board's filters opens the slide-over. No band is added at all.

```
┌───────────────────────────────────────────────┐
│ [ All projects ▾ ] [ Intent ▾ ]  [ Releases ›]│
└───────────────────────────────────────────────┘
┌───────────────────────────────────────────────┐
│ Flow · 12 finished · lead 3d · cycle 2d    ›  │
└───────────────────────────────────────────────┘
```

**Benefit:** no band, no height, minimal visual weight.
**Cost:** the least discoverable entry — an unlabelled chip reads as a filter, and a reader may
never open it.

## Option D — Hybrid: labelled chip, its own slide-over

Option C's placement with Option A's independence: no new band, a chip that states the release
itself, and a slide-over that belongs to the chip rather than to the flow strip.

```
┌───────────────────────────────────────────────┐
│ [ All projects ▾ ] [ Intent ▾ ]               │
│ [ Releases · v0.99.0 · 28 Oct            › ]  │
└───────────────────────────────────────────────┘
┌───────────────────────────────────────────────┐
│ Flow · 12 finished · lead 3d · cycle 2d    ›  │
└───────────────────────────────────────────────┘
┌───────────┬───────────┬───────────┬───────────┐
│ Inbox     │ Shaping   │ Build     │ Done      │
└───────────┴───────────┴───────────┴───────────┘
```

With no project selected: `[ Releases · v0.99.0 · 4 projects shipped › ]`.

**Benefit:** keeps the chip's zero height and the sibling line's independence, and the label
carries the release so the chip cannot read as an anonymous filter.
**Cost:** splits attention between the control strip and the metrics band, and the chip must stay a
full touch target to be usable on a narrow screen.

## Trade-offs in one table

| Direction | Height | Findability | Coupled to finished cards | Risk |
|---|---|---|---|---|
| A · sibling line | + one line | highest | no | board grows a third band |
| B · segment in flow strip | none | high | yes | inherits the `count === 0` guard |
| C · control-strip chip | none | lowest | no | may never be opened |
| D · labelled chip + own slide-over | none | medium | no | split attention, small target |

## Scope coverage

Every direction serves `scope-4` (the board surface) and the read behind it (`scope-3`). Only B
carries friction: it cannot show releases for a project with no finished cards until the flow
strip's early return changes, which is work the plan did not include.

## Evidence

- The board mounts the flow strip above the kanban with a fixed height budget, and the strip
  returns `null` when the finished-card count is zero (`components/board/flow-strip.tsx:44`).
- The slide-over already exists and is the flow strip's own pattern
  (`ResponsiveDrawerShell side="right"`, `flow-strip.tsx:64-70`), so every direction reuses it.
- The plan's own DoD requires the surface to be independent of the finished-card count, which is
  what separates B from the rest.

## What the reader has to decide

Which placement, and nothing else — the line's content, the slide-over, and the absence sentences
are already fixed by the approved plan.
