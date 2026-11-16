---
stage: architecture
selected: A-split-reader
shape_version: spec-product_v2
scope_map_version: card-rbkbfyqy-scope-map-v1
selected_by: llm
selection_reason: "the intermediate layer is a named seam in this repository (flow-metrics.ts + flow-coverage.ts), and the alternative puts git subprocesses inside the pure parser"
created_at: 2026-10-28
---

# Architecture — release chip and slide-over

## Construction Pattern

Three layers, each with one job, following the split this repository already uses for flow
metrics:

1. **`lib/project-releases.mjs` — pure.** Takes tag rows (`version`, `day`) and an optional
   changelog string, returns the release window, the undocumented count, the notes-ahead flag and
   the one-line summary. No `fs`, no `git`, no `bb`, no clock. Every branch that a test can reach
   lives here, which is why the absence states, the dialect parsing and the ordering are all
   testable without a repository on disk.
2. **`server/runtime/project-releases.ts` — the strict reader.** Resolves each project's root,
   shells out for the tag spine, and asks for the changelog blob at a tag only when a slide-over
   is opening for that project. It owns the timeouts, the buffer bounds, the aggregate deadline and
   the mapping from failure to a typed state. It never parses a heading.
3. **`server/project-releases-contract.ts` + wiring — the call.** A zod-validated
   `projectReleases({ projectId: string | null })` whose handler composes the two layers and whose
   result carries no omitted keys.

On the client, `components/board/release-chip.tsx` renders one line from that result and owns the
slide-over's open state; `components/board/release-list.tsx` renders the rows. The chip is mounted
beside the board's filters, not inside the finished-card strip, so it has no shared guard and no
shared toggle.

## Alternatives considered

| Direction | Shape | Why rejected or chosen |
|---|---|---|
| Split reader (chosen) | pure module + strict reader + one call | Chosen: the seam already exists (`flow-metrics.ts` pure, `flow-coverage.ts` I/O), so the parser is testable alone and the subprocess lives where the failures are typed |
| Single module with git inside | one file reads git and parses | Rejected: it makes every absence test a fixture repository on disk, and it repeats the fail-soft habit the plan exists to fix |
| Reuse `runGitIn` | call the existing runner | Rejected: its contract collapses "unreadable" into "", which is the exact confusion the plan forbids; changing it would touch five card surfaces |
| Component-owned read | the chip calls the SDK directly | Rejected: it puts a subprocess on a render path and leaves the absence typing to a component |

## Trade-Off

- **Two places run git.** The strict reader is a sibling of `runGitIn`, which means the repository
  now has two runners with different contracts. That is the accepted cost: the existing five card
  surfaces keep their fail-soft behaviour untouched, and the new surface gets the truthfulness the
  plan requires. A single runner with a flag would put the distinction in a boolean, which is how
  the softness leaked in the first place.
- **No caching.** The chip re-reads on mount and the slide-over re-reads when it opens. Tags change
  rarely, so the cost is bounded (measured: 30–66 ms for `for-each-ref`, ~8 ms warm for a 244 KB
  blob), and a cache would introduce an invalidation problem for a feature whose source is
  append-only. If the fleet read ever costs more than a board render, the fix is a cache in the
  reader, not a second source of truth.
- **The fleet read is parallel, not incremental.** A failed project resolves to its own state
  rather than aborting the call, so the reader must settle promises independently and keep a
  deadline. That is more code than a serial loop, and it is what makes one broken repository a
  single line instead of an empty board.
- **`day` is computed in the reader, never in a component.** Two surfaces formatting one instant can
  disagree by a timezone; one string crossing the wire cannot. The cost is that the reader owns a
  detail a component would normally own.

## Scope Compatibility

| Scope | Fit | Note |
|---|---|---|
| scope-1 release-record module | fits | the pure layer is exactly this scope |
| scope-2 strict tag reader | fits | the reader layer owns both commands, the bounds and the typed states |
| scope-3 projectReleases call | fits | the contract file and one wired handler |
| scope-4 board chip and slide-over | fits | two components, no change to the finished-card strip |
| scope-5 inventory and proof | fits | no architecture dependency |

No scope needs to grow for this direction, and the one expansion the plan named as breaking Lean —
per-release drilldown — remains out, because the reader would then need a third command and a
component would own history browsing.

## What this leaves for planning

The sequencing is one-way: the pure module first (it defines the row shape every other layer
speaks), then the reader, then the call, then the surface, then the inventory entry. The parser and
the absence states carry tests written or red-teamed from a fresh context, per the repository's rule
that an implementer is never its own test's only author.
