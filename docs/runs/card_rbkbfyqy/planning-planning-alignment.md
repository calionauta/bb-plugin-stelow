---
stage: planning
task: planning-alignment
recipe: planning-research
skill: stelow-workflow-tech-planning
workflow_id: card_rbkbfyqy
generated_at: 2026-10-28T22:45:00Z
workspace: /home/deploy/repos/bb-plugin-stelow
scope_of_this_run: "planning:15 — bidirectional alignment check only"
spec_version: 2 (approved 2026-10-28)
scope_map: card-rbkbfyqy-scope-map-v1 (draft, unapproved)
decision_reads:
  - dec_xpc78x6q (selection: D-hybrid-chip-with-own-drawer, scopes 3 and 4)
classification: aligned-with-one-product-correction
---

# Alignment check — approved spec against the tech plan inputs

## 1. What this artifact is, and what it deliberately is not

This is `planning:15`. It compares the approved product spec (`plans/spec-product.md`, v2) against
the four things that now constrain a tech plan: the scope map (5 scopes, **draft**), the selected
interface (`dec_xpc78x6q`), the measured stack research, and the testing strategy. It classifies
misalignment and names the exact edit each finding needs.

It is not `spec-tech.md`. Scope generation (`planning:10`) has not run in this workspace — there is
no `spec-tech_v*.md`, and this run does not write one. Nothing here invents a scope, a task table or
a Done Criterion; §6 lists constraints the generator must carry, not the generator's output.

It also does not edit `state.md`, any gate, `scope-map.json`, or `spec-product.md`. The scope map is
a gate-owned draft and `approveScopeMap` refuses a self-minted receipt; the product spec is frozen at
v2 with a human's approval on it. So the corrections below are **instructions and gate items**, not
silent rewrites of artifacts a gate has not looked at yet. That is the whole discipline of this
stage: surface the drift, do not paper over it.

## 2. Verdict

| Axis | Classification | Basis |
|---|---|---|
| Product scope (IN/OUT list) | **aligned** | Every row of the spec's Scope Table has a delivering scope; every entry in "Out of scope" is honoured by all five scopes |
| Product behaviour (a stated sentence) | **one correction needed** — C1 | D8 says no changelog blob is read on a board render, while the chip's project line carries a gap sentence that needs one |
| Scope plan vs the selected interface | **misaligned** — S1 | Scope-4 still mounts a strip at `build-panel-view.tsx:357`, superseded two hours later by the human's chip decision |
| Scope plan vs measured stack | **3 gaps** — S2, S3, S6 | Top-level repo assertion, the changelog filename/`git show` double failure, and an ownerless `day` formatter |
| Scope plan vs testing strategy | **1 gap** — S9 / G2 | Ten test scopes exist as evidence, none as a delivery unit, and the critique's test-scope gap is still open |
| Contract shape vs house rule | **1 gap** — S4 | `undocumentedCount` / `notesAhead` have no absence value, so an absent project would publish a zero |
| Quoted measurements | **stale in three artifacts** — §5 | Three documents quote three different values for the same fact; one is a factual error |

Overall: **`aligned` on shape, with one product sentence to correct and a scope-map edit the scope gate
has not authorised.** No reshape. Nothing found in the stack or the tests makes a product requirement
impossible, and no scope claims something the spec forbids.

## 3. The checks, in the order the skill asks for them

### 3.1 Product requirement → scope (does anything in the spec lack an owner?)

| Requirement (spec v2) | Owner scope | Verdict |
|---|---|---|
| Newest release named per project, one fixed-height line | 4 | covered, **placement wrong** (S1), third selection state missing (C2) |
| Fleet line: newest across projects + how many shipped | 4 | covered, counting rule unsettled (G1), and it cannot read changelogs (S5) |
| Drawer: last five releases per project, one takeaway each | 1 + 4 | covered; fleet-drawer row budget unstated (S7d) |
| Takeaway = indented prose → first bullet → null | 1 | covered |
| Order by tag day desc, version tie-break, total | 1 | covered; spec's own count is stale (§5) |
| Five project absences + one row-level absence, none reads as "nothing shipped" | 1, 2, 4 | covered in prose, **not in the payload** (S4) |
| Strict reader: 10 s, 4 MiB, 15 s aggregate | 2 | covered (S6 owns who formats `day`) |
| Tag↔notes match by exact normalised text | 1 | covered |
| Wire result carries no `undefined` | 3 | covered; `null` vs `0` undecided (S4) |
| Independent of the flow strip's `count === 0` return | 4 | covered — own component, own drawer |
| Feature inventory + upstream blueprint + bundle proof | 5 | **three claims do not match the workspace** (S8) |
| Loading placeholder, stale-answer drop (critique) | 4 | **missing** (S7a, S7b) |

