# Premise recheck — the repair plan against `origin/master`

**Type:** verification record (read-only), supersedes the plan's numbers.
**Date:** 2026-10-23
**Run:** `wfr_f63b5d12-ac77-41b6-a2a9-72f6c5c32490` — seven scope agents plus one
completeness critic, all read-only, all against `origin/master` (2e9cba9d), never
the working tree (it carries another thread's WIP).
**Verdict:** the plan is **not executable as written**. 0 of 43 acceptance
criteria survive; 26 of ~70 premises are dead or moved; three scopes lose their
central finding.

## 1. Why this happened

The audit measured branch `fix/context-policy-parity` *with uncommitted work*.
The repair plan inherited its line numbers, counts and module names, and treated
them as facts about the repository. Two of the three blockers (B1, B2) were never
true of master; the same is true of one finding inside six of the eight scopes.

The rule this repository already states — *the authority is the gate, not the
prose* — applied to its own plan: every finding needed a check against the tree
that would actually ship. Checking cost one workflow run; not checking would have
cost six phantom fixes on top of the two already caught by hand.

## 2. What each scope actually is now

| Scope | Survives | Dies | Moved |
|---|---|---|---|
| **5** clause integrity | S7 only: track renderers interpolate the imported const (`track-prompts.ts:170,255`), never `protocols` | S8a/S8b (`cardOwnerRules` in `CLAUSE_ORDER:46` + budget 706; `reviewProtocol` read through the parameter at `:67`, sentinel-pinned in `runtime-track-prompts.test.mjs:56,58,104`); `Required<Pick<…>>` (the type is already fully required, `workflow-shared.ts:1-16`) | the declaration list is a **test helper** (`tests/helpers/prompt-paths.mjs:40`), not production |
| **2** facts with one owner | S6: seven derivations (`board-read.ts:240`, `card-seams.ts:132,273`, `cli-inspection.ts:291`, `cli-done-build.ts:214`, `question-contracts-gate.ts:34`, `thread-state-projection.ts:35`), **four unanchored** (not two), no exported reader, and `board-read.ts:237` rebuilds the state path by hand | S5 — the manifest has **one** JS reader (`lib/artifact-manifest.mjs:94`) and the helper merges then dedupes into the first block (`data/stelow:865,907,951,959`); nothing is lost | S4 — the move path is already aligned (`card-detail-presentation.ts:190`, `workflow-moves.test.mjs:146-166`); the surviving divergence is the **timeline**: `stage-skips.mjs:112` never receives the knobs, so `context` can never be painted skipped |
| **3** state honesty | 11 premises: `--force` vs the floor, `last_error`, the two `mark done` writers, terminal filter, failed-read `[]` | restore's "withheld question with no exit" (it has one); `card/restore.ts`, `tests/pending-questions.test.mjs`, `tests/runtime-thread-lifecycle.test.mjs` — **paths that do not exist** | `markThreadRunning` lives somewhere other than `runtime-core.ts` |
| **6** cache economy | the 7.5%/9.9% prefix and the 823/824 char break are real; ceilings are real | clauses live in another module than the plan names; `model-tier-economics.md` quotes no token figures | `DONE_PROTOCOL` is **2,479** chars, not 2,436; playbook relocation needs a different destination |
| **7** noise and prose | 10 premises: the 275-export class, the stub, the dead consts, `remaining-debt-audit.md` | one "orphan" is not orphaned; **`docs/file-locking.md` exists** | — |
| **8** declaration surface | 4 premises | `types/` does not exist; **263/276**, not 257/270; generation is not a live third option (generated output would break the `.mjs` binding the surface test requires) | — |
| **4-rest** | 9 premises: renewal, the in-memory merge lock, the poll cost | `scope-start-gate.ts` (it is `scope-batch-gates.ts`); renewal-by-reacquire does not extend a claim; `lock-protocol-contract.test.mjs` cannot reach the lock | merge-lock hazard is real, different location |

## 3. Sequence, corrected

1. **SCOPE-8 lands with SCOPE-7, never after it.** Pruning `lib/*.mjs` exports is
   exactly what `declaration-surface.test.mjs:94-100` forbids while the sibling
   `.d.mts` still declares it — 7 reddens the suite that 8 owns.
2. **SCOPE-2 → SCOPE-3 is not a dependency.** Nothing in 3 reads a stage. They are
   independent; 3 can start first.
3. **SCOPE-5 has an unlisted conflict.** The WIP in the shared checkout rewrites
   research/explore registration steps for artifact-manifest ownership; editing
   `track-prompts.ts` before that lands conflicts. Either wait or take the file
   first.
4. **4.3–4.6 do not precede 4.1.** `claimScopeBatchRun` is reachable only through
   `scopeStartGate`, so the batch decision stays upstream of the claims work.
5. **SCOPE-1 needed no work on master** — already true before this record, and the
   one live item (S1) closed upstream (`#93` → pin `81f4505`).

## 4. Acceptance criteria that would actually fail before the fix

Rewritten, because all 43 originals measured something that already passes. These
are the executable set:

| Scope | Criterion | Fails on master because |
|---|---|---|
| 5 | A track prompt rendered with a **different** `userInputContract` string contains that string | research/explore interpolate the import (`track-prompts.ts:170,255`), so the rendered text is identical regardless of the field |
| 5 | Deleting `reviewProtocol` from `TRACK_PATH_CLAUSES`' fixture fails with the clause named, not a `TypeError` | `clauseTexts()` (`prompt-paths.mjs:178`) has no entry, and `lib/prompt-budget.mjs:71-79` throws on the missing bag |
| 2 | Reading the stage through one exported reader equals what all **seven** sites return for the same blob, including a line that says `see current_stage:` mid-sentence | four sites match mid-line (no `^`) and would return `:` adjacent junk |
| 2 | `board-read` obtains the state dir through `workflowStateDir()` | it joins `.stelow/${created}/${dirHash}/state.md` itself (`board-read.ts:237`) |
| 2 | A card whose policy excludes `context` is painted **skipped** in the timeline | `stage-skips.mjs` has no `stage_policies` at all |
| 3 | `markThreadRunning` clears a previous `last_error` on research and explore | the build path clears it; the other two do not |
| 3 | A terminal card with zero open questions never renders the waiting hero | the filter omits terminal status |
| 3 | A failed question read yields `unknown`, not `0 open` | returns `[]` |
| 6 | Research/explore cacheable prefix ≥ 75% with the same fixture | 7.5% / 9.9% |
| 7 | `npm run deadcode` reports zero **new** findings after the prune, with `declaration-surface` still green | the prune breaks declaration binding unless the `.d.mts` goes with it — this is the 7+8 coupling |
| 4 | A claim acquired with `--ttl 60` expires at 60s, not at 1800s | done this round; keep the guard |
| 4 | A held claim past its TTL is still exclusively held after re-acquire | re-acquire does not extend a scope claim |

## 5. What the recheck saved, and what it found

**Avoided:** six fixes for defects that do not exist on master — S8a, S8b,
`Required<Pick>`, S5's manifest merge, the "missing" `docs/file-locking.md`, and a
`types/` migration against a directory that is not there.

**Found, which the audit missed:**
- the derivation count is **seven**, not six, and **four** are unanchored, not two;
- `board-read` holds an **eighth** derivation — a `stelow.json` fallback
  (`:275-281`) — so migrating only the regexes leaves a second owner;
- `reviewProtocol` is unbudgeted: no `CLAUSE_CHAR_CEILINGS` entry, so it can grow
  without a ceiling noticing;
- `TRACK_PATH_CLAUSES` is a fixture constant, which means the plan's headline
  metric could be "achieved" by editing a test;
- SCOPE-7 and SCOPE-8 are one unit of work, not two.

## 6. Open, and owned

- **SCOPE-8 needs re-derivation**, not a spike: its own premises were branch-local,
  so the question "keep, generate or delete the declaration surface" has no
  measured input yet.
- **B3 stays the owner's call** (documented in `FEATURES.md:854`), unchanged.
- **The plan file itself is stale** wherever this record contradicts it. Until it is
  rewritten, read the plan for intent and this record for fact.
