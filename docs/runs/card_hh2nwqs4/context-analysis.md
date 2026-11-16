# Strategic context — decision routing in scope mapping and tech planning

Study topic: where a Jev-compatible decision layer can replace LLM judgment in the scope-mapping
and tech-planning stages of this plugin, and which flow points are worth wiring.
Geographic focus: Global (the category landscape), applied to one host.

Method: `stelow-product-multi-method-market-analysis`, Variant 1 (General Deep Analysis) —
PESTLE, Foresight, Delphi and Wardley applied across three time horizons, then adjudicated
against the four decisions the request names: risk, spike-worthiness, scope order, task order.

---

## 0. The finding that reorganizes the question

The request asks *where* decision routing can replace LLM judgment. The answer that survives
the evidence is: **nowhere on this host yet, and the blocker is not the router.**

Measured on 2026-09-30, in this workspace:

| Probe | Result |
|---|---|
| Files under `.stelow` (12 days, 16 cards) | 58 |
| Cards that reached `planning` | 0 |
| Cards that reached `scope` | 0 (`sw-card_oqm8gyae` is `scope:=pending`) |
| `spec-tech_v*.md` artifacts produced | **0** |
| The one `plans/` directory (`sw-card_oqm8gyae`) | `spec-product.md` only, 86 lines, 0 occurrences of `risk`/`spike`/`[TYPE]` |
| `Risk Score\|RISK` in `lib/` + `server/` | 0 hits |
| `risk`/`type`/`sequence` fields in `data/stelow-assets/schemas/scope-map.json` | absent (`additionalProperties: false`) |
| Machine fields in `scope-batch.json` | `id`, `status`, `targetFiles`, `dependsOn` — no `risk`, no `type` |

So the tech-planning surface the question is about has **never executed on this host**. There
is no plan artifact, therefore no `Risk Score` values, therefore **zero rows of calibration
data**. This closes open question #2 from the recon: the corpus is not "large enough to
tune a threshold" — it is `n = 0`.

That matters because `docs/decision-routing.md:94` already rejected a candidate (*ask necessity*)
for precisely this reason — a classifier fitted on a non-representative corpus "would learn the
harness, not the product" — and `:85-87` rejected *scope-map challenge* as "advisory theater"
because nothing consumed its answer. Adding a decision point to a stage with zero executions
reproduces both failure modes exactly.

The second structural finding, independent of volume: the risk rubric and the spike rule are
**declared but unbacked**. `scopes-and-sequencing.md:213-236` carries a 1–5 risk table whose
Action column says `risk >= 4 → front-load` and `risk >= 5 → [spike] BEFORE implementation` —
and `grep` finds **no consumer anywhere in `lib/` or `server/`**. Today the only reader of a risk
score is a human scanning `spec-tech_v{n}.md` prose, and the rule is executed by nobody. The gap
in "what is risky" is a **schema gap**, not a judgment gap.

## 1. Recent Past (≈1 year ago) — the routing layer was hand-rolled and LLM-shaped

**PESTLE.** *Technological*: through 2025, routing classifiers were trained artifacts —
RouteLLM's BERT router on Chatbot Arena preferences, `semantic-router`'s embedded prototypes,
vLLM's ModernBERT CoT-vs-direct gate. Each required a labelled dataset and a training run per
taxonomy. *Political/legal*: EU AI Act high-risk classification obligations made "who decided,
and on what evidence" an audit question, favouring systems that can emit a decision trace. That
bias survives: the products selling routing today all sell the trace, not the accuracy. *Economic*:
the whole argument for a router is amortizing inference spend, so every prior router was a cost
instrument. *Social*: practitioner sentiment treated "LLM as classifier" as acceptable because it
needed no new infrastructure.

**Foresight.** Strong signal: the category split into *proxy-level* routing (LiteLLM, OpenRouter,
Portkey — normalize, log, fall back) versus *decision-level* routing (a classifier whose output
controls the branch). Weak signal, and the one that aged well: Anthropic's own routing guidance
carried a line most teams skipped — *"Consider a non-LLM router. If a regex or a keyword match
classifies reliably, use it"* — plus the load-bearing warning that *"if the classifier is wrong
30% of the time, you have not separated concerns, you have added a failure mode."* That sentence
is the house rule `docs/decision-routing.md:3` already encodes, arrived at from the other side.

**Delphi.** Practitioner consensus across the surveyed literature converges on four rules and
disagrees on everything else: keep the label set closed and validated; fail toward the error you
can least afford; log the label so a misfire is distinguishable from a bad handler; and **never
delegate authorization to the model**. Consensus is thin on threshold values — every published
number is explicitly labelled an example to evaluate, not a default.

**Wardley.** The capability chain one year ago:

```
User request
  ↓
[Hand-rolled BERT / embedding classifier]   ← Custom, per-taxonomy, needs labels
  ↓
[LLM writes the answer]                      ← Product
  ↓
[Token counting, exact lookups]              ← Commodity (rules)
  ↓
[Stateless prompt classification]            ← Genesis
```

The differentiating layer was the classifier; everything below it was commodity. Note where
this host's own risk/spike/ordering decisions sit: **below** the classifier, in the commodity
band, not above it.

## 2. Current Trends (today → 1 year) — the classifier became a product, and split in two

**PESTLE.** *Technological*: on 2026-09-15 TypeSafe released **Jev**, the first "System One"
model — state in, typed probabilistic decision out, three primitives (`choice` / `score` /
`noul`), $0.042 per MTok input with output free, 70–500 ms, no string generation, 64k context.
Measured two days later by OpenRouter (2026-09-19) on 60 support tickets: Jev 1.13 hit 59/60
intent accuracy at 194 ms p50 and $0.0248 per 1,000, against Claude Opus at 60/60, 1,957 ms and
$2.88 per 1,000. Accuracy is a wash; cost is ~100×. LiteLLM's Moe Khalil (2026-09-20) measured
5.43× faster than a Haiku classifier and, more tellingly, **95% vs 73.75% tier-match accuracy** —
the LLM classifier was fine at trivial-vs-not and unreliable in the middle band that routing
decisions actually turn on. LangChain reported score variance of 0.0000149 across 500 repeated
decisions, 433× below GPT-5.6 Luna. *Economic*: that variance number is the real unlock — it is
what makes an LLM-as-judge usable inside a loop. *Legal/ethical*: Jev is a **US-hosted cloud
service in early access**; the self-hosted answers (Laya at ~33 ms, ModernBERT at ~10–20 ms,
openjev as a wire-compatible diffusion-backed engine) are the data-sovereignty path. *Social*:
"System One" reads as a new model class, but the skeptical readings are precise — TypeSafe's own
0% type-error figure is a schema guarantee, not a measurement, and the headline 193.6× / 444.6×
speedups are company-built tasks with frontier models as the answer key.

**Foresight.** Strong signal: the primitives are *typed and parallel* — one call answers several
independent questions against the same state, and the cost of an answer you ignore is near zero
because output is free. That is a genuine change in the economics of speculative fan-out. Weak
signal: the entire layer is consolidating toward *a config line*. LiteLLM now exposes
`classifier_type: jev`; MCP gateways (Composio) are converging routing and tool selection into one
control plane. Both read as "the router is becoming a commodity you configure."

**Delphi.** Consensus is now sharp on the *boundary*. The Jev-vs-LLM comparison is a wash on
accuracy, so the deciding variable is the shape of the work: bounded, frequent, replayable,
policy-actionable → decision model; open-ended output, novel reasoning, images/PDFs → LLM. The
most load-bearing documented limitation is the one that kills half of this request: Jev takes
**text only** and "tends to lose accuracy when the state it examines carries irrelevant detail,
and it is unreliable at arithmetic, counting, and date comparison." The community evaluation
guide states it flatly: Jev **cannot explain** why an agent failed — pairing it with an
autoregressive model on test failure is the recommended pattern.

**Wardley.** The chain today:

```
Users
  ↓
[Decision API / Jev — choice, score, noul]   ← Product (fast-moving, early access, hosted)
  ↓
[Local encoder classifiers — ModernBERT, Laya]  ← Opening into a commodity
  ↓
[Signal orchestration — keyword ~1ms, embedding 20–50ms]  ← Commodity
  ↓
[Deterministic rules, exact lookups]           ← Genesis
```

The movement is **upward and outward**: the differentiating layer is migrating from "we trained a
classifier" to "we configured someone else's", and a parallel local/self-hosted track is
commoditizing underneath it. Strategic meaning: a decision-routing capability bought this year is
most likely a configuration, not an asset. What compounds is the **trail** — question schema
version, confidence, route, fallback, per decision — because that is what makes the next
threshold a config change.

## 3. Future Predictions (next 5 years)

**PESTLE.** *Political/legal*: audit-grade decision provenance becomes table stakes for
agentic systems in regulated verticals, which pushes every routing layer toward
reversible, logged, shadow-mode rollouts (Floopy's shape: run in parallel, diff against
baseline, promote by manual flip, one-call rollback). *Economic*: inference cost per decision
keeps falling toward free-output models, so the justification for a decision layer stops being
"cheap" and becomes "**auditable and replayable**" — a much more durable reason. *Technological*:
per-request rubric evaluation in CI and on production traces becomes normal, powered by the
variance advantage rather than the cost advantage. *Social*: the "ask an LLM to classify" pattern
loses status the way hand-rolled schemas did.