### 3.2 Scope → product (does a scope claim more than the spec grants?)

No. Every `inScope` line in the five scopes is either a spec requirement or a mechanism a critique
resolution already named. The two lines that read like additions are not product claims: scope-5's
lint/shape/typecheck/build:reload lines are the repository's commit obligations, not a feature, and
scope-2's working-tree fallback is authorised by D1 for the no-tags case only. Nothing in the map
promises a surface, a count or a sentence the spec withholds.

### 3.3 Tech → product (does a measured constraint invalidate a product claim?)

Three measurements matter, and two of them are cheap to satisfy rather than fatal:

- **A path inside a repository inherits that repository's tags.** Measured today:
  `git -C /home/deploy/repos/bb-plugin-stelow/components rev-parse --show-toplevel` answers the repo
  root. So a project whose source is a subdirectory would publish its parent's releases. The spec
  never promises this cannot happen; the critique demanded the guard. → S2.
- **A project path that is a parent of six repos is not itself a repo.** The project named `repos`
  (`/home/deploy/repos`) is one of the fourteen, and its `rev-parse` fails. That is `no repo`, the
  state the spec names, **not** `path missing` — the critique's resolution merged the two, and that
  merge is itself a small lie this check rejects. → S2.
- **`git show` cannot tell you why it failed.** Exit 128 for a missing path and a missing tag alike;
  both a missing changelog entry and an unreadable repository would collapse into one state. → S3.

Nothing else in the stack findings contradicts a product claim. The 4 MiB buffer and 10 s timeout are
bounds the spec already states; the parallel fan-out matches D8's cost claim.

### 3.4 Artifact → artifact (do the three planning documents agree with each other?)

Mostly. Two disagreements are worth naming because a plan will copy one of them:

- `runs/exec_1u1m1qu8/plans/stack-research.md` §5.1 says "190 declaration files, 718 names";
  `testing-strategy.md` says 257 `.d.mts` files. Measured: **257**. The testing artifact is right.
- `stack-research.md` says "the day the wire carries must be derived … by one explicit formatter in
  the reader", `selected-architecture.md:18` gives the pure module rows of `(version, day)`, and
  `scope-1` says the module derives `day` from the tag timestamp. Those three cannot all hold. → S6.

## 4. Findings

Severity: **critical** = would ship the wrong thing or a wrong claim; **important** = would cost a
rework cycle; **minor** = a sentence or a path.

### C1 — D8 forbids the read the chip's gap sentence needs (important, product sentence)

Spec D8 (`spec-product.md:115`) says "changelog blobs read only when the drawer opens". The chip with
a project selected carries the gap sentence (`scope-map.json:165`, spec `:163-164`), and that sentence
is computed from a changelog. Two readings, one of which must be chosen:

- **Recommended:** the board render reads **one** blob, for the one selected project, capped by the
  same 4 MiB/10 s bounds (the stack pass measured 23 ms wall for all six blobs, largest 242 KB). The
  fleet render reads **no** blob. This keeps D8's actual intent — no subprocess per project per board
  render — while making the sentence true. It needs one sentence in the spec: D8's mitigation becomes
  "at most one blob, for the selected project".
- **Letter of D8:** the gap sentence moves into the drawer and the chip carries version and day only.
  The product claim survives, one clause moves.

The correction is a design detail, not a reshape: IN/OUT, scope and the interface stand. Because the
review mode is *Product Spec + Interface + Scopes*, this sentence is the one thing a person should
confirm; §7 records the plan-safe default if they do not.

### C2 — "a project selected" has three cases on the board, the design has two (important)

