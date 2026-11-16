# Execution Critique — Evidence Audit

**Date:** 2026-09-30
**Mode:** workflow (intent `investigate`; route `[triage, select, setup, context, audit]` — no `spec-tech`, no execution)
**Source of truth:** `runs/exec_6kds185v/recon/setup.md`, `runs/exec_x0oruxjh/strategic/context-analysis.md`, `runs/exec_x0oruxjh/strategic/context.md`, `session.log` — audited against the live tree, not against the documents' own line numbers
**Model used for audit:** Space Bunny Free (independent re-derivation; scope verdicts delegated to a fresh subagent that had not seen the claims being checked)
**Appetite:** Complete — full recommendations, no condensation

This audit answers one question: **is the evidence behind the `context` stage's recommendation sound, and is it non-vacuous?** The workflow ships no code, so criteria 2–5 are evaluated against the analysis artifacts as the delivered work product. `state.md`, gates and completion state were not touched.

## Summary

| Metric | Value |
|--------|-------|
| Artifacts audited | 4 (setup recon, context-analysis, context synthesis, session.log) |
| Local claims independently re-derived | 14 |
| Claims verified | 8 |
| Claims partially true (conclusion survives, framing wrong) | 4 |
| Claims refuted | 2 |
| Line-number references wrong | 5 |
| Load-bearing claims broken | **1** (`score` transport unused) |
| Gaps identified | 7 (0 block, 3 warning, 4 minor) |
| Conclusion changed? | No — the recommendation survives; one supporting reason is withdrawn |

## Evaluation

### 1. Scope/Plan Completeness

The card's stated scope was four decisions (risk, spike-worthiness, scope order, task order) plus the external TypeSafe Jev skill research. All four are adjudicated in both `context-analysis.md` §4 and `context.md` §3 with the same verdicts, and the Jev skill research is in `setup.md` §5 with a rule→application table. The recon's five parsed questions map cleanly onto them; none is dropped. `context.md` §6 hands forward a scope (upstream schema + deterministic ingest validation) and an explicit out-of-scope, which is the right Shape Up input.

| Item | Status | Notes |
|------|--------|-------|
| Q1 risk | ✅ adjudicated | Verdict "strongest candidate, blocked" consistent across both artifacts |
| Q2 spike | ✅ adjudicated | Only candidate with real execution consequence — correctly identified |
| Q3 scope order | ✅ adjudicated | Rejected; `lib/scope-order.mjs` confirmed topological |
| Q4 task order | ✅ adjudicated | Rejected as execution, advisory at most |
| Q5 Jev skill research | ✅ adjudicated | Official + community skill read; rules tabulated against this repo |
| Corpus calibration question | ✅ closed | `session.log` answers recon §8 Q2 with five verified probes |

### 2. Implementation Quality (of the analysis as a work product)

Every local claim was re-derived with a fresh command. **8 of 14 verified cleanly**, including the three that carry the most weight: `grep -rn "Risk Score\|RISK" lib/ server/` → 0 hits; both scope schemas genuinely lack `risk`/`type`/`sequence` with `additionalProperties: false`; `EXECUTION_ASSET_PREFIXES = ["recipes/", "schemas/"]` confirms the schema is sync-owned. The analysis is unusually well-anchored on the structural claims.

**One claim is refuted and it is load-bearing.** `context.md:70-72` and `context-analysis.md:200-201` both argue that a `scope-risk` point is "the smallest technical increment" because *the transport already normalizes `score`, though no registered point emits it*. `lib/skill-criteria.mjs:87`, `lib/task-evidence.mjs:30` and `lib/gap-registry.mjs:222` all build `type: "score"` questions today, and `lib/skill-criteria.mjs:111-116` consumes the normalized answer against `CRITERIA_MET_SCORE`. The `score` path is exercised end to end in shipped code, under the `artifact-criteria` registry entry, whose own `requires` field already reads "Jev-compatible provider (**Score questions**)".

**This correction was already found and then lost.** `session.log` states it precisely: *"the recon said 'no point emits score'. Precisely: no registry entry… The advisory CLI paths DO build score questions."* The correction lived in the session log and did not reach either delivered artifact, which reverted to the broader and false phrasing. That is a process failure, not an oversight — the audit's whole premise is that the session log is evidence, and the two documents that ship did not inherit from it.

