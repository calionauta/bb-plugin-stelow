# P2: the shaping board as Mermaid `block`

**Type:** feature brief, fresh context. Load `/skill:stelow-workflow-coding-standards`.
**Base:** `origin/master`. Branch `feat/shaping-board-2026-10-23`, own worktree.

## What is already decided and must not be re-litigated

1. **The source is a Mermaid fence in a `.md` artifact. There is no SVG artifact,
   no writer, no new artifact kind.** The viewer renders it on read with the
   bundled pele. A `.md` artifact whose fence is a diagram already works (PR #413
   made the render kind follow the path), and a `.mmd` artifact already renders
   beside its source. So your output is TEXT, and nothing above `lib/`.
2. **Closed taxonomy.** The board may express only: bands (phases), places
   (screens), affordances (things you can do in a place), edges between places
   with a label, and open questions. Do not invent a new shape per card. The model
   is `{ bands, places, edges, questions }` and nothing else; a need outside it is
   recorded in the record, not added to the schema on your own authority.
3. **Nested boxes are legal in Mermaid `block`** - `block:groupId:span` with
   `columns N` and nested groups. That is how a place gets a fat-marker interior:
   band = block, place = nested block, affordance = leaf node. Verify this against
   the bundled pele (1.8.0) before designing around it, and record what you found.

## The job

A pure emitter in `lib/`: `boardMermaid({ bands, places, edges, questions }) -> string`,
plus the model invariants as a separate pure validator
(`assertBoardModel` or similar) that throws with a message naming the offending id.

Invariants, all of them testable without rendering:
- every edge endpoint is a known place id;
- a place belongs to a band that exists;
- a band has at least one place;
- no place is orphaned (no inbound and no outbound edge) unless it is the entry;
- an open question is attached to a place that exists.

## Acceptance criteria (each must fail on the old behaviour)

1. **It renders.** `pele.render(emitted)` produces an SVG containing one node per
   place. Assert node count against the model, not a hardcoded number.
2. **Nesting is real.** A place with three affordances produces three child nodes
   inside its block; removing one affordance removes exactly one child from the
   SVG. Capture both counts.
3. **Red proof on the invariants.** For each of the five, a fixture that breaks it
   must throw with the offending id in the message. Show one of them failing
   before the validator existed (or with the check removed).
4. **Open questions are visible.** They are emitted with a `classDef` that differs
   from the rest, and the count in the SVG matches the model.
5. **Deterministic.** The same model emits the same text twice (assert equality),
   so a diff is about the board, not about map ordering.

## Boundaries

- No UI, no RPC, no artifact writing: another change owns that path, and touching
  it guarantees a conflict.
- No new dependency. `pele` is already bundled; read `lib/diagram-strategy.mjs`
  for the pin and use the renderer that is there.
- The tree is ASCII-only in code and comments; docs follow the repo language.
- Fresh worktree: `npm ci` or symlink the main checkout's `node_modules` (delete
  the symlink before committing). An incomplete install shows a fake
  `Cannot find module 'pele'` at `server/runtime/platform.ts:145` - that is the
  install, not your change.
- Gates with exit codes in the record: `typecheck`, `quality:shape`, `npm test`.
  A `.mjs` imported from TypeScript needs its `.d.mts` in the same commit.
- Never push, merge, tag or release. Never edit `skills/` or `data/stelow`.

## Deliverable

`docs/audits/2026-10-23-p2-board-record.md`: the pele finding about nesting, the
model, the five invariants with their red proofs, the render numbers, the three
exits, and "what I did not do and why".

Report under 250 words: whether pele 1.8.0 really nests blocks, the node and
affordance counts from the SVG, the five invariant proofs, and the three exits.
