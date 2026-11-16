---
stage: audit
task: evidence-audit
skill: stelow-workflow-execution-critique
workflow_id: card_cbnihg4c
name: preset-environment-kind
product_type: software
appetite: Complete
mode: workflow
lens: evidence
source_of_truth: >
  stelow.json#workflows[card_cbnihg4c].scopes[] (machine-checkable mirror),
  lib/trackable-evidence.mjs evidenceConditions() run live against that mirror,
  lib/trackable-contracts.mjs scope contract, .stelow/2026-09-30/sw-card_cbnihg4c/state.md,
  plans/spec-tech_1.md, plans/spec-product.md rev 3
reviewed_commit: d2113ff
base: 75bb482
code_checkout: /home/deploy/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_tvu6ab9qf7-1/bb-plugin-stelow
artifact_root_checkout: /home/deploy/repos/bb-plugin-stelow @ b8f6a19 [feat/card-title-delivery-record]
sibling_artifacts:
  - runs/exec_8c24t25l/audit/requirements.md
  - runs/exec_uurtj4ng/verification/report.md
  - runs/exec_uurtj4ng/verification/ui-review.md
gaps:
  - type: incomplete
    area: "stelow.json#workflows[].scopes[] — all 7 scopes"
    description: "Zero of 7 scopes carry a `record`. The host's own evidence machine, run live, returns a NoRecord condition for every one of them."
    impact: high
    effort: S
    resolution: escalate
    scope_candidate: true
  - type: incomplete
    area: "scopes/{id}.json sidecar contracts"
    description: "Zero of 7 scopes have a contract file, so each returns ContractMissing. The scope contract's declared doneWhen is [Record complete, record.verified===true, no blocking overlap]; 0 of 3 hold on any scope."
    impact: high
    effort: S
    resolution: escalate
    scope_candidate: true
  - type: missing
    area: "docs/runs/card_cbnihg4c/ — iteration-state-*.md and execution-report.md"
    description: "No iteration-state file exists anywhere on disk for any scope; find returns zero. Step 8's 4-class overlap execution-report.md is also absent. The primary claim-proof artifact and the overlap report were never written."
    impact: high
    effort: S
    resolution: escalate
    scope_candidate: true
  - type: missing
    area: "Record ### Baseline"
    description: "No pre-change exit code exists for any scope or any command, so 'npm test exit 0' at close cannot be distinguished from an inherited failure set. Sibling mutation M5 is exactly this class."
    impact: high
    effort: S
    resolution: escalate
    scope_candidate: true
  - type: quality
    area: "skills/stelow-workflow-execution-critique/references/workflow-audit.md:121,146,321"
    description: "Criterion 6 and Criterion 11 filter on the literal status 'completed'. The host closes scopes as 'done' and isDoneStatus aliases the two, so both checks select zero of seven scopes and pass vacuously. This is why the first four evidence gaps survived a full cycle unremarked."
    impact: high
    effort: S
    resolution: escalate
    scope_candidate: true
  - type: debt
    area: "scripts/pre-commit-record.sh, STELOW_VALIDATE"
    description: "The enforcement the skill names does not exist in this install. pre-commit-record.sh is absent from the repo; STELOW_VALIDATE is read by no code, only named in two doc files. The convention is honestly labelled 'advisory, v1 - no enforcement'."
    impact: medium
    effort: S
    resolution: documented
    scope_candidate: false
  - type: incomplete
    area: "workspace binding between evidence and the code it describes"
    description: "The artifact root is checked out on another thread's branch (b8f6a19 feat/card-title-delivery-record). d2113ff is an ancestor of no ref there, lib/preset-environment-seed.mjs does not exist in it, and stelow.json plus .stelow/ are gitignored with no docs/runs/card_cbnihg4c/ ever created. Zero durable evidence for this card."
    impact: high
    effort: M
    resolution: escalate
    scope_candidate: true
  - type: debt
    area: "stages.plan-gate and stages.diff-gate"
    description: "Both are real catalogued stages, both read pending, and neither appears in the state.md history — while execution and audit ran. Two gates never executed; the card advanced past both."
    impact: high
    effort: M
    resolution: escalate
    scope_candidate: true
  - type: requirement
    area: "isolated-worktree-check.tsx:13 — the five echoed copy sites"
    description: "Four artifacts hold incompatible dispositions of the same string: state.md:513 says correct it, state.md:574 says reviewed and left alone, spec-product.md:398-402 says it stays true, and DoD 8 (:454-455) plus the OUT/IN row (:425) still require the edits. AC 12 asks for something none of them adjudicated."
    impact: high
    effort: S
    resolution: escalate
    scope_candidate: true
  - type: incomplete
    area: "stelow.json#workflows[card_cbnihg4c].stage"
    description: "The machine-readable mirror reads current_stage triage with a one-entry history and updated 21:10:37, while state.md reads audit at 22:31:48. The file every evidence criterion reads is 81 minutes and five stages behind the card."
    impact: medium
    effort: S
    resolution: documented
    scope_candidate: false
  - type: debt
    area: "locks/ — 3 expired claims registered as card artifacts"
    description: "All three expired at 21:06:47 and are still on disk, registered in the artifact list at 21:27:55. Each is attributed to scope-3 but was acquired at 20:36:47, eleven minutes before scope-3's own started_at of 20:47:36."
    impact: low
    effort: trivial
    resolution: documented
    scope_candidate: false
  - type: quality
    area: "state.md artifact list"
    description: "The two verification files are each registered twice under different path forms and different generated_at values (repo-relative at 21:40:00, .stelow-prefixed at 22:31:48)."
    impact: low
    effort: trivial
    resolution: documented
    scope_candidate: false
