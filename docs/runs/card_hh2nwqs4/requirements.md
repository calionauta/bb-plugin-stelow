---
gaps:
  - type: incomplete
    description: "The load-bearing prerequisite (run one build-intent card end to end) has no owner, no trigger and no tracking artifact"
    impact: high
    effort: trivial
    resolution: escalate
  - type: quality
    description: "Hostile-state and no-answer-alone-authorizes rules recorded in setup.md are absent from the final candidate designs at artifact acceptance"
    impact: high
    effort: moderate
    resolution: escalate
  - type: incomplete
    description: "The [TYPE] spike to scout+researcher branch has zero test coverage while the recommended point gates exactly that branch"
    impact: medium
    effort: trivial
    resolution: escalate
  - type: process
    description: "Session-log corrections were found and written down but never carried into the delivered context artifacts"
    impact: medium
    effort: trivial
    resolution: escalate
  - type: incomplete
    description: "The three named candidate points exist only in a run artifact, not in the locally-owned docs/decision-routing.md Known debt section"
    impact: medium
    effort: trivial
    resolution: escalate
  - type: incomplete
    description: "The skill sweep bound is unstated: the request asked for flow points and skills, but only this pipeline was swept"
    impact: medium
    effort: trivial
    resolution: documented
  - type: quality
    description: "Vendor benchmark figures carry the cost argument unverified against real artifacts"
    impact: low
    effort: trivial
    resolution: documented
  - type: quality
    description: "Corpus counts were quoted without a date; the workspace moved from 16 to 20 card dirs"
    impact: low
    effort: trivial
    resolution: fixed
---

# Execution Critique Report — Requirement Audit

**Date:** 2026-09-30
**Mode:** workflow (`investigate` card, terminal `audit` stage)
**Recipe / task:** `execution-audit` / `requirement-audit` → `audit/requirements.md`
**Source of truth:** the request as parsed in `runs/exec_6kds185v/recon/setup.md` §1 (five
questions), the recipe contract in `data/stelow-assets/recipes/execution-audit.yaml`, and the
two artifacts produced so far (`setup.md`, `context-analysis.md`, `context.md`).
**Model used for audit:** standard host model (per `stages.yaml` `model_hint: standard`)

> **Adaptation, stated up front:** this card is `intent: investigate`, whose route is
> `triage → select → setup → context → audit` (`stages.yaml:42`). There is no implementation
> and no code diff to audit — `sem diff` / `git diff` are vacuous here by design, not by
> omission. The subject of this audit is therefore the **delivered answer against the
> request's requirements**, and every load-bearing claim quoted below was re-verified
> directly in this workspace rather than accepted from the prior artifacts. The sibling
> task `evidence-audit` owns the deeper evidence review; this report stays on coverage.

## Summary

| Metric | Value |
|--------|-------|
| Requirements evaluated | 11 (5 request questions + 2 recipe requirements + 4 contract/quality bars) |
| Requirements complete | 7 |
| Requirements partial | 3 |
| Requirements failed | 1 |
| Gaps identified | 7 (2 high, 3 medium, 2 low) |
| Load-bearing claims re-verified | 9 of 9 hold |

