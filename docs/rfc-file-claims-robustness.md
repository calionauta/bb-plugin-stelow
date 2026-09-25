# RFC: file-claims robustness

Status: implemented. `docs/rfc-file-claims-progress.md` is the execution log.

Historical note: line references below identify the server layout when this
proposal was written. `server.ts` is now the seven-line entry; runtime and
capability behavior lives in `server/plugin-runtime.ts` and modules under
`server/`. Treat the old line numbers as provenance, not navigation; use the
named symbols and current tests to verify the landed behavior.

## 1. Current state (verified against code)

Two layers, different visibility:

- **Upstream** (`stelow`): per-scope FS locks inside the card's own state dir
  (`.stelow/.../locks/{sha1}.lock`, `scripts/stelow lock acquire|release|check`,
  TTL 30min). Declared status: `convention`
  (`skills/stelow-workflow-orchestrator/references/cli-tools/file-locking.md:1-129`).
  `scope-executor/SKILL.md:281` states overlap detection is audit, not prevention.
  Lock required only when `TARGET_FILES` + parallel dispatch
  (`skills/stelow-workflow-scope-executor/references/step-3-feature.md:69-83`).
- **Plugin**: workspace-level claim registry in SQLite
  (`lib/card-claims.mjs:1-251`, tables `card_claims` + `card_claim_waiters`),
  keyed by `(workspace_path, file_path)`. Reason documented in the file header:
  upstream locks are per-card and invisible to sibling cards.
  `bb stelow lock` (`server.ts:6866-6967`) runs the vendored helper, then the registry.

Working paths (verified):

- Conflict → `BB-LOCK-BLOCKED file= heldBy= expiresAt=` stderr + `paused`
  inbox event with dedupe `lock-blocked:<card>:<file>` naming holder and
  auto-release (`server.ts:6933-6944`, summary at `server.ts:3529-3532`).
  Worker prompt teaches park-scope / no-retry-loop (`server.ts:1179`).
- Release → `releaseCardClaimsAndNotify` → `notifyClaimWaiters`
  (`server.ts:3533-3575`): resolves `paused` as `resumed`, clears waiters,
  sends agent-only nudge to re-acquire, publishes `card-state`.
  Triggered on `lock release` (`server.ts:6947-6950`), 45s reconcile sweep
  of expired claims (`server.ts:4025-4044`), and terminal transitions below.
- Terminal release exists for: `cancelCard`, `deleteCard`
  (`server.ts:4803,4818`), `moveCard` → `archived|completed`
  (`server.ts:5149`), `done` build/research/explore
  (`server.ts:6617,6632,6648`).

Contract on paper:

- `stelow/HOSTING.md:26-29`: hosts must not mirror `lock` semantics; consume `scripts/stelow`.
- `stelow/docs/host-plugin-blueprint.md:62-68,91-96`: terminal release, waiter
  resume, holder-naming paused events, `lock-blocked:<card>:<file>` dedupe.

## 2. Gaps (each confirmed in code)

1. **`blocked` leaks claims.** `blocked` is a valid card status
   (`server.ts:173`) and is treated as terminal in reads
   (`server.ts:4423,4676`, guards at `3199+`), but `moveCard` only releases on
   `archived|completed` (`server.ts:5149`). A card reaching `blocked` holds files.
2. **Claim key is the project source, not the effective checkout.** Lock handler
   keys by `cardWorkspace().path` = project source (`server.ts:2292-2299,6886`),
   while execution may run in a per-card `managed-worktree`
   (`cardCheckout()`, `server.ts:2648-2670`; env kinds at `server.ts:860-892`).
   Two cards isolated in their own worktrees conflict falsely (over-lock).
   `project-default` (shared unmanaged checkout) is correct today.
3. **DRY violations.** `server.ts:3528` redefines `CLAIM_TTL_MS` instead of
   importing it from `lib/card-claims.mjs:24`. Terminal-status lists are pasted
   in at least three places (`server.ts:4423,4676,5149`).
4. **No lock-protocol contract test.** `workflow-contracts` pins stages/transitions,
   not locks. `tests/card-claims.test.mjs` covers the pure lib only, not the
   server wiring (release → `resumed` → nudge) nor the ghost-holder reap
   (`server.ts:6918-6928`).
5. **Voluntary compliance (upstream design, not a bug).** A worker can write
   without `acquire`; the post-execution `git diff` audit catches it after the
   fact. The plugin inherits this. Enforcement would require a methodology
   change upstream, not a plugin patch (per `AGENTS.md`: never hand-edit `skills/`).