lessons_learned:
  - "The host's evidence machine is correct and alias-aware; the skill's markdown check is the brittle half. isDoneStatus treats done and completed as terminal aliases, and running evidenceConditions live produced 14 conditions the audit's own literal filter would never have selected."
  - "An advisory convention with a named enforcement hook that does not exist is indistinguishable, from the card, from a convention nobody wanted. Nothing recorded that scripts/pre-commit-record.sh is absent."
  - "A 'reviewed and left alone' disposition produces no diff, and three of the four artifacts that mention these copy sites disagree about whether that disposition is correct. Recording it in one place is not the same as reconciling it."
  - "The evidence and the code it describes can end up in different checkouts with neither on a shared ref, and nothing in the card notices. The workspace is shared; the evidence is not portable."
generated_at: 2026-09-30
---

# Evidence Audit — preset environment kind

**Date:** 2026-09-30
**Mode:** workflow, **lens: evidence**
**Source of truth:** the machine-checkable evidence mirror, run through the host's
own evidence machine — not the narrative in the sibling artifacts
**Model used for audit:** Space Bunny Free (independent of the executor and of
the requirement-audit; no source file was modified)

The sibling `audit/requirements.md` audited *what was built*. This slice audits
*whether the card can prove what it claims*, and it reaches a different verdict
on a different axis. The code is in good shape — `npm run test:presets` exits 0
at `d2113ff`, the tree is clean, and the sibling's diff stat reproduces exactly
(20 files, +963/−118). **The evidence chain under it is close to empty, and the
audit procedure that was supposed to catch that is itself defective.**

---

## Summary

| Metric | Value |
|--------|-------|
| Scopes claiming completion | 7 |
| Scopes carrying a `record` | **0** |
| Scopes carrying a sidecar contract | **0** |
| Scopes carrying `tasks[]` | **0** |
| `iteration-state-*.md` files on disk | **0** |
| `execution-report.md` (Step 8) on disk | **0** |
| Baseline (pre-change) exit codes recorded | **0** |
| Host evidence conditions raised (live run) | **14** (7 × `NoRecord`, 7 × `ContractMissing`) |
| Catalogued gates never entered | 2 (`plan-gate`, `diff-gate`) |
| Scopes the audit skill's own criterion 6 would select | **0 of 7** |
| Gaps identified | 12 |
| Independent claims re-run and confirmed | 4 (presets suite, diff stat, tree cleanliness, hostile-copy disposition) |

**Verdict: the card is not auditable.** Not because the work is bad — on every
claim I could re-run, it held — but because the artifacts that would let a
reader distinguish "done" from "claimed done" were never written, and the check
that should have said so is written so that it cannot say so.

---

## 1. Scope/Plan Completeness (evidence view)

All seven scopes are `status: "done"` in `stelow.json`. None carries a `record`,
a contract, a `tasks[]`, an iteration count, a `completed_at`, a `duration_s`,
or a `suggested_commit`. The plan's seven scopes are therefore all *claimed* and
none is *evidenced*.

