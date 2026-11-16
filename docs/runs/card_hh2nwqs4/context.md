# Context synthesis — where a decision router belongs in scope mapping and tech planning

Synthesis of [`context-analysis.md`](./context-analysis.md) (method: `stelow-product-multi-method-market-analysis`,
Variant 1 — PESTLE / Foresight / Delphi / Wardley over three horizons, then adjudicated against the
four decisions the request names).

Intent: `investigate`. Appetite: `Complete`. Review mode: `Auto`. Product type: `software`.
This artifact is a Context-stage input for Shape Up. It records a **decision and a sequencing
plan**; it is not a spec and starts no implementation.

---

## 1. Verdict

> **Add a corpus, not a decision point.** On this host, tech planning has never executed —
> 0 of 16 cards reached `scope` or `planning`, 0 `spec-tech_v*.md` artifacts exist, 0
> `Risk Score` values have ever been written. The calibration set for any of the four
> candidate decisions is `n = 0`, not "small". The router is not the blocker; the
> unexecuted stage is.

The one action that changes this answer: take a single `build`-intent card all the way through
`scope → interface → selection → planning → execution → verification`, producing the first real
`spec-tech_v1.md` with `Risk Score` and `[TYPE]` actually filled in. That yields the labeled rows
every threshold would be tuned against, and costs no schema change, no new dependency, and no
upstream release.

## 2. What the analysis overturned

The request assumed the work was *choosing between four decision points*. Two measurements
show the choice is premature and mis-framed:

**The stage under discussion has never run.** Verified again in this run:

| Probe | Command shape | Result (2026-09-30) |
|---|---|---|
| Cards on this host | `ls -d .stelow/*/sw-*` | 20 directories, 12 days |
| `spec-tech_v*.md` anywhere | `find .stelow -name 'spec-tech*'` | **0** |
| The single populated `plans/` | `.stelow/2026-09-29/sw-card_oqm8gyae/plans/` | `spec-product.md` only — 86 lines, 0 hits for `risk` / `spike` / `[TYPE]` |
| `Risk Score\|RISK` in code | `grep -rn … lib/ server/` | **0** — no consumer of a risk score exists |
| `risk` / `type` in the scope contract | `data/stelow-assets/schemas/scope-{map,batch}.json` | absent; `scope-batch` items are `additionalProperties: false` over `id, status, targetFiles, dependsOn` |

This closes the recon's open question #2: the calibration corpus is not thin, it is empty.
`docs/decision-routing.md:94` already rejected a candidate (*ask necessity*) for exactly this
shape of problem — a classifier fitted on a non-representative corpus "would learn the harness,
not the product". A point added to a stage with zero executions reproduces it.

**The risk rubric is declared but unbacked.** `scopes-and-sequencing.md:213-236` carries a
1–5 table whose Action column says `risk >= 4 → front-load` and `>= 5 → [spike] BEFORE
implementation`, and `tech-output.md:132` requires the field per scope. **Nothing executes
either rule.** Today a risk score is a number a human reads in plan prose, and `spec-tech.md`
is the only place it could ever exist. The gap in "what is risky" is a **schema gap before it
is a judgment gap** — and the schema is **sync-owned**, so the fix is upstream in
`calionauta/stelow` (release + `repository_dispatch stelow-release`); a local edit to `data/`
is reverted at the next sync.

Together: the two candidate decisions the request named are both blocked, one by an empty
corpus and one by a missing field, and the missing field is upstream-owned.

## 3. Adjudication of the four named decisions

| Decision | Primitive | Who decides it today | Answerable by rules? | Verdict |
|---|---|---|---|---|
| What is risky | `score` | **Nobody.** Prose in a plan that has never been produced | Partly — complexity / novelty / legacy-risk are separable predicates | **Strongest candidate, blocked** |
| What deserves a spike | `noul` | The planner subagent, inside one full LLM turn | No — "is the uncertainty fundamental?" is genuinely semantic | **Best on merit, blocked, and the only one with execution consequence** |
| Order of scopes | `choice` / `score` | `lib/scope-order.mjs:30` — topological sort of `dependsOn` | **Yes, completely** | **Reject** |
| Order of tasks | `score` | `dependsOn` graph + `STATUS_RANK` at runtime | **Yes, completely** | **Reject as execution; advisory at most** |

