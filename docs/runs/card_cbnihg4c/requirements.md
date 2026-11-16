---
stage: audit
task: requirement-audit
skill: stelow-workflow-execution-critique
workflow_id: card_cbnihg4c
name: preset-environment-kind
product_type: software
appetite: Complete
mode: workflow
source_of_truth: plans/spec-tech_1.md (scopes) + plans/spec-product.md rev 3 (AC 1-12, DoD) + plans/testing-strategy.md (test scopes)
reviewed_commit: d2113ff
base: 75bb482
branch: bb/stelow-pq-no-modal-de-agent-presets-ao-thr_tvu6ab9qf7
sibling_artifacts:
  - runs/exec_uurtj4ng/verification/report.md
  - runs/exec_uurtj4ng/verification/ui-review.md
generated_at: 2026-09-30
gaps:
  - type: missing-tests
    area: "Scope 4 / components/settings/preset-manager-preset-row.tsx:27-38"
    description: "The worktree Pill moved INSIDE the truncating meta span leaves the FULL 300+ file suite green. The 'sibling, never inside it' assertion is defeated by its own non-greedy match. Re-verified by this slice with an independent full npm test run (EXIT=0)."
    impact: high
    effort: moderate
    resolution: escalate
    scope_candidate: true
  - type: missing-tests
    area: "Scope 3 / components/settings/preset-manager-types.ts:55 (formFromPreset)"
    description: "Acceptance criterion 5's round-trip has no executor anywhere. Replacing preset.environmentKind with a hard-coded 'project-default' leaves the full suite green; editing a worktree preset would show the box unchecked and silently downgrade the preset on save."
    impact: high
    effort: trivial
    resolution: escalate
    scope_candidate: true
  - type: missing-tests
    area: "Scope 3 / components/settings/preset-manager-editor.tsx:31-36 (isBuiltInEdit)"
    description: "The built-in disabled condition is decided here and no test in the tree names it. Returning !props.form.id — every new preset disabled, every saved preset editable — leaves the full suite green."
    impact: high
    effort: trivial
    resolution: escalate
    scope_candidate: true
  - type: missing-tests
    area: "Scope 5 / components/creation/composer-environment-seed.ts:37"
    description: "The seeded-once capture is pinned by source text, not behaviour. Making the guard unconditional keeps every pinned literal and re-captures every render; the full npm test suite stays green. Acceptance criterion 3 therefore has no executor."
    impact: high
    effort: moderate
    resolution: escalate
    scope_candidate: true
  - type: incomplete
    area: "Scope 5 / the three creation dialogs, defaultEnvironment"
    description: "Nothing asserts the off state OMITS the prop at the wiring layer. Seeding {type:'project-default'} at the hook's return, with the pure mapper untouched, leaves the full suite green."
    impact: medium
    effort: trivial
    resolution: escalate
    scope_candidate: true
  - type: missing-tests
    area: "Scope 6 / FEATURES.md (whole file)"
    description: "The strategy's contract_truth BLOCK gate has zero implementation: no file under tests/ reads FEATURES.md. A full 'git checkout 75bb482 -- FEATURES.md' — reverting the card's entire documentation deliverable — passes npm test (EXIT=0)."
    impact: high
    effort: trivial
    resolution: escalate
    scope_candidate: true
  - type: incomplete
    area: "Scope 5 + Scope 6 / FEATURES.md:1229-1233 vs the SDK re-seed rule"
    description: "FEATURES.md claims a preset saved mid-dialog cannot re-seed over the person's choice. The capture pins defaultEnvironment only; defaultProviderId / defaultModel / defaultReasoningLevel / defaultPermissionMode are passed live from the same preset row, and the documented SDK rule re-seeds EVERY selection when ANY default* changes. Derived from the SDK docstring, not observed in a browser."
    impact: high
    effort: moderate
    resolution: escalate
    scope_candidate: true
  - type: incomplete
    area: "Scope 3 / preset-environment-kind-field.tsx:97 and :94"
    description: "Acceptance criterion 9's unrecognised sentence and acceptance criterion 8's cascade sentence are unguarded. Rewriting the unrecognised sentence passes npm test AND tsc --noEmit. The cascade sentence names the rule and the escape but never the consequence the code's own comment spells out."
    impact: medium
    effort: trivial
    resolution: escalate
    scope_candidate: true
  - type: incomplete
    area: "lib/preset-assignment.mjs:38 (adjacent, outside every scope's TARGET_FILES)"
    description: "Forwards defaultPreset?.environmentKind ?? 'project-default' to upsertPreset with no kind validation, so on an upgraded install a card-override assignment from an out-of-enum preset hits the zod enum and returns a raw validation string. AC 10 as written is scoped to savePreset, so this is not a criterion failure — it is an unrecorded adjacent path."
    impact: medium
    effort: trivial
    resolution: documented
    scope_candidate: false
  - type: debt
    area: "skills/stelow-workflow-execution-critique/references/workflow-audit.md:111,321"
    description: "Criteria 6 and 11 filter on the literal 'completed'. The host closes scopes as 'done' and isDoneStatus (lib/trackables.mjs:28-30) treats both as terminal. Both criteria therefore selected 0 of 7 scopes on this card and passed vacuously. Correction to the sibling evidence slice: there are TWO occurrences, at :111 and :321 — not the three line numbers cited there."
    impact: medium
    effort: trivial
    resolution: escalate
    scope_candidate: true
  - type: new-scope
    area: "The close path itself — 7 of 7 scopes status 'done' with no record, no contract, no tasks[], no completed_at, no duration_s"
    description: "All three audit slices reach the same destination by different roads. Until a scope close can be falsified, a green npm test and a 'done' scope are the same claim wearing two hats. One scope, not four: make a close impossible to fake."
    impact: critical
    effort: significant
    resolution: escalate
    scope_candidate: true
  - type: new-scope
    area: "Requester decision — the import-dialog default (spec-product.md:425 and :454-455 vs :398-402)"
    description: "The requester asked for the default to apply 'quando for abrir uma issue de qq projeto'. The card seeds the three card CREATION dialogs; the GitHub IMPORT path keeps its own unchanged default. state.md decided this without the requester confirming, and the spec contradicts itself in three places. The answer decides fix vs new scope."
    impact: high
    effort: moderate
    resolution: escalate
    scope_candidate: true
  - type: quality
    area: "components/settings/preset-manager-types.ts:55 vs its own docstring at :66-67"
    description: "The docstring claims the form carries the original value rather than normalising it. The ?? does normalise a null — and isKnownEnvironmentKind two functions below is typed string | null | undefined. Mitigated: the column is NOT NULL and the RPC defaults it, so this is unreachable-but-contradictory rather than a live bug."
    impact: low
    effort: trivial
    resolution: documented
    scope_candidate: false
  - type: quality
    area: "tests/preset-environment-seed.test.mjs:266-278"
    description: "The min-h-11 count contradicts its own comment: removing min-h-11 from the JSX while leaving the words inside a JSX comment still reads 'found 1' and passes. It is the presence grep the comment claims it replaced, reintroduced one block after the UIR-2 fix."
    impact: low
    effort: trivial
    resolution: documented
    scope_candidate: false
  - type: debt
    area: "Undeclared files and one undeclared symbol"
    description: "components/creation/composer-environment-seed.ts is the load-bearing artefact of scope 5 and is in no TARGET_FILES list; neither are preset-manager-editor.tsx, preset-manager-types.ts, or the extra PresetManagerFormToggle extraction in preset-manager-form-body.tsx. spec-tech_1.md:153,163 also still say 'per dialog mount' where the code (correctly) keys on open."
    impact: low
    effort: trivial
    resolution: documented
    scope_candidate: false
  - type: quality
    area: "Seven touched files lost their trailing newline"
    description: "The extraction actively removed one that existed at 75bb482. Lint and both shape gates pass and 9/186 components/ files already lack one, so this is hygiene, not a gate."
    impact: low
    effort: trivial
    resolution: documented
    scope_candidate: false
