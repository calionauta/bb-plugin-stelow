# Research Architecture Implementation Plan

## Goal

Make Stelow research preserve each strategy's faithful native output while providing one clean, deterministic interface for review and delivery fan-out.

The plugin must not flatten strategy-specific work into a generic research summary. It must retain the strategy's native result, expose every independently generated output, and maintain a short machine-readable research index for opportunities that the user can turn into build cards.

## Decisions

### 1. Canonical index: `research-index.md`

Replace `brief.md` completely. Do not retain a legacy read path.

`research-index.md` is the canonical operational index, not the canonical research output. It has exactly three purposes:

1. Concise cross-strategy synthesis.
2. Deterministic, selectable delivery opportunities.
3. An index of every generated native output.

Proposed shape:

```md
# Research index: <research name>

## Summary
<concise cross-strategy synthesis, evidence limits, and key decisions>

## Outputs
| Strategy | Round | Output | Path | Notes |
| --- | --- | --- | --- | --- |
| Jobs to be done | 1 | Job map steps | `rounds/job-to-be-done-r1-job-map-steps-<stamp>.md` | Full native output |

## Opportunities
### <Strategy label> — <YYYY-MM-DD>
- [ ] <opportunity title> — <one-line reason it matters>
```

The `## Opportunities` checkboxes are a deterministic queue for fan-out. They are not task completion state and must never be checked by a research worker.

### 2. Native strategy outputs: source of truth

Every research run writes the full native playbook result into a primary round file:

```text
rounds/<strategy>-r<round>-<stamp>.md
```

Examples:

```text
rounds/pricing-r1-20260907-1430.md
rounds/market-analysis-r2-20260907-1430.md
```

The primary round exists for every strategy and every round.

### 3. Independent suboutputs

A strategy that has independently meaningful prompts, variants, or sequential substeps writes one file per output:

```text
rounds/<strategy>-r<round>-<substep>-<stamp>.md
```

Examples:

```text
rounds/job-to-be-done-r1-contextual-segmentation-20260907-1430.md
rounds/job-to-be-done-r1-job-map-steps-20260907-1430.md
```

The strategy's primary round file remains an integrated native output or a table of contents linking to those files. It must not replace the suboutputs.

All suboutput artifacts are registered in `state.md` and listed in `research-index.md`.

### 4. Declarative output contracts

The research strategy registry is the single source of truth for behavior required by the plugin. Every strategy specifies an output contract:

- `single`: one native integrated result per round.
- `variant`: one selected native variant per round; mutually exclusive variants are not all run automatically.
- `composite`: a full run has named independently persisted suboutputs; targeted runs have only the selected output.

Initial contracts:

| Strategy | Contract | Output rule |
| --- | --- | --- |
| business-models | single | Integrated recommendation and model math. |
| evolutionary | single | One structured seven-part diagnostic. |
| job-to-be-done | composite | Targeted prompt or explicit full 10-prompt mapping. |
| promotions | single | Integrated promotion calendar. |
| market-analysis | variant | General Deep Analysis or Weekly Intelligence Canvas. |
| marketplace | single | Integrated ordered tactics. |
| open-source | single | Thesis, moat, experiment. |
| opportunity-mapping | single | Required integrated opportunity map. |
| paywall | single | Integrated funnel specification. |
| pricing | single | Integrated pricing recommendation. |
| ads | single | Integrated channel plan. |
| discovery | single | Selected discovery-stage/experiment output; do not force all eight stages. |
| product-health | single | Integrated tension board. |
| trust-building | single | Integrated fear-to-guarantee mapping. |

Only JTBD currently requires mandatory independently persisted suboutputs in its explicit full mode. Future composite strategies add their prompt IDs to the registry; the plugin then validates presence rather than relying on model interpretation.

### 5. JTBD modes and outputs

The worker must ask when the request does not already make the intent clear:

- **Full JTBD mapping**: run all ten prompts sequentially and persist all outputs.
- **Targeted JTBD analysis**: select exactly one of the ten prompts.
- **Recommend**: agent chooses based on available context and records the assumption.

Full mapping output files:

1. `contextual-segmentation`
2. `thinking-styles`
3. `jtbd-discovery`
4. `competitors`
5. `job-actors`
6. `situational-variables`
7. `functional-needs`
8. `financial-needs`
9. `emotional-social-jobs`
10. `job-map-steps`

Each uses the common strategy/round/stamp filename convention.

### 6. Fan-out behavior

A checkbox represents one independently actionable opportunity and maps to one build card.

The existing UI multi-select action can create multiple build cards in one operation. It creates one card per selected checkbox, then marks only those exact checkboxes as selected.

A worker must never create cards merely from ambiguous prose. For a user comment such as “create a build card for X”:

1. Worker resolves X against `research-index.md` opportunities and native outputs.
2. If scope/target is ambiguous, it asks a structured confirmation using the portable Stelow ask contract.
3. Once confirmed, worker invokes an explicit host integration command/RPC to fan out the resolved opportunity.
4. Server creates the delivery card, updates the exact checkbox, and appends an audit comment.