There is no `canceled` status: `cancelCard` maps to `archived`. `blocked`
is the status the question means.

## 3. Principles

KISS (no new daemon; reuse the 45s sweep), DRY (one TTL, one terminal table,
one key resolver), Convention over configuration (safe defaults, no new flags).

## 4. Plan

### Phase 0 — DRY baseline (no behavior change)

- Import `CLAIM_TTL_MS` from `lib/card-claims.mjs`; delete the local const
  at `server.ts:3528`.
- New `lib/card-terminal.mjs`: `isClaimTerminal(status)` =
  `completed|archived|blocked`, pure + node test. Replace the pasted lists
  (`server.ts:4423,4676`, `moveCard` branch).
- Verify: `npm run typecheck && npm test`.
- Commit: `refactor:` (no `FEATURES.md`, no release).

### Phase 1 — Close the `blocked` leak

- `moveCard`: release on `isClaimTerminal(status)`, not just
  `archived|completed` (`server.ts:5146-5149`).
- Reconcile sweep (`server.ts:4025-4044`): additionally reap claims whose
  holder sits in a terminal status (today only time-expiry), then
  `notifyClaimWaiters` on the same path.
- `tests/claims-lifecycle.test.mjs` covers acquire → terminal release → empty
  claims + waiter notification and is wired into `test:inbox`. The older plan
  named a separate `card-claims-release` test; the landed test was consolidated
  into the full-cycle claims lifecycle suite.
- Commit: `fix:` (bug, no `FEATURES.md` entry).

### Phase 2 — Key by effective checkout

- Convention: **claim key = effective checkout, fallback source. No new flags.**
- New pure `lib/card-claim-key.mjs`: `resolveClaimKey({checkoutPath, sourcePath})`
  → `checkoutPath ?? sourcePath`, reusing `normalizeClaimPath`. Unit test.
- Lock handler (`server.ts:6884-6906`): resolve `cardCheckout(cliCard)` first
  (understands worktree/recovery), fallback `cardWorkspace`. Use that key in
  `acquire/check/release`, `addClaimWaiters`, `waitersForFiles`,
  `notifyClaimWaiters`. State dir and helper cwd stay on the source
  (state ≠ execution — do not move).
- Wiring tests: same file/different worktrees → no conflict; same checkout →
  conflict; `project-default` unchanged.
- Upstream mirror: propose blueprint §2 edit in the stelow checkout
  ("key claims by effective checkout, not project source"), separate commit
  there, per `AGENTS.md` blueprint rule.
- Commit: `fix:`.

### Phase 3 — Pin the protocol (the missing firm contract)

- Pin with `tests/lock-protocol-contract.test.mjs`: TTL equality
  (helper default 1800 == `CLAIM_TTL_MS`), stderr shape
  (`BB-LOCK-BLOCKED file= heldBy= expiresAt=`), dedupe key
  (`lock-blocked:<card>:<file>`), release resolving `paused` as `resumed`,
  waiter cleanup after notify. Breaks the build on drift either side.
- Soft visibility only (no worker enforcement): surface
  `liveClaimsForWorkspace` in the done/sync trail when claims are open.
  Read-only; never blocks.
- Commit: `feat:` + one `FEATURES.md` §3 line if user-visible copy changes.

### Phase 4 — Full-cycle integration test

- SQLite-real test (no lib mocks): A acquires → B conflicts + waiter +
  `paused/lock-blocked` → A releases → B `resumed` + nudge → expired-claim
  sweep wakes orphan waiters. Covers ghost-holder reap (`server.ts:6918-6928`).
- Per `AGENTS.md`: `npm run typecheck`, `npm test`, `npm run build:reload`,
  `grep dist/` before handoff/commit.

Order: 0 → 1 → 3 → 2 → 4. One commit per phase, green before next.

## 5. Non-goals

- No line-level locking, no OS `flock`, no mandatory worktrees
  (upstream rejected worktrees at `file-locking.md:95-116`).
- No `canceled` status; `cancelCard` = `archived` stays the convention.
- Fencing tokens (emitted, currently ignored in `notifyClaimWaiters`) are
  out of scope; use-or-remove in a separate refactor.

## 6. What this fixes per repo

- Plugin: gaps 1–4 fully.
- Upstream: contract text only (blueprint + `HOSTING.md` mirror). Gap 5
  (voluntary compliance) remains by upstream design; making `acquire`
  mandatory would be a methodology change in `scope-executor`, owned upstream.
