# P2 record — the shaping board as Mermaid `block`

**Scope:** the board emitter (`lib/board-mermaid.mjs`) and the model invariants
(`lib/board-model.mjs`), both pure, plus their test. Nothing above `lib/`.
**Date:** 2026-10-23
**Branch:** `feat/shaping-board-2026-10-23`, from `origin/master` e9cc99a1.
**Status:** text out, no writer, no UI, no RPC. Five invariants enforced and
proved red, three exits green.

## 1. The pele finding (1.8.0, `block-beta`)

**Nesting is real in layout, and absent in the DOM.** That distinction decided
how the board is verified, so it is the first thing to record.

A block inside a block does render as a block inside a block:

```
block:band_shape["Shape"]:1
  columns 1
  block:place_welcome["Welcome"]:1
    columns 3
    aff_welcome_sign_in["Sign in"] ...
```

Measured on the fixture below: the place rect `x=20 y=48 w=401.42 h=100` sits
entirely inside the band rect `x=8 y=8 w=425.42 h=264`, and the centre of each
affordance leaf falls inside the place rect. So a place is a real fat marker
with a drawn interior — the thing the brief asked to verify.

What is *not* real is ancestry. pele emits every block as a sibling
`<g class="pele-cluster" data-id="...">` (each with its own `<rect>`, and a
`<text class="pele-cluster-label">` when the block has a label), and every leaf
as a sibling inside one flat `<g class="pele-nodes">`. There is no nested `<g>`
tree to walk: the cluster group contains a rect and a label, never its children.

Consequence, and it is the reason this is in the record: "the child is inside its
block" has to be proved **geometrically** — the leaf's `translate(x,y)` inside
the place's rect. Counting descendants of the cluster group would count zero and
a test written that way would pass on a renderer that never nested anything.

Six more 1.8.0 facts were settled by probe before designing around them:

| Probe | Result |
|---|---|
| Block id alphabet | `block:band-shape` is a **lexical error**; `band_shape` renders. Ids are `[A-Za-z0-9_]`. The emitter slugs ids and refuses a slug collision. |
| Labelled edge | `-- "label" -->` renders an edge-label group. `-->\|"label"\|` **parses and silently drops the label** (0 label groups measured). |
| Applying a class | `node["x"]:::class` is a lexical error; `classDef` + `class <ids> <name>` works, including a top-level `class` statement for a node nested inside blocks. |
| Where the class lands | Inline on the node's `<rect>`: `stroke-dasharray:5 5` reaches the drawn shape, not only the class attribute. |
| Label text | Parse-breakers are `"`, `<`, `>`, `&`; entity-escaping them and letting pele decode returns the original text (verified by decoding the SVG text back). Backslashes pass through unchanged — escaping them as `&#92;` produced a stray `&`, so they are left alone. |
| Empty place | A block with `columns 1` and no children renders (120x120 viewBox). No filler node is needed for a screen with no affordances. |

## 2. The model

Closed taxonomy, four collections and nothing else:

```js
{
  bands:     [{ id, label? }],                            // phases
  places:    [{ id, band, label?, affordances: [          // screens
                 { id, label? }                           // things to do there
               ] }],
  edges:     [{ from, to, label? }],                       // moves between places
  questions: [{ id, place, label? }],                      // open questions
}
```

- **Entry is derived, never declared:** the first place of the first band, in
  model order. A declared `entry` would need a sixth invariant ("exactly one
  entry") to stop two places claiming to be the start; the brief opened five.
  When no place is flagged, the convention cannot disagree with itself.
- **Shapes:** band = block, place = nested block, affordance = leaf node, open
  question = leaf node inside its place, classed `question` (dashed stroke).
- **A question is a leaf inside the place, not a top-level node joined by a
  dotted edge.** The brief's taxonomy says edges run *between places*; a
  place→question edge would have been a sixth shape invented on the emitter's
  authority. Inside the block the attachment is structural, the class makes the
  question visibly different, and no new edge kind exists.
- **Determinism:** model arrays are iterated in order, the two groupings are
  built once, the output is kind + lines + trailing newline. Nothing sorts,
  nothing dedupes, nothing derives an order the model did not state.

## 3. The five invariants, each proved red

`assertBoardModel` refuses with a message naming the offending id. Every proof
below was produced by commenting out one call in `lib/board-model.mjs` and
re-running `tests/board-mermaid.test.mjs`. Four of the five removals left
`# pass 13 / # fail 1`, with the matching refusal test failing; removing
`assertNoOrphanPlace` left `# pass 12 / # fail 2`, because the entry-convention
test states the same rule from the other side (a place listed first but sitting
in another band is not the entry).

| # | Invariant | Refusal message | Fixture that breaks it |
|---|---|---|---|
| 1 | every edge endpoint is a known place | `edge ends at unknown place "ghost"` | an edge `welcome -> ghost` |
| 2 | a place belongs to a band that exists | `place "welcome" belongs to unknown band "phase-9"` | `places[0].band = "phase-9"` |
| 3 | a band has at least one place | `band "measure" has no places` | an extra band with no places |
| 4 | no orphan place, except the entry | `place "limbo" is orphaned: no edge in or out, and it is not the entry "welcome"` | an extra place, no edges |
| 5 | a question is attached to an existing place | `question "poll-2" is attached to unknown place "nowhere"` | a question on `nowhere` |

Each fixture is also asserted through `boardMermaid`, so a broken model cannot
become a picture. One verbatim failure, with check 5 removed:

```
# Subtest: refuses a question on a place that does not exist, naming the id
not ok 14 - refuses a question on a place that does not exist, naming the id
  failureType: 'testCodeFailure'
  error: 'Missing expected exception: the refusal names the offending id'
  code: 'ERR_ASSERTION'
```

**Why two of the checks matter beyond the throw.** With check 2 removed, the
model emitted *without complaint* and the render showed clusters
`band_shape,band_build,place_signin,place_editor` and nodes
`place_welcome,aff_signin_a2,aff_editor_e1`: the place lost its block (a bare
node created by the edge that mentions it) and its affordance `aff_welcome_a1`
disappeared from the picture entirely. With check 5 removed, the render showed
three affordance nodes and no question node, while `classDef question` was still
emitted — a board declaring a style for open questions and showing none. Both
are silent losses; the invariant exists to turn them into a refusal.

## 4. Render numbers

Fixture: 2 bands, 3 places, 6 affordances, 2 labelled edges, 1 open question.
Source: 28 lines, 714 chars. SVG: 5154 bytes, `viewBox="0 0 1349 280"`.

| Fact | Model | Drawn |
|---|---|---|
| bands | 2 | 2 `pele-cluster` with `band_` ids |
| places | 3 | 3 `pele-cluster` with `place_` ids |
| affordances | 6 | 6 leaf nodes |
| open questions | 1 | 1 leaf node classed `question` (dashed) |
| leaves, total | 7 | 7 |
| clusters, total | 5 | 5 |
| edges | 2 | 2 `<g class="pele-edge">` |
| labelled edges | 2 | 2 `<g class="pele-edge-label">` |

**Nesting, both counts:** `place_welcome` draws 3 affordance children inside its
rect; dropping one affordance from the model draws 2, and the total leaf count
falls by exactly 1 (7 → 6).

One terminology correction, because the acceptance criterion says "one node per
place": pele draws a place as a **cluster**, not a `pele-node`. The test asserts
one cluster per place (against `BOARD.places.length`), one leaf per affordance
plus question (against the model), one edge group per edge, one label group per
labelled edge, every place block inside its band's block, every question inside
the place that raised it, the model's edge direction (the rendered edge id ends
with `from` before `to`), and the blocks in model order. Asserting "nodes per
place" would have asserted zero.

