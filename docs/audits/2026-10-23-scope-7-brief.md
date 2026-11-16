# SCOPE-7 brief: noise and prose

**Deliverable:** delete what nothing reads, and stop restating numbers a gate
already measures. Mechanical, wide, and it now has two gates on its path.

## Premises verified against origin/master (2e9cba9d)

- 275 exports with no external reader (start from `npm run deadcode`), a
  `contextAskGate` stub that always returns allowed, dead constants
  (`NON_AUTO_SKIPS`, `MODE_DOES_NOT_RUN`), `.trackSync` built twice, a
  `gatePreservation` literal duplicated in `start-workflow-prompt.ts`.
- Aged prose: a comment in `tests/prompt-cache-order.test.mjs` claims the build
  paths are red (they are green at 90.9%); `lib/prompt-clause-budgets.mjs` cites
  93.7%; `docs/remaining-debt-audit.md` (1,967 lines) restates ceilings that
  `check-source-budgets.mjs` already owns.
- DEAD premises - do not act on them: `docs/file-locking.md` EXISTS. One of the
  two "orphan" files is not orphaned. There is no `types/` directory.

## The coupling that will bite you

Two gates bind the declaration surface to the implementation:

- `tests/declaration-surface.test.mjs` requires every `export declare` name to be
  exported by the sibling `.mjs`.
- `tests/declaration-drift.test.mjs` (new) fails on arity drift and ghost
  declarations, and holds two shrink-only ceilings: 42 invisible exports and 35
  unchecked barrel re-exports.

So: pruning an implementation export REQUIRES deleting its `export declare` in the
same commit. If a prune lowers the drift counts, lower the baseline constants in
that test - lowering is progress. Raising them is not allowed, and the reason
cannot be "the new export is fine".

## Protocol

- Branch `fix/noise-and-prose-2026-10-23`, in your own worktree from
  `origin/master` (the shared checkout carries another thread's uncommitted work).
- Fresh worktree: `npm ci` (2 min) or symlink the checkout's `node_modules` and
  delete the symlink before committing. An incomplete install gives a fake
  `Cannot find module 'pele'` at `server/runtime/platform.ts:145`.
- **Verify every deletion before making it:** if `knip` or `grep` says nothing
  reads a symbol, confirm against `origin/master` with `git grep`; if the only
  reader is a test, say which and decide with the test, not around it.
- **Red proof:** for each prose fix that a gate now enforces, show the gate failing
  on the old text (or explain why it cannot fail and drop the fix instead).
- Gates, all three, with exits in the record: `npm run --silent typecheck`,
  `npm run --silent quality:shape`, `npm test`.
- Record at `docs/audits/2026-10-23-scope-7-record.md`: what was deleted and what
  proves nothing reads it, what was left and why, the exits, and a final section
  "what I did not do and why".
- Never push, merge, tag or release. Never delete a capability documented in
  `FEATURES.md`. Never touch `skills/` or `data/stelow` by hand.
- Commit with a conventional type. No AI attribution trailer.
