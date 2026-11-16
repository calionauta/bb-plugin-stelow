# `bb stelow gaps`: a read-only view over the gap registry

**Type:** feature brief, fresh context. Load `/skill:stelow-workflow-coding-standards`.
**Base:** `origin/master`. Branch `feat/cli-gaps-2026-10-23`, own worktree.

## Why this exists, and why it is small

Today a documented gap only exists if somebody opens a card's audit markdown. The
data is already parsed - `lib/gap-registry.mjs` exports `parseGapFrontmatter`,
`registryGaps`, `escalatedGaps`, `summarizeGaps`, `validateGapRegistry` - and
`server/runtime/critique-gap-state.ts` exposes `createCritiqueGapState(deps)`,
which already reads gaps per card. So this is a thin VIEW, not a mechanism:
no new table, no new schema, no writes.

It answers one question the workflow cannot answer today: "what has already been
flagged in this area?" - which is the only one of three proposed gap ideas that
survived validation (the other two: a zero-gaps floor changes the contract just
stabilised, and capturing gaps earlier duplicates the schema across stages).

## The command

    bb stelow gaps [--card <id>] [--area <glob>] [--status documented|escalated] [--json]

- Reads every card's audit artifacts through the existing parser - never a second
  reader.
- Groups by `area`, so the answer is "three cards already flagged tests/docs-index".
- `--json` for machines, text for humans. Default shows documented and escalated
  with counts; `--status` narrows.
- Exit 0 always when it read successfully, including zero rows. A view that exits
  non-zero because it found nothing is unusable in scripts.

Read `server/runtime/cli-registry.ts` for how a command is registered (see
`gap-scopes` there) and follow the dispatch pattern of an existing read-only
command exactly. Do not invent a new registration path.

## The three red proofs (a view that lies is worse than no view)

1. **Zero rows is not the same as zero found.** Fixture with 3 `documented` and 1
   `escalated` across two cards: `--status escalated` prints 1, `--status
   documented` prints 3, unfiltered prints 4 total. Disable the filter and the
   count goes to 4 for `escalated` - capture both.
2. **An orphan state directory is not a card.** A real export run today printed 15
   `Unknown card` lines across 42 directories. A directory whose card no longer
   exists must not be counted or listed: with an orphan in the fixture the total
   does not change.
3. **It writes nothing.** Assert `git status --porcelain` is empty after the
   command runs in a fixture repo. A view that writes is a second writer.

## Also close the trailer inconsistency found today (small, same class)

A finished card's export prints `Stelow-Gaps: 0 fixed / 9 documented / 0 escalated`
while six other cards print `Stelow-Artifacts: 0`. Two shapes for one field. Pick
one key, derive both numbers from the same owner (`state.md` artifacts list and the
audit gap rows), and assert the trailer equals what `bb stelow gaps` reports for
that card. If they must differ, the record must name the delta - not leave two
keys that look like the same thing.

## Boundaries

- No new dependency. No UI. No migration. Never edit `skills/` or `data/stelow`.
- Fresh worktree: `npm ci`, or symlink the main checkout's `node_modules` and run
  `npm rebuild better-sqlite3` (a missing binding is the install, not your change).
- A `.mjs` imported from TypeScript needs its `.d.mts` in the same commit.
- Gates with exit codes in the record: `typecheck`, `quality:shape`, `npm test`.
- Never push, merge, tag or release.

## Deliverable

`docs/audits/2026-10-23-gaps-cli-record.md`: the command surface, the reuse points
with path:line, the three red proofs with their assertion text, the trailer
decision, the three exits, and "what I did not do and why".

Report under 200 words: the command surface, the three red proofs, the trailer
decision, and the three exits.
