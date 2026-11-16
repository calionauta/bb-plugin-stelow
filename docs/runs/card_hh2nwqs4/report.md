---
gaps:
  - type: incomplete
    description: "The corpus prerequisite has no owner and no trigger: no card on this host ever produced a real spec-tech_v1.md"
    impact: high
    effort: moderate
    resolution: escalate
  - type: quality
    description: "Hostile-state and authorization rules recorded in setup.md are absent from the final candidate designs; 2 of 3 candidates consume LLM-authored prose as decision state"
    impact: high
    effort: moderate
    resolution: escalate
  - type: incomplete
    description: "The spike type branch has zero test coverage while the recommended spike-worthy point gates exactly that branch"
    impact: medium
    effort: trivial
    resolution: escalate
  - type: process
    description: "Corrections found in session.log never reached either delivered artifact - found, written down, then lost"
    impact: medium
    effort: trivial
    resolution: escalate
  - type: incomplete
    description: "The three named candidates live only in a run artifact, not in the locally-owned docs/decision-routing.md Known debt section where the next pass will look"
    impact: medium
    effort: trivial
    resolution: escalate
  - type: incomplete
    description: "Skill sweep bound unstated - the request asked for flow points and skills; only this pipeline was swept"
    impact: medium
    effort: trivial
    resolution: documented
  - type: quality
    description: "Vendor benchmark claims carry the cost argument unverified"
    impact: low
    effort: trivial
    resolution: documented
  - type: quality
    description: "Stale corpus constants and 5 stale line anchors in the delivered documents"
    impact: low
    effort: trivial
    resolution: fixed
---

# Execution Critique Report

**Card:** `sw-card_hh2nwqs4` (intent `investigate`, terminal stage `audit`)
**Recipe/task:** `execution-audit` / `audit-report`
**Date:** 2026-09-30
**Mode:** workflow — audit of a *delivered analysis*, not of shipped code
**Source of truth:** the request's five questions (`runs/exec_6kds185v/recon/setup.md` §1), the recipe contract (`data/stelow-assets/recipes/execution-audit.yaml`), the four delivered artifacts, and the live tree
**Inputs merged:** `audit/requirements.md` (requirement-audit), `audit/evidence.md` (evidence-audit)
**Model used for audit:** Space Bunny Free (all load-bearing claims re-derived from the repo, not inherited)

## Summary

| Metric | Value |
|--------|-------|
| Sibling audits merged | 2 |
| Distinct claims adjudicated | 23 (9 requirement + 14 evidence) |
| Claims verified clean | 17 |
| Claims partial (conclusion survives, framing wrong) | 4 |
| Claims refuted | 2 |
| Gaps identified (merged, deduplicated) | 8 (2 high, 4 medium, 2 low) |
| FIXED / DOCUMENTED / ESCALATED | 2 / 2 / 4 |
| Legal routes out of this stage | **0** |

**The merged verdict differs from both inputs on the one thing that matters.** The recommendation is sound and the analysis is honest, but the requirement audit's Decision — *"rework through the host's reject path as new `feature`-intent cards"* — names a route that does not exist from this stage. Re-derived and confirmed below. That is this report's principal contribution.

## Evaluation

### 1. Scope/Plan Completeness

There is no `spec-tech_v1.md`, so scope completeness is measured against the request's five questions rather than plan scopes. All five are adjudicated in both `context-analysis.md` §4 and `context.md` §3 with identical verdicts; the Jev skill research is in `setup.md` §5 with a rule→application table. Nothing is dropped.

| Item | Status | Notes |
|------|--------|-------|
| Q1 what is risky | ✅ adjudicated | `scope-risk` — "strongest candidate, blocked"; the block is a schema gap, not a judgment gap |
| Q2 what deserves a Spike | ✅ adjudicated | `spike-worthy` — the only candidate with real execution consequence |
| Q3 order of scopes | ✅ adjudicated | Rejected: `lib/scope-order.mjs:30` `orderScopes()` already sorts topologically on `dependsOn`/`blockedBy` |
| Q4 order of tasks | ✅ adjudicated | Rejected as execution; at most advisory |
| Q5 Jev skill research | ✅ adjudicated | Official + community skill read and *mapped* to this repo, not summarised |
| Recipe `pipeline` + `structured-output` | ✅ met | `stages.yaml:610-611` declares both; this three-task fanout ran with no fallback to `sequential` |
| Ownership boundary | ✅ respected | No edits to `state.md`, gates, or completion state |

