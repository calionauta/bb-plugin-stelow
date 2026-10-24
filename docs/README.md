# Plugin docs — index and policy

User documentation is unified on the Stelow site
(`https://calionauta.github.io/stelow/`, source: `stelow` repo `docs/`).
This folder holds **maintainer-only** material plus the operator guides
that are still waiting for their canonical home. Do not add new
user-facing manuals here.

## Migrated to the site (stubs with canonical links)

These guides moved to `stelow/docs/plugin/`; each file below is now a
stub with the canonical URL plus an operator summary. Maintainer-only
sections stay inline where they existed.

- `github-issues.md` → `docs/plugin/github-issues/` (+ `automation-rules/`)
- `native-workflows.md` → `docs/plugin/native-workflows/`
- `decision-routing.md` → `docs/plugin/decision-routing/`
- `team-playbook.md` → `docs/plugin/team-playbook/`
- `interface-contrast.md` → `docs/plugin/scope-contracts/`

## Will move to `stelow/docs/plugin/` (user-canonical, still pending)

None pending — all operator guides migrated (see above).

## Stays here (maintainer-only, never public)

- `dependencies-and-diagrams.md` — what this plugin needs installed (with the
  command that verifies each), the two install symptoms that masquerade as code
  bugs, and how a Mermaid fence or `.mmd` artifact renders on read with the
  bundled `pele` (source is the artifact, a failed render falls back to it).
- `runtime-architecture.md` — server module map and lifecycle boundary.
- `runtime-integration-2026-09.md` — dated extraction record.
- `remaining-debt-audit.md` — phase record of a merged branch's size-debt
  repair; the live census is `scripts/source-debt.json` plus
  `tests/debt-baseline.test.mjs`, never a number restated there.
- `artifact-quality-plan.md`, `rendered-ui-audit.md` — quality audits.
- `staged-execution-continuity.md`, `restore-dogfood.md` — execution notes.
- `legacy-compat.md` — every backward-compatibility branch in the boot path,
  tracked for the v1 cleanup.
- `release-incidents.md` — war stories behind the `AGENTS.md` release rules
  (evidence, never rules).
- `release-runbook.md` — release procedures (cadence, squash typing,
  recovery, verification, frozen 0.3 line); the discipline stays in
  `AGENTS.md`.
- `skills-sync-notes.md` — sync triggers, pin provenance, upstream-first
  repair (failure modes and exact commands).
- `recipe-pilot-matrix.md`, `phase6-independent-review-plan.md`,
  `width1-sequential-pilot.md`, `research-architecture-implementation-plan.md`
  — plans and pilot records, kept for their measurements, not as behaviour.
- `model-tier-economics.md` — measured answer to "should Stelow adopt
  Prewalk?", plus the model-hint routing gap and the path-archaeology tail.
  Referenced from `FEATURES.md` (presets) and `rfc-worker-robustness.md`
  (fragility #6).
- `rfc-*.md` — proposals under discussion, not behavior.
- `audits/*.md` - the dated records as a class; `audits/README.md`
  enumerates them, so a new record needs no second list here.
- `audits/` — dated audit and evaluation records, deleted as a unit when stale.
  `2026-10-23-scope-6-record.md` covers the prompt cache economy of the
  research and explore spawns and the per-track completion rule.
- `runs/` — per-card execution evidence, never linked from user docs.

## Rules

- Every `docs/*.md` must be linked from `README.md` or `FEATURES.md`,
  or it does not exist (see `AGENTS.md`, Feature inventory).
- No second overview, no second getting-started, no Shape Up methodology
  copy in this repo — those live in `stelow`.
- `FEATURES.md` stays the internal feature inventory (job-grouped, with
  quoted outputs); the site carries a condensed user view, not a copy.