**Risk (`score`).** The 1–5 table maps onto `criteria` levels if its degrees are rewritten as
*situations*; the state is compact (title, outcome, in/out, touched files, dependency count),
comfortably inside `DECISION_STATE_MAX_CHARS = 8000` (`lib/decision-api.mjs:15`); and the
transport **already normalizes `score`** (`lib/decision-api.mjs:141-164`) though no registered
point emits it — this is the smallest technical increment on the list. Blocked twice: the field
is not in any schema, and with `n = 0` plans there is nothing to set `routeAt` against.

**Spike-worthiness (`noul`).** The only candidate that **changes execution**: `[TYPE] spike`
with no `[EXECUTOR]` routes to scout + researcher instead of the normal worker loop, changes the
DoD, and consumes a goal slot. That asymmetry — a needless spike costs a research goal, a
missing spike becomes rework — argues for the three-band shape already used by `auto-continue`:
mark `[spike]` above a high floor, **ask a live question in the middle band**, leave it a
`feature` below a low floor. The middle band must be a real question, not a silent promotion, or
the host manufactures exactly the phantom wait `AGENTS.md` forbids. Caveat from the Jev
documentation: the judgment needs codebase knowledge, and decision models measurably degrade on
state carrying irrelevant detail — so the state must be the scope's own summary, not the tree.

**Ordering — reject, twice over.** `lib/scope-order.mjs` already sorts topologically from
`dependsOn` (cycles preserved rather than deadlocking, ties keeping `state.md` order) and
`STATUS_RANK` re-orders tasks at runtime. A router here would be advisory over an artifact whose
order is *already* deterministically enforced — precisely the "advisory theater" that
`docs/decision-routing.md:85-87` rejected for *scope-map challenge*. Independently, the Jev
documentation states the model is "unreliable at arithmetic, counting"; ordering **is** counting.
The request's intuition that ordering is a decision point is the one the evidence rules out.

## 4. The unclaimed win — three concrete points, in pipeline order

`docs/decision-routing.md:66-73` already names the largest unclaimed win: *"No router point sits
at a stage transition or artifact acceptance."* All four registered points
(`lib/decision-points.mjs:63-111`) are at the edges — card creation, idle resume, inbox tick,
explicit CLI. Named here with a shape, in the order the pipeline reaches them:

1. **Does this plan have real acceptance criteria per scope?** (`noul`, per scope, read-only.)
   The proven `artifact-criteria` pattern — atomic judgment per item, against a real artifact,
   degrading to `unverifiable` below the floor, gating nothing. Closest existing precedent in
   the codebase.
2. **Which verify command applies to this scope?** (`choice` over an allowlist, derived from
   `targetFiles`.) "Route and fill arguments together": route and its typed parameters from one
   call, over an allowlist the model cannot widen. **But** rules own this first — a
   path→command table is deterministic, so this only earns a model call if the table cannot
   cover the real cases.
3. **Is this scope's DoD met, or does it need review?** (`noul`, at artifact acceptance, three
   confidence bands, human review for irreversible outcomes.)

Each is read-only, replayable, has a bounded question schema, and — the test
*scope-map challenge* failed — **has a consumer**. All three are still blocked on the same
prerequisite: none can be calibrated while `planning: 0` executions. The binding constraint is
corpus, not capability.

## 5. Recommendation and sequence

**Now — one action, not a feature:** run a `build`-intent card end to end to create the corpus.
That makes the unexecuted `>= 4 → front-load` and `>= 5 → spike` rules observable, and gives
`artifact-criteria` something real to be tested against.

**Then, in order:**

| Order | Step | Why here | Ownership |
|---|---|---|---|
| 1 | Corpus: one full `build` run to execution | No threshold is a guess before this | local, no schema |
| 2 | Add `risk` (1–5) and `type` to the scope contract, then **execute the existing rule as deterministic ingest validation** | Makes the declared rule real before anything models it. This is validation of a machine field, *not* a model call | **upstream** `calionauta/stelow` + `repository_dispatch stelow-release` |
| 3 | `spike-worthy` point (`noul`, three bands, middle band = live question) | Highest value per decision: the only one that changes execution | local, `lib/` + node test |
| 4 | `scope-risk` point (`score`) | Smallest technical increment (normalizer, providers, threshold UI all exist) — but advisory until the field is machine-readable | local |
| — | Scope order, task order | **Never**, absent counter-evidence | — |