Two scoping weaknesses survive. The request asked for **flow points *and* skills**; only this pipeline was swept and the bound was never stated. And the headline question — where routing could replace an LLM — is answered *negatively* but without an inventory of the LLM turns these stages actually spend, so "negative" is unfalsifiable by construction.

### 2. Implementation Quality

No code shipped. The analysis artifacts are the work product, and they are unusually well-anchored: 8 of 14 local claims re-derived to exactly the recorded result. Verified independently in this merge:

- `grep -rn 'type: *"score"' lib/ server/` → **4** hits (`gap-registry.mjs:222`, `skill-criteria.mjs:87`, `task-evidence.mjs:30`, `decision-api.mjs:153`), and `skill-criteria.mjs:111-116` consumes the normalized answer against `CRITERIA_MET_SCORE`. The `score` transport is exercised end to end in shipped code.
- `grep -rn "Risk Score" .stelow/` → only discussion *about* the absence; `grep -rli spike tests/` → **0 files**; `grep -rn spike lib/` → **0**.
- `EXECUTION_ASSET_PREFIXES = ["recipes/", "schemas/"]` (`lib/workflow-skills-sync.mjs:328`) with `SRC_PREFIX = "skills/"` (line 19) — so the schema change is sync-owned and upstream-first routing is correct, and `docs/decision-routing.md` is locally owned.
- The `n=0` → `n=1` correction holds: `.stelow-0.3-backup/2026-09-13/sw-card_cpa76qyv/plans/spec-tech_v1.md` exists and its `state.md` records `scope: done`, `planning: done`. It contains **0** `Risk Score` and **0** `[TYPE]`, and uses `## Scope 1 — feature:` headings, which `HUMAN_OPEN_RE = /^#{1,6}\s*SCOPE-(\d+)\s*:?\s*(.*)$/` (`lib/spec-scope-reader.mjs:20`) does not match — no `i` flag, and `Scope 1 —` is not `SCOPE-1`. The artifact is real and genuinely unparseable, so the conclusion is unchanged; only the stated `n` was wrong.

**Two load-bearing claims are refuted.** First, the "transport already normalizes `score`, though no registered point emits it" framing is false as a cost argument — the path is already in production use under the `artifact-criteria` entry, whose own `requires` field already reads "Jev-compatible provider (Score questions)". Second, "all four registered points are at the edges" drops the qualifier that makes it true: `DONE_PROTOCOL` (`server/runtime/plugin-protocols.ts:65`) orders `bb stelow verify-tasks` and `bb stelow gap-triage` immediately before `done`, and both reach `judgingPoint()` (`server/runtime/cli/cli-judging-route.ts:52`) → `DECISION_POINT_ARTIFACT_CRITERIA`. A registered point **is** consulted at artifact acceptance. It remains advisory and never gates, and `docs/decision-routing.md:66` states that carefully — the restatement in `context.md` is what drifted.

A third claim is overstated rather than wrong: a spike does not "consume a goal slot" or "change the DoD". `spike` routes to scout + researcher (`scope-executor/SKILL.md:113`); the DoD is planner-authored per scope and the type selects an executor.

### 3. Invisible 20%

| Dimension | Status | Notes |
|-----------|--------|-------|
| Error handling | ✅ | Both artifacts carry explicit falsification sections — four falsifiers each, aimed at the load-bearing claims |
| Observability | ⚠️ | Persisting `body.model` per point is recommended, but it is framed as a *new* requirement. `server/decision-store.ts:65-80` stores config + points only; it is an existing, unpersisted gap today |
| Security | ✅ | "Never let a Jev answer alone authorize a side effect" correctly applied to spike promotion, the only candidate with side effects |
| Input validation | ✅ | The middle-band "live question, never a silent promotion" requirement is the right mitigation for an LLM-authored `spec-tech` artifact — hostile state in a named field |