**Second refuted claim: "all four points are at the edges."** `DONE_PROTOCOL` (`server/runtime/plugin-protocols.ts:65`) orders `bb stelow verify-tasks` and `bb stelow gap-triage` immediately before `done`, with results reported in `audit.md`; both route through `judgingPoint()` (`server/runtime/cli/cli-judging-route.ts:52-64`) to `DECISION_POINT_ARTIFACT_CRITERIA`. A registered point therefore *is* consulted at artifact acceptance. The claim survives only in the documents' more careful wording — the worker invokes it, it is advisory, and it never gates — and the source doc `docs/decision-routing.md:66-73` says the same careful thing. The restatement in `context.md:96-98` ("all four registered points are at the edges") drops the qualifier that makes it true.

**Overstated claim: a spike "consumes a goal slot."** `goals.md:15,141,151` does make every scope a delegate/acceptance contract, but the goals *tool* is routed for `optimization` (`invocation.md:99`), while `spike` routes to scout + researcher (`scope-executor/SKILL.md:113`). Likewise "changes the DoD": the DoD is planner-authored per scope (`SKILL.md:95`); the type selects an executor. The asymmetry argument survives — a needless spike still costs a scout+researcher cycle — but it is not a goal-slot cost.

### 3. Invisible 20%

| Dimension | Status | Notes |
|-----------|--------|-------|
| Error handling | ✅ | Both artifacts carry explicit `## What would falsify this` sections — four falsifiers each, correctly targeted at the load-bearing claims |
| Observability | ⚠️ | Both documents recommend persisting `body.model` per point, but neither notes that it is *also* not persisted today (`lib/decision-api.mjs:173` returns it; `decision-store.ts:65-81` stores config and points only). Framed as a new requirement rather than an existing gap |
| Security | ✅ | Correctly inherited: "never let a Jev answer alone authorize a side effect" is applied to the spike promotion, which is the only candidate with side effects |
| Input validation | ✅ | The middle-band "live question, never a silent promotion" requirement is the correct mitigation for the `spec-tech` artifact being LLM-authored — hostile state in a named field |

### 4. Edge Cases

| Edge case | Status | Notes |
|-----------|--------|-------|
| `n = 0` vs `n = 1` | ⚠️ | `context.md:18-19` and `context-analysis.md:32-34` both state `n = 0`; `session.log` says `n = 1` (the frozen-0.3 `spec-tech_v1.md`). Both delivered artifacts dropped the correction. The conclusion is unchanged — that one artifact has zero `Risk Score` and uses `## Scope 1 —` headings that `lib/spec-scope-reader.mjs:18-19` does not recognize — but `n = 0` is stated more strongly than the evidence supports |
| Corpus counted outside the live tree | ⚠️ | "0 spec-tech artifacts exist" is true of `.stelow/` and false repo-wide: `.stelow-0.3-backup/2026-09-13/sw-card_cpa76qyv/` has both a real `spec-tech_v1.md` and a `state.md` recording `scope` and `planning` stages. So "0 of 16 cards reached scope or planning" is false on this host, not merely scope-limited |
| Card count | ⚠️ | Three different numbers across three artifacts: 16 (`context-analysis.md:22`), 20 (`context.md:19`), 19 (`session.log:21`). Truth: 15 dated `sw-*` dirs with `state.md`, plus 5 `.stelow/approvals/` dirs without one = 20 dirs matching `ls -d .stelow/*/sw-*` |
| Line references | ⚠️ | 5 wrong: risk table is at `scopes-and-sequencing.md:225-236` (not 213-236); `stages.yaml` audit block is 597-624 (595 is `diff-gate`); the ask-necessity rejection is `decision-routing.md:78-85` (`:94` is the bar statement); `score` normalizer is 141-163 |

### 5. Doc & Tests

No code shipped, so no `README`/`CHANGELOG`/`FEATURES.md` entry is owed — correct per the repo's own rule that a feature needs a `FEATURES.md` entry, and this is a recommendation, not a feature. `grep -i spike tests/` → 0 matches, confirming the spike routing has no test coverage; worth recording because the recommended `spike-worthy` point would land on untested behaviour.

### 6. Record Evidence

The claim-proof artifacts are present and unusually specific: eight named web sources with dates, and a local evidence index citing file:line for every structural claim. This is above the bar — most claims resolved to a command that reproduced them. The weakness is not fabrication but **drift between the session log and the shipped documents**: three corrections found during the run (the `score` path, the `n = 1` artifact, the 0.3-backup card) are absent from both delivered artifacts. Evidence that exists but does not reach the reader is, for the reader, evidence that does not exist.

### 7. Gap Registry

