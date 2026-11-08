# SCOPE-2 record — one reader for the current stage (S6)

**Scope:** SCOPE-2 of `2026-10-23-stelow-audit-repair-plan.md`, as corrected by
`2026-10-23-premise-recheck.md`.
**Date:** 2026-10-23
**Branch:** `fix/current-stage-reader-2026-10-23` (from `origin/master` 2e9cba9d)
**Status:** the reader and the seven sites are done. Two residual derivations are
deferred and named in §4.

## 1. What was wrong, in the recheck's numbers

Seven places derived `current_stage` with their own regex; **four were
unanchored** — `board-read.ts:240`, `card-seams.ts:132`, `cli-inspection.ts:291`,
`cli-done-build.ts:214`. The host's own rule is that a fact with two owners
drifts; this was one fact with seven readers, and the four unanchored ones
answered a different question: "what does this file mention first", not "what is
the stage". A state file with a note above the field returns the note, and the
panel, the done gate and the thread projection then disagree while each believes
it read the file.

## 2. The fix

`lib/current-stage.mjs` owns the pattern and the parse:
`/^current_stage:\s*(\S+)\s*(?:#.*)?$/m`. Anchored because the bug is matching a
mention; tolerant of a trailing `# comment` and of a quoted value, because those
are spelling, not stage names.

All seven sites call `parseCurrentStage(...)` and keep their own `null` →
`""`/`null` normalisation, which is a presentation choice, not the parse. The
ad-hoc regexes are gone from `server/` — `git grep` for the old pattern returns
nothing.

**Red proof.** Dropping the anchor and re-running `tests/current-stage.test.mjs`:

```
AssertionError [ERR_ASSERTION]: a mention above the field is not the field
```

The test asserts both sides of that: the reader returns `triage`, and the
unanchored pattern the host used returns `audit` from the same text — the defect,
stated as a passing assertion on the old behaviour.

## 3. Verification

| Command | Exit |
|---|---|
| `node tests/current-stage.test.mjs` | 0 |
| `npm run typecheck` | 0 |
| `npm run quality:shape` | 0 (39 inherited lint findings, none new) |
| `npm test` | 0 |

## 4. Deferred, and why

- **`board-read.ts:237` still builds the state path by hand**
  (`join(rootPath, \`.stelow/${created}/${dirHash}/state.md\`)`) instead of
  `workflowStateDir()`. It is the same class — a second owner of a path — but it
  is a different fact from the stage, it needs an `await` inside a helper that is
  currently sync, and it touches the read path of every card. It belongs in its
  own pass, with its own red proof, not bolted onto this one.
- **The eighth derivation:** `board-read.ts:275-281` falls back to
  `stelow.json`'s `stage.current_stage`. Removing it changes what the board shows
  when the state file is unreadable, so it needs a decision (fall back to the
  card's `stage` column, or refuse) rather than a mechanical swap.
- **S4 (the timeline never paints `context` skipped)** is untouched: it is about
  which knobs `stage-skips.mjs` receives, not about reading the stage.

## 5. Non-claims

- This does not unify *all* stage derivations: seven now share one parser, and
  two remain (§4). The count is the evidence, not the claim of totality.
- The new module has a hand-written `.d.mts` because `server/` cannot import a
  `.mjs` without one. That is SCOPE-8's debt appearing again, measured this time:
  one more file to keep in sync by hand.
