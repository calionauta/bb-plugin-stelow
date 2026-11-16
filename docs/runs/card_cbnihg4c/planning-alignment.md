---
stage: planning
task: planning-alignment
skill: stelow-workflow-tech-planning
step: tech:15
name: bidirectional-alignment-check
product_type: software
appetite: Complete
review_mode: Auto
stack_source: existing:node
check_depth: deep
detected_at: 2026-09-30
repository: /home/deploy/repos/bb-plugin-stelow
plugin_version: 0.58.1
card: .stelow/2026-09-30/sw-card_cbnihg4c
---

# Bidirectional alignment check — preset environment kind

This is `planning:15`, the check that runs **after** the stack is known and
**before** the tech plan is gated. It compares the tech side (what
`stack-research.md` and `testing-strategy.md` establish about this codebase)
against the product side (`plans/spec-product.md` revision 2, `scope-map.json`,
`interfaces/selected-interface.md`) and classifies the result.

## 1. Method and mode

| Input | Read for |
|---|---|
| `plans/stack-research.md` | the tech stack and its per-scope implications (§4 of that doc) |
| `plans/testing-strategy.md` | coverage targets, per-scope evidence, the 7 red-proof mutations, CI gates |
| `plans/spec-product.md` (rev 2, approved) | the IN/OUT boundary, 9 DoD items, 12 ACs, the test-shape clause |
| `scope-map.json` (approved, 7 slices) | the executable scope decomposition |
| `interfaces/selected-interface.md` (opt-3) | the chosen control shape |
| The repository at this commit | every load-bearing claim, re-read rather than trusted |

**Review Mode = `Auto`** (`review_gates: []`). Per
`references/alignment-check.md`, in Auto mode both `product_needs_update` and
`blocking` resolve to *auto-update the product spec, then proceed* — no human
question is parked. **Appetite = `Complete`**, so check depth is **deep**: each
scope's ACs against codebase reality, including dependencies, shape gates, and
the mechanical claims that a plan can be self-consistently wrong about.

The discipline that matters here: an alignment check that only compares the two
documents against each other passes plans that are wrong about the repository.
Every finding below is anchored to a file, a line, and a command whose output I
read in this run.

## 2. Verdict

```
classification      : product_needs_update
mode                : Auto  ->  auto-update spec-product to revision 3, proceed
blocking findings   : 0
spec updates made   : 6 (all in plans/spec-product.md, revision 3)
scope rework briefs : 2 (routed to `rework-on: scope`, NOT edited into the approved map)
```

**The design is sound and I am not reshaping it.** The vocabulary finding, the
silent off-state, the seed-never-override rule, and the mandatory extraction are
all correct against this codebase, and I re-verified the three that carry the
whole design. What is wrong is narrower and more mechanical: the approved spec
contains a **table describing the control this card decided not to build**, a
**gate mechanism described backwards**, an **a11y inheritance claim that is
false**, and a **test-shape clause that the card's own scope invalidates**.
Three of the four survived critique round 1, which is the finding worth
recording: that round audited *whether* the claims were true and did not check
*whether they were true of this file*.

## 3. Findings

### F1 — The Interaction-states table describes a control this card rejected

**Severity: high. Self-contradiction inside one approved document.**

`plans/spec-product.md:195-207` opens "**Interaction states** (gap: affordance)"
and then specifies:

- `:199` — "Element: `fieldset` + `legend`, one radio per option (`strategy-picker` shape)"
- `:200` — "Checked: exactly one, always; the field is a single choice"
- `:202` — "Focus order: natural DOM order, legend first, then the options"
- `:207` — "`min-h-11` on each option label"

That is the **two-option radio** from revision 1. Nine lines earlier, at
`plans/spec-product.md:99`, the same document says: *"The control is an
explicit on/off toggle, **not** a two-option radio."* The selected interface
(`interfaces/selected-interface.md`) is `opt-3`, the checkbox, and
`scope-map.json` → `env-kind-control` in-scope repeats it: *"Explicit on/off
control, NOT a two-option radio."*