`FiltersBar` toggles projects as a set (`components/board/board-filters.tsx:275`,
`build-panel-types.ts:14` `projectIds: string[]`). The spec names two states: one project, or none.
The board ships **three**: zero, one, two-or-more. `FlowStrip` already resolves this by treating
anything but exactly one as `null` (`build-panel-view.tsx:358-359`), which the chip will inherit by
copying. That inheritance is fine only if it is written down: with two projects filtered, the line
reads as a fleet claim while the reader is looking at a filtered board.

Recommendation, cheapest true version: exactly one → that project's newest release; zero **or 2+** →
the fleet line, and its label says across all projects, so the sentence cannot be read as a claim
about the selection. If the gate wants the line to respect the filter instead, scope-4 grows one state
and one sentence, and the fleet line disappears from the 2+ case.

### S1 — scope-4 predates the interface decision it must obey (critical, scope map)

| Artifact | Says | Time |
|---|---|---|
| `scope-map.json:150-171` | `components/board/release-strip.tsx`, "mounted beside FlowStrip at `build-panel-view.tsx:357`" | 19:51 |
| `selected-interface.md:19-31` | chip in the Build board's control strip beside the project and intent filters, its own slide-over | 22:01 |
| `selected-architecture.md:31-34` | `release-chip.tsx` + `release-list.tsx`, "beside the board's filters" | 22:01 |
| `decision-receipts.json` | `dec_xpc78x6q`, chosen by the operator, scopes 3 and 4 | 21:59 |

The map is the outlier and it is the artifact `planning:10` reads. Left alone, the plan mounts a
second stacked band at `:357`, which is the exact composition the critique's first critical gap
rejected ("six stacked release lines above a kanban whose height is already spent"). The mount site
is `components/panels/build-control-strip.tsx:37` (a single row of filters plus two toggles,
rendered from `build-panel-view.tsx:345`), 84 lines today.

