# Interface selection contract — `contrast.json` → `interface-pick`

Maintainer-only. Methodology lives upstream (`stelow` repo); this file pins
the owned seam between the two stages so they cannot drift apart again.

## The seam

| Side | Owner | Artifact |
|---|---|---|
| `interface` stage | `stelow-workflow-interface-contrast` (recipe `interface-contrast`) | `interfaces/contrast.json` + readable `interfaces/*.md` rendering |
| `selection` stage | orchestrator (`stages.yaml` questions `interface-pick` / `interface-pick-auto`) | `interfaces/selected-interface.md` |
| Mapping between them | `lib/interface-pick-options.mjs` (`contrastPickOptions`) | ask options `{ label, description, preview, artifact }` |

The `interface` stage always runs on `feature` / `new-product` (never in any
review-mode `skipped` list — see `lib/stage-skips.mjs`). The `interface`
review gate decides only WHO picks: human structured ask (`interface-pick`)
when selected, agent-recorded receipt (`interface-pick-auto`) otherwise.

## Mapping rules

- Pickable only for routes `interface-refinement` / `lean-single-proposal`
  with `briefStatus: generation-ready` and `disposition: continue`.
  Every other route refuses with a named reason and the route-table
  destination (e.g. `stop-and-name-decision` → `human`,
  `existing-interface-no-comparison` → refuse naming `adopt-existing`).
- Invalid receipts refuse with the validator's `issues`, never a pick.
- Per option: `label` = option `id` verbatim (over 60 chars refuses the
  whole receipt — fail-closed, never truncate); `description` = primary
  value + scope coverage (served/friction scope IDs with notes) or an
  explicit no-map statement; `preview` ≤ 15 rows built ONLY from receipt
  fields (decision question, primary value, related values, coverage,
  criteria) — never an invented wireframe; `artifact` = the readable
  `interfaces/interfaces.md` rendering (caller-supplied path allowed).
- No recommendation field: authority lives with the decider (human answer
  vs agent disposition recorded via `stelow decide`), never in the mapping.

## Seal routing (quality gate on the recorded pick)

`contractForBuildArtifact` (`lib/explore-contracts.mjs`) routes build
`selected-interface.md` by content, because the two pick shapes need
different floors: proposal-shaped picks (carry `Breadboarding` / `Work
Pattern` sections) keep the `interface-alternatives` contract (800 words,
proposal sections, ASCII), while contrast picks meet the new
`interface-selection` contract (120-word floor, `selected_by:` authority
record, ref `stages/interface-selection.md`). Before this, the single
mapping validated every pick against the proposal contract and stamped
"missing or thin" on each contrast pick.

## What this does NOT cover (upstream-owned, now fixed)

- Upstream `calionauta/stelow` branch `fix-interface-pick-contract`
  (commit `a16a858`, pinned in `data/stelow-source.json`): the
  `interface` / `int-gate` prose in the orchestrator `SKILL.md` now routes
  to `interface-contrast` + the `visual_review` gate, `ask-patterns.md`
  Pattern 2 reads `contrast.json` options (breadth proposals live in
  Pattern 2A, Explore-only), new `stages/interface-selection.md` owns the
  pick (`selection` playbook points at it; `select` reclaimed
  `stages/selection.md`), and shape-up / plan-critique / tech-planning /
  architecture-alternatives escalate to `interface-contrast` while
  `interface-alternatives` banners itself Explore-only. This contract is
  the owned implementation of that methodology.

## Tests

- `tests/interface-pick-options.test.mjs` (authored by a fresh context from
  the requirement alone): faithful mapping, all refusal routes, 60-char cap,
  15-row preview cap, no-wireframe, no-recommendation. Red-verified (fails
  with the module missing) before the implementation landed.