**Foresight.** Strong signal: composite scoring with preserved raw dimensions — the
recommendation to keep the per-dimension answers, the weight version and the question schema
rather than only the final 0.82 — is a blueprint for how agent artifacts get annotated with
machine-readable provenance. Weak signal: decision models as *authorizers* stay out of scope;
every source in this survey puts permissions in code and treats confidence as a signal, never as
permission.

**Delphi.** The consensus projection is a three-layer split — planner (frontier LLM), decision
layer (typed classifier), side-effect executor (code plus policy) — with confidence-gated
escalation as the hinge. Consensus is weakest on whether a single vendor's model survives, and
strong on the abstraction: the System One adapter exists precisely so the interface outlives any
one provider.

**Wardley.** Where the four candidate decisions land over five years:

```
User state
  ↓
[Semantic predicates — "is this risky?", "is this worth a spike?"]  ← stays bespoke
  ↓
[Sequence/dependency reasoning — topological order]                  ← fully commoditized
  ↓
[Counting, ordering, exact lookups]                                  ← was never a model job
  ↓
Genesis
```

## 4. Adjudication: the four decisions the request names

| Decision | Primitive | Who decides today | Can rules answer it? | Verdict |
|---|---|---|---|---|
| **What is risky** | `score` (1–5 rubric) | Nobody. Prose in a plan that has never been produced | Partly — complexity/novelty/legacy-risk are separable predicates | **Strongest candidate, blocked** |
| **What deserves a spike** | `noul` | The planner subagent, inside one full LLM turn | No — "uncertainty is fundamental" is genuinely semantic | **Best candidate on merit, blocked, and the only one with execution consequence** |
| **Order of scopes** | `choice`/`score` | `lib/scope-order.mjs` — topological sort of `dependsOn` | **Yes, completely** | **Reject** |
| **Order of tasks** | `score` | `dependsOn` graph + `STATUS_RANK` at runtime | **Yes, completely** | **Reject as execution; advisory at most** |

**Risk.** A `score` point fits exactly: the 1–5 table becomes the `criteria` levels, rewritten as
*situations* rather than degrees; state is compact (title, outcome, in/out, touched files,
dependency count) which respects `DECISION_STATE_MAX_CHARS`; and the transport already
normalizes `score` (`lib/decision-api.mjs:141-164`) though no registered point emits it — so this
is the smallest technical increment on the list. Blocked on two things: the `risk` field does not
exist in any schema (`scope-map.json` and `scope-batch.json` are both
`additionalProperties: false`), and that schema is **sync-owned** — the fix is upstream in
`calionauta/stelow`, not a local edit. And with `n = 0` plans there is no data to set `routeAt` on.

**Spike-worthiness.** The only candidate with real execution consequence: `[TYPE] spike` with no
`[EXECUTOR]` routes to scout + researcher instead of the normal worker loop, changes the DoD, and
consumes a goal slot. That asymmetry — a needless spike costs a research goal; a missing spike
becomes rework — argues for the three-band shape already used by `auto-continue`: mark `[spike]`
above a high floor, **ask a live question in the middle band**, leave it as a feature below a low
floor. The middle band must be a live question, not a silent promotion, or the host manufactures
exactly the phantom wait `AGENTS.md` forbids. Note also that a spike judgment needs codebase
knowledge, and decision models measurably degrade on state carrying irrelevant detail.

**Scope order and task order — reject.** `lib/scope-order.mjs` already sorts topologically from
`dependsOn` (cycles preserved rather than deadlocking, ties keeping `state.md` order), and
`STATUS_RANK` already re-orders tasks at runtime by status. A router here would be advisory on
an artifact whose order is already deterministically enforced — which is why
`docs/decision-routing.md:85-87` rejected *scope-map challenge* as advisory theater. Independently,
the Jev documentation says the model is "unreliable at arithmetic, counting"; ordering is
counting. The request's intuition that ordering is a decision point is exactly the one the
evidence rules out.

## 5. Where decision routing *would* pay off — the unclaimed win

`docs/decision-routing.md:66-73` already names the largest unclaimed win: *"No router point sits
at a stage transition or artifact acceptance"* — all four registered points are at the edges
(card creation, idle resume, inbox tick, explicit CLI). Named here, with a concrete shape for
this pipeline, in the order the pipeline actually reaches them:

1. **Does this plan have real acceptance criteria per scope?** (`noul`, per scope, read-only.)
   This is the proven `artifact-criteria` pattern — atomic judgment per item, against a real
   artifact, degrading to `unverifiable` below the floor, gating nothing. It is the closest
   existing precedent in the codebase.
2. **Which verify command applies to this scope?** (`choice` over an allowlist, derived from
   `target_files` in `scope-batch.json`.) This is "route and fill arguments together": the route
   and its typed parameters come from one call, and the allowlist is host config the model cannot
   widen.
3. **Is this scope's DoD met, or does it need review?** (`noul`, at artifact acceptance, with the
   three confidence bands and human review for irreversible outcomes.)