Verified against the component the spec says to reuse,
`components/isolated-worktree-check.tsx:16-30`: there is no `fieldset`, no
`legend`, and no radio. It is a bare `<input type="checkbox">` inside a `<label>`
with a `DetailsDisclosure` sibling. The spec's own §"Solution 1" table at
`:112-115` already describes the correct two-state behaviour; only the
interaction-states table was left behind.

**Why this matters more than a stale paragraph:** the interaction-states table is
the section an executor reads to *build the control*. A worker that reads `:199`
and builds a two-option radio reintroduces exactly the unearned promise that gap
5 of critique round 1 was written to kill — "Project checkout" as a selectable
state — and it does so from a document that three other places correctly forbid.
The OUT/IN table at `plans/spec-product.md:337` even lists "Renaming the stored
enum value" against "An on/off toggle whose off-state makes no promise".

**Resolution (applied in revision 3):** the table is rewritten to the checkbox:
one element, `checked` is `true`/`false` and *not* "exactly one", focus order is
the label then the checkbox, `Touch` is one label not "each option label", and
the `Empty` row — which currently says N/A because "the option set is closed" —
is replaced by the real empty case, the unrecognised stored value, which
`components/settings/preset-manager-types.ts:8` (`environmentKind: string`) and
`:48-49` (an unchecked `as` cast) make genuinely reachable at runtime.

### F2 — `min-h-11` + `cursor-pointer` are not inherited by reusing a string constant

**Severity: high. This is the a11y evidence base for the whole control.**

