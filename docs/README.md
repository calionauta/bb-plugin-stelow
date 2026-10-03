# Plugin docs — index and policy

User documentation is unified on the Stelow site
(`https://calionauta.github.io/stelow/`, source: `stelow` repo `docs/`).
This folder holds **maintainer-only** material plus the operator guides
that are still waiting for their canonical home. Do not add new
user-facing manuals here.

## Will move to `stelow/docs/plugin/` (user-canonical, still pending)

These are operator guides useful to end users. They stay here until the
unified docs are published; afterwards each becomes a stub with a link.

- `github-issues.md` → `docs/plugin/github-issues/`
- `native-workflows.md` → `docs/plugin/native-workflows/` (or fold into execution page)
- `decision-routing.md` → `docs/plugin/decision-routing/` (or fold into Operate section)
- `team-playbook.md` → `docs/plugin/team-playbook/` (experimental, mark as such)
- `interface-contrast.md` → `docs/plugin/` (scope-map + contrast contracts)
- `legacy-compat.md` → maintainer-only after v1 cleanup (see below)

## Stays here (maintainer-only, never public)

- `runtime-architecture.md` — server module map and lifecycle boundary.
- `runtime-integration-2026-09.md` — dated extraction record.
- `remaining-debt-audit.md` — measured size debt with repair list.
- `artifact-quality-plan.md`, `rendered-ui-audit.md` — quality audits.
- `staged-execution-continuity.md`, `restore-dogfood.md` — execution notes.
- `recipe-pilot-matrix.md`, `phase6-independent-review-plan.md` — plans.
- `rfc-*.md` — proposals under discussion, not behavior.
- `runs/` — per-card execution evidence, never linked from user docs.

## Rules

- Every `docs/*.md` must be linked from `README.md` or `FEATURES.md`,
  or it does not exist (see `AGENTS.md`, Feature inventory).
- No second overview, no second getting-started, no Shape Up methodology
  copy in this repo — those live in `stelow`.
- `FEATURES.md` stays the internal feature inventory (job-grouped, with
  quoted outputs); the site carries a condensed user view, not a copy.