The new direct fan-out capability must accept only an existing opportunity ID. It must not parse natural language, invent an opportunity, or bypass confirmation.

### 7. Portable user-question contract

The upstream Stelow `references/cli-tools/ask.md` remains the canonical portable contract:

1. Use host-native `ask_user_question` when it is available.
2. Otherwise use `stelow ask` file handoff.
3. In BB, the plugin maps the contract to `bb stelow ask` and preserves the live answerable card UI.
4. If neither exists, use enumerated chat fallback.

Product strategy skills must reference this shared contract; they must not name an unspecified generic `question` API as their execution mechanism.

Research orchestration must:

- reconstruct available context before asking;
- ask only when information materially changes the strategy output;
- batch independent questions;
- ask dependent questions sequentially;
- include a recommended option;
- record assumptions when it proceeds without asking.

Strategy-specific input contracts drive questions. Examples:

- JTBD: targeted prompt vs full mapping, if unclear.
- Market analysis: variant, topic, geography.
- Opportunity mapping: core problem required; ecosystem inputs optional.
- Discovery: intended stage or recommend-from-context.

Research does not reuse delivery appetite as a quality or evidence budget.

### 8. Web research contract and last30days

Add one shared upstream document: `references/cli-tools/web-research.md`.

It defines a layered research procedure:

1. Use the host's native web-search capability as the baseline.
2. Use primary sources and cite evidence in the native strategy output.
3. When current community sentiment, recent launches, current competitor moves, or last-30-day signals materially matter, invoke `last30days` as a complementary signal source.
4. Record source coverage and limitations. A missing/rate-limited connector is partial coverage, never proof of absence.
5. Do not fabricate findings when research tools are unavailable.

Strategies that require web evidence reference this one shared contract rather than duplicating instructions or naming `last30days` individually. Initially: market analysis, JTBD, discovery, opportunity mapping, ads, promotions, pricing, paywall, trust building, marketplace, and open-source when their request depends on current public signals.

`last30days` is installed by the Stelow installer as an optional, best-effort capability:

- install using `npx skills add mvanhorn/last30days-skill`;
- do not require credentials;
- run its doctor after install;
- never fail Stelow installation if it cannot install or sources are unavailable;
- describe free/no-credential operation as partial coverage, not guaranteed complete coverage.

The installer asks for confirmation rather than performing a hidden global installation.

## Implementation Work

### A. Upstream Stelow repository

1. Add the shared `web-research.md` CLI-tool contract to the upstream workflow orchestrator.
2. Extend the CLI tools README to expose it.
3. Update product strategy skills that need external evidence to reference the shared contract.
4. Update strategy interaction guidance to reference the shared ask contract, preserving standalone behavior.
5. Make JTBD explicitly offer Full Mapping, targeted prompts, and recommendation; use the portable ask contract.
6. Add a confirmed optional `last30days` installation hook to `install.sh`.
7. Add/upate upstream tests for links, installation behavior, and skill contract consistency.
8. Do not edit `skills/` in the plugin checkout directly; plugin vendored skills are synced from upstream.

### B. bb-plugin-stelow repository

1. Rename code and artifacts from `brief` to `research-index` throughout, with no legacy reader.
2. Rename deterministic parser/readiness modules to describe the research index responsibility.
3. Update worker prompt to generate the exact index format and register index plus suboutputs.
4. Update `research-rounds` naming/parsing for `strategy-rN-substep-stamp` filenames.
5. Add output contracts to `RESEARCH_STRATEGIES`.
6. Validate expected composite suboutputs before marking research ready; report missing output explicitly.
7. Update artifact grouping, card RPCs, UI labels and round display.
8. Add direct, opportunity-ID-only worker fan-out command/RPC after structured confirmation.
9. Update unit tests for index parsing, readiness, round filename parsing, strategy contracts and direct fan-out.
10. Update `FEATURES.md` because this changes a user-facing feature.
11. Run `npm run typecheck`, `npm test`, and `npm run build:reload`.
12. Confirm built `dist/` contains the renamed feature before handoff.

## Acceptance Criteria

- No code, test, UI copy, artifact, or feature description calls the canonical artifact `brief.md`.
- Every new research card always has `research-index.md` and a primary native round file.
- The index parses only `## Opportunities` checkboxes for fan-out and lists every generated output under `## Outputs`.
- JTBD full mapping produces exactly ten named suboutput files plus its primary round file.
- Targeted JTBD produces only the selected native suboutput plus its primary round file.
- A strategy contract determines whether suboutput validation is needed.
- A worker can fan out only a known opportunity after a confirmed structured user answer.
- Research questions use the portable ask contract and render in the BB card.
- Web-research guidance is centralized upstream; `last30days` is optional best effort and is not duplicated across strategy skills.
- Plugin tests, typecheck and build/reload pass.
