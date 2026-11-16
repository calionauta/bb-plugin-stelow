# Two facts with several owners, and the tests that keep them single

**Type:** fix brief, fresh context. Load `/skill:stelow-workflow-coding-standards`.
**Base:** `origin/master`. Branch `fix/one-owner-2026-10-23`, own worktree.

Both defects are the same disease this repository keeps paying for: a fact with
more than one owner drifts, and each owner believes it. Fix the owner, then add
the test that would have caught the drift - not the other way round.

## Defect A: the gap registry has two schemas that disagree

A real card wrote three audit documents. All three were refused by the gate:

    FAIL requirements: needs depth - execution critique needs a `gaps:`
    frontmatter registry (impact + resolution per gap)

The documents were titled correctly and followed the skill. The reason they were
refused is that the SKILL and the HOST ask for different fields:

- `skills/stelow-workflow-execution-critique/references/workflow-audit.md:167`
  documents `type, area, description, impact, effort`.
- `server/runtime/critique-gap-state.ts:25` types
  `{ description, resolution, evidence, expires, owner }`.
- `lib/gap-registry.mjs` is the parser both should agree with. It is the only file
  that actually reads the frontmatter.

So a worker that follows the instructions produces a report the guard refuses.
That is the same class as the skill that used to teach editing `stelow.json`.

Do: make the PARSER the single owner, align the skill's documented shape to it
(or make the parser accept both, deriving the missing side explicitly, if a field
is genuinely optional), and record which way you went and why. Where the skill and
the parser disagree on a name, prefer the parser - it is the code that runs.

**The test that keeps it single:** parse the skill's OWN fenced example through
`lib/gap-registry.mjs` and assert it is accepted. If the documentation and the
guard ever diverge again, CI goes red before a card burns three documents. That
test does not exist today, which is the whole reason this cost a card.

## Defect B: three artifact counts, and one of them is a lie in git history

A finished card's commit carries `Stelow-Artifacts: 0`, while `bb stelow manifest`
prints 24 and `state.md` lists 31 entries. The trailer is the worst of the three
because it is durable: someone reading the commit in a year believes it.

Do: one owner for "which artifacts this card produced". It is the `artifacts:`
list in `state.md`, written by the worker - never a new counter. The trailer is
DERIVED from that owner at commit time. If the trailer counts something else by
design (e.g. only artifacts registered through the manifest), then its name is a
lie and must change or the derivation must say which subset it is.

**Tests:** the trailer equals the owner's count for a fixture card; `bb stelow
manifest` equals the same count; and a red proof - remove one artifact from the
owner and both derived numbers drop by exactly one. If the three numbers are
meant to differ, assert the documented delta instead of equality, and name it.

## Boundaries

- No new dependency. No UI work.
- Never edit `skills/` by hand for the CODE side - but the skill's documented shape
  is prose, and aligning it is allowed here because the parser is the authority. Say
  in the record that upstream sync may overwrite it, and what to do when it does.
- Fresh worktree: `npm ci`, or symlink the main checkout's `node_modules` and run
  `npm rebuild better-sqlite3` (a missing binding reads as
  `Could not locate the bindings file` - the install, not your change).
- A `.mjs` imported from TypeScript needs its `.d.mts` in the same commit.
- Gates with exit codes in the record: `typecheck`, `quality:shape`, `npm test`.
- Never push, merge, tag or release.

## Deliverable

`docs/audits/2026-10-23-one-owner-record.md`: for each defect, which owner you
chose, what would have caught it earlier, the red proofs (assertion text), the
three exits, and "what I did not do and why".

Report under 250 words: the two owners chosen, the two new tests, the red proofs,
and the three exits.
