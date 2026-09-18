# Phase 6 — Independent review, chat seals, Quality panel

## Status

Accepted design, not yet implemented. Deterministic gates (Phases 1–5) stay
the blocking layer; everything here is advisory/triage until a golden set
and measured agreement exist. Open decisions are marked [DECISION].

## 0. Evidence base

- LLM-as-judge 2026: self-preference is mechanistic (fluency/perplexity);
  swapping models without leaving the family only changes whose style wins.
  What works: different-lineage judge, binary criterion-level rubrics,
  quote-anchoring (verdict cites a verbatim span the harness verifies
  character-for-character), golden-set calibration with kappa (never raw
  agreement), pinned judge version, judge as regression floor — never the
  sole gate where a deterministic check exists (27/27 deterministic vs
  11/27 generic LLM reviewer in the cited study). Format bias dwarfs
  position bias: never ask a holistic "quality 1–10".
- Provenance UX: provenance over detection; three states
  (verified / edited / unverified — never binary); separate content item /
  generation record / review record / display label with a pure policy
  function mapping records to labels; progressive disclosure
  (chip → drawer → panel); disclosure ≠ approval; EU AI Act Art. 50
  transparency obligations apply since Aug 2026.
- BB SDK (verified): `threads.spawn` accepts a different
  `providerId`/`model`/`reasoningLevel` (cross-lineage reviewer needs no
  core change); `app.slots.messageDirective` lets plugins render
  `::name{attrs}` directives with RPC-validated React components
  (precedent: builtin `inline-vis`); `messageAction` slot, inbox events,
  card comments, and `app.tsx` panels are all plugin-owned surfaces.
- Stelow rules applied: deterministic code blocks, LLM opines (prompt is
  pointer, code is enforcer); fail-open on unreadable sources; pure `lib/`
  + node test per rule; one primary action per card; openable records;
  methodology upstream, enforcement in owned `lib/`; existing skill rule
  "don't trust the same model — audit with a different model".

## 1. Independent reviewer (`bb stelow review`, opt-in)

