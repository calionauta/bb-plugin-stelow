# Artifact rendering record — one fix, one decision

**Type:** repair record (defect fix + investigation stopped at a product decision).
**Date:** 2026-10-23.
**Base:** `origin/master` @ `f544224915d28681346a78a8eb6bade68cb5fb77` (contains PR #410).
**Branch:** `fix/artifact-rendering-2026-10-23`, cut from that commit in its own worktree.
**Input:** card `card_wxpaf8ll`, run end to end — not a fixture.

---

## 0. What the real card showed

State dir: `.stelow/2026-10-23/sw-card_wxpaf8ll/` in the shared checkout
(`/home/deploy/repos/bb-plugin-stelow`). 27 files, 21 registered artifacts.

`state.md` lines 61–63, one entry of that manifest:

```yaml
  - stage: planning
    kind: document
    label: spec tech v1
    path: .stelow/2026-10-23/sw-card_wxpaf8ll/plans/spec-tech_v1.md
```

Two facts follow, and both defects rest on them: every entry carries a
**label that is not a file name**, and the manifest's `kind` is a provenance
word (`document`, `artifact`) that the pinned helper assigns by extension
(`skills/stelow-workflow-orchestrator/references/state-contract.md:81`), never
a render kind.

The state dir holds **no** `.mmd`, `.html`, `.svg` or `.png` file, and no
fenced `mermaid` block inside any of its Markdown documents (`find` for the
four extensions -> empty; a recursive grep for the fence marker -> empty).
Nothing had been produced for a diagram to point at.


---

## 1. Defect 1 — Markdown artifacts rendered as raw text

### Root cause

`components/detail/artifact-viewer-dialog.tsx:151` on this base:

```ts
const path = file?.display ?? file?.path ?? "";
const kind = artifactRenderKind(path);              // :152
const derived = derivedDiagram(path, content, …);   // :160
```

`display` reaches the viewer from `server/runtime/card-detail-artifacts.ts:67`,
which is `fields.label ?? basename(full)`. A real manifest always has
`fields.label`, so `display` is a **title** — `"spec tech v1"` — and the real
file name in `file.path` was never read. `artifactRenderKind("spec tech v1")`
is `"source"`, so both `kind === "markdown"` branches (`:169`, `:179`) fell
through to `<pre>`. `derivedDiagram` was fed the same title, so a fenced
diagram inside a labelled document was never derived either — the picture was
missing for the same reason the prose was.

This was not the viewer's rendering logic, which is correct for a correct kind.
It was the input to the one function that owns the kind. **Single owner after
the fix: `artifactRenderKind` in `lib/artifact-render.mjs`, asked with the
file's path.** No second classifier was introduced, and the manifest's `kind`
stays the provenance word it is documented to be.

### What changed

- `components/detail/artifact-viewer-dialog.tsx:156–166` — `display` is held as
  `label` and `path` as `path`; the kind and the diagram derivation both read
  `path`. The two element titles (`… — derived diagram`, `… — interface
  mockup`) keep the label, falling back to the path. No rendering branch
  changed.
- `tests/artifact-viewer-mockup.test.mjs` — two cases where `display !== path`,
  listed under the red proof below.
- `FEATURES.md` — the artifact-viewer entry now states that the manifest label
  is never consulted. The previous sentence ("the decision is the path alone")
  was already the intent; it is now what the code does.

### The blind spot the fixture had

Every existing fixture in that file spelled `display` and `path` the same
(`{ display: "notes.md", path: "notes.md" }`), so `kindCalls` asserted
`["notes.md"]` and passed for the wrong reason: it proved the shared module was
consulted, not what it was asked. The new cases supply a label and a path and
**no kind**, which is exactly the shape the card produced.

### Red proof

Reverting the viewer (base file) and running
`node tests/artifact-viewer-mockup.test.mjs`:

```
AssertionError [ERR_ASSERTION]: a .md artifact whose display is a label still renders as prose, never as source
    at file:///…/tests/artifact-viewer-mockup.test.mjs:128:8
  actual: null
  expected: true
```

The second half is a separate failure, so it was proved separately by fixing
only the kind line and leaving the derivation on the label:

```
AssertionError [ERR_ASSERTION]: a fenced diagram in a labelled .md artifact is still derived and drawn
    at file:///…/tests/artifact-viewer-mockup.test.mjs:278:8
  actual: null
  expected: true
```

With the fix installed, both files are green, including their `kindCalls`
assertions that the shared module was asked about
`/ws/.stelow/2026-10-23/sw-card_x/plans/spec-tech_v1.md` — the path, never
`"spec tech v1"`.

---

## 2. Defect 2 — a rendered diagram never becomes an artifact

**Status: stopped at a product decision.** This section is the evidence for
that stop, not a task list.

### Where a diagram is produced today

| Producer | Where | Output |
|---|---|---|
| Viewer derivation | `lib/artifact-diagram.mjs:32` (`derivedDiagram`), from a `.mmd` file, a valid `scope-map.json`, or the first fenced `mermaid` block of a Markdown artifact | a Mermaid source string, in memory, at view time |
| Browser renderer | `components/detail/mermaid-diagram.tsx:10-35` — `import("pele").render(source).svg` | an SVG **element in this browser tab** |
| Server | `server/runtime/diagram-renderer.ts:32-41` — `createDiagramRendererHandlers` returns `{ diagramRendererStatus }` only; `server/runtime/platform.ts:145` imports pele to check that it resolves | `{ present, version, detail }` — a status, never a diagram |

There is no fourth producer, no `files.write` of a diagram anywhere in
`server/` or `lib/` (`grep -rn "svg" server lib` → no hits), and no RPC that
renders one. The SVG the reader sees lives and dies with the tab.

### Why "just write the file" is not the whole fix

A host-written diagram landing in the state dir would still not appear on the
card that asked for it:

1. The unregistered-artifact scan only accepts `.md` —
   `lib/artifact-manifest.mjs:64` (`if (!name.endsWith(".md") …) return false`),
   the bar the board shares. A stray `.svg` is invisible.
2. A manifest entry is written by the pinned helper at a transition
   (`state-contract.md:81`: ".md files as `kind: document`, anything else
   (`.json`, `.mmd`, `.html`) as `kind: artifact`"), and the helper has no
   artifact verb to call early:
   `bash data/stelow schema artifacts` → exit **2**, `schema: unknown command
   'artifacts' (known: advance, ask, audit-trail, check, config, decide,
   doctor, guard-judge, lock, scope, seed, status, sync-scopes)`.
3. So a diagram written today is listed only after the *next* `advance`. On a
   card that has settled at audit — the card in §0 — that transition never
   comes, and the file exists on disk while the modal shows nothing.
4. Making it appear sooner means either the host writing `artifacts:` into
   `state.md` (the two-writer shape PR #410 removed) or widening the
   unregistered scan past `.md`, which also drags in the other non-`.md`
   files: 9 of the 27 files on the real card are not Markdown (8 `.json`
   receipts plus `session.log`), and every one of them would then be a
   deliverable candidate on every card.

### The decisions this needs (not mine to invent)

**D1 — format.** SVG is pele's native output (pin `1.8.0`, `package.json:27`);
`pele.render(source)` returns `{ type, mermaidType, svg, width, height, links }`
server-side as well as in the browser, so an SVG snapshot needs no new code
path and no dependency. PNG is what pastes into a chat or an issue; it needs a
rasterizer (`sharp`/`resvg` — a new dependency, and a new decision about fonts
and DPI). Both is two representations of one fact, free to disagree — the
failure this repo keeps repairing.

**D2 — what a diagram is listed as.** (a) an artifact of the stage whose
source produced it (`.svg` beside its `.md`, `stage:` copied from the source
entry) — automatic once written, but it asserts that a diagram belongs to a
stage; (b) its own `diagrams:` section in the manifest — a new schema section,
out of bounds without the human's word; (c) not listed at all, kept as a view
of an artifact (today) — costs nothing, means a diagram is never a deliverable.

**D3 — snapshot or view.** Every diagram today is derived at view time, and
`lib/artifact-diagram.mjs` says why in its own header: the map or the Markdown
"is the source of truth". A stored SVG is a snapshot; the moment the map is
re-approved or the fence is edited, the file and the document disagree and
nothing detects it. Snapshot-and-rewrite-on-every-source-write requires hooks
on writers the host does not control (the worker edits plan documents directly);
snapshot-and-declare-stale requires a freshness rule and UI; derived-only is
today's behaviour.

**D4 — visibility.** As §2.2 shows, this is not a rendering question but the
single-writer rule. Whichever answer D2 gets, D4 needs an explicit choice
between a host write to `state.md` (breaks one writer) and a wider unregistered
scan (changes what counts as a stray, card and board together).

**Recommendation, if the human wants durable diagrams:** D1 SVG only; D3
derived-only remains correct until someone needs the picture outside bb, in
which case a snapshot is written *and* rewritten on every write of its source;
D2 (a), whose stage is the source document's; D4 resolved by naming the diagram
files the scan accepts rather than widening it to every non-`.md` stray.
Nothing was implemented, because each of the three first choices changes what
the card claims, and a card that lists a picture which no longer matches its
source is the same defect as a README quoting an output the code stopped
producing.

---

## 3. Gates

Run in this worktree, in this order, after the change and before the commit.

| Gate | Command | Exit |
|---|---|---|
| Types | `npm run --silent typecheck` | **0** |
| Shape | `npm run --silent quality:shape` | **0** — `no changed line over 160 characters`; budgets at the base baseline |
| Suite | `npm test` | **0** |

Targeted runs while working: `node tests/artifact-viewer-mockup.test.mjs`,
`node tests/artifact-render.test.mjs`, `node tests/artifact-viewer-diagram.test.mjs`
— all green with the fix, red without it as quoted in §1.

---

## 4. What I did not do and why

- **Did not make diagram persistence work.** It needs D1–D4 answered together
  (§2). Writing an SVG snapshot without D3 would hand the reader a picture that
  can silently outlive the document it was derived from; writing it without D4
  would leave the file on disk and the card still empty. Both are worse than the
  current, honest "derived at view time".
- **Did not add a table, a manifest section, or a helper verb.** No authority
  for a schema change was delegated, and the pinned helper's vocabulary is not
  the host's to extend (`schema artifacts` → exit 2 is a contract, not an
  oversight).
- **Did not write `state.md` from the host.** PR #410 restored one writer, and
  a second writer is exactly the failure that rule exists to prevent.
- **Did not widen `isDeliverableArtifactPath`.** That bar is shared with the
  board; loosening it to reach `.svg` would also list `invariants.json`,
  `session.log` and the `runs/` receipts on every card, which is a product
  decision about what a stray is.
- **Did not change the manifest's `kind` vocabulary** (`document` /
  `artifact`). It is the pinned helper's provenance word; the render kind has
  one owner and it is path-based, which is what the fix restored.
- **Did not touch `skills/` or `data/stelow`.** Both sync from upstream and are
  overwritten without warning; if a diagram should ever be a durable file, the
  methodology that produces it lives there, upstream of this repo.
- **Did not push, merge, tag, or release.** The branch is local.