## 1. Requirement Completeness

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| R1 | **Recipe `pipeline`:** run as an orchestrated task inside a run dir, writing `audit/requirements.md` | ✅ | `runs/exec_yspd4mhh/` existed and was empty at start; this file is its first write. Recipe task block matches (`depends_on: []`, `failure_policy: fail`, `write_policy: artifact`) |
| R2 | **Recipe `structured-output`:** `schemas/markdown.json` — `content` string, `minLength: 1` | ✅ | Artifact is Markdown; the schema is content-non-empty only, so the real bar is the skill's own completeness contract (summary table + 8 criteria + gap registry + lessons + decision, ≥800 words), which this report meets |
| R3 | **Q1 — what is risky** | ✅ | Answered with a decision, not a survey: `score`, "strongest candidate, blocked". The blocker is identified as a **schema gap** (`risk` absent from `scope-map.json` scope item — re-verified: properties are exactly `capabilities, dependsOn, id, inScope, outOfScope, outcome, status, title`, `additionalProperties: false`) rather than a judgment gap |
| R4 | **Q2 — what deserves a spike** | ✅ | `noul`, three-band shape, and correctly identified as the **only candidate with real execution consequence** (executor swap + DoD + goal slot) |
| R5 | **Q3 — order of scopes** | ✅ | Rejected, with the right reason: `lib/scope-order.mjs:30` `orderScopes` is a topological sort of `dependsOn`; a router there is advisory over an already-enforced order |
| R6 | **Q4 — order of tasks** | ✅ | Rejected as execution, advisory at most. Independently corroborated: the Jev documentation places counting and ordering out of the decision-model lane |
| R7 | **Q5 — research the TypeSafe Jev skill on the internet** | ✅ | Official `typesafe-ai` SKILL.md and the community `building-with-typesafe-jev` prior-art index were read and *mapped*, not summarised: primitive-by-outcome ("Choice = one of a set", "Score = position in a dimension"), "decompose ruthlessly", "select don't generate", "gate on confidence", and the authorization prohibition |
| R8 | **The request asked for flow points *and skills*** ("pontos do fluxo e skills q valeria usar") | ⚠️ | Partial. The three named candidate points are all **inside scope-mapping / tech-planning**. The 12 prior-art intents were not swept against other stages (verification, gap-triage, testing-execution, scope-executor), and the document never says that sweep was out of scope — a reader can reasonably infer coverage that was not performed |
| R9 | **`investigate` terminates at `audit`** — deliverable is a recommendation, not code | ✅ | Verified `stages.yaml:42` and `setup.md` §4. Correct call: no code was written, no state advanced |
| R10 | **"Where can decision routing replace an LLM?"** (the headline question) | ⚠️ | Answered as a **negative with three candidates** ("nowhere on this host yet"), which the evidence supports. But the answer is qualitative: there is no inventory of the LLM turns each stage actually spends, so the size of the opportunity elsewhere in the pipeline is unmeasured |
| R11 | **Ownership boundary respected** (sync-owned vs owned) | ✅ | Verified: `SRC_PREFIX = "skills/"` and `EXECUTION_ASSET_PREFIXES = ["recipes/", "schemas/"]` (`lib/workflow-skills-sync.mjs:10,328`). The recommendation is correctly routed upstream-first to `calionauta/stelow` |

## 2. Deliverable Quality

| Issue | Severity | Location |
|-------|----------|----------|
| The three candidate points are proposed without the hostile-state mitigation that the *same run's* recon recorded | High | `context.md` §4 points 1–3 vs `setup.md` §5 |
| `score` feasibility is stated as "the smallest technical increment", but three code paths already build `score` questions (`lib/gap-registry.mjs:222`, `lib/skill-criteria.mjs:87`, `lib/task-evidence.mjs:30`) — under-credited | Low | `context.md` §3 |
| Corpus denominator quoted as a constant ("16 cards, 58 files"); at audit time the workspace holds 20 card dirs and 65 files | Low | `context-analysis.md` §0 |
| No contradictions found between `setup.md`, `context-analysis.md` and `context.md`; `context.md` is a disciplined compression that adds the recommendation rather than restating | — | all three |

## 3. Invisible 20%

| Dimension | Status | Notes |
|-----------|--------|-------|
| Security / trust boundary | ❌ | The Jev guidance recorded in `setup.md` §5 — *"never let a Jev answer alone authorize a side effect"*, hostile state isolated in a **named field** — is absent from the final candidate designs in `context.md` §4. Two of the three candidates sit at **artifact acceptance**, the highest-risk place for a model answer to gate anything, and both consume LLM-authored `spec-tech` prose as decision state |
| Failure policy | ✅ | Each rejected candidate names why the failure is unrecoverable or duplicative (`ask necessity` on the product-authority path; `scope-map challenge` with no consumer). This is the policy's own bar, applied honestly against the request's own ideas |
| Threshold direction | ✅ | Verified against `docs/decision-routing.md:40-58`: `spike-worthy` would take its own key with `thresholdLabel` in the `artifact-criteria` ("Promote at confidence ≥") form, **not** the inverted `auto-continue` form. Correct, and the reason is stated |
| Observability / replay | ⚠️ | `lib/decision-api.mjs:173` parses `body.model` and returns it; nothing persists it per point. Correctly identified in `context.md` §5 as insurance "applying to every point above" — but not stated as a **prerequisite** of the first point |
| Input validation | ⚠️ | Compact state and `DECISION_STATE_MAX_CHARS = 8000` (`lib/decision-api.mjs:15`) are respected in the proposed shapes; the truncation is acknowledged, and the "shortlist first" rule is the right mitigation |