Two details that would otherwise be rediscovered later:

- **Threshold direction.** `spike-worthy`'s action is "promote", so its `thresholdLabel` reads
  like `artifact-criteria` ("Promote at confidence ≥") — *not* the inverted `auto-continue` form.
  Per `decision-routing.md:40-58`, direction is not uniform, so no point shares a key with a
  different direction.
- **Record the model per point.** `lib/decision-api.mjs:173` parses `body.model` and returns it,
  but nothing persists it per point. Pinning the model version a threshold was tuned against is
  cheap insurance and applies to every point above.

## 6. What this hands to Shape Up

- **Scope of the Shape Up work, if any:** upstream-first schema for `risk`/`type` +
  deterministic ingest validation of the existing rule, in `calionauta/stelow`. That is the
  whole of it — one schema change plus one validator, no decision point.
- **Explicitly out of scope:** scope-order and task-order routing (deterministic already);
  a decision point added before the corpus exists (no calibration set, `n = 0`).
- **Carried forward as an open question:** whether the first real `spec-tech_v1.md` fills
  `Risk Score` and `[TYPE]` consistently enough for the declared rules to be worth executing
  automatically. That is the observation the corpus run is for, and it is what decides whether
  step 3 is a small accelerant or load-bearing.

## 7. What would falsify this

- If the first real `spec-tech_v1.md` shows `Risk Score` and `[TYPE]` consistently filled **and**
  deterministic validation of `>= 5 → spike` fires on real plans, then both points are cheap
  accelerants rather than load-bearing — and the recommendation collapses to "do the schema, skip
  the router."
- If a Jev-comparable model reaches sub-50 ms at equal accuracy, the latency argument for
  deterministic-first weakens; the audit-trail argument does not.
- If `dependsOn` turns out to be frequently wrong or missing in real scope maps, scope order
  reopens — as a **data-quality problem in the map**, not as a routing problem.
- If a router on real plans disagreed with the planner's own risk judgment often enough to be
  worth adjudicating, that disagreement is the label set, and is worth measuring either way.

## 8. Evidence index

**Local (re-verified in this run)**

- `docs/decision-routing.md:66-73` (unclaimed win), `:75-97` (three measured rejections),
  `:40-58` (threshold direction)
- `lib/decision-points.mjs:63-111` — four registered points, all edge-of-flow
- `lib/decision-api.mjs:15` (`DECISION_STATE_MAX_CHARS`), `:141-164` (`score` normalized),
  `:173` (`body.model` returned, not persisted)
- `lib/scope-order.mjs:26,30` — `statusRank`, topological `orderScopes`
- `data/stelow-assets/schemas/scope-batch.json`, `scope-map.json` — no `risk`/`type`;
  `additionalProperties: false`; both sync-owned
- `skills/stelow-workflow-tech-planning/references/scopes-and-sequencing.md:213-236` — the
  1–5 table and the two unexecuted rules; `tech-output.md:132` — the required field

**External** (full citations in `context-analysis.md` §8)

- TypeSafe AI, *Introducing System One Models & Jev*, 2026-09-15 — the `choice`/`score`/`noul`
  primitives; typed, text-only, unreliable at arithmetic and counting
- OpenRouter, *Jev vs LLM*, 2026-09-19 — accuracy a wash vs Opus at ~100× lower cost
- LiteLLM (Moe Khalil), 2026-09-20 — **95% vs 73.75%** tier match: the LLM classifier collapses
  in the middle band, which is exactly the band a spike judgment turns on
- WEC / Regolo / Bloss0m / WhatAI, 2026-09-18…23 — community shapes: confidence-gated routing,
  fan-out, self-hosted alternatives, the "cannot explain a failure" limitation

**Scope note:** state.md, gates and completion state were not touched. The unrelated working-tree
changes in this repo belong to other threads and were left alone.
