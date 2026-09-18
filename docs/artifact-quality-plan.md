# Artifact quality plan — from 200-char validity to verifiable depth

## Implementation status (task list)

- [x] Phase 0 — incident evidence (`thr_tz3xaiq73p`: Stelow, not Ponytail; 10 thin substeps passed `verify`).
- [x] Phase 1 — JTBD presence gate: `substepPathsForRound`, `findInvalidSubsteps`, integrity/verify/done wiring, per-item FAIL lines, scoping ask, inbox names slug+reason with per-substep dedupe keys.
- [x] Phase 2 — JTBD depth contracts: upstream Completeness contracts on all ten prompts (`stelow v0.62.0-alpha`); `lib/artifact-contracts.mjs` + `lib/artifact-validation.mjs`; `needs-depth` in verify/done/inbox. Proven: all 10 incident files fail with named reasons.
- [x] Phase 3 — all-strategy contracts: upstream contracts on the remaining thirteen skills (`stelow v0.63.0-alpha`); `STRATEGY_CONTRACTS` (14 primaries; market-analysis + paywall pass on ANY selected variant via `validateVariant`); primary depth in `researchRoundIntegrity`.
- [x] Phase 4 — Explore + Build (same engine): `EXPLORE_CONTRACTS` for all 8 techniques (`stelow v0.64.0-alpha`); explore `verify`/`done`/inbox enforce depth; Build `done` validates recognized manifest documents via `contractForBuildArtifact` (audit.md/receipts/unknown never block). Gaps fixed in-flight: directory-beats-basename matcher precedence; prompt-contracts pin arity.
- [x] Phase 5 — evidence honesty: `lib/research-evidence.mjs` detects the worker's own web-unavailable declaration (EN/PT); `verify`/`done`/completion carry hypothesis-only, never "complete research". Scoping ask already enforced since Phase 1. Preset default unchanged (cost decision, flagged not made).
- [ ] Phase 6 (deferred, needs product decisions) — opt-in LLM reviewer (preset/budget/policy), chat-response seals, card Quality panel (UI; other session active in app.tsx).
- [ ] Phase 6 (deferred) — LLM reviewer, chat-response persistence + seals, card Quality panel.
- [ ] Rollout follow-ups — observe-mode metrics (fail rate, top codes, re-runs, time-to-quality); legacy cards stay `legacy / not contract-validated`.

## 0. Incident evidence (verified 2026-09-18)

Thread `thr_tz3xaiq73p` (project `proj_ttth6cvs5r`, card `card_o54iz123`,
request "criar produto de impacto social no brasil"):

- `originPluginId` is `stelow`, provider is `acp-opencode`. No Ponytail
  plugin is installed (`bb plugin list` shows `stelow@0.24.0`, no ponytail
  entry). Ponytail did not participate.
- Worker prompt is the Stelow research prompt (Steps 1–5 + `DONE_PROTOCOL`).
  Step 3b tells the worker the file "must hold your playbook output with
  real substance (200+ chars)" (`server.ts` research prompt builder).
- Result: 1 primary round file (~2100 words) + 10 JTBD substep files at
  177–284 words each + `research-index.md` (527 words). `verify` PASSed and
  the worker announced "Full Mapping JTBD em 12 arquivos, tudo marcado como
  hipótese (busca web indisponível na sessão, registrado no index)".
- Spot check `job-to-be-done-functional-needs-r1-*.md`: 10 criterion names
  only, no per-criterion alternative, no composite-score breakdown
  (R/P/H/Inc/Inv), no speed/ease/consistency metrics, no summary table —
  all required by upstream
  `stelow-product-job-to-be-done/references/07-functional-needs.md`.
  `job-to-be-done-thinking-styles` has 4 styles; the playbook contract to
  pin down is upstream (count + Thought/Emotion/Personal-Rule table +
  functional/emotional/social jobs per style).
- `research-index.md` honestly records "ferramenta de busca web indisponível
  nesta sessão (3 tentativas canceladas)" and marks everything hypothesis.
  The failure is depth, not honesty: thin files passed a thin gate.

Root cause (three layers, all confirmed in code):

1. `lib/research-artifacts.mjs:22,39` — validity is `>= 200 chars +
   not-empty + not-mirroring-index`. Any 200-char file passes.