Each is read-only, replayable, has a bounded question schema, and — critically — **has a
consumer**, which is the test `scope-map challenge` failed.

The sequencing constraint is uncomfortable but plain: none of these can be calibrated while
`planning: 0` executions. The binding prerequisite is corpus, not capability.

## 6. Recommendation

**Do not add a decision point yet. Add a corpus.**

The one action that changes the answer is a single `build`-intent card taken all the way through
`scope → interface → selection → planning → execution → verification`, producing the first real
`spec-tech_v1.md` with `Risk Score` and `[TYPE]` blocks filled. That yields the labeled rows
without which `routeAt` is a guess, makes the unexecuted `>= 4 → front-load` and
`>= 5 → spike` rules observable, and gives the `artifact-criteria` pattern something to be tested
against. It is upstream-free and needs no new schema.

Then, in order:

- **Upstream (unblocks risk and spike):** add `risk` (1–5) and `type` to the scope contract in
  `calionauta/stelow`, then **execute** the existing rule as ingest validation. Note the framing
  this analysis recommends: this is *deterministic* validation of a machine field, not a model
  call. Per the recon, it is upstream-first (release + `repository_dispatch stelow-release`);
  a local edit to `skills/` or `data/stelow-assets/` is reverted at the next sync.
- **Then `spike-worthy` (`noul`, three bands, middle band = live question).** Highest value per
  decision because it is the only one that changes execution. Own `thresholdLabel`, per
  `decision-routing.md:40-58` — the direction is not uniform, so no shared key.
- **Then `scope-risk` (`score`).** Smallest increment technically (normalizer, providers and
  threshold UI all exist), but advisory until the field is machine-readable.
- **Never, absent counter-evidence: scope order, task order.**
- **Recording the model per point.** `lib/decision-api.mjs:173` already parses `body.model` but
  persists nothing per point. The TypeSafe guidance to pin the version thresholds were tuned
  against is cheap insurance and applies to every point above.

## 7. What would falsify this

- If the first real `spec-tech_v1.md` shows `Risk Score` and `[TYPE]` are consistently filled and
  that deterministic validation of `>= 5 → spike` fires on real plans, the risk/spike points
  become cheap accelerants rather than load-bearing.
- If a Jev-comparable model reaches sub-50 ms at equal accuracy, the latency argument for
  deterministic-first weakens; the audit-trail argument does not.
- If `dependsOn` turns out to be frequently wrong or missing in real scope maps, scope order
  reopens — and it would reopen as a *data quality* problem in the map, not as a routing problem.
- If a router on real plans disagreed with the planner's own risk judgment often enough to be
  worth adjudicating, that disagreement is the label set, and it is worth measuring either way.

## 8. Sources

- TypeSafe AI, *Introducing System One Models & Jev*, 2026-09-15 — https://typesafe.ai/blog/introducing-system-one-models-and-jev
- OpenRouter, *Jev vs LLM: When to Use Each*, 2026-09-19 — https://openrouter.ai/blog/tutorials/jev-vs-llm-when-to-use-each/
- WEC Docs, *Jev: a decision model you put in front of your LLMs*, 2026-09-23 — https://development-wec.wiline.com/docs/news/router-classifier-tax-system-one-jev/
- Regolo, *Jev and system one models: benchmarks, open-source alternatives*, 2026-09-23 — https://regolo.ai/jev-and-system-one-models-benchmarks-open-source-alternatives-and-when-to-use-them/
- Bloss0m, *Jev in the Agent Runtime: Confidence-Gated Routing, Fan-Out, and Community Experiments*, 2026-09-18 — https://www.bloss0m.com/en/blog/108-jev-confidence-gated-agent-runtime/
- WhatAI Blog, *Jev AI Explained: System One Decisions vs LLMs*, 2026-09-20 — https://whataidoinead.com/blog/jev-ai-explained-system-one-model
- vLLM Semantic Router (arXiv:2603.04444) — https://arxiv.org/html/2603.04444v1
- Zylos Research, *AI Agent Model Routing and Dynamic Model Selection*, 2026-03-02 — https://zylos.ai/research/2026-03-02-ai-agent-model-routing/
- AgentNotebook, *Agentic Workflow Routing: LLM Router in Python*, 2026-07-26 — https://www.agentnotebook.dev/tutorials/agentic-workflow-routing-python
- TypeSafe agent skill (read in recon) — https://jevtypesafeai.com/agent-skill
- Local: `docs/decision-routing.md`, `lib/decision-points.mjs`, `lib/decision-api.mjs`, `lib/scope-order.mjs`, `data/stelow-assets/schemas/{scope-map,scope-batch}.json`, `.stelow/*/sw-*/state.md`, `.stelow/2026-09-29/sw-card_oqm8gyae/plans/spec-product.md`