---

# Execution Critique Report — preset environment kind

**Date:** 2026-09-30
**Mode:** workflow (plan audit against `spec-tech_1.md` and `spec-product.md` rev 3)
**Source of truth:** the seven typed scopes, the twelve acceptance criteria, and the per-scope test contract in `plans/testing-strategy.md`
**Model used for audit:** Space Bunny Free (independent of the executor; five hand-mutations applied, run and reverted)
**Code under audit:** `d2113ff` on top of `b169142`, base `75bb482` — 20 files, +963/−118

The rework commit `d2113ff` exists because verification refused `b169142` on
three counts (B1, B2, B3). This audit re-ran every gate at `d2113ff` and
re-ran the verification mutations, plus three of its own. **B1, B2 and B3 are
genuinely fixed** — all three of verification's own mutations now go red. What
remains is narrower and, in one case, is a requirement the executor was told to
do and did not: **AC 12's copy half and DoD 8's five echoed copy sites are still
untouched**, even though `state.md` records the decision to correct them.

---

## Summary

| Metric | Value |
|--------|-------|
| Tech-plan scopes evaluated | 7 |
| Scopes complete | 4 (1, 2, 3, 4) |
| Scopes partial | 3 (5 coverage shape, 6 copy half, 7 residual) |
| Acceptance criteria evaluated | 12 |
| AC complete | 7 |
| AC partial | 4 |
| AC not met | 1 (AC 12) |
| Product DoD items evaluated | 9 |
| DoD complete | 7 · partial 2 |
| Gaps identified | 8 |
| Hand-mutations run by this audit | 5 (3 red, 2 green) |