2. `lib/research-strategies.mjs:15` declares JTBD `composite` with 10
   substeps, and `missingSubsteps` exists — but `server.ts:researchRoundFiles`
   uses it only for display (`round.missing`), while the enforcing path
   (`researchRoundIntegrity` → `findInvalidRounds` → `researchReadiness` →
   `verify`/`done`) checks only the primary round file. Substeps are
   discovered visually, never gated.
3. The worker prompt teaches thinness ("200+ chars") and the broad request
   ran Full Mapping with no scoping ask and no web evidence, yet the output
   was allowed to read as a complete mapping.

## 1. Non-goals and constraints

- Never hand-edit `skills/` or `data/stelow`: both sync from upstream
  (`node scripts/sync-stelow-assets.mjs`) and are overwritten without
  warning. Methodology text is fixed upstream in `calionauta/stelow` and
  propagates; enforcement code lives in this repo under `lib/` + `tests/`.
- `data/product-strategies.json` is synced from upstream
  `product-strategies.json` (merged at `server.ts:101-108` over embedded
  contracts). The `single | variant | composite + substeps` shape stays
  upstream. Quantitative depth minima are enforcement data and belong in
  owned `lib/` (new module), not in vendored data.
- Follow repo rules: conventional commits (`fix:`/`feat:` for user-facing),
  `FEATURES.md` entry in the same commit, upstream blueprint
  (`docs/host-plugin-blueprint.md`) proposal for portable patterns,
  `npm run typecheck` + `npm test` green, `npm run build:reload`, confirm
  the change in `dist/` (`grep dist/`).
- KISS/YAGNI/LoB apply. No per-skill bespoke validators; one generic
  engine, data-driven contracts.

## 2. Architecture: one generic engine, data-driven contracts

New owned modules (all pure, unit-tested, no I/O):

- `lib/artifact-contracts.mjs` — declarative contract table. Each entry:
  `{ strategyId | stageId, artifactId, kind, requiredSections[],
  minimumWords, minimumItems {section: n}, requiredTables[],
  evidencePolicy }`. JTBD ships 10 entries; other strategies ship 1 each;
  explore/build stages ship 1 each as they migrate.
- `lib/artifact-validation.mjs` — deterministic checkers over markdown
  text: section presence (verbatim headings), word count, item counts per
  section (bullets/numbered rows/table rows), table presence + min rows,
  appendix presence (`Research-led Draft Bets` when evidence was used or
  missing). Returns `{ pass, failures[] }` with machine-readable codes
  (`missing-section`, `too-few-items`, `thin`, `missing-table`,
  `missing-evidence-appendix`).
- `lib/artifact-quality-report.mjs` — renders per-artifact and per-round
  verdicts shared by `verify` text/JSON, `done` refusal, sync inbox error,
  and card RPC (`researchIndex.rounds[].files[].quality`).

Verdict levels (structural gate only; no LLM judgment in v1):

- `verified` — contract met.
- `needs-revision` — structural failure; blocks `verify`/`done`.
- `hypothesis-only` — structurally valid but produced without required
  evidence (web unavailable, no interviews); allowed to exist, never
  announced as complete research.
- Legacy cards: `legacy / not contract-validated` (no retroactive fail).

Evidence policy (deterministic, no model grading):

- Worker prompt already requires: no web tools → say so in the index,
  never fabricate. Enforcement: when the index declares web unavailable,
  every round in that card is capped at `hypothesis-only`; `done` still
  passes structurally but the completion comment + card banner read
  "hypothesis — requires validation", never "pesquisa completa".
- When research contributed, the `Research-led Draft Bets` appendix with
  Bet / Why-now / Evidence-origin-bias / Confidence / Next-validation must
  be present or the artifact fails with `missing-evidence-appendix`.

LLM reviewer and chat-response persistence are explicitly deferred to
Phase 6 (highest cost, lowest determinism). Nothing in Phases 1–5 depends
on them.

## 3. Phase 1 — JTBD vertical slice: enforce what we already declare (blocking)

Goal: `verify`/`done` fail on thin or missing JTBD substeps with a named fix.

Changes:

1. `lib/research-rounds.mjs` — add `substepHistory(history, manifest)`:
   join `history` (primary files) with `state.md` manifest blocks
   (`stage: research`, same strategy + roundNo + stamp via `parseRoundPath`)
   into `[{ n, strategyId, primary, substeps: [{ slug, path }] }]`.
2. `lib/research-artifacts.mjs` — add
   `findInvalidSubsteps(substepHistory, readContent, indexBlob)` returning
   `[{ n, slug, reason }]` where reason is `missing | thin | mirrors-index`.
   A substep is valid under the same `isValidRoundContent` predicate
   (keeps Phase 1 small; depth minima arrive in Phase 2).
3. `server.ts:researchRoundIntegrity` — also scan substeps; return includes
   them (`{ n, label }` where label is `Round N — <strategy> (<slug>)`).
   `researchReadiness`, `verify`, and `done` pick this up with zero new
   branches (they already consume the invalid list).
4. `lib/research-artifacts.mjs:researchVerifyText` — render per-item lines:
   `FAIL round 1 (Jobs to be done — functional-needs): missing/thin/mirrors
   index — rewrite it, then run verify again.` Keep exit codes.
5. Worker prompt (`server.ts` research prompt, Step 3b): replace "200+
   chars" with "the playbook's full result VERBATIM — every prompt's
   required sections, items, tables, and scores; the host validates each
   substep file and names the failing check". Add: broad request + Full
   Mapping intent + missing audience/problem/geography → `bb stelow ask`
   scoping first (Targeted vs Full vs Recommend); "proceed with hypotheses"
   stays available but yields `hypothesis-only`.
6. `researchRoundFiles` card display: `round.missing` stays; add per-file
   `status: ready | pending` from the same predicate so UI and gate agree.