`plans/spec-product.md:181-182` claims the new field "inherits `min-h-11` +
`cursor-pointer` by construction rather than by a new inventory".
`interfaces/selected-interface.md:44-46` repeats it, and `testing-strategy.md`
builds a whole gate rationale on it (":168-172", "`focus-within` treatment
inherited by construction from the reused `isolated-worktree-check.tsx`").

Verified in `components/isolated-worktree-check.tsx`:

- `:8-14` — `ISOLATED_WORKTREE_LABEL`, `ISOLATED_WORKTREE_BENEFIT` and the
  module-private `ISOLATED_WORKTREE_DETAILS` are **plain strings**. No classes.
- `:19` — the `min-h-11 cursor-pointer` lives on the `<label>` **inside the
  `IsolatedWorktreeCheck` component**, at `:16`.
- `:20` — the input gets `size-4 cursor-pointer`.
- `grep -c "focus-within" components/isolated-worktree-check.tsx` → **0**. The
  only two files in `components/` carrying `focus-within` are
  `creation-settings.tsx` and `strategy-picker.tsx`.

So reusing the *constant* inherits nothing but three words. Reusing the
*component* would inherit the classes — but `scope-map.json` → `env-kind-control`
requires a **new** `PresetEnvironmentKindField` with its own `disabled` state, its
own help text, and an unrecognised-value state, none of which
`IsolatedWorktreeCheck` (a `{checked, onChange}` component with no `disabled`
prop) can express. The two requirements are mutually exclusive as written.

There is a second, quieter error in the same claim. Reusing
`ISOLATED_WORKTREE_BENEFIT` — *"The agent works on a separate copy — your files
and branches stay untouched"* — is **false in the preset editor**. On a preset
there is no agent and no card yet; it is a default that a future card may take
or a person may change, and `plans/spec-product.md:261` states the rule
verbatim: *"The seed is a seed. A person who changes the picker changes the
card."* Worse, `ISOLATED_WORKTREE_DETAILS[2]` (`:13`) reads *"Needs a
New-worktree preset in Agent Presets — without one the card parks with an
explanation"*. Rendered **inside** Agent Presets, that sentence instructs the
reader to go create the thing they are currently creating. `selected-interface.md:57-61`
records this as a "visible reference cycle" and accepts it; it is worse than
cosmetic — it is a sentence that is false in its new location, which is the
`AGENTS.md` "state honesty" rule, not a taste disagreement.

**Resolution (applied in revision 3):** the reuse is narrowed to what is actually
true and actually wanted. `ISOLATED_WORKTREE_LABEL` is reused as the single
source for the concept's name. `ISOLATED_WORKTREE_BENEFIT` and
`ISOLATED_WORKTREE_DETAILS` are **not** reused, each with the reason recorded.
`min-h-11`, `cursor-pointer` and a focus-visible treatment are written by hand
on the new control, and `testing-strategy.md`'s gate rationale is corrected to
match — the pin is now a *count to satisfy*, which is what
`tests/decision-routers-ui.test.mjs:89-92` already does.

### F3 — The debt-baseline mechanism is described backwards, in both the spec and the scope map

**Severity: high. As written, this scope turns a green build red.**

`plans/spec-product.md:139-144` and `scope-map.json` → `form-extractions` both
instruct: *"Add both to `inheritedBaseline` in the gate's print order, and lower
both ceilings in the same commit."*

I read the gate. `tests/debt-baseline.test.mjs`:

- `:39-78` — `inheritedBaseline` is a **literal expected-output list**, compared
  against what the diff-scoped budget gate *prints*.
- `:249-254` — `assert.deepEqual(reported, inheritedBaseline, "the inherited debt
  set changed…")`. It is an equality against stdout, not a waiver registry.
- `:209-216` — every ceiling in `scripts/source-debt.json` must be `> 50`, or the
  entry is invalid.
- `:222-224` — a recorded function that is *no longer oversized* must be
  **dropped**: "`${key}` is no longer oversized; drop it from the baseline".
- `:12` (header comment) — "a carried oversized function surfaces as inherited
  **the moment the file is edited**".

Running the gate at the pinned fork point confirms the shape: it printed 25
`inherited …` lines, and every one is a function still over 50 lines.

So the mechanism is the opposite of what the scope says. After extracting
`PresetManagerFormBody` out of `preset-manager-form.tsx:PresetManagerFormView`
(recorded at 73, `scripts/source-debt.json:19`) and `PresetManagerPresetRow` out
of `preset-manager-list.tsx:PresetManagerList` (74, `:20`), the **extracted**
functions will be under 50 lines — that is the entire point of extracting them —
so they will print **nothing**, and adding them to `inheritedBaseline` fails the
`deepEqual`. And because a 73-line function split in two will very likely land
the remainder **below** 50, its ledger entry must be **deleted**, not "lowered":
`assertRecordedOverBudget` rejects a ceiling that is not `> 50`, and the loop
rejects an entry whose function stopped being oversized.

The honest formulation is the one the gate's own header comment already gives:
*do not add anything to `inheritedBaseline`; the extraction is what makes the
inherited set shrink; the ledger entries for the two parents move to their new
sizes, or disappear entirely if the remainder fits the budget.*

**Resolution:** corrected in `plans/spec-product.md` (revision 3), and raised as
a scope rework brief — see §5.

### F4 — The test-shape clause says "extend" a pin that this card invalidates

**Severity: high. It would produce a red suite mid-execution.**

`plans/spec-product.md:427-431` says: *"what `upsertPreset` receives — extend the
existing exact-args pin at `tests/component-rule-seams.test.mjs:184-190`, which
already asserts `environmentKind`"*.
`scope-map.json` → `behaviour-tests` says the same at `:158`.

I read that pin. `tests/component-rule-seams.test.mjs`:

- `:158-161` — the fixture is `environmentKind: "local"`.
- `:184-187` — `assert.deepEqual(named.find("upsertPreset").args, { … environmentKind: "local" … })`.

**`"local"` is not in the enum.** `server/platform-rpc-contract.ts:100` is
`z.enum(["project-default", "new-worktree"]).default("project-default")`. So the
existing pin asserts that an out-of-enum kind **reaches the RPC**.

AC 10 (`plans/spec-product.md:398-400`) and `scope-map.json` →
`env-kind-control` in-scope (`:80`) require the opposite: client-side validation
in `savePreset`, a reader-facing refusal, and **the RPC never called** for an
out-of-enum kind. The moment that validation lands — and it is in scope, in the
approved map, and required by an approved AC — the fixture at `:160` becomes a
refusal, `named.find("upsertPreset")` returns `undefined`, and the `deepEqual`
at `:184` fails.

This is a genuine trap rather than a nit: the executor, holding a spec that says
"extend this pin", a scope map that says "extend this pin", and a red test that
says the pin is wrong, has three bad options — weaken the new validation, edit
the pin to match the broken behaviour, or invent a third shape. All three are
"tests over broken logic", which is precisely what `AGENTS.md` bans.

Note also that `permissionMode: "ask"` at `:160` and `:186` is *also* out of enum
(`accept-edits | auto | full`). It survives, because this card validates the kind
only. Worth stating so nobody "tidies" it in the same commit.

**Resolution:** corrected in revision 3 — the pin is **rewritten**, not extended:
the fixture moves to a valid kind, the exact-args assertion stays, and the
invalid-kind case becomes a *separate* refusal assertion (message set, RPC never
called) rather than a second row in the same object. `behaviour-tests` also gains
no row for this today, which is itself the gap.

### F5 — AC 11 is a documentation criterion wearing a behaviour costume

**Severity: low. No scope is missing; the classification is just wrong.**

AC 11 (`plans/spec-product.md:404-406`): "**Given** a worktree preset, **when**
'New preset' is opened, **then** the new form inherits the default preset's kind,
**and this inheritance is recorded in `FEATURES.md`**."

Verified: this already ships. `components/settings/preset-manager-form-state.ts`
`defaultForm()` (`:68-72`) returns `{ ...formFromPreset(preset), id: null, name: "" }`,
and `formFromPreset` carries `environmentKind`
(`components/settings/preset-manager-types.ts:48-49`);
`EMPTY_PRESET_FORM.environmentKind` is `"project-default"` (`:36`).

`scope-map.json` → `features-doc-truth` `:142` correctly lists *"Record that
'New preset' inherits the default preset's kind"* — so the scope map has this
right and the AC does not. The problem is that the test-shape clause demands
evidence per AC, and a Given/When/Then phrasing implies a behavioural test for
behaviour that is not changing. `behaviour-tests` has no row for it, which is the
correct outcome reached by accident.

**Resolution:** AC 11 is reclassified in revision 3 as a documentation criterion
(`test-contract` row, not `test-unit`), so nobody writes a regression test for an
unchanged default.

### F6 — Checked and consistent, recorded so it is not re-litigated

Two sibling artifacts state different test-file counts. Both are correct, and the
difference is a glob, not a disagreement — recorded here so a reader does not
treat it as a defect:

- `tests/suite-wiring.test.mjs:12` filters `.endsWith(".test.mjs")` → **332**
  files, which is what `testing-strategy.md` states.
- `tests/*.mjs` including non-test helpers → **334**, which is what
  `stack-research.md:§2` states.

Verified by both `ls` and by the gate's own output line format. No action.

## 4. What the check confirmed (the direction that matters as much)

A check that only produces findings is a check that cannot distinguish a plan
from a bad plan. These load-bearing claims were re-verified and **hold**:

1. **The vocabulary inversion is real.**
   `server/workers.ts:99-101` returns `{ type: "host", workspace: { type: "unmanaged", path } }`
   for `project-default`; `:103` returns `{ type: "project-default" }` for
   `new-worktree` and lets bb resolve it. `lib/tracks.mjs:94-100` returns
   `"managed"` for any `project-default` and reaches `"worktree"` only via
   `managed-worktree`. A control labelled over the raw enum would mislabel one of
   its two states. The on/off inversion is the right call.
2. **The seed is genuinely unwired, and the type is genuinely unexported.**
   `defaultEnvironment` exists at
   `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts:2667`;
   `CreateThreadEnvironmentArgs` is declared at `:368` and is **not** in the
   export list at `:3026`. The scope map's "indexed access rather than importing
   an unexported name" is not a stylistic preference — it is the only route that
   typechecks. Concretely:
   `NonNullable<NewThreadComposerProps["defaultEnvironment"]>`, and
   `NewThreadComposerProps` **is** exported at `:3026`.
3. **The seed's re-seed risk is real and the seed-once ref is the right defence.**
   The SDK doc at `:2642-2666` documents the value-compared seed semantics,
   including that `{ type: "project-default" }` "seeds nothing" — which is
   exactly why the off state omits the prop rather than passing that value.
4. **The mandatory extraction is genuinely required.** `scripts/source-debt.json:19-20`
   records 73 and 74; the files are 92 and 87 lines. Any edit to either puts the
   oversized function in the changed set.
5. **The three dialogs really do drop the field.** `create-build-dialog.tsx:134`,
   `create-research-dialog.tsx:110`, `create-explore-dialog.tsx:110` type
   `analysisPreset` / `researchPreset` / `explorePreset` as a five-field literal
   with no `environmentKind`, while `components/panels/build-panel-state.ts:226-232`
   returns the whole row. Confirmed no server change is needed.
6. **The docs-and-copy scope is correctly enumerated.** All five echoed sites
   exist: `server/github-issue-flow.ts:213,232`, `server/github-rule-rpcs.ts:91`,
   `lib/github-automation-gate.mjs:34`, `components/github/github-automation-tab.tsx:76`
   (plus `components/isolated-worktree-check.tsx:13`), and the two pinned strings
   are at `tests/server-github-issue-flow.test.mjs:108,127` as claimed.
7. **Test wiring claims hold.** `npm test` chains `test:contracts`, and
   `test:contracts` invokes `tests/component-rule-seams.test.mjs` and
   `tests/suite-wiring.test.mjs`. Critique round 1's withdrawal of the
   "orphaned guards" claim was correct.

## 5. Scope rework briefs

These are **routed, not applied**. `state.md` records the map was produced by
*"challenged, not edited"* through `scope-map-challenge.json`, so I did not
silently rewrite an approved artifact. Both land at the `scope` stage.

**SR-1 — `form-extractions` in-scope clause 3 is wrong.**
Current: *"Add both to `scripts/source-debt.json` inheritedBaseline in the gate's
print order"*. There is no `inheritedBaseline` in `scripts/source-debt.json` — it
is a literal list in `tests/debt-baseline.test.mjs:39`, compared with `deepEqual`
against gate stdout at `:249-254`. Replace with: the extraction shrinks the
inherited set; the two parent entries in `scripts/source-debt.json` move to their
new sizes or are **deleted** if the remainder fits the 50-line budget; add
nothing to `inheritedBaseline`.

**SR-2 — `behaviour-tests` in-scope clause 2 says "extend" where "rewrite" is
required**, and adds no row for the invalid-kind refusal that AC 10 mandates.
Replace with: the fixture at `tests/component-rule-seams.test.mjs:158-161` moves
to a valid kind; the exact-args assertion at `:184-187` is preserved; a separate
refusal case asserts one reader-facing message and `upsertPreset` never called;
and `permissionMode: "ask"` is left alone with a comment saying why.

## 6. Change log applied to `plans/spec-product.md` → revision 3

Auto mode authorises exactly this and parks no question.

| # | Edit | Driven by |
|---|---|---|
| 1 | Interaction-states table rewritten from two-option radio to the opt-3 checkbox; `Empty` row replaced by the real unrecognised-value case | F1 |
| 2 | Reuse narrowed to `ISOLATED_WORKTREE_LABEL`; benefit and details strings excluded with reasons; touch-target classes and focus treatment written by hand, not inherited | F2 |
| 3 | Extraction paragraph corrected to the actual gate mechanism | F3 |
| 4 | Test-shape clause: the exact-args pin is rewritten, not extended, with the invalid-kind case separated | F4 |
| 5 | AC 11 reclassified as a documentation criterion | F5 |
| 6 | `assumptions_resolved` extended with the five alignment findings and the evidence for each | F1-F5 |

No IN/OUT row, scope, dependency, or acceptance threshold changed. The product
decision is untouched — this revision only makes the document agree with the
repository it describes.

## 7. Hand-off (workflow mode)

```
stage          : planning
description    : Tech planning. Typed scopes + sequencing.
status         : partial
artifacts      : runs/exec_nyrqy19d/plans/planning-alignment.md
next-candidate : plan-gate
gate           : none
rework-on      : scope
```

Status is `partial` by design: this task is one slice of the stage. This run
covered `planning:15` — the bidirectional alignment check. Two findings were
applied to `plans/spec-product.md` (revision 3) and two are routed to the scope
stage as SR-1 and SR-2; `scope-map.json` is **unchanged**. The remaining planning
work — the typed scope plan (`spec-tech`) and its task tables — is not part of
`planning:15` and was not produced here. No state file, gate, approval, or
completion record was modified.