**Verdict: not shippable as-is.** Two ESCALATED coverage gaps and one
ESCALATED requirement gap remain, and one decision needs a human rather than
another execution pass.

---

## 1. Scope/Plan Completeness

| Scope | Type | Status | Evidence at `d2113ff` |
|-------|------|--------|------------------------|
| 1 `env-seed-mapper` | feature | ✅ complete | `lib/preset-environment-seed.mjs` + `.d.mts`; frozen module constants; total map (anything ≠ `new-worktree` → `undefined`); `.d.mts` uses `NonNullable<NewThreadComposerProps["defaultEnvironment"]>` as the plan required, because `CreateThreadEnvironmentArgs` is unexported |
| 2 `form-extractions` | feature/refactor | ✅ complete | `PresetManagerFormBody` and `PresetManagerPresetRow` are named exports; `scripts/source-debt.json` **lost** two lines (`PresetManagerFormView: 73`, `PresetManagerList: 74`) — deleted, not raised; `debt-baseline` green with nothing added to `inheritedBaseline` |
| 3 `env-kind-control` | feature | ✅ complete | `components/settings/preset-environment-kind-field.tsx`; writes `form.environmentKind`; imports `ISOLATED_WORKTREE_LABEL` and `doesNotMatch` the two false strings; hand-written `min-h-11` + cursor; `disabled = busy \|\| builtIn`; four state-specific sentences |
| 4 `preset-list-indicator` | feature | ✅ complete | `preset-manager-preset-row.tsx:38` renders the `worktree` Pill as a **sibling** of the `min-w-0 flex-1 truncate` span at `:27`, with the affirmative-only shape the plan asked for |
| 5 `composer-seed-wiring` | feature | ⚠️ partial | All three dialogs read and pass the seed, and the reset key is present. The behaviour is right; the *defence* is pinned textually rather than behaviourally (gap G2) |
| 6 `features-doc-truth` | docs | ❌ partial | `FEATURES.md` `:1012-1013` and `:1206-1207` rewritten, limitations named, and the reopen claim now matches the code. **The five echoed copy sites are byte-for-byte untouched** (gap G3) |
| 7 `behaviour-tests` | test | ⚠️ partial | `tests/preset-environment-seed.test.mjs` is 378 lines and every verification mutation now fails it. Two residues: AC 5 has no executor (G1) and the seeded-once property is text-pinned (G2) |