A place with no affordances keeps its block and adds no filler node (0 leaves,
`place_blank` cluster present): an empty screen is a finding about the product,
not a hole for the emitter to paper over.

## 5. Exits

| Command | Exit | Note |
|---|---|---|
| `node tests/board-mermaid.test.mjs` | 0 | 14 subtests pass |
| `npm run typecheck` | 0 | `tsc --noEmit`, including both new `.d.mts` |
| `npm run quality:shape` | 0 | 3 changed source files, no line over 160, 39 inherited lint findings, none new |
| `npm test` | 0 | full suite; the new file runs inside `test:artifacts` |

## 6. Red-team pass (fresh context)

Per the repository rule that an implementing agent does not certify its own
tests, a subagent with no history of this work was asked to falsify the suite by
mutating the emitter and the validator, one change at a time, and reporting
which subtest caught each. It found seven real gaps in the suite, all now fixed
by assertions rather than by prose:

| Mutation that passed before | Test added |
|---|---|
| an affordance emitted outside its place's block | per-band containment loop plus the existing child-count check |
| every question rendered in the first place | "a question is drawn inside the place that raised it" (per-place counts against the model) |
| the second band's places emitted outside its block | the containment loop is now over every place and its own band |
| edge `from` and `to` swapped | the rendered edge id must end with `from` before `to` |
| the `&` escape dropped from labels | label text is decoded once and compared with the author's literal label (`R&D &amp; <x>`) |
| groups sorted by id instead of model order | the determinism test also asserts the blocks appear in model order |
| `entryPlace` returning the last place of the last band | entry test with a place listed first but sitting in the second band |

Re-run after the fixes, every one of those mutations fails the suite. Five of
them fail exactly one test; the affordance-outside-block mutation fails two
(child count and question containment both see it), and so does the entry
mutation (the entry test and the orphan refusal). The same pass confirmed what
was already guarded: counts, class application, quote and angle-bracket
escaping, the slug-collision refusal, and all five invariants. Two notes about
the suite as it now stands: the determinism test calls the pure emitter twice,
which on its own cannot catch map ordering - the model-order assertion beside it
is what does; and a fixture count is always a sample of one board, so the
per-band loop is what keeps containment from being one fixture wide.

## 7. What I did not do, and why

- **No UI, RPC, artifact writing, `diagramForArtifact` row, or schema file.**
  Those paths belong to another change and touching them guarantees a conflict.
  `boardMermaid` returns text and no product code calls it yet; that is the
  deliverable.
- **No `entry` field and no sixth invariant.** The entry is derived (first place
  of the first band). Adding a field would have needed its own "exactly one"
  rule, and the schema was closed on purpose.
- **No `FEATURES.md` entry.** No surface renders a board yet, so there is no
  user-facing feature to list; the UI change owns that entry, and a feature
  inventory line for something nobody can open would be a claim, not a feature.
- **No `docs/README.md` row.** `audits/` is indexed as a unit by
  `docs/README.md`, and the seven records beside this one carry no row either.
- **No new dependency and no pin change.** `pele@1.8.0` was already an exact
  dependency and `PELE_PIN` already says `1.8.0`.
- **No layout controls in the model** (per-place columns, band span, colours).
  Those are presentation, not product facts; the emitter caps a place at three
  children per row and leaves the rest to the renderer.
- **No sorting, dedupe, or auto-derived edge order.** A diff must mean a change
  in the board. Two edges in the same direction are drawn twice because the
  model says so twice.
- **A `.d.mts` per module even though nothing TypeScript imports them yet.** The
  future UI import would otherwise need to add types in the same commit; the
  declaration-surface test checks that both claims are true today.