I did not judge this by reading the reference and counting keys. I ran the
host's own pure evidence machine against the live tracking file:

```
$ node -e 'evidenceConditions(...)'   # lib/trackable-evidence.mjs
contractForTrackable('scope') = {"kind":"scope","contractFile":"scopes/{id}.json",
  "recordInline":"record", "doneWhen":["Record complete (files, commands, baseline)",
  "record.verified === true","no blocking overlap (Step 8 report)"]}
scope-1  status=done  record=ABSENT  tasks=0  conditions=2
    -> [NoRecord/RecordMissing]      ... is done with no Record — its close cannot be audit-checked.
    -> [ContractMissing/ContractMissing] ... is done with no contract — its acceptance criteria live only in prose.
... (identical pair for scope-2 … scope-7)
```

Seven `NoRecord`, seven `ContractMissing`. The contract that declares the
`doneWhen` for a scope is the same file the host uses to raise these conditions,
so this is the system's own verdict, not mine. **All three `doneWhen` clauses
fail on all seven scopes**, and `scopeDoneGate` (`server/scope-batch-gates.ts:90`,
docstring "Pre-write proof + release") checks file claims and nothing else, so
nothing on the close path could have objected.

## 2. Implementation Quality (evidence view)

Not re-litigated here — the sibling covered it and I found no contradiction. Two
provenance claims of the sibling's I re-ran and confirm: `git diff --stat
75bb482..d2113ff` is 20 files / +963 / −118 exactly as claimed, and
`git status --porcelain` is empty at `d2113ff`, so its five hand-mutations were
genuinely reverted.

## 3. Invisible 20%

| Dimension | Status | Notes |
|-----------|--------|-------|
| Error handling | n/a | No code changed by this audit |
| Observability | ❌ | The evidence pipeline is the observability surface for delivery, and it emitted nothing: no record, no baseline, no overlap report, no iteration log |
| Security | n/a | Out of the card's risk class |
| Input validation | ⚠️ | `evidenceConditions` fails open by design ("missing evidence is a condition, never a crash") — correct for UI, and it means a silent card is the expected failure mode, not an exceptional one |
| Evidence durability | ❌ | `stelow.json` and `.stelow/` are both gitignored, and `docs/runs/card_cbnihg4c/` was never created. Nothing about this card is committable, so nothing about it survives |

## 4. Edge Cases

| Edge case | Status | Notes |
|-----------|--------|-------|
| A scope closed through the host CLI | ❌ **fails open** | The host writes `done`; criterion 6 filters on `'completed'`. Zero scopes selected, zero gaps reported. This is not hypothetical — it is exactly what happened here |
| Enforcement hook present | ❌ | `scripts/pre-commit-record.sh` is absent from the repo; `grep -rn STELOW_VALIDATE` over non-`dist/` code returns only the two doc files that name it. Neither mechanism the reference cites exists |
| Contract sidecars | ❌ | `scopes/{id}.json` absent for all 7, so each scope's acceptance criteria live only in spec prose |
| Evidence outliving the process | ❌ | All evidence is inside gitignored paths; see E7 |
| Two readers of the same string | ❌ | Four artifacts, four dispositions — see §6 E8 |
| Locks after a normal close | ⚠️ | Three claims expired at 21:06:47, still on disk, and registered as card artifacts at 21:27:55; each attributed to `scope-3` though acquired 20:36:47, before `scope-3.started_at` (20:47:36) |

## 5. Doc & Test

| Item | Status |
|------|--------|
| `tests/preset-environment-seed.test.mjs` wired into `test:presets` | ✅ verified by reading `package.json`; `npm test` chains it |
| `npm run test:presets` | ✅ **EXIT=0**, re-run by this audit at `d2113ff` |
| `tests/trackable-evidence.test.mjs` wired | ✅ it is in `test:contracts` — the evidence machine is itself under test, which is why the 14 conditions above are trustworthy |
| `docs/runs/card_cbnihg4c/` | ❌ never created; the gitignore comment names it as the durable home and it does not exist |
| `plans/spec-product.md` internal consistency | ❌ self-contradictory on the copy sites (E8) |
| `CHANGELOG.md` / `FEATURES.md` | Not this slice's criterion; the sibling audited both and the FEATURES work stands |

## 6. Gap Registry

| ID | Gap Type | Description | Impact | Effort | Action | Owner | Status |
|----|----------|-------------|--------|--------|--------|-------|--------|
| E1 | incomplete | No `record` on 7/7 scopes; host returns `NoRecord` ×7 | high | S | FIX: write the 7 `## Record` sections and mirror them, honestly, including Limitations | execution | ESCALATED |
| E2 | incomplete | No `scopes/{id}.json` contracts; `ContractMissing` ×7; all three declared `doneWhen` clauses fail | high | S | FIX: author the 7 sidecars from spec-tech_1.md's Done Criteria before any re-close | execution | ESCALATED |
| E3 | missing | No `iteration-state-*.md` and no `execution-report.md` anywhere — the primary artifact and the Step 8 overlap report | high | S | FIX: write both; the overlap report is what makes `actual_files` auditable rather than self-declared | execution | ESCALATED |
| E4 | missing | Zero baseline exit codes; regressions undetectable at close | high | S | FIX: capture baselines on the next pass before the first edit | execution | ESCALATED |
| E5 | quality | `workflow-audit.md:121,146,321` filter on `'completed'`; host writes `done`; `isDoneStatus` aliases both — criteria 6 and 11 are vacuous on every host-closed scope | high | S | FIX: filter on `isDoneStatus`, or the host status, in the audit skill; this is the reason E1–E4 went a full cycle unremarked | plugin (skill) | ESCALATED |
| E6 | debt | `pre-commit-record.sh` absent; `STELOW_VALIDATE` read by no code | medium | S | DOC or ship the hook; the convention is honestly "advisory, v1" and this card is its cost | decision-maker | DOCUMENTED |
| E7 | incomplete | Evidence and referent in different checkouts; `d2113ff` is an ancestor of nothing at the artifact root; no durable evidence at all | high | M | HUMAN+EXEC: re-verify from the worktree that holds `d2113ff`, and commit the evidence to `docs/runs/card_cbnihg4c/` before closing | human | ESCALATED |
| E8 | requirement | Four artifacts, four dispositions for `isolated-worktree-check.tsx:13` (see below) | high | S | HUMAN: pick the disposition, then make the other three agree | decision-maker | ESCALATED |
| E9 | incomplete | `stelow.json` stage projection 81 min / 5 stages behind `state.md`; `phases: []` | medium | S | FIX: host writes the stage transition it already records elsewhere | plugin (host) | DOCUMENTED |
| E10 | debt | 3 expired locks on disk and registered as artifacts; misattributed to a scope that had not started | low | trivial | FIX: reap on close | execution | DOCUMENTED |
| E11 | quality | The two verification files registered twice, two path forms, two timestamps | low | trivial | FIX: dedupe on register | execution | DOCUMENTED |
| E12 | — (credit) | `test:presets` wiring verified, suite EXIT=0 re-run by me, tree clean, diff stat reproduced, evidence machine under test, and scope-6's 1-of-5 `actual_files` is the single place a silent skip is visible in the whole mirror | — | — | none | — | DOCUMENTED |