### 4. Edge Cases

| Edge case | Status | Notes |
|-----------|--------|-------|
| `n = 0` vs `n = 1` | ⚠️ corrected here | Both delivered artifacts state `n=0`; `session.log` says `n=1`. Conclusion unchanged (see §2) but the claim was stated more strongly than the evidence supports |
| Corpus counted outside the live tree | ⚠️ corrected here | "0 of 16 cards reached scope or planning" is false on this host — the 0.3-backup card did. True only scope-limited to `.stelow/` |
| Card count | ⚠️ corrected here | Three numbers across three artifacts (16 / 19 / 20). Measured: **20** dirs matching `.stelow/*/sw-*`, of which **15** carry a `state.md` (5 under `approvals/` do not) |
| Line references | ⚠️ | 5 stale anchors in the delivered docs (risk table, `stages.yaml` audit block, `decision-routing.md`, `score` normalizer range) |
| Vendor benchmarks | ⚠️ | Jev's accuracy claims carry the cost argument but are not benchmarked against real artifacts, which is the bar this repo already sets for itself at `docs/decision-routing.md:87` |

### 5. Doc & Tests

No code shipped, so no `README` / `CHANGELOG` / `FEATURES.md` entry is owed — correct per the repo's own rule, and this is a recommendation, not a feature. `grep -rli spike tests/` → **0**: the exact branch a `spike-worthy` point would gate has no test coverage at all. Recorded because it changes the build order.

### 6. Gap Registry

Owner **and** next action on every row, per the skill's `gap-actionability` bar. The sibling audits' own tables would fail this bar — they name a repo (`local`/`upstream`), not an actor, and no trigger.

| ID | Gap Type | Description | Impact | Effort | Owner | Next action (trigger) | Status |
|----|----------|-------------|--------|--------|-------|----------------------|--------|
| G1 | incomplete | The prerequisite has no owner and no trigger: no card on this host ever produced a real `spec-tech_v1.md`, so the calibration corpus does not exist | High | Moderate | Human card owner | Open a `feature`-intent card through `scope → … → verification` to produce the first real `spec-tech_v1.md` (on approval of this report) | **ESCALATED** |
| G2 | quality | Hostile-state and authorization rules recorded in `setup.md` §5 are absent from the final candidate designs; 2 of 3 candidate points consume LLM-authored prose as decision state | High | Moderate | Plugin maintainer | Encode as a named field + refusal to route on artifact prose + host checks stay authoritative, in `lib/decision-points.mjs` with a node test (before any point is registered) | **ESCALATED** |
| G3 | incomplete | The `spike` type branch has **zero** test coverage; the recommended point gates exactly this branch | Medium | Trivial | Plugin maintainer | Add the node test in `tests/` (before `spike-worthy` is built) | **ESCALATED** |
| G4 | process | Corrections found in `session.log` (the `score` path, `n=1`, the 0.3-backup card) never reached either delivered artifact — found, written down, then lost | Medium | Trivial | Orchestrator/skill author | Add a context-stage checklist line: every session-log finding is carried into the artifact or explicitly rejected with a reason (next skill revision) | **ESCALATED** |
| G5 | incomplete | The three named candidates exist only in a run artifact, not in `docs/decision-routing.md` Known debt where the next pass will look | Medium | Trivial | Plugin maintainer | Add as *measured, unbuilt* candidates with dates (with G1) | **ESCALATED** |
| G6 | incomplete | Skill sweep bound unstated — the request asked for flow points *and* skills; only this pipeline was swept | Medium | Trivial | Card author | State the bound in the artifact, or open a card to sweep verification / gap-triage / testing (with G1) | **DOCUMENTED** |
| G7 | quality | Vendor benchmark claims carry the cost argument unverified | Low | Trivial | Plugin maintainer | Cite real-artifact tests instead, per the existing policy | **DOCUMENTED** |
| G8 | quality | Stale corpus constants (16/19/20) and 5 stale line anchors | Low | Trivial | Card author | Date-stamp measurements; fixed in this report | **FIXED** |

### 7. Lessons Learned