The scope-6 finding is not new — verification raised it and the executor
addressed everything else on that list. It is the one item that fell through,
and `state.md`'s `shape_decisions` records it as settled
(*"GitHub import default unchanged; the stale copy in
`isolated-worktree-check.tsx` is corrected instead"*), so this audit is not
raising a new objection. It is reporting a recorded decision that was never
executed.

---

## 2. Implementation Quality

| Issue | Severity | Location |
|-------|----------|----------|
| AC 5's round-trip has no executor — dropping `environmentKind` from `formFromPreset` leaves the whole suite green (mutation M5, reproduced below) | high | `components/settings/preset-manager-types.ts:46-55` |
| The `useSeededComposerEnvironment` guarantee is asserted by reading its source, not by calling it; a condition that keeps the pinned literal and always recaptures stays green (mutation M4) | high | `tests/preset-environment-seed.test.mjs:349-372` |
| The list-pill sibling assertion keys on `{preset.isDefault` rather than on the worktree Pill, so the structural guarantee is pinned one node away from the thing it protects | low | `tests/preset-environment-seed.test.mjs:310-313` |
| `Pill` tone for `worktree` is identical to `default` and `built-in`, and none of the three carries `shrink-0` on a `flex items-center gap-2` row | low (UIR-6, carried) | `preset-manager-preset-row.tsx:33-38` |
| Dangling `aria-controls` when the form is collapsed | low (UIR-7, pre-existing at `75bb482`, moved verbatim) | `preset-manager-form-body.tsx:89` |

No syntax, import, or broken-reference issue exists: `tsc --noEmit` is clean,
`depcruise` reports **no dependency violations across 853 modules / 1950
dependencies**, and `quality:shape` reports no changed line over 160 characters
across the 16 owned files the branch touches. The `lib/` module imports nothing
from `app.tsx`, `server.ts`, `components/` or `hooks/`, so the host-neutral rule
holds.

One design point deserves naming because it is easy to mistake for a bug later:
`environmentKind` was widened from a two-option union to `string`
(`preset-manager-types.ts:20-27`). That is deliberate and correct — an upgraded
install adds the column with `ALTER TABLE` and no CHECK, so an out-of-enum value
is genuinely reachable, and a control that normalised it would hide the fact the
person needs to see. `savePreset` narrows it back with a reader-facing refusal
(`preset-manager-crud.ts:64-69`), and the cast at `:104` is guarded by that
refusal rather than being a way around it. This is the AC 9/AC 10 design working
as specified.

---

## 3. Invisible 20%

| Dimension | Status | Notes |
|-----------|--------|-------|
| Error handling | ✅ | `savePreset` refuses an out-of-enum kind before the RPC, sets exactly one reader-facing message naming both the offending value and the way out, and `setBusy(false)` still runs in `finally`. Tested against a recording rpc double that asserts **zero** calls |
| Observability | ⚠️ | No new telemetry, which is consistent with the plan. But the AC 6 substitution is **silent by design** — `describeCardEnvironment` returns `"exploratory"` before it ever consults the seed (`lib/tracks.mjs:95-96`), so nothing is written anywhere. That is an accepted carve-out, not an oversight, and it is named in `FEATURES.md` |
| Security | ✅ | Out of the card's risk class: no new dependency, no RPC surface, no migration, no untrusted input path. `savePreset` is the one place an out-of-schema string could reach the wire and it refuses |
| Input validation | ✅ | Three layers: `isKnownEnvironmentKind` in the form path, `saveRefusal` before the call, and the RPC's own `z.enum` as defence in depth. The client's refusal exists so a raw zod string never lands in the form's single message line |
| Boundary honesty | ✅ | The stored word (`project-default` = shared checkout in Stelow) and the wire word (`project-default` = managed worktree in BB) are opposite meanings. The mapper states `host/managed-worktree` explicitly and refuses to lean on the one token the two layers disagree about — asserted, including a `notEqual` on `worktree?.type === "project-default"` |

---

## 4. Edge Cases

| Edge case | Status | Notes |
|-----------|--------|-------|
| Unrecognised stored kind (AC 9) | ✅ | Renders unchecked with a sentence naming the stored value; the mapper returns `undefined` rather than throwing; `savePreset` refuses it. Asserted for `"local"`, `""`, `null`, `undefined` |
| Off state (AC 4) | ✅ | The mapper returns `undefined`, so the composer's default applies unchanged. Byte-for-byte today's behaviour |
| Preset saved while the dialog is open (AC 3) | ✅ behaviour / ⚠️ proof | The capture is keyed on `open`, so a mid-dialog save cannot re-seed. The property is proven by re-running verification's mutation (red) but not by a direct assertion |
| Dialog closed and reopened | ✅ fixed | This was B3. `captured.current?.open !== open` is the reset key; `FEATURES.md:1229-1231` and the docstring at `composer-environment-seed.ts:22-27` now describe what the code does rather than what it intended |
| First open before preset data loads | ✅ | `boardPresets` starts `[]` and the tree is gated behind `!state.isInitialLoad`, so the initial capture happens after data lands. Verified again this pass |
| Built-in preset | ✅ | Control disabled; the cascade (re-routes every auto-started worker, inherited by every preset created afterwards) is named in the help sentence, which is now the input's `aria-describedby` |
| Preset renamed while the dialog is open | n/a | Not affected — the capture is `environmentKind`-only |
| Personal/exploratory project (AC 6) | ✅ recorded | Documented as a **silent** substitution in `FEATURES.md`, with the label divergence (`worktree` from the composer, `managed` from GitHub import / CLI / research fan-out / respawn) named as a per-path known behaviour |
| Non-Git source | ⚠️ unverifiable headlessly | Requires a real project on a real host. Same class as AC 1 |

---

## 5. Doc & Test

| Item | Status |
|------|--------|
| `FEATURES.md:1012-1013` rewritten | ✅ now accurate — the picker is seeded and the person can always change it; the label is recorded as stored per path, not per intent |
| `FEATURES.md:1206-1207` rewritten | ✅ the authoring control, the built-in cascade, the unrecognised-value refusal, and both recorded limits |
| Five echoed "create a New-worktree preset" sites | ❌ **untouched** — `git diff 75bb482..HEAD` over all five files is empty |
| Two exact-string pins at `server-github-issue-flow.test.mjs:108,127` | ✅ untouched and still true, so no pin needed moving |
| `FEATURES.md` accuracy vs code | ✅ the reopen sentence is true at `d2113ff`; this was a `contract_truth` failure at `b169142` and is closed |
| Test file wired into an npm script | ✅ `test:presets` chains `tests/preset-environment-seed.test.mjs`; `suite-wiring` green, no orphan |
| Full suite | ✅ `npm test` EXIT=0 at `d2113ff` |
| `typecheck` / `quality:shape` / `architecture` | ✅ all clean |
| New tests red-proofed | ⚠️ 3 of 5 of this audit's mutations red; two stay green (G1, G2) |
| E2E / browser | ❌ not run — a BB plugin has no standalone URL, and driving the real flow means the desktop host, whose loaded bundle is not this worktree's. Not fabricated |

---

## 6. Hand-mutations run by this audit

Five mutations, all applied to the real files, run against five relevant test
files, and **reverted**. `git status --short` is empty and the tree is at
`d2113ff`.

| # | Mutation | Suite result | What it proves |
|---|----------|--------------|----------------|
| M1 | delete `defaultEnvironment={seededEnvironment}` from `create-explore-dialog.tsx` (verification's exact B1 mutation) | **RED** | B1 is fixed. The seed is counted per dialog, so one dialog silently dropping fails |
| M2 | replace the hook's capture with a bare per-render recompute (verification's exact B2 mutation) | **RED** | B2 is fixed |
| M3 | revert the `open` key to a mount-once ref (the B3 regression) | **RED** | B3's fix is pinned |
| M4 | `if (captured.current?.open !== open \|\| captured.current.seed !== undefined)` — keeps the pinned literal, **always** recaptures | **GREEN** | G2. The assertion constrains source text, not the property. `testing-strategy.md` asked for "a second read with a changed preset still returns the first reference"; that assertion does not exist |
| M5 | delete `environmentKind` from `formFromPreset` (AC 5's round-trip) | **GREEN** | G1. Confirmed by `grep -rn formFromPreset tests/` → **zero hits**, independently of the mutation |

M4 is the honest finding here rather than a contrivance: `AGENTS.md` bans
"Copy/CSS/existence pins — they pass on broken logic and break on refactors",
and `preset-environment-seed.test.mjs:349-372` is exactly that shape for the one
mechanism `DoD 4` ("picking something else always wins") rests on. Verification
named the fix — extract the capture, or use a tiny `useRef` host double matching
the repo's existing `ts.transpileModule` seam pattern — and the executor shipped
a third option instead. M2 and M3 going red is real progress and should be
credited as such; M4 is the residue.

---

## 7. Gap Registry

| ID | Gap Type | Description | Impact | Effort | Action | Owner | Status |
|----|----------|-------------|--------|--------|--------|-------|--------|
| G1 | missing | AC 5's round-trip has no executor. `formFromPreset` carries `environmentKind` and `savePreset` forwards it — correct by reading, invisible to regression (M5 green) | medium | S | FIX: import `formFromPreset` and assert the kind survives the mapping; also assert `defaultForm()`'s inheritance so AC 11's documentation has a backing fact | execution | ESCALATED |
| G2 | quality | The seeded-once defence is text-pinned, not behaviourally asserted. A condition that keeps `captured.current?.open !== open` in the source while always recapturing stays green (M4 green) | high | S | FIX: extract the capture into a pure `captureSeed(current, open, kind)` and assert it directly — second call with a changed kind returns the first reference. This is what `testing-strategy.md` already specified for `composer-seed-wiring` | execution | ESCALATED |
| G3 | missing | DoD 8 and AC 12's second half are unexecuted. `isolated-worktree-check.tsx:13` still reads *"Needs a New-worktree preset in Agent Presets"* — now false in a new way, since that preset is authorable two clicks away in the same dialog. `state.md` recorded the decision to correct it; the file was never edited. The other four echo sites are refusals that remain true | high | S | FIX: correct `isolated-worktree-check.tsx:13` only; record the four refusals as "reviewed and left alone — still true" in `FEATURES.md`. The two pinned strings at `server-github-issue-flow.test.mjs:108,127` must not move | execution | ESCALATED |
| G4 | partial | `testing-strategy.md` asked for the off state asserted as "not-in-props"; the shipped assertion is on the mapper's return value. Behaviourally equivalent in React, shape differs from the contract | low | S | DOC or FIX when the file is next opened | execution | DOCUMENTED |
| G5 | quality | Three `Pill`s in one row share a tone and none carries `shrink-0`; `worktree` is a behaviour while `default`/`built-in` are provenance (UIR-6) | low | S | DOC — cosmetic, and the structural requirement is met and pinned | decision-maker | DOCUMENTED |
| G6 | pre-existing | Dangling `aria-controls` on the collapsed form toggle (UIR-7). Present at `75bb482`, moved verbatim by the extraction | low | S | DOC — **not attributed to this card** | decision-maker | DOCUMENTED |
| G7 | unverifiable | AC 1 and AC 6 are conditional on a Git-backed, non-personal project and can only be observed for real. B3 was exactly the finding a browser would have caught in seconds | medium | M | HUMAN: one browser pass on *save a preset to worktree → open Create card → read the picker → reopen* before the diff gate | human | ESCALATED |
| G8 | requirement | The requester wrote *"quando for abrir uma issue de qq projeto, vir como default o que foi selecionado no preset"*. This card seeds the three **card creation** dialogs; the GitHub issue **import** path keeps its own `IsolatedWorktreeCheck` with an unchanged default. `state.md` decided the import default stays unchanged — a reasonable reading, taken without the requester confirming it | high | M | HUMAN: confirm the reading. If "abrir uma issue" meant the import dialog, half the request is unanswered and this is a new scope, not a fix | human | ESCALATED |

Eight gaps. Five escalated, three documented. Every escalated row names an
owner and a next action; none is an observation without a disposition.

---

## 8. Lessons Learned

**What went well.** The mandatory extraction (scope 2) is the strongest thing in
this commit and it was honoured *before* the control was added, not after: both
`source-debt.json` ceilings were **deleted** rather than raised, and
`inheritedBaseline` — which is a literal expected-output list, not a waiver
registry — grew by nothing. A plan that names the gate before the work starts
gets obeyed, and the debt ledger is better off than it was.

The rework commit `d2113ff` is a real answer to verification, not a
cosmetic one. B3 was a behaviour defect, and the fix is a one-line structural
change (`captured.current?.open !== open`) chosen precisely because the hook sits
above `<Dialog>` and Radix unmounts `DialogContent` rather than the hook's
owner — that is the mount chain understood, not guessed at. It also corrected
`FEATURES.md` and the docstring, which is the harder half.

The vocabulary handling is the feature. Storing `project-default` while the host
reads that same word as a managed worktree is the exact trap this request fell
into, and the mapper refuses to lean on the ambiguous token at all — asserted
with an explicit `notEqual`, not merely implied by the expected object.

**What could improve.** The recurring failure is **textual pins being accepted
as behavioural tests**, twice now on the same file. Verification caught it once
(UIR-2), the executor converted that one to a count, and then wrote the next
assertion in the same shape three hundred lines further down. A rule that is
enforced once is not a rule; it is an incident. The check that would have caught
G2 at write time is trivial: for each new assertion, name the mutation it
survives, and run it before committing.

The other half is G3. `state.md` recorded a decision to correct a stale string,
the plan listed it as a target file, the DoD listed it as an acceptance item,
verification flagged it twice — and it survived all of it because "reviewed and
left alone" and "not looked at" produce the same diff. A disposition that
produces no diff needs a line somewhere saying so, and this one produced
nothing.

**Issues to watch.** `savePreset`'s cast at `preset-manager-crud.ts:104` is
safe only because `saveRefusal` runs first. Reordering those two lines is a
silent type-safety loss that no test would catch, because the tests exercise the
pair, never the order.

---

## 9. Gap Conversion Summary

| Fixed at `d2113ff` | Documented | Escalated (new work) |
|----|----|----|
| 3 (B1, B2, B3 from the previous verification) | 3 (G4, G5, G6) | 5 (G1, G2, G3, G7, G8) |

Of the three blocking findings the last verification raised, all three now fail
under their original mutations. The new escalations are two coverage gaps that
survived the fix, one unexecuted decision, one browser pass that cannot be
automated, and one question only the requester can answer.

---

## Decision

| Situation | Action Taken |
|-----------|-------------|
| All FIXED or DOCUMENTED, no ESCALATED | — |
| **ESCALATED gaps exist** | 🔄 **Loops back to `execution`** |
| New scopes added to tracking file | 🔄 Execution → Verification → Audit |

**Status: partial.** `rework-on: execution`, `next-candidate: none` (audit is
terminal; execution only when rework is required).

Three of the five escalations are small and mechanical, and each is already
red-demonstrable or grey-demonstrated above: G1 and G2 are test work in a file
that already exists, G3 is one string plus four recorded dispositions. G7 is a
single browser pass and should happen **before** the next verification, not
after. **G8 is not execution work at all** — it is a question for the requester,
and it should be asked now rather than after another cycle, because the answer
determines whether this is a fix or a new scope.

No state file, gate, or completion record was modified by this run. All five
hand-mutations were reverted; the branch is clean at `d2113ff`.

---

## Provenance

- Sibling artifacts: `runs/exec_uurtj4ng/verification/report.md` (B1, B2, B3),
  `runs/exec_uurtj4ng/verification/ui-review.md` (UIR-1 … UIR-7)
- Code audited: `d2113ff` on `bb/stelow-pq-no-modal-de-agent-presets-ao-thr_tvu6ab9qf7`,
  base `75bb482`, 20 files, +963/−118
- Commands run at `d2113ff`: `npm test` (EXIT=0), `npm run typecheck` (EXIT=0),
  `npm run quality:shape` (EXIT=0), `npm run architecture` (EXIT=0, 853 modules,
  1950 dependencies, no violations)
- Hand-mutations: M1, M2, M3, M4, M5 — each applied, run against five relevant
  test files, and reverted. `git status --short` empty, HEAD at `d2113ff`.
