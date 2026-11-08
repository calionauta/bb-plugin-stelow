# P1 — the flow diagram, derived from the catalog and proven renderable

Branch `feat/flow-diagram-2026-10-23`, cut from `origin/master` (`f5442249`) in
the thread's own worktree. Nothing above `lib/` was touched: the modal and the
artifact write path belong to another thread.

Two decisions were given and are kept: the **Mermaid text is the artifact of
record** (an SVG is a picture of whatever renderer happened to be installed), and
**no new dependency** — the plugin already pins `pele`, so the renderer is the
validator.

## 1. Where the facts come from, verified against `origin/master`

| fact | where |
| --- | --- |
| the transition table (vendored, synced — never edited here) | `skills/stelow-workflow-orchestrator/references/transitions.md:76` (`## Transition Table`), first row `### triage` at `:78`, terminal row `### audit` at `:279` |
| the parser that reads it into `{ stage: { verb: [targets] } }` | `lib/transition-facts.mjs:109` (`parseTransitionRows`) |
| the closed verb set | `lib/transition-facts.mjs:43` (`TRANSITION_KINDS`: `next`, `accept`, `reject`, `rework`, `annotate`) |
| the exit verbs, and the dead-end rule | `lib/transition-facts.mjs:58` (`EXIT_VERBS`), `:76` (`stageExits`) |
| the two audits that rule serves | `lib/transition-facts.mjs:191` (markdown), `:240` (catalog) |
| the catalog projection: four MOVE verbs only | `lib/workflow-catalog.mjs:59` (`STAGE_TRANSITIONS`), and the comment at `:51-57` that keeps `annotate` out |
| the renderer pin and its install command | `lib/diagram-strategy.mjs:17` (`PELE_PIN = "1.8.0"`), `package.json:27` (exact pin) |
| how the shipped viewer renders | `server/runtime/platform.ts:145` (`loadPele`), `components/detail/mermaid-diagram.tsx:22` (`render(source)`) |

`stageExits` did not exist at `f5442249`: the "no outward exit and not terminal"
rule was written twice inside `lib/transition-facts.mjs`, once per audit. The
diagram needs the same answer, so the rule was extracted and both audits now call
it — one owner for "what is a dead end", no second definition that could disagree
with the picture. `EXIT_VERBS` is the same extraction for the verb set.

## 2. Which verbs the diagram shows, and why

All five, one edge per `(stage, verb, target)` — `21 next`, `21 accept`,
`16 reject`, `2 rework`, `1 annotate` = **61** edges over **18** nodes.

- **`annotate` is shown, dashed (`-.->`).** It is a row the table carries
  (`diff-gate → execution`), and it is explicitly *not* a move
  (`lib/workflow-catalog.mjs:51-57`). Omitting it would hide a real row; drawing
  it solid would claim a route a card can travel. The line's shape carries the
  difference, not a colour: `tests/flow-diagram.test.mjs:145` binds
  `verbArrow(verb)` to the catalog's move verbs, so a future non-move verb cannot
  ship as a solid line.
- **`rework` is shown, solid, self-loops included** (`shape → shape`): it *is* a
  move verb, so it draws like one. `shape`'s in-place rework is a loop a reader
  should see, not a defect to smooth over.
- **`next` and `accept` are both shown even though they name the same target on
  every one of the 18 stages (measured).** The table declares both and the helper
  accepts both, so 18 of the 61 edges are the data's own twin. Collapsing a pair
  into one labelled `next, accept` would look tidier and would break the invariant
  the first acceptance criterion measures — one edge per transition — hiding which
  verbs a card can actually travel under. If a future table makes `next` and
  `accept` disagree, the picture changes with it, which is the point of deriving it.
- **`WORKFLOW_STAGES` labels are not used.** The emitter takes parsed facts only;
  the stage id is the name the CLI takes (`bb stelow advance execution`), so the
  id is the honest label.

## 3. The emitter's contract

```js
flowDiagramMermaid({ transitions, title? }) -> string   // lib/flow-diagram.mjs:77
buildFlowModel({ transitions }) -> { nodes, edges }     // lib/diagram-model.mjs:105
```

- **Input is parsed facts, never markdown.** Either shape is accepted as-is:
  `parseTransitionRows(tableText)` (`{ stage, targets }` rows) or the catalog
  projection `STAGE_TRANSITIONS` (the verb map itself). The emitter does not open
  a file, so the diagram and the advance path cannot read the table differently.
- **Output**: optional Mermaid front matter (`---\ntitle: '…'\n---`, single-quoted
  so a title may carry `:`/`#`), then `flowchart TD`, then one node line per stage
  in table order, then one edge line per transition in table
  (`TRANSITION_KINDS`) order. Deterministic: the same table emits byte-identical
  text (asserted), so a diff in the diagram is a diff in the flow.
- **Node ids** are derived from the stage id only: `s_<stage>` with `-` → `_`
  (`lib/diagram-model.mjs:33`), so `int-gate` is `s_int_gate`. A collision after
  normalising is refused rather than merged — two stages in one node would present
  a hole as a decision.
- **Roles are in the outline, never in a colour**: `start` draws `([triage])`,
  `terminal` draws `{{audit}}`, everything else `[stage]`. No theme, no palette, no
  `classDef` — `terminal` is `stageExits(...).outward.length === 0` (the audit's
  own dead-end rule) and `start` is the mirror of it using the same `EXIT_VERBS`
  (nothing *advances* into the stage), which is why `triage` is the entry even
  though `reject` doors point back at it.
