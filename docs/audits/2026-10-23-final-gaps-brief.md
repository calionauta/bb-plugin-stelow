# Four pendings, the script-count guard, and the docs that stop repeating today

**Type:** fix/feature brief, fresh context. Load `/skill:stelow-workflow-coding-standards`.
**Base:** `origin/master`. Branch `fix/final-gaps-2026-10-23`, own worktree.

## 1. The merge that would have amputated the suite (do this first)

PR #420 conflicts on `package.json`. Resolving by taking the branch side drops the
test scripts that landed in master since it forked: the branch has **82** `"test:"`
scripts, master has **88**. `tests/suite-wiring.test.mjs` does not catch it - it
only checks that every test file is mentioned in SOME script, not that a band still
exists. A green PR with six missing bands is the exact lie this repo has been
paying for.

Do: rebase the branch, take MASTER's `package.json`, re-add the branch's own two
test references, and prove the count did not fall.

**The guard:** a test asserting the number of `"test:"` scripts in `package.json`
is at least a recorded floor (the floor only rises). Red proof: delete one band
from the fixture copy and watch it fail. That is the test that was missing when I
resolved it wrong.

## 2. Wire the door: a live card must ask a derived question

`lib/contrast-model.mjs` derives questions; `recordContrastAsks` records them with
premise and reversal cost; nothing calls it. Wire the caller at the point where a
card's contrast matrix is read (see `docs/audits/2026-10-23-contrast-wiring-record.md`
for the stage and artifact), so that:

- a blank cell in `contrast-matrix.md` produces an open question whose `premise`
  names that cell;
- the question appears through the existing ask surface, not a new one;
- a question is never created without a premise.

Red proof: with the call removed, a matrix with a blank cell produces zero
questions; with it, exactly one, and its premise is that cell.

## 3. Enumerate the card's nine gaps

Read the three audit documents of `card_wxpaf8ll` (state dir under
`.stelow/.../runs/exec_*/audit/`), list the nine `gaps:` rows in the record with
their `type`, `impact` and `effort`, and say which are worth routing with
`bb stelow gap-scopes` and which are honest debt. Do not fix them: routing is a
product call, and a gap that gets fixed silently is a gap nobody learns from.

## 4. Re-export the bundles that copied zero files

`assignBundleNames` received `sourcePath` while it reads `path`, so every bundle
exported until now copied nothing. The fix is merged; the old bundles on disk are
still empty. Re-export the affected cards through the documented path, and report
counts before and after - not "done".

## 5. Docs: the two absences that cost real time today

`docs/` gets a short page (link it from `docs/README.md`):

- **Mandatory dependencies, each with the command that verifies it:** `node`/`npm`,
  `git`, `bash` (the helper is bash), `python3` (the helper parses JSON with it),
  and `pele` (bundled via npm, pinned - nothing to install). Include the two
  misleading symptoms, because both look like code and are not:
  `Could not locate the bindings file` means reinstall/rebuild, and
  `Cannot find module 'pele'` means an incomplete install.
- **How diagrams render now:** a Mermaid fence and a `.mmd` artifact render on read
  with the bundled pele; there is no SVG artifact; the source is the durable thing;
  a render failure falls back to the source. This is user-visible, so it needs its
  `FEATURES.md` entry in the same commit (AGENTS.md: a feature without an entry
  does not exist).

Do NOT touch the GitHub Pages site: it carries a condensed user view, and a third
copy of operational truth is the failure mode this repo keeps paying for.

## Boundaries

- No new dependency. Never edit `skills/` or `data/stelow`.
- Fresh worktree: `npm ci`, or symlink the main checkout's `node_modules` and run
  `npm rebuild better-sqlite3` (a missing binding is the install, not your change).
- A `.mjs` imported from TypeScript needs its `.d.mts` in the same commit.
- Gates with exit codes in the record: `typecheck`, `quality:shape`, `npm test`.
- Never push, merge, tag or release.

## Deliverable

`docs/audits/2026-10-23-final-gaps-record.md`: the count before and after the
rebase, the guard's red proof, the door's red proof, the nine gaps as a table, the
bundle counts before and after, and the docs page with its FEATURES entry. Plus
"what I did not do and why".

Report under 250 words: the script count, the three red proofs, the nine gaps in one
line each, and the three exits.
