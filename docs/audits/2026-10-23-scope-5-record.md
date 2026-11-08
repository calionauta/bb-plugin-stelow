# SCOPE-5 record — clause integrity

**Scope:** SCOPE-5 of `2026-10-23-stelow-audit-repair-plan.md`, as corrected by
`2026-10-23-premise-recheck.md`.
**Date:** 2026-10-23
**Branch:** `fix/track-user-contract-2026-10-23` (from `origin/master` 2e9cba9d)
**Status:** one live defect fixed. Three of the scope's five premises were dead
before it started; the recheck found that, this record carries the result.

## 1. What the scope was, and what survived

| Plan item | Verdict after the recheck | Here |
|---|---|---|
| 5.1 declare `cardOwnerRules` + `reviewProtocol` (S8) | **dead** — `cardOwnerRules` is in `CLAUSE_ORDER:46` with a 706 budget, `reviewProtocol` is read through `protocols` (`track-prompts.ts:67`), and both are sentinel-pinned in `runtime-track-prompts.test.mjs:56,58,104` | nothing to do |
| 5.2 `userInputContract` as a parameter, or delete the field (S7) | **alive, track paths only** — the build paths already read it; research and explore interpolated the import | **fixed** |
| 5.3 `Required<Pick<…>>` on the shared prefix | **dead** — `BuildProtocols` is already fully required (`workflow-shared.ts:1-16`) and `buildSharedPrefix` takes it unpartialled, so a missing clause is already a compile error | nothing to do |

## 2. The fix

`researchUserContract()` and `exploreUserContract()` took no argument and
interpolated `USER_INPUT_CONTRACT` from `plugin-protocols.js`. Both now take the
contract string, and both call sites pass `protocols.userInputContract` — so the
field that `runtime-core.ts:63` fills is the one that renders, and the build and
track paths finally read the same source.

The import is gone: with the field required by `TrackPromptProtocols` and filled
by the runtime, a fallback to the const would have kept a second source alive and
turned a wiring bug into silent correct-looking text.

**Red proof.** Before the fix, with a distinct fixture value:

```
not ok 10 - track prompts render userInputContract from the protocols, not from the import
  error: 'research renders the field it was given'
```

After: 10/10. The fixture itself was the defect's blind spot — it passed the
production const, so a renderer reading the import was byte-identical to one
reading the parameter. `tests/runtime-track-prompts.test.mjs` now carries a
distinct `USER-CONTRACT-FIXTURE` sentinel, which is what makes the assertion
capable of failing.

## 3. Verification

| Command | Exit |
|---|---|
| `node --experimental-strip-types --import ./tests/register-ts-source.mjs tests/runtime-track-prompts.test.mjs` | 0 (10/10) |
| `npm run typecheck` | 0 |
| `npm run quality:shape` | 0 (39 inherited lint findings, none new) |
| `npm run test:prompt` | 0 |
| `npm test` | 0 |

## 4. Files touched

`server/runtime/track-prompts.ts` (two functions, two call sites, one unused
import), `tests/runtime-track-prompts.test.mjs` (fixture sentinel + one test).

## 5. Deferred, with the reason

- **`reviewProtocol` has no `CLAUSE_CHAR_CEILINGS` entry** (0 hits on master), so
  it can grow without a ceiling noticing. Not fixed here because the honest fix is
  a design choice, not a repair: either it becomes a declared clause with a budget
  (and joins `CLAUSE_ORDER`, where `prompt-budget.test.mjs:174-181` would police
  it) or it stays a footer field and the ceiling list stays a build-clause list.
  Adding the entry alone would be inert at best and a `TypeError` at worst.
- **`TRACK_PATH_CLAUSES` is a fixture constant** (`tests/helpers/prompt-paths.mjs:40`),
  not a production declaration. The plan's headline metric for this scope could be
  "achieved" by editing a test. The recheck named the honest metric: extend the
  three-way render/ceiling/bag check in `prompt-budget.test.mjs:158-181` to the
  track prompts.
- **S7's build half was already correct**, so the audit's "1,874 chars" figure and
  the "field is dead everywhere" framing do not hold on master.