- **Refusals, not escapes**: a non-object or empty table, a row with a header and
  no parseable body (`present: false`), a target the table does not declare, an
  id collision, and a stage id Mermaid cannot draw all throw
  (`tests/flow-diagram.test.mjs:168`). A diagram of a broken table is a lie, so
  it is not drawn.

## 4. Acceptance criteria and their red proofs

Each assertion compares the emitter to the **parser**, never to a number written
in the test — a hardcoded 61 would keep passing while the table grew a row.

**1. One edge per transition.** `tests/flow-diagram.test.mjs:65` builds the
parser's own triple list (`stage|verb|target`, table order) and asserts
`deepEqual` in both directions against the model and against the edge lines
actually present in the emitted text. Measured: parser 61, model 61, text 61.
*Red proof*: dropping the `accept` verb inside `readEdges` fails with `the model
carries exactly the parser's transitions, none added, none reordered`.

**2. Deleting a transition removes its edge.** `:91` removes one real row from an
in-memory copy of the table — `reject:    setup` (asserted to occur exactly once)
— re-parses, re-emits, and compares. **61 → 60 edges**, the only missing triple is
`context|reject|setup`, the deleted line is absent from the text, and the node
count stays 18. Nothing is hardcoded: the drop is one, and the identity of the
lost edge is the row that was removed.

**3. It renders.** `:108` passes the emitted source to the bundled `pele`
(`1.8.0`) and asserts a whole `<svg>` document, non-zero size, and a measured
layout. Measured: `mermaidType` `flowchart-v2`, SVG **36,003 chars**, **986 × 2526**,
from **2,508 chars / 80 lines** of Mermaid. *Red proof*: an unclosed node bracket
in the emitter fails inside pele with `[PeleError]: Parse error on line 3` — the
renderer is a real gate on the syntax, not a formatting step.

**4. No dead ends.** `:117` walks all 18 nodes: a node's `terminal` role must equal
`stageExits(...).outward.length === 0` for that stage (the audit's predicate, not a
new one), a non-terminal node must have an outbound edge, a non-start node must
have an inbound edge, and `terminal`/`start` must be exactly `{audit}` / `{triage}`.
*Red proof*: forcing the terminal set empty fails with `audit: the outline agrees
with the audit's dead-end rule`; replacing the terminal hexagon with a plain
rectangle fails with `audit draws as a terminal shape`.

A fifth, unrequested pin lives beside them: the catalog projection draws the
markdown's edges minus `annotate` (`:84`), so the vendored mirror and the catalog
still describe one machine — and the emitter demonstrably takes either shape.

## 5. pele API used

`await import("pele")` then `render(source)` — the call the shipped viewer makes
(`components/detail/mermaid-diagram.tsx:22`). It returns
`{ type, mermaidType, svg, width, height, links }`; the test asserts on
`mermaidType`, `svg`, `width`, `height`. No `maid`, no Mermaid validator, no new
dependency.

## 6. Gates (exit codes)

| gate | exit | evidence |
| --- | --- | --- |
| `npm run --silent typecheck` | **0** | `tsc --noEmit`, both `.d.mts` files included |
| `npm run --silent quality:shape` | **0** | 4 changed source files, no line > 160; budgets clean; boot cost 495 leaves / 98.2%; lint 39 findings, all inherited |
| `npm test` | **0** | full suite, including `tests/flow-diagram.test.mjs` wired into `test:workflow-facts` (`package.json:145`) and `suite-wiring` (533 files) |

`tests/flow-diagram.test.mjs` was also run alone (exit 0) for every red proof
above; each mutation was reverted and the suite re-run green afterwards.

## 7. What I did not do and why

- **No UI, no RPC wiring.** The modal and the artifact write path are another
  thread's (`thr_ag6r95hn6q`); the deliverable stops at the emitter.
- **No `.mmd` committed.** The emitter is the artifact; a checked-in output would
  drift from the table on the first changed row, and the wiring thread owns where
  (and whether) a file lands.
- **No renderer dependency, no validator.** Given decision 2: the text is
  generated by our code, so `pele` accepting it is the only proof worth having.
- **No styling beyond two outlines and one dashed verb.** No theme, no colours, no
  `classDef`: the distinction the data carries is already a shape.
- **No phase grouping / subgraphs.** Phases are not in the parsed table; grouping
  would re-read the catalog for a fact the emitter is contractually not given.
- **No `FEATURES.md` entry.** No user-facing surface changed; a feature without a
  surface does not exist, so the wiring commit owns that entry.
- **No upstream blueprint proposal.** The boundary forbids pushing or touching the
  stelow checkout here. The portable rule to propose upstream, for the wiring
  commit's PR: *a diagram of the workflow derives from the parsed transition table;
  the emitter takes parsed facts and the renderer is a consumer, never the source.*
- **`node_modules` was a symlink to the main checkout** for the whole session (the
  `.gitignore:5` note explains why a bare `node_modules` entry covers it) and was
  removed for the commit; it is restored afterwards so the worktree stays runnable.
  Nothing from it entered the tree.
- **Not pushed, not merged, not tagged.** Branch only.