## 4. Edge Cases

| Edge case | Status | Notes |
|-----------|--------|-------|
| Corpus arrives but `Risk Score` is filled inconsistently | ✅ | Covered by `context.md` §7 falsifier — it collapses the thesis to "do the schema, skip the router" |
| `dependsOn` wrong or missing in real maps | ✅ | Covered, and correctly reframed as a **data-quality problem in the map**, not a routing problem |
| First point fires in the middle band | ⚠️ | Three bands are proposed, but the middle band is specified as "a live question" without naming the host seam that would raise it. An unrouted middle band is a phantom wait — the exact failure `AGENTS.md` forbids |
| Spike mis-typed on a real scope | ⚠️ | The asymmetry is asserted (a needless spike costs a research goal; a missing spike becomes rework) but not traced to `goals.md` / `scope-batch`, so open question #3 from `setup.md` §8 is asserted rather than closed |
| Re-typing an already-executing scope | ❌ | Not addressed anywhere. `scope-batch.json` scope item carries only `id, status, targetFiles, dependsOn` — nothing records *how* the type was decided, so a gate would have no field to write its answer into |

## 5. Doc & Tests

| Item | Status |
|------|--------|
| No user-facing code change → `FEATURES.md` not required | ✅ |
| The card's most valuable output (three **named**, shaped candidate points) exists only inside a run artifact under `.stelow/` | ❌ |
| `docs/decision-routing.md` "Known debt" still says only "no router point sits at a stage transition or artifact acceptance" | ❌ |
| Spike executor path test coverage | ❌ |

The two `❌` on documentation are the same gap seen twice: `docs/decision-routing.md` is **owned
locally** (not sync-owned), and its "Known debt" section is precisely where
`docs/decision-routing.md:66-73` already invites the next candidate. The three candidates this
card produced — named, shaped, and costed — are the first concrete content that section has
received since it was written. Today they live only in `runs/exec_x0oruxjh/strategic/context.md`,
which no future reader is pointed at.

The test row is worse than a documentation nit. `grep -rln "spike" tests/` returns **nothing**:
the `[TYPE] spike` → scout + researcher routing that recommendation step 3 would gate has zero
coverage. `AGENTS.md` is explicit that new state-machine logic belongs in `lib/` with a node
test; gating an untested branch with a confidence threshold is the wrong order.

## 6. Gap Registry

| Gap | Type | Description | Impact | Effort | Action (owner) | Status |
|-----|------|-------------|--------|--------|----------------|--------|
| G1 | Missing prerequisite | The load-bearing recommendation — "run one build-intent card end to end" — has no owner, no trigger and no tracking artifact. Everything else is sequenced behind a corpus that nobody has committed to producing | High | S | Open a new `feature`-intent stelow card that takes a small real change through `scope → interface → selection → planning → execution → verification`, producing the first real `spec-tech_v1.md` (**card owner, human**) | ESCALATED |
| G2 | Design omission | Hostile-state rule and the "no answer alone authorizes a side effect" rule are lost between `setup.md` §5 and the final candidate shapes in `context.md` §4, at artifact acceptance | High | M | When G1's follow-on card designs `spike-worthy` or the DoD point: isolate the artifact body into a named field, refuse to route on it, keep host-side checks authoritative (**maintainer, `lib/decision-points.mjs` + node test**) | ESCALATED |
| G3 | Untested path | `[TYPE] spike` → scout + researcher has zero test coverage; recommendation step 3 changes exactly this branch | Medium | S | Land a node test for the spike type branch *before* any decision point gates it (**maintainer, `tests/`) | ESCALATED |
| G4 | Unstated scope | The request asked which **skills** would benefit; only this pipeline was swept, with no note that the sweep was bounded | Medium | S | State the bound explicitly in the recommendation card, or extend the sweep to `verification` / `gap-triage` / `testing-execution` as its own card (**card author**) | DOCUMENTED (open) |
| G5 | Ephemeral finding | The three named candidates are not recorded in the owned `docs/decision-routing.md` "Known debt" section, so they die with the card | Medium | S | Add them as *measured, unbuilt* candidates with the n=0 blocker attached (**maintainer, `docs/decision-routing.md` — owned, not sync-owned**) | ESCALATED |
| G6 | Stale constant | Corpus counts quoted without a date; workspace has moved 16 → 20 card dirs since the recon | Low | S | Date-stamp every corpus count in a recommendation and label it a measurement, not a constant (**card author**) | FIXED in this report |
| G7 | Unverified dependency | Vendor benchmark figures (TypeSafe 193.6×/444.6×, LiteLLM 95% vs 73.75%) carry the cost argument unverified; the skill's own rule is "don't trust the same model" | Low | S | Do not cite vendor numbers in the design card; `docs/decision-routing.md` already requires tests against real artifacts, which supersedes them (**maintainer**) | DOCUMENTED |