Tests (extend, don't fork):

- `tests/research-artifacts.test.mjs` — substep invalid list: missing file,
  thin file, mirror file, all-valid pass.
- `tests/research-rounds.test.mjs` — `substepHistory` join: stamp mismatch
  ignored, wrong strategy ignored, duplicate manifest path deduped.
- `tests/research-ready.test.mjs` — index-ready + primary-valid +
  substep-thin → not ready with named substep.
- `tests/research-strategies.test.mjs` — JTBD 10-substep fixture present +
  complete; `missingSubsteps` unchanged.

Acceptance: the incident's 10 thin files fail `verify` with 10 named lines;
a fixture with full substeps passes; `done` refuses until fixed.
`FEATURES.md` (Research track: composite enforcement) + typecheck + full
`npm test` + `build:reload` + `dist/` grep.

## 4. Phase 2 — JTBD depth contracts (blocking minima, still deterministic)

Goal: a 250-word file with the right filename stops passing.

Upstream first (separate commits in the stelow checkout, then sync):

- Pin exact countable minima next to each of the 10 reference prompts
  (words + items + tables). Example shape (numbers finalized while reading
  each reference; below are starting points from the incident, not the
  final contract):
  - `contextual-segmentation`: 20 initial candidates, up to 10 detailed
    (market, justification, factors, outcomes, constraints); min 800 words.
  - `thinking-styles`: N styles per playbook (confirm 5 vs observed 4),
    each with Thought/Emotion/Personal-Rule table + functional/emotional/
    social jobs; min words.
  - `functional-needs`: 10 criteria, each with alternative, score breakdown,
    speed/ease/consistency metrics, current solutions; closing 2-column
    summary table.
  - `financial-needs`: 30 raw criteria, top 20 detailed (same per-item
    shape as functional).
  - `job-map-steps`: 6 mandatory stages, steps in each, first-person
    wording check (deterministic: stage headings present).
- Keep prose in `references/`; add the numbers to the same files so the
  worker reads them and the contract table cites them.

Plugin (owned):

- Fill `lib/artifact-contracts.mjs` with the 10 JTBD entries mirroring the
  upstream numbers (plugin cites upstream file + line per entry).
- `lib/artifact-validation.mjs` checks each substep file against its entry;
  failures name expected-vs-found counts (`expected 10 detailed criteria,
  found 3 — missing Score/Metrics in 7`).
- Wire into `findInvalidSubsteps` (Phase 1 seam): reason gains
  `needs-depth` with the validator's failure list; `verify`/`done`/inbox
  render it unchanged.
- Worker prompt: replace "MAXIMUM depth" with the rendered contract
  ("10 criteria with score and metrics" — testable, not "maximum").

Tests: one fixture per JTBD substep (pass) + one deliberately thin fixture
per substep (fail with the right code). Mutation-killing: each test must
fail if its check is stubbed to pass.

Acceptance: incident fixtures fail on counts, not just chars; full fixtures
pass; no other strategy's behavior changes.

## 5. Phase 3 — generalize to every research strategy (no new engine)

- Add one contract entry per `single` strategy (primary file only) and per
  `variant` strategy (selected variant file). Minima stay small and honest
  (sections + min words + key tables); do not invent JTBD-level rigor where
  the playbook promises an integrated recommendation.
- `missingSubsteps` already returns `[]` for non-composite; validation
  reuses the same path. `market-analysis` variant: validate only the
  selected variant file, never demand both.
- Rollout per strategy behind the same `verify`/`done` seam; tests per
  strategy (pass + thin fixtures).

## 6. Phase 4 — Explore + Build artifacts (same engine, new entries)

- Explore: one entry per stage (`explore-<stage>.md`): required sections +
  min words. Reuses `exploreVerifyReport` seam.
- Build: entries for plans, Shape Up, interface alternatives, testing
  strategy, UX/architecture/execution critiques, audit receipt shape
  (sections only — test-run and Git evidence keep their existing dedicated
  gates in `lib/audit-verification.mjs` / `lib/audit-receipt.mjs`, not the
  generic engine).
- `done` for build keeps its existing order (audit stage → tests →
  receipt → trail); generic contract failures append as named items.

## 7. Phase 5 — evidence honesty + scoping asks (prompt + status, small code)

- Web-unavailable → `hypothesis-only` cap (Phase 2 verdict level): card
  banner, `verify` stdout, and `done` completion comment all carry it;
  inbox copy never says "pesquisa completa".
- Scoping ask before broad Full Mapping (audience, problem/job, geography,
  mode): implement as worker-prompt contract + `ask` (no new state
  machine; refusal-with-redirect rule already requires valid exits).
- Preset note: research cards default to a capable preset; document the
  band default change in `FEATURES.md` if touched. No silent preset
  mutation on existing cards (stale-preset rule stands).

## 8. Phase 6 — deferred: reviewer, chat responses, Quality panel (do last)

- Optional LLM quality review (separate preset, never self-review):
  input = request + contract + artifact + structural report + evidence
  list; output = `{ pass | needs-revision | human-review, failures[],
  repairs[] }`. Recommended for research-with-evidence, required before
  `done` for audits/critiques/tech plans, optional for simple explore.
  Gated behind a flag; off by default until Phases 1–5 are green.
- Chat responses that deliver analysis: persist `response-<turn>.md`,
  validate against a `chat-response` entry, show verified/hypothesis-only/
  needs-revision/invalid seal. Out of scope for non-Stelow BB chats.
- Card Quality panel per artifact: status, contract, passed/failed checks,
  expected-vs-found, sources, reviewer verdict, "Repair this artifact"
  (reprompt with failures attached).

## 9. Migration and rollout

1. Land engine + JTBD presence gate (Phase 1) in observe mode first if
   risk demands: report-only line in `verify --json`, blocking in the next
   commit. Default: blocking for new rounds only.
2. Old cards: never retro-fail. Display `legacy / not contract-validated`.
3. Metrics to watch: verify fail rate, top failure codes, re-runs to green,
   time-to-quality per strategy.
4. Each phase ships as: `fix:`/`feat:` commit + `FEATURES.md` + tests +
   `typecheck` + `npm test` + `build:reload` + `dist/` grep + upstream
   blueprint proposal where a portable pattern changed.

## 10. Acceptance (whole plan)

- No Stelow artifact passes on 200 chars alone; every mandatory substep is
  registered and individually validated.
- `verify`/`done` name the file, the requirement, and expected-vs-found.
- Web-cancelled research yields `hypothesis-only`, never "complete".
- Every document-producing skill has an explicit, verifiable contract entry
  or is listed as unmigrated.
- `npm run typecheck`, `npm test`, `npm run build:reload` green;
  `FEATURES.md` + upstream blueprint updated.