Opt-in means: nothing automatic, no band default, no silent fallback.
Invocation is always explicit — a human runs the command (future "Request
review" button) or the worker runs it only after a `bb stelow ask`
confirmation. The worker prompt recommends review; it never auto-runs it
(cost is opt-in at the interaction level too).

### Shift-left precondition (never spend on thin files)

`review` refuses when the deterministic `verify` does not pass
(research: readiness + rounds + substeps; explore: stage contract).
Review only ever sees structurally valid artifacts: worker writes →
free local `verify` → rewrite loop → PASS → optional paid review.
Refusal names the failing check, mirroring `verify` output.

### Shape

- New CLI verb `bb stelow review [--card <id>]`: spawns a reviewer thread
  via `threads.spawn` with the **review preset** (§4), input = original
  request + artifact contract + artifact content + deterministic
  `failures[]` + evidence list. No workspace writes (read-only reviewer).
- Reviewer returns ONLY a structured verdict, validated by shape:
  `{ verdict: pass | needs-revision | human-review, findings[] }` where
  each finding is `{ criterion, quote, verdict, repair }`.
  - `criterion`: one binary check derived from the artifact contract
    (e.g. "Top 10 holds 10 criteria with Score+Metrics").
  - `quote`: verbatim span from the artifact the verdict rests on; the
    host rejects findings whose quote is not a character-exact substring
    (fabricated quote = failed review run, not a FAIL verdict).
  - `repair`: objective, re-verifiable fix (feeds "Repair this artifact").
- The deterministic report is the rubric: the reviewer never re-derives
  counts the code already checked; it judges what code cannot
  (coherence, scope fit, usefulness, request adherence) and cites spans.
- Verdicts persist as `review-<turn>.md` in the card state dir and render
  in the Quality panel (§3). `done` never blocks on review; when a review
  exists, `done` appends its verdict to the completion record.

### Policy (initial, flag-gated off)

- Research with web evidence: review recommended (worker prompt suggests).
- Audits, critiques, tech plans: review recommended before `done`.
- Simple explore: review optional.
- Enforcement (blocking) only after: golden set + measured kappa +
  explicit owner approval. Never silently.

### Cost controls

- Binary verdicts, short structured outputs, low reasoning (§4).
- On-demand only; deterministic PASS with no flags never triggers a review.
- Review thread uses the review preset, never the card preset.

## 2. Chat seals (`::stelow-quality`)

### Mechanism

- Register `::stelow-quality` via `app.slots.messageDirective`, mirroring
  the `inline-vis` precedent: worker emits
  `::stelow-quality{card="<id>" artifact="<path>"}` in its closing message;
  the component resolves status through an RPC (`qualitySeal`) that
  re-runs the deterministic validation live — never trusts attributes.
- Display states (provenance, not truth): `verified` / `hypothesis-only` /
  `needs-revision` / `unverified` (no lastro divergente ou ausente).
  Chip → drawer (checks pass/fail, expected-vs-found, evidence, reviewer
  verdict when present). Copy states what was checked, never "true/correct".
- Scope: Stelow worker threads only. Common BB chats are untouched.

### Anti-forgery

- Seal without backing artifact, or backing artifact that fails
  revalidation, renders `unverified` — a first-class state, not an error.
- Stale seals: the RPC binds file content hash at render time; a rewritten
  artifact re-resolves on next render (same rule as content hashes for
  reviewed labels: review goes stale on edit).

## 3. Quality panel (card detail)

- Per-artifact section: overall status, applied contract, checks
  passed/failed, expected-vs-found counts, sources/coverage, reviewer
  verdict with repairs, evidence status.
- One primary action: "Repair this artifact" — resumes the worker with
  the failure list attached (existing resume path, no new lifecycle).
- Read-only first; aggregate metrics (fail rate, top codes, re-runs,
  time-to-quality) only after volume exists. Coordinate `app.tsx` edits
  with concurrent work; keep the section self-contained.

## 4. Review preset [DECISION: lineage + budget owner]

One dedicated preset, minimal, designated explicitly (never inherited):

- Stored as a singleton designation (`review_preset` table, FK-cascade on
  delete like `stage_presets`), managed by `getReviewPreset` /
  `assignReviewPreset` RPCs. Deleting the preset clears the designation.
- The preset modal (Manage presets) shows the designation as a badge plus
  an explainer: when it fires (only via explicit `bb stelow review`),
  why it must be another model family (self-preference is mechanistic),
  and that nothing runs automatically. UI binds the new RPCs; server
  ships first so the contract is stable.
- Different model family from the worker default (anti self-preference),
  on an already-configured provider route (no new vendor).
- Low reasoning level; short structured outputs only.
- Restrictive permission (read-only reviewer; never `full`).
- Never a band default (no invisible per-card tax); selected explicitly.
- `review` refuses when no review preset is designated — with setup
  instructions — and NEVER falls back to the card/worker preset (silent
  fallback would recreate self-review while charging for it).

One dedicated preset, minimal:

- Different model family from the worker default (anti self-preference),
  on an already-configured provider route (no new vendor).
- Low reasoning level; short structured outputs only.
- Restrictive permission (read-only reviewer; never `full`).
- Never a band default (no invisible per-card tax); selected explicitly
  by `bb stelow review` or a future review policy flag.

## 5. Rollout

1. Reviewer command + verdict persistence (no enforcement, no UI beyond
   the drawer data shape).
2. `::stelow-quality` directive + `qualitySeal` RPC.
3. Quality panel section + Repair action.
4. Golden set + kappa measurement on reviewer verdicts vs human spot
   checks; publish the agreement rate with the verdict.
5. Only then: discuss blocking policy for high-risk types, with the
   measured agreement as the confidence interval — never before.

## 6. Acceptance

- No deterministic gate depends on any LLM output.
- Every seal resolves from revalidation, with `unverified` as an honest
  state; no seal claims truth, only checked provenance.
- Reviewer findings without exact quotes are rejected by shape.
- Judge preset pinned and versioned; changing it invalidates trend
  comparisons until re-baselined on the golden set.
- `npm run typecheck`, `npm test`, `npm run build:reload` green;
  `FEATURES.md` + upstream blueprint updated per user-facing change.