**What went well.** The corpus probe. Rather than reasoning about whether a threshold *could* be tuned, the run grepped for the data and reported zero rows, then used that to invert the request's premise: the user asked which of four decisions to route, and the answer is that the stage has never executed. That is a better question than the one asked, and it is only reachable by actually running the search. Two of the four decisions were then rejected with a file, a line, and an independent constraint — the Jev docs' own warning about unreliability at counting is what made the scope-order rejection cheap.

**What could improve.** The session log found three corrections and both shipped documents went out without them. An audit reading `context.md` alone would rate the `score` claim as sound. When a run produces a log sharper than the artifacts built from it, the artifacts are what is wrong.

**Issues to watch.** The `n = 0` framing is rhetorically stronger than the evidence and does real work in the verdict. And the "smallest technical increment" argument now rests on a thinner claim than it did: `score` transport is live, so the `scope-risk` increment is not the transport, it is the missing field — which is upstream-owned (`R0`). The ordering is unaffected; the reason for it is now "the only path that creates the corpus", which was always the load-bearing argument.

### 8. Gap Conversion Summary

| Fixed | Documented | Escalated (new scopes) |
|-------|------------|------------------------|
| 1 | 2 | 5 |

Five escalated gaps, deduplicated to **three** work items (G1, G4, and the pair G2+G3 which share one file and one reviewer):

1. **Corpus card** (G1) — one `build`/`feature`-intent card through the full route.
2. **Routing doc + safety rules** (G5, G2, G3) — one card: candidates recorded, hostile-state rules encoded, spike branch tested.
3. **Context-stage checklist** (G4) — one skill revision.

## Decision

| Situation | Action Taken |
|-----------|-------------|
| All FIXED or DOCUMENTED, no ESCALATED | ✅ Close cycle |
| ESCALATED gaps exist | 🔄 Loops back to Execution |
| New scopes added to tracking file | 🔄 Workflow re-enters Execution → Verification → Audit |

**The decision matrix cannot be applied as written, and this merge overrides the requirement audit's Decision.**

Five gaps are ESCALATED, and the matrix's second row says *loops back to Execution*. On this card that transition does not exist. Re-derived in this merge:

- `stages.yaml:42` — `investigate: [triage, select, setup, context, audit]`. `execution` is not on the projection.
- `stages.yaml:624` — the `audit` stage declares `reject: [execution]`.
- `data/stelow:258` — candidates are filtered to `stages[:idx] | stages[idx+1:idx+2] | {stage}`. At `idx` of `audit` in a 5-stage list, that is `{triage, select, setup, context, audit}`.

The edge is dead. The requirement audit's *"rework through the host's reject path as new `feature`-intent cards"* names a door the card cannot reach, and the audit skill's own hand-off block instructs the same impossible move. A refusal with no exit is a deadlock with a good error message — which is this repo's own stated rule, and it applies to the workflow graph as much as to a scope executor.

**Action taken: close the audit stage, do not advance, and record the escalated work as three new `feature`-intent cards in the normal way.** The follow-ups are created from a stage that *can* reach `scope`, not by rewinding a terminal audit on an investigate card. Whether an investigate audit with ESCALATED gaps should have a legal route back is a question about the stage graph, not about this card — it belongs to the orchestrator and is recorded here rather than resolved here.

**Recommendation stands.** Add a corpus, not a decision point: one `feature`-intent card through `scope → interface → selection → planning → execution → verification`, then the upstream `risk`/`type` field in `calionauta/stelow` (release + `repository_dispatch stelow-release`), then `spike-worthy`, then `scope-risk`. The two rejected decisions — scope order and task order — stay rejected. Two of the four reasons supporting that ordering are withdrawn or narrowed here, and the recommendation is stronger for it: it now rests on the corpus argument alone, which was the argument that was always load-bearing.

---

**Scope note:** wrote only this file (`runs/exec_yspd4mhh/audit/report.md`). `state.md`, gates, and completion state were not touched. The sibling `requirements.md` and `evidence.md` were read and left unmodified. Unrelated working-tree changes in this repository (creation dialogs, `lib/panel-storage.mjs`, `package.json`) belong to other threads and were left alone.
