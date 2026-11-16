# SCOPE-6 brief: prompt cache economy

**Deliverable:** research and explore spawns with a cacheable prefix of at least
75%, measured, without losing a clause that changes behaviour.

## Premises verified against origin/master (2e9cba9d)

- The killer: per-card interpolation starts at char 823/824, so the shared prefix
  dies in the first paragraph. Measured prefix: build 90.9%, research 7.5%,
  explore 9.9% (tests/prompt-cache-order.test.mjs).
- `DONE_PROTOCOL` is 2,479 chars on master. About 2,084 of them are Build-only and
  CONTRADICT the research/explore track contract ("STOP and end your turn" vs
  "never just announce completion").
- The clauses live in `server/runtime/worker-protocol-clauses.ts` and
  `server/runtime/workflow-shared.ts` (CLAUSE_ORDER, budgets in
  `lib/prompt-clause-budgets.mjs`). NOT in `lib/prompt-clauses.mjs` - that file
  does not exist, whatever the plan says.
- `docs/model-tier-economics.md` quotes no token figures. Nothing to update there.

## What to do

1. Reorder the track prompts so every per-card value (state dir, card name,
   flavour, request) renders AFTER every shared clause, including the last clause
   that `protocolFoolter` appends if any line there is per-card.
2. Split `DONE_PROTOCOL` into track-specific halves so research/explore stop
   carrying Build-only completion instructions.
3. Lift the five advisory clauses into whatever playbook surface already serves
   them, if the playbook can serve them; if it cannot, record that instead of
   inventing a new mechanism.
4. Lower `CLAUSE_CHAR_CEILINGS` to the new sizes. NEVER raise a ceiling to pass.

## Protocol

- Branch `fix/prompt-cache-economy-2026-10-23`, in your own worktree from
  `origin/master`. The shared checkout carries another thread's uncommitted work.
- A fresh worktree has no `node_modules`: run `npm ci` (2 min), or symlink
  `/home/deploy/repos/bb-plugin-stelow/node_modules` and delete the symlink before
  committing. An incomplete install gives a fake `Cannot find module 'pele'` in
  `server/runtime/platform.ts:145` - that is the install, not your change.
- **Measure before and after** and put both tables in the record: prefix percent,
  chars and tokens per track per path (build spawn, research, explore).
- **Red proof:** the prefix test must be seen failing on the old order. Revert the
  reorder, run it, capture the number, restore.
- Gates, all three, with exits in the record: `npm run --silent typecheck`,
  `npm run --silent quality:shape`, `npm test`.
- Record at `docs/audits/2026-10-23-scope-6-record.md`: what was wrong (path:line),
  what changed, the before/after tables, the red proof text, the exits, and a final
  section "what I did not do and why".
- Never push, merge, tag or release. Never delete a capability documented in
  `FEATURES.md`. Never touch `skills/` or `data/stelow` by hand.
- Commit with a conventional type. No AI attribution trailer.