| Gap Type | Description | Impact | Effort | Action | Status |
|----------|-------------|--------|--------|--------|--------|
| quality | `score`-unused claim is false; three shipped builders use it, under the `artifact-criteria` entry that already declares "Score questions" | high | trivial | FIX | **FIXED** — corrected in §2 and in the "What would improve" below |
| quality | "all four points are at the edges" drops the advisory/invoked-not-gated qualifier that makes it true | medium | trivial | FIX | **FIXED** — §2 |
| incomplete | A spike "consumes a goal slot" / "changes the DoD" — conflates the goals tool with executor routing | medium | trivial | FIX | **FIXED** — §2 |
| quality | Card count stated three different ways; `n = 0` stated where `n = 1` is supportable; "0 spec-tech" omits the 0.3 backup | medium | trivial | FIX | **FIXED** — §4 |
| quality | Line-number drift in 5 references (risk table, stages.yaml, decision-routing.md anchors, score normalizer range) | low | trivial | FIX | **FIXED** — §4 |
| incomplete | `body.model` framed as a new requirement; it is also an existing, unpersisted gap today | low | trivial | DOC | **DOCUMENTED** |
| process | Corrections found in `session.log` did not propagate to the two delivered artifacts; the `score` error was found, written down, and then lost | medium | moderate | **ESCALATE** | **ESCALATED** — new scope candidate |

Escalation rationale: the `score` correction is low-impact in itself (the conclusion survives), but a session log whose findings are not carried into deliverables makes every subsequent evidence claim on this card weaker than it appears. Impact medium, effort moderate → **DOCUMENTED-or-ESCALATED** per the classification ladder; escalated because it is a defect in the audit trail itself, not in a document.

### 8. Lessons Learned

**What went well.** The corpus probe. Rather than reasoning about whether a threshold *could* be tuned, both artifacts ran the search and reported `n = 0`, then used that to invert the request's premise: the user asked which of four decisions to route, and the answer was that the stage has never executed. That is a genuinely better question than the one asked, and it is the kind of finding that only appears when someone actually greps.

**What could improve.** The session log found three corrections and both documents shipped without them. An audit that reads `context.md` alone would rate the `score` claim as sound. When a run produces a session log with findings sharper than the artifacts built from it, the artifacts are the thing that is wrong.

**Issues to watch.** The `n = 0` framing is rhetorically stronger than the evidence and does real work in the verdict. And the "smallest technical increment" argument now rests on a thinner claim than it did: `score` transport is exercised, so the `scope-risk` increment is not the transport — it is the missing field, which is `R0`, upstream-owned. The R0-first ordering is unaffected; the reason for it is now "the only path that creates the corpus", not "the transport is free".

### 8b. Gap Conversion Summary

| Fixed | Documented | Escalated (new scopes) |
|-------|-------------|------------------------|
| 5 | 1 | 1 |

The escalated item is **not** a decision-routing feature. It is a process scope: *the context stage must derive its delivered artifacts from `session.log`, or carry its findings forward explicitly.* A cheap shape — a checklist line in the context stage's primary actions requiring every session-log finding to be either carried into the artifact or explicitly rejected with a reason.

## Decision

| Situation | Action Taken |
|-----------|-------------|
| All FIXED or DOCUMENTED, no ESCALATED | ✅ Close cycle |
| ESCALATED gaps exist | 🔄 Loops back to Execution |
| New scopes added to tracking file | 🔄 Workflow re-enters Execution → Verification → Audit |

**One ESCALATED gap exists, and on this card that transition has no legal route.** `stages.yaml:42` projects `investigate` to `[triage, select, setup, context, audit]`, and the audit stage declares `reject: [execution]` (`stages.yaml:624`). `data/stelow:256-258` filters candidates to `stages[:idx] | stages[idx+1:idx+2] | {stage}`, so at `audit` on an investigate card `execution` is dropped and the edge is dead. The audit skill's own hand-off block instructs "If the gap registry contains ESCALATED work, return to `execution` through the host's reject/rework path" — for this intent that path does not exist. The gap cannot be routed to a new scope from here; it becomes a follow-up card, and the correct home for that decision is the stage graph, not this audit.

**Recommendation stands.** Add a corpus, not a decision point: one `build`-intent card through `scope → interface → selection → planning → execution → verification`, then the upstream `risk`/`type` field in `calionauta/stelow` (release + `repository_dispatch stelow-release`), then `spike-worthy`, then `scope-risk`. The two rejected decisions (scope order, task order) stay rejected. Two of the four reasons supporting that ordering are withdrawn or narrowed in this audit, and the recommendation is stronger for it — it now rests on the corpus argument alone, which was the argument that was always load-bearing.

**Scope note:** `state.md`, gates, and completion state were not read-modified. The unrelated working-tree changes in this repository belong to other threads and were left alone.