Twelve gaps: eight escalated, four documented, every row with a named owner and
a next action.

**E8 deserves its own paragraph, because it corrects the sibling.** The sibling
escalated G3 as "an unexecuted decision", citing `state.md` as recording a
decision *to correct* the copy. That is `state.md:513` — true. It is not the
whole record. `state.md:574`, written 100 minutes later by verification, says the
opposite: the five sites "were reviewed and left alone, because they now name a
UI that can do it. Previously unrecorded; now recorded here as a deliberate
disposition." And `plans/spec-product.md:398-402`, written *before* execution,
already adjudicated it: the copy "names Agent Presets as the place and **stays
true**". So there is no unexecuted decision — there are two decisions in
conflict, and the later one reversed the earlier without saying so.

Worse, the spec contradicts *itself*: DoD 8 at `:454-455` and the OUT/IN row at
`:425` still require the five copy edits in the same commit, which `:398-402`
declined. And AC 12 — which none of these four dispositions ever addresses —
asks that "the copy no longer implies the preset can only be created elsewhere".
The spec's defence rebuts a different claim (that the copy says "go elsewhere");
it never rules on AC 12's actual wording, and AC 12's condition is unmet: the
sentence names Agent Presets without ever saying a preset is now creatable
there. So part of G3 survives — the copy does need work — but not for G3's
reason, and the honest action is to decide, not to edit.

## 7. Lessons Learned