The skill's own `gap-actionability` bar — *rows name owner and next action, not observations
alone* — is met here, and it is **not** met by the prior artifacts: `context.md` §6 gives an
ordered table with an "Ownership" column reading `local` / `upstream`, which names a *repo*, not
an actor, and no trigger. That is the single most consequential thing this audit adds.

## 7. Lessons Learned

- **What went well:** the work refused the question's own framing where the evidence did. Two of
  the four named decisions (scope order, task order) were rejected, and the rejection was
  grounded in a file and a line (`lib/scope-order.mjs:30`) plus an independent constraint from
  the model's own documentation. It also converted "what is risky" from a modeling question into
  a schema question by noticing the rule was **declared but unbacked** — re-verified here: the
  1–5 table and both rules exist at `scopes-and-sequencing.md:213-236` and
  `grep -rn "Risk Score" lib/ server/` returns zero.
- **What could improve:** a chain of stages loses its safety rules at the seam. `setup.md` §5
  recorded three constraints that a model must honour; `context.md` §4 — the artifact a human
  would actually act on — carries none of them. Anything load-bearing should be restated at the
  point of use, not only at the point of discovery.
- **Issues to watch:** the `n = 0` finding is correct **today** and will silently expire. The
  moment one plan lands, "we have no corpus" becomes false, and the correct response flips from
  "do the schema first" to "calibrate now". Nothing in the artifacts is scheduled to notice that
  transition; G1 is what makes it happen on purpose.

## 8. Gap Conversion Summary and Decision

| Fixed here | Documented | Escalated (new cards) |
|-----------|------------|-----------------------|
| 1 (G6) | 2 (G4, G7) | 4 (G1, G2, G3, G5) |

**Requirement verdict:** the request is answered. All five questions receive a decision with a
verdict and a reason, the ownership boundary is respected, and the negative result is the
correct one on this evidence. What is missing is not analysis — it is **commitment**: the
prerequisite that gates everything else is a proposal with no owner, and the highest-risk
candidate design has lost the two safety rules the same run had already found.

| Situation | Action Taken |
|-----------|-------------|
| Requirements complete, gaps fixable in place | ✅ G6 fixed in this report |
| ESCALATED gaps exist (G1, G2, G3, G5) | 🔄 Rework through the host's reject path → new `feature`-intent cards |
| Audit stage is terminal for `investigate` | ⛔ No `advance`; state, gates and completion state untouched |

**Recommended card order:** G1 (create the corpus) → G5 (record the candidates so they survive)
→ G3 (test the spike branch) → G2 (safety rules inside the point's design). G4 and G7 are
documentation debts that ride along with G1.

**Scope note:** this audit wrote only
`runs/exec_yspd4mhh/audit/requirements.md`. `state.md`, gates and completion state were not
touched. The unrelated working-tree changes visible in `git status` (creation dialogs,
`lib/panel-storage.mjs`, `package.json`) belong to other threads and were left alone.