Required edit: scope-4's capability list and mount site point at the chip/rows inside
`BuildControlStrip`; `release-strip.tsx` is not a file this card creates. Add the interface's own
accepted cost as an `inScope` line: **the control strip wraps rather than compresses on a narrow
screen**, because a `min-h-11` chip beside the filters will otherwise squeeze the filters (the
`inbox-row-layout` rule forbids a row's action cluster squeezing its text).

### S2 — the reader must prove the path is its own repository top level (critical)

Evidence: measured on this host today, 6 of 14 project paths are not repositories, one of them
(`repos`) is the parent of six; a subdirectory of a repo inherits that repo. The spec's
`no repo` / `path missing` distinction (`spec-product.md:69-72`) is what keeps the sentence honest,
and the critique's resolution ("a path that is not becomes path-missing") collapses it.

Required edit, scope-2: one rule — `rev-parse --show-toplevel` must equal the resolved project path;
a mismatch is `no repo` (the project's source is not its own repository), never that parent repo's
tags and never `path missing`. Reader test case 3 gains: a temp repo with a subdirectory fixture
reads `no repo`, and the parent's tags never appear.

### S3 — two measured mechanisms the scope plan does not name (important)

- **Changelog filename.** The critique's resolution accepts `CHANGELOG.md` and `Changelog.md` at the
  repo root only. Scope-2 names `git show <tag>:CHANGELOG.md` only — one variant absent, and the
  second variant is the difference between `ok` and `no release record` for a project that uses it.
- **Two-step existence check.** `git show` exits 128 both for a missing tag and a missing path in the
  tree, and `^{tag}` peeling is not a usable existence test on this repo's lightweight tags (measured
  in `stack-research.md` §3). The reader must do `rev-parse --verify refs/tags/<name>` (0/1) and then
  `cat-file -e <tag>:CHANGELOG.md` (0/128); which step failed is what selects the state.

Required edit: scope-2's command list gains the verification step and the two filenames; the mapping
"which step failed → which state" is written once, in the reader, not in the component.

### S4 — project-level counts have no absence value (important, contract)

Scope-3's output carries `undocumentedCount` and `notesAhead` for **every** project
(`scope-map.json:120`), and the spec forbids an `undefined` key (`:84-88`). A `no repo` project has no
window and no changelog, so an implementation will default both to `0` and the surface will publish
"0 undocumented" about a project it never read — a fabricated fact, and precisely the class of claim
this card exists to remove.

Required edit: both fields are `number | null`, `null` whenever no changelog was read; the component
never renders them outside `ok`; the contract test asserts `null` (not `0`, not omitted) for each of
the five absences. Terminological note for the same table: the spec says "five project states", the
testing strategy says "six states" (it counts `ok`), the architecture says "six typed states". One
phrase everywhere: **`ok` plus five absences**.

### S5 — the three read modes are not named, so scope-2 and scope-3 disagree (critical)

Scope-2: "exactly two git commands … `git show` only for a release the drawer is about to render —
never on a board render". Scope-3: the project payload carries `undocumentedCount` and `notesAhead`.
Those cannot both hold with no changelog read. The fix is one named rule with three modes:

| Mode | Trigger | Commands | Fields answered |
|---|---|---|---|
| **Spine** | board render, fleet, or any project the reader is not rendering notes for | `for-each-ref` only | `state`, `newest.version/day`, `releases[].version/day`, counts `null` |
| **Spine + newest** | board render, exactly one project selected | spine + one blob at the newest tag | adds `documented`, `takeaway`, `undocumentedCount`, `notesAhead` for that project |
| **Spine + window** | drawer open, per rendered project | spine + one blob per project | the five rows with notes, plus the two counts |

This single table resolves C1's cost question, S4's null semantics, and D8's performance claim at
once. It belongs in scope-2's `inScope`, and scope-3's payload is then honestly nullable per mode.

### S6 — `day` has no owner (important — it decides the first file scope-1 writes)

- `selected-architecture.md:18`: the pure module "takes tag rows (`version`, `day`)".
- `scope-1`: "`day` is YYYY-MM-DD derived from the tag's own timestamp, and it is both the sort key
  and the rendered value".
- `testing-strategy.md` case 8: the module renders the same day under `TZ=UTC` and
  `TZ=America/Sao_Paulo`.
- `stack-research.md` §3: one explicit formatter over `%(creatordate:unix)`, "in the reader".

At most one is true. Resolution that satisfies all four intents: rows enter the pure module as
`{version, unixSeconds}`; the module owns one exported formatter and returns `{version, day}`; the
reader passes unix and never formats; the wire carries `day` only. Architecture line 18 changes one
word, case 8 stays a pure unit test, and the "`day` is never computed in a component" trade-off is
untouched. `%(creatordate:short)` never appears in the reader.

### S7 — four resolved critique behaviours are missing from scope-4 (important)

- **(a) Stale answers.** "Answers are keyed by the selection that asked for them; a late answer is
  dropped." Not in scope-4. Without it the chip can show project A's release under project B's
  filter — the card's central failure mode, arrived at by race instead of by a bad read.
- **(b) First paint.** "The line renders a muted placeholder at fixed height from first paint; a
  failed read replaces it with the unreadable sentence; loading never persists past the deadline."
  Not in scope-4. The rendered test's "three states" are project/fleet/absence; loading is a fourth.
- **(c) Gap direction.** Spec gate decision 3 says the line names "notes ahead of tags";
  `scope-map.json:165` renders "when tags outrun the notes". Opposite directions, and scope-1
  computes both (`undocumentedCount`, `notesAhead`). Name both sentences, or one that composes them,
  and let the row-level "notes missing for this release" stay separate.
- **(d) Fleet drawer row budget.** Scope-4 says five rows per project in the drawer; the spec leaves
  the fleet expansion unspecified. Five per project is 30 rows today across six projects and one blob
  per project. Either state it as intended (recommended — it is literally "per-project summary") or
  name the one-row-per-project alternative.

### S8 — scope-5's three claims do not match the workspace (minor, but two are "does not exist")

- **FEATURES.md home.** Scope-5 puts one bullet in section 2 "beside the board surfaces" and cites
  "the neighbouring bullet at `FEATURES.md:2385`". Section 2 starts at `:396`; line 2385 is inside
  section 7 (`Command and embed`, from `:2050`). The bullet's home should be §2 beside Board and
  Filters, with a **pointer** to the flow bullet, not claimed adjacency.
- **Blueprint path.** `docs/host-plugin-blueprint.md` does not exist in this repo; it lives at
  `/home/deploy/repos/stelow/docs/host-plugin-blueprint.md` and lands upstream in a separate commit.
  Scope-5's capability line should say so, or the plan will search this checkout for a file that is
  not here.
- **`dist/` grep status.** Scope-5 lists it as a capability; the testing strategy bans it as a test
  and allows it as commit evidence. Same artifact, two statuses — settle it as evidence only.

### S9 — five delivery scopes, ten test scopes, and one open critique gap (important, gate)

`critique-report.md` records "the five scopes absorb six artifacts and no verification" as
`resolved: false`, carried to planning. `testing-strategy.md` then defines ten test scopes as evidence
obligations, and the scope map has no `test-*` scope at all. `planning:20` says `production` adds
`test-behavior`, `test-unit`, `test-integration`, `test-security`.

Both readings are legal, and the ceiling decides the argument: 5 + 4 = **9**, the maximum. So the
literal reading fits, exactly, and the fold is a deviation the gate must accept rather than a rule
the plan can assume. Recommendation: **fold, one line per scope naming which of the ten test scopes
it satisfies**, because a separate test scope would re-open files that scopes 1–4 own and the card's
appetite is Lean. The literal alternative costs four sequential re-opens and buys nothing except
conformance to a default written for larger plans. Either way, S9 is answered in `spec-tech.md`, not
in the scope map.

### Gate items — what only the plan gate can settle

These are not corrections to an artifact; they are decisions the plan cannot make for a person.

**G1 — what "how many shipped" counts** (`scope-map.json:35`, open decision 2). The gate answer was
"newest across all projects plus how many shipped" without defining shipped. Two readings remain:
projects that carry a release tag, or projects whose newest tag falls inside a visible window. The
spine read carries tag dates, so both are computable at no extra cost; what the spec does not contain
is a window — no age stamp, no since-control, no duration anywhere. A windowed count would therefore
invent a span the product never states. Recommendation: **projects carrying a release tag, plus how
many carry none**, which is also the reading the session log recorded. The interface's
`4 projects shipped` is illustrative copy, never a number to author into code or a test.

**G2 — five scopes or nine** (S9). The gate accepts the fold with per-scope test mapping, or asks for
the four `test-*` scopes that reach the 9-scope ceiling exactly. Nothing else in the plan changes
either way.

**G3 — the scope-map edit itself.** S1, S2, S3, S4, S6, S7 and S8 change the content of a draft the
scope gate has not looked at, and the scope-confirm ask from the previous worker expired unanswered.
The plan may apply them; the gate sees them as a diff in `spec-tech.md` and in the map's next
revision. No receipt is minted here, and `approveScopeMap` refuses one anyway.

## 5. Measurements, taken again today — and what the artifacts say instead

Read-only probes on this host at 2026-10-28 22:25–22:44Z. Every number below is a **datum, not an
acceptance criterion** (§6, rule 13).

| Fact | Quoted where | Measured now |
|---|---|---|
| Projects | 14 (stack, map) | 14 |
| Git repositories among the 14 projects | 6 with tags (stack) | 7: 6 with tags, 1 (`sessionmap`) with 0 |
| Projects answering with an absence | "8 of 14" (spec) | 8: 6 non-repos, 1 missing path, 1 zero-tag |
| Tags in this repo | 416 (stack) | 416 |
| Tag-days with more than one release | 32 (spec) / 41 (stack) | 41 of 48 days in this repo; **155 of 222 across all six** |
| Most releases on one day | 35 (spec D6) / 36 (scope-1) / 37 (stack) | 37 (`2026-09-15`); stelow 13, gogogo 13 |
| Newest tag | 0.99.0 (spec) / v0.100.0 (map) / v0.100.1 (stack) | `v0.100.1` |
| Version headings at HEAD | 311 (stack) | 311 here; gogogo has 143 `## ` headings of which **112** parse as releases |
| Largest changelog | 244,247 B (scope-2) / 242 KB (stack) | 231,435 B at HEAD here; 247,989 B at `v0.100.1` |
| `.d.mts` files | 190 (stack) / 257 (testing) | **257** — stack is wrong |

Two consequences. First, the tie-break is not an edge case anywhere: 70% of all tag-days across the
fleet carry more than one release, so "same-day" is the normal shape of a release order and the
stability test is load-bearing, not decorative. Second, three artifacts disagree about the same
numbers within a day of measuring them, which is the strongest argument in the plan for asserting
rules and never a quoted count.

## 6. What `planning:10` must carry (constraints, not scopes)

1. **Chain is one-way:** 1 → 2 → 3 → 4 → 5, matching `selected-architecture.md:81-84`. The row shape
   scope-1 defines is the contract every later layer speaks; do not start two scopes in parallel.
2. **Row shape, decided before anything else:** input `{version, unixSeconds}`, output
   `{version, day, documented, takeaway}` (S6).
3. **Three read modes are a scope-2 rule** (S5), not a component's improvisation.
4. **Contract file is new** and registered in `RPC_FRAGMENTS` (`server/rpc-contract.ts:14,44`).
   `server/card-rpc-contract.ts` is 373/400 lines; adding there is a budget regression by
   construction.
5. **Input takes `optionalInput`** (`server/rpc-input.ts:18`): `{projectId: string | null}` with a
   `null` default, so an omitted argument and an explicit `null` both mean the fleet and neither is a
   shaped-input failure.
6. **Handler at module scope**, in a sibling wiring module beside `buildFlowMetrics`
   (`rpc-surfaces.ts:67`; that file is 316 lines). Compose the reader and the module; parse nothing in
   the handler.
7. **`day` crosses the wire as a string**, never a `Date` or an epoch (`spec-product.md:84-89`).
8. **No dependency, no cache, no change to `runGitIn`.** `git-evidence.ts:61-79` keeps its fail-soft
   contract for five card surfaces; the sibling runner is the accepted cost.
9. **Every new `lib/` module ships its `.d.mts`** — 257 today, `declaration-surface.test.mjs` fails an
   unbound name.
10. **Shape budgets apply to tests too** (400 file / 50 function / 160 chars), and the parser's
    responsibilities must split by dialect / body bound / takeaway / ordering rather than by
    convenience.
11. **Rendered tests assert placement through `lib/drawer-side.mjs`** (`tests/flow-drawer.test.mjs:4`
    precedent), never a class string, and assert the board stays mounted while the drawer opens.
12. **Test authorship is a plan constraint:** the implementer is never its test's only author; parser,
    absence and contract cases are authored or red-teamed from a fresh context.
13. **No number from §5 becomes an acceptance criterion.** Structural facts only: five rows, `ok`
    plus five absences, three read modes, one blob per rendered project.

## 7. Defaults if no one answers the two product items

`humanBoundary` is `none` for this task, so nothing was asked. Both items have a plan-safe default
that a later gate can overrule without rework:

- **C1** → the reader reads at most one blob on a board render, for the selected project only, inside
  the existing 10 s / 4 MiB bounds. Spec D8's sentence becomes "at most one blob, for the selected
  project" in a v3 if the gate agrees.
- **C2** → exactly one selected project means that project; zero or two-plus mean the fleet, and the
  label never implies the filter applies.

Neither default hides a claim: the chip names a release and its day, and the fleet sentence says
across all projects.

## 8. Limitations

Everything measured here was measured on this host, on the shared checkout at
`fix/inbox-row-mobile-reflow` (68849b42), which is dirty with another thread's work; only read-only
`git`, `node:fs` and `bb project list` probes were run. No browser, no rendered drawer, no `npm test`
— this checkout's lint and shape state belongs to someone else's branch, so claiming a gate result
from it would be a false receipt. `spec-tech.md` does not exist yet; the checks above are against the
scope map, the interface and the two planning inputs, which is the earliest honest moment to run
them.

## 9. Hand-off

```
stage          : planning
task           : planning-alignment
status         : done
classification : aligned-with-one-product-correction
artifacts      : runs/exec_1u1m1qu8/plans/planning-alignment.md
owns           : C1, C2, S1-S9, G1-G3 (as instructions + gate items)
does_not_own   : spec-product.md (frozen v2), scope-map.json (draft, gate-owned),
                 spec-tech.md (planning:10), state.md, gates, completion state
next-candidate : planning:10 — scope generation, carrying §6 and applying S1-S8 to scope-4/2/3/5
gate           : plan-gate (planning:30) — items C1, C2, G1, G2, G3 for the human at that gate
rework-on      : architecture
```

Nothing outside this artifact was written. `state.md`, gates and completion state were not touched.