**What went well.** The host is better than its own documentation. `isDoneStatus`
(`lib/trackables.mjs:28`) treats `done` and `completed` as terminal aliases with
a comment explaining why, and `evidenceConditions` keys on it — so the runtime
*did* raise all 14 conditions. The defect is entirely on the skill side, which
filters on a bare string. That is a good failure to have: the machine was
right, and the audit that should have read its output would have passed
vacuously.

**What could improve.** A convention with two named enforcement mechanisms,
neither of which exists in the install, is not a convention with teeth — it is a
paragraph. The reference is honest that it is "advisory, v1 — no enforcement",
and this card is simply the price of that sentence, paid in full: seven closes,
zero records, zero contracts, zero baselines, and not one flag raised.

The second lesson is about where evidence lives. `stelow.json` and `.stelow/`
are gitignored; the gitignore comment says to commit `docs/runs/<card>/`
instead; that directory does not exist for this card. Combined with the
workspace being shared and currently on another thread's branch, the result is
that this card's entire evidence is unreproducible — and its *code* is too, since
`d2113ff` lives only in a worktree and is an ancestor of nothing shared.

**Issues to watch.** E5 is the one to fix first and it is cheap: any future
audit that follows `workflow-audit.md` literally will report zero scopes
evaluated on every card closed through the host, forever. That is not a warning,
it is an invisible pass, and this card is the first time it has had a complete
enough evidence trail to notice.

## 8. Gap Conversion Summary

| Fixed | Documented | Escalated (new work) |
|-------|------------|------------------------|
| 0 | 4 (E6, E9, E10, E11) | 8 (E1, E2, E3, E4, E5, E7, E8) |

E1–E4 are the same underlying omission seen from four angles and should be one
scope, not four: *make a scope close impossible to fake.* E5 is a separate,
tiny, plugin-side fix. E7 is a workspace/hygiene action. E8 needs a human word
before it becomes a scope at all.

---

## Decision

| Situation | Action Taken |
|-----------|-------------|
| All FIXED or DOCUMENTED, no ESCALATED | — |
| **ESCALATED gaps exist** | 🔄 **Loops back to `execution`** |
| New scopes added to tracking file | 🔄 Execution → Verification → Audit |

**Status: partial.** `rework-on: execution`, `next-candidate: none` (audit is
terminal; execution only when rework is required).

The requirement half of this audit reached the same destination by a different
road, and the two agree on the loop-back. They do not agree on the diagnosis, and
that disagreement is the most useful thing this slice produced: the sibling found
gaps *in the work*, this one found that the card has no way to tell anyone what
it did. Fix E1–E4 as one scope first — until a close can be falsified, a green
`npm test` and a `done` scope are the same claim wearing two hats.

Two items are not execution work and should not wait for a rework pass:
**E7** (the evidence needs a home that survives this thread) and **E8** (only
the requester or the decision-maker can say whether that sentence must change).
E8 should be asked now, because the answer decides whether it is a one-line
string edit or a spec revision — and the spec currently promises the edit in two
places while a third says it is unnecessary.

No state file, gate, completion record, or source file was modified by this
audit. The only write is this artifact.

---

## Provenance

- Code under audit: `d2113ff` on `bb/stelow-pq-no-modal-de-agent-presets-ao-thr_tvu6ab9qf7`,
  in worktree `thr_tvu6ab9qf7-1`, base `75bb482`
- Artifact root checkout: `/home/deploy/repos/bb-plugin-stelow` @ `b8f6a19`
  [`feat/card-title-delivery-record`] — a different thread's branch;
  `git merge-base --is-ancestor d2113ff HEAD` → false;
  `lib/preset-environment-seed.mjs` absent there
- Commands run by this audit (read-only, in the `d2113ff` worktree):
  `git diff --stat 75bb482..d2113ff` (20 files, +963/−118),
  `git status --porcelain` (empty), `npm run test:presets` (EXIT=0)
- Host evidence machine executed live against the live tracking file:
  `evidenceConditions()` from `lib/trackable-evidence.mjs` + `contractForTrackable("scope")`
  from `lib/trackable-contracts.mjs` → 14 conditions across 7 scopes
- Files read for the disposition conflict: `state.md:513`, `state.md:574`,
  `plans/spec-product.md:398-402`, `:425`, `:454-455`, AC 12;
  `components/isolated-worktree-check.tsx:13` (unmodified by this branch)
- No source file, state file, gate, or completion record was written.
