---
stage: verification
name: preset-environment-kind
product_type: software
appetite: Complete
recipe: verification
skill: stelow-workflow-testing-execution
reviewed_commit: b169142
branch: bb/stelow-pq-no-modal-de-agent-presets-ao-thr_tvu6ab9qf7
base: 75bb482
generated_at: 2026-09-30
---

# Verification report — preset environment kind

**Verdict: not ready for diff-gate.** The full suite is green and the debt
ceilings came down rather than up, but three blocking findings stand between
this commit and "shippable" — one of them a false-green test that the plan
itself specified, and two of them a behaviour gap that the *documentation
added by this same commit* asserts works.

| Phase | Result |
|---|---|
| P1 E2E browser | ❌ **not run** — see [Coverage I could not reach](#coverage-i-could-not-reach) |
| P2 UI quality audit | ⚠️ **partial** — 2 blocking, 3 deviations (sibling `ui-review.md`) |
| P3 unit / full suite | ✅ `npm test` EXIT=0 (333 files), `typecheck` clean, `quality:shape` clean |
| P4 parallel code review | ✅ this report + 4 hand-mutations, 2 of which stayed green |
| P5 final checklist | ❌ three boxes unticked (below) |

The green suite is real but it is **not evidence for the feature's central
capability**. Two independent hand-mutations — each removing shipped behaviour
the plan required — leave the entire suite green. That is the specific failure
mode `stelow-workflow-testing-ai-code` and this repo's own AGENTS.md warn
about, and it is the reason this report does not advance.

---

## What I ran, and what it returned

| Command | Result |
|---|---|
| `npm test` (full) | **EXIT=0** — 333 wired test files, no orphan (`suite-wiring` green) |
| `npm run typecheck` | clean, exit 0 |
| `npm run quality:shape` | clean — 16 changed files from `75bb482`, no changed line >160 chars |
| `npm run test:presets` | green (includes `preset-environment-seed.test.mjs`) |
| `npm run test:preset-ui` | green |
| `tests/debt-baseline.test.mjs` | green — 3 oversized files, 39 oversized functions, 24 inherited |
| `tests/decision-routers-ui.test.mjs` | green (the counting precedent this card was told to follow) |

**The extraction genuinely paid for itself.** Both ledger entries were
*deleted*, not raised (`scripts/source-debt.json` −2 lines:
`PresetManagerFormView: 73` and `PresetManagerList: 74` are gone). The
spec-tech gate that said a new control required an extraction first was real
and was honoured. This is the strongest part of the commit.

---

## Blocking findings

### B1 — the composer seed is wired into three dialogs and **tested in none of them**

`testing-strategy.md:78-80` (scope `composer-seed-wiring`) required **two**
test scopes. Neither exists:

```
$ grep -rn "defaultEnvironment" tests/ | wc -l
0
$ grep -rn "useSeededComposerEnvironment\|seededEnvironment" tests/ | wc -l
0
```

The strategy's own words: *"three counts, one per dialog, so one dialog
silently dropped fails."* I ran exactly that mutation.

**Mutation 1 — delete the seed from one of three dialogs:**

```bash
$ sed -i 's/^          defaultEnvironment={seededEnvironment}$//' \
    components/creation/create-explore-dialog.tsx
$ grep -c defaultEnvironment components/creation/create-explore-dialog.tsx
0                                    # the Explore composer no longer seeds at all

$ node --experimental-strip-types --import ./tests/register-ts-source.mjs \
    tests/preset-environment-seed.test.mjs   # EXIT=0
$ node tests/preset-ui.test.mjs                                    # EXIT=0
$ node ... tests/component-rule-seams.test.mjs                    # EXIT=0
$ node ... tests/card-creator-environment-optional.test.mjs        # EXIT=0
```

A third of the feature's runtime surface deleted, entire suite green. Scope 5
of the tech plan is verified by `grep` in a human's head and by nothing else.

**Fix:** three counts, one per dialog, plus the omitted-props assertion for the
off state (per `testing-strategy.md:78` — the omission is the load-bearing
half).

### B2 — AC 3's defence is untested, and the test that would catch it does not exist

`plans/spec-product.md:468-470` (AC 3) and the plan's scope-5 criterion
(*"the seed is captured once per dialog mount with a seeded-once ref"*) both
name a specific mechanism: `useSeededComposerEnvironment`'s `useRef`. The
strategy asked for a *"second read with a changed preset still returns the first
reference"* assertion and called that the thing that *"makes AC 3 testable
without mounting the host composer."*

**Mutation 2 — delete the entire re-seed defence:**

```bash
# captured.current ??= { seed: presetEnvironmentSeed(environmentKind) };
# return captured.current.seed;   →   return presetEnvironmentSeed(environmentKind);
$ node ... tests/preset-environment-seed.test.mjs   # EXIT=0
$ node tests/preset-ui.test.mjs                     # EXIT=0
$ node ... tests/component-rule-seams.test.mjs      # EXIT=0
```

The ref is gone; the mapper's frozen-constant defence remains, so the commit
still half-works — which is precisely why nothing noticed. **AC 3 has no
executor.**

**Fix:** call the hook's captured value twice with a changed `environmentKind`
and assert the second call returns the first reference. This is testable
without React by extracting the capture, or with a tiny `useRef` host double
matching the repo's existing `ts.transpileModule` seam pattern.

### B3 — UIR-5 is a behaviour defect, and `FEATURES.md:1231` now documents the opposite

The sibling audit filed this as a comment inaccuracy. It is more than that, and
I confirmed the mechanism in the mount chain:

- `useSeededComposerEnvironment` is called at `create-build-dialog.tsx:147` —
  **above** `<Dialog>` at `:155`, in `CreateBuildDialog`'s own body.
- `BuildPanelDialogs` (`build-panel-dialogs.tsx:87-102`) renders all three
  dialogs **unconditionally**, passing `open` as a prop. No `key`, no
  conditional mount.
- `BuildPanel` mounts that tree once, gated behind `!state.isInitialLoad`
  (`build-panel.tsx:179`).
- Radix `Dialog` unmounts `DialogContent` on close, **not** the component
  holding the hook.

So the `useRef` is created once per *panel mount*, not per *dialog open*. The
docstring at `composer-environment-seed.ts:21-22` claims otherwise, and this
commit went further and wrote the same claim into the product doc:

> `FEATURES.md:1231` — *"…which Stelow neutralises by capturing the seed once
> per dialog — **reopening the dialog re-reads it**."*

That sentence is false. The requester's exact scenario does not work: set a
preset to worktree, open Create card in the same session, and the picker does
not reflect it.

**The first-open case is fine**, and I checked it rather than assuming:
`boardPresets` starts `[]` (`build-panel-state.ts:45`) and the tree is gated
behind `!isInitialLoad`, so the *initial* capture happens after data loads. The
defect is confined to reopen-after-change. That is precisely the scenario the
feature exists to serve, and precisely the one this commit's own docs claim
works.

This is also a **`contract_truth` gate failure** under `testing-strategy.md`'s
CI gates (*"FEATURES.md or a pinned copy string still describes the
pre-control product"*): a documented example of behaviour the code does not
produce.

**Fix (either):** capture inside a child that mounts with `DialogContent`, or
key the ref on `open`. And correct `FEATURES.md:1231` and the docstring — a
false reassurance about a re-seed rule is the same class of unearned promise
the whole card was built to eliminate.

---

## Non-blocking, carried forward

These come from `ui-review.md`; I re-verified UIR-2 by hand and concur with the
other two without re-deriving them.

| ID | Finding | Status |
|---|---|---|
| **UIR-2** | Touch-target pin is **presence, not count** (`assert.match(fieldSource, /min-h-11/)`). I reproduced the false green: stripping both classes from the JSX and leaving the words in a comment keeps the assertion passing. `spec-product.md:254-256` and `testing-strategy.md:67` both said **counted**; the precedent at `decision-routers-ui.test.mjs:89-92` counts `h-11` occurrences. Real counts today: `min-h-11` ×1, `cursor-pointer` ×2. | Confirmed, blocking-adjacent |
| **UIR-1** | Help text renders as a `<p>` **outside** the `<label>`, so the checkbox's accessible name is `"Isolated worktree"` and AT hears none of the explanation — which the spec made the *sole* carrier of the built-in cascade and the out-of-enum value (`spec-product.md:276,:290,:294`). House precedent 20 lines away: `creation-settings.tsx:91`. | Confirmed |
| **UIR-3** | `focus-within` treatment required by `spec-product.md:237,:253-254` is absent (`grep -c focus-within` → 0). Not a broken keyboard path (UA ring survives), but the criterion reads as satisfied and is not. | Deviation |
| **UIR-4** | `cursor-pointer` applied unconditionally while `disabled={busy \|\| builtIn}` — a permanently disabled built-in control still promises clickability. | Deviation |
| **UIR-6** | `default` / `built-in` / `worktree` all in default `Pill` tone; adjacent identical pills read as one category. No `shrink-0` on the third pill; only the actions group has it. | Low |
| **UIR-7** | Dangling `aria-controls` when the form is collapsed. **Pre-existing at `75bb482`**, moved verbatim by the extraction. Not attributed to this card. | Not attributed |

### Scope-6 gap: the five echoed copy sites were not reviewed or updated

`spec-tech_1.md` scope 6 lists five target files and a DoD item (*"the five
echoed copy sites are updated, in the same commit"*). The commit touches **none
of them**:

```
$ git show b169142 --stat -- server/github-issue-flow.ts server/github-rule-rpcs.ts \
    lib/github-automation-gate.mjs components/github/github-automation-tab.tsx \
    components/isolated-worktree-check.tsx
(empty)
```

AC 12 requires the import dialog's copy to stop implying *"the preset can only
be created elsewhere."* `isolated-worktree-check.tsx:13` still reads *"Needs a
New-worktree preset in Agent Presets"* — now false in a new way, because the
preset that was previously CLI-only is authorable two clicks away in the very
dialog the sentence points at. Whether this counts as "reviewed and left alone"
(a legitimate disposition, since the two pinned strings at
`server-github-issue-flow.test.mjs:108,127` *are* still true) or as an
unreviewed miss is a judgement for the decision-maker. I flag it rather than
assert it, but it is currently unrecorded either way.

### AC 5 round-trip: no executor

`formFromPreset` carries `environmentKind` (`preset-manager-types.ts:47-55`) and
`savePreset` forwards it — correct by reading. `grep -rn formFromPreset tests/`
→ **no hits.** A regression that dropped the field from the round-trip would be
invisible. Lower severity than B1/B2 (the code is right) but it is a
Standard-path criterion with no test.

---

## Coverage I could not reach

**P1 E2E browser testing was not run.** This is a BB plugin (`server.ts` +
`app.tsx`) with no standalone dev server or URL; exercising the real flow means
driving the BB desktop host, and the worktree's plugin bundle is not the one
currently loaded in the running BB. I chose not to fabricate a green E2E line.

**B3 is precisely the finding a browser would have caught in seconds** — the
ui-review said so, and I agree. The same session applies to AC 1 and AC 6, which
are conditional on a Git-backed project and can only be observed for real.
Recommend a browser pass on the reopened-dialog path **before** diff-gate, not
after.

---

## Phase 5 checklist

- [ ] E2E/browser testing done — **not run** (see above)
- [x] UI accessible — *qualified*: UIR-1 unassociated help text is unresolved
- [x] Unit tests pass — `npm test` EXIT=0
- [ ] **New tests red-proofed** — 2 of 4 hand-mutations stayed green (B1, B2)
- [x] Tests co-located correctly
- [x] Code review done — this report
- [ ] **No regressions detected** — unverifiable; the regression tests for the
      new path do not exist
- [x] Documentation updated — *qualified*: `FEATURES.md` updated but now
      asserts a false behaviour (B3)
- [x] AGENTS.md — no architecture change, correctly untouched

**Four unticked boxes. The two blocking code findings (B1, B2) and the
documented-but-false behaviour (B3) all sit in the "tests prove the feature
works" column, and the suite's green says nothing about any of them.**

---

## Recommended next step

**Rework on `execution`**, not forward to diff-gate. In priority order:

1. **B1** — add the three per-dialog seed counts and the omitted-props
   assertion. Red first: the mutation above is the proof it must catch.
2. **B2** — add the second-read assertion for the seeded-once ref.
3. **B3** — fix the mount (or key the ref on `open`), then correct
     `FEATURES.md:1231` and `composer-environment-seed.ts:21-22` to match
     whatever the code actually does. If the reopen behaviour is *not* wanted,
     say so in the docs rather than claiming it.
4. **UIR-2** — convert both touch-target assertions to counts
   (`>= 1` and `>= 2`), per the precedent the plan already named.
5. **UIR-1** — give the help text an `id` and `aria-describedby` on the input,
   or move it inside the label. The sentences are the sole carrier of two
   spec-assigned facts; AT cannot reach them today.
6. **UIR-3 / UIR-4** — add the `focus-within` treatment, or record the
   deviation. Suppress the pointer cursor when disabled.
7. Record the scope-6 copy-site disposition either way.

B1 and B2 are small, mechanical, and each is already red-demonstrable. B3 is
the only one that touches behaviour, and it is the one worth getting right:
the commit currently promises a re-read it does not perform.

---

## Provenance

- Sibling artifact: `runs/exec_uurtj4ng/verification/ui-review.md` (UIR-1
  through UIR-7, 2 blocking / 3 deviations / 2 low / 1 pre-existing)
- Code under review: `b169142` on `bb/stelow-pq-no-modal-de-agent-presets-ao-thr_tvu6ab9qf7`,
  base `75bb482`, 20 files, +820/−118
- All four hand-mutations were applied, run, and **reverted**;
  `git status --short` is clean and the tree is at `b169142`.
- No state file, gate, or completion record was modified by this run.
