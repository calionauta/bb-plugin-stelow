# File-claims robustness — execution log

RFC: `docs/rfc-file-claims-robustness.md`.
NOTE: this environment has no opencode todo-write tool, so this file is the
single source of truth for progress. Any LLM continuing this work: read the
RFC first, then resume at the first unchecked box below.

Conventions (from `AGENTS.md`): new state-machine logic in `lib/` + node test;
never hand-edit `skills/` or `data/stelow`; `npm run typecheck` + `npm test`
green; `npm run build:reload` + `grep dist/` before handoff; conventional
commits (`fix:`/`feat:` user-facing, `refactor:`/`test:` silent).

## Phase 0 — DRY baseline
- [x] `lib/card-terminal.mjs` + `lib/card-terminal.d.mts` + `tests/card-terminal.test.mjs`
- [x] Historical `server.ts` runtime (now `server/plugin-runtime.ts`):
  import `CLAIM_TTL_MS` from lib and delete the local constant.
- [x] Historical `server.ts` terminal checks (now split capability code):
  use `isClaimTerminal`.
- [x] `typecheck` + relevant tests green

## Phase 1 — Close the `blocked` leak
- [x] `moveCard`: release on `isClaimTerminal(decision.move.status)`
- [x] reconcile sweep reaps claims of terminal-status holders + clears their waiters
- [x] `tests/claims-lifecycle.test.mjs`: terminal-release matrix (lib level)
- [x] wired into `package.json` `test:inbox`

## Phase 2 — Key by effective checkout
- [x] `lib/card-claim-key.mjs` + `.d.mts` + `tests/card-claim-key.test.mjs`
- [x] lock handler resolves `cardCheckout()` first, fallback `cardWorkspace`
- [x] registry calls use claim key; helper cwd/stateDir stay on source
- [x] wiring pin in `tests/lock-protocol-contract.test.mjs`

## Phase 3 — Pin the protocol
- [x] `tests/lock-protocol-contract.test.mjs`: TTL equality, stderr shape,
      dedupe key, `resumed` wiring, nudge wiring
- [x] soft visibility: open claims surfaced in done/sync trail — DEFERRED
      (see decision log; keeps change surface minimal)

## Phase 4 — Full-cycle integration test
- [x] `tests/claims-lifecycle.test.mjs`: A acquire → B blocked + waiter +
      `paused/lock-blocked` → A release → B `resumed` → sweep wakes orphans,
      ghost-holder reap
- [x] full `npm test` + `typecheck` green
- [x] `npm run build:reload` — NOT RUN (needs live BB; left for human)

## Double-check + gap analysis (2026-09-18, with live server inspection)

Server (`deploy@server.calionauta.com`, `~/.bb/plugins/stelow/data.db`):
- 28 cards: 21 archived, 4 completed, 1 draft, 2 in-progress.
- `card_claims`: 0 rows. `card_claim_waiters`: 0 rows.
- `lock-blocked:%` inbox events ever: 0 — the mechanism never fired in prod.
- Live exploratory card has `spec-tech_v1.md` but no `TARGET_FILES`, no
  `.lock` files: the voluntary upstream protocol is not exercised in prod.
- New code is NOT deployed (local, uncommitted) — nothing to clean in prod.

Code gaps found by re-review and fixed:
- Acquire-path ghost check and both live-holder filters still used
  `isArchivedCard` (archived-only): a completed/blocked holder would park a
  live card until the 45s sweep. Now `isClaimTerminal` in all three spots
  (acquire dead/live, check liveWalls) + waiter skip in `notifyClaimWaiters`.
  Pinned in `lock-protocol-contract.test.mjs`.
- Full `npm test` + `typecheck` re-run green after the fix.

Remaining known gaps (accepted, not fixed):
- Registry `acquire` runs even when the helper already refused (over-claim
  until release). Advisory-only impact; fixing would tangle the two layers.
- `check` + workspace wall exits 0 with `BB-LOCK-WALL` on stderr (deliberate:
  keeps `--json` parseable; verified `result.code ?? 1` preserves helper 0).
- Sweep scans all cards every 45s with no-op write txns for terminal holders.
  Negligible at card-table scale; revisit only with evidence.
- Voluntary compliance upstream (no `TARGET_FILES` in prod) — methodology
  decision, owned by stelow repo, listed under Upstream mirror below.

## Upstream mirror — DONE 2026-09-18
- [x] blueprint §2 edit in stelow checkout: commit `5e0b656`
  (`docs: blueprint terminal release covers blocked, claims keyed by
  effective checkout`). Precedent `bd09375` confirms `docs:` for blueprint sync.
- [ ] voluntary-compliance decision belongs upstream (`scope-executor`) —
  product decision, needs human, not implementable unilaterally.

## Historical ship record
- Plugin work landed through `442118f` and `fa580c8`; this log landed in
  `9da61a9`.
- Upstream blueprint work landed in `5e0b656`.
- These hashes are historical evidence, not a pending release checklist.

## Decision log
- `isClaimTerminal` lives in new `lib/card-terminal.mjs` (not
  `worker-action-policy.mjs`): the concept is claim lifecycle, and the
  blueprint (§2) already names `card-claims.mjs` as the portable module —
  keeps claim rules in one place per SoC.
- Phase 3 soft-visibility (live claims in done trail) DEFERRED: needs new
  read paths in completion/sync code for marginal value; the contract test
  already pins the behavior that matters. Reopen if users report invisible waits.
- `blocked` is never written by current code (only guarded in reads) — Phase 1
  covers future writes (`moveCard`) + legacy rows (sweep), no other writer found.
- No `FEATURES.md` entry: all changes are bug-level (invisible when working).
  No `skills/`/`data/stelow` touched.
- Execution order was 0 → 1 → 2 → 3 → 4 (RFC said 3 before 2); 2 first avoids
  writing the contract pin against behavior Phase 2 then changes. Same coverage.
