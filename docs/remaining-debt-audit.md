# Remaining debt audit

Phase 1 of the remaining-debt resolution branch. This report measures the four
areas named by the branch and produces the ordered repair list that the later
phases execute. It fixes nothing in the measured areas; the only code change it
ships is the shape-gate repair described under *Gate repairs*.

Every number below was measured on this branch (`refactor/app-slices-1-11`) with
`node scripts/check-source-budgets.mjs` and a TypeScript AST census that mirrors
that gate's traversal. Master values come from `git show origin/master:<path>`.
The two must agree, or the census does not describe the same shapes the gate
measures.

The adversarial review of this phase re-measured every symbol and line range in
the tables and corrected four of them, listed under *Review corrections*.

## How to read the deltas

`check-source-budgets.mjs` scores two different references, and both matter:

- **New violations** are scoped to the *merge-base* with `origin/master`,
  currently `1f968be` — 200 commits behind the branch tip.
- **Inherited debt** is scored against the *target tip* of `origin/master`,
  currently `12c6664`.

So "baseline" in the tables is the master value the gate subtracts, and a
negative delta is real progress that the gate already accepts. Progress is
recorded as a ratchet in `tests/debt-baseline.test.mjs`; a split must lower
those entries deliberately.

## 1. GitHub automation area

`server/github-issues.ts` is the largest owned file in the tree and the only
oversized file under `server/`. The branch changed it by 23 added and 23
removed lines, net zero.

| Symbol | Lines | Range | master | HEAD | delta |
| --- | --- | --- | --- | --- | --- |
| `server/github-issues.ts` (file) | 942 | 1-942 | 942 | 942 | 0 |
| `runGithubMigrations` | 64 | 152-215 | 64 | 64 | 0 |
| `createGithubAutomation` | 701 | 242-942 | 709 | 701 | **-8** |
| `runSingleAutomationRule` | 53 | 480-532 | 53 | 53 | 0 |
| `listGithubCandidates` | 58 | 646-703 | 58 | 58 | 0 |
| `postGithubCompletion` | 59 | 740-798 | 59 | 59 | 0 |
| `useGithubDialogState` | 229 | `components/github/github-dialog-state.ts` 125-353 | 229 | 229 | 0 |
| `GithubDoneDraftDialog` | 89 | `components/github/github-done-draft-dialog.tsx` 16-104 | 89 | 89 | 0 |
| `GithubCompletionDialog` | 60 | `components/github/github-completion-dialog.tsx` 24-83 | 60 | 60 | 0 |
| `LinkedDiscussionSection` | 116 | `components/github/github-linked-discussion.tsx` 20-135 | 116 | 116 | 0 |

Eight of nine symbols have not moved. The single -8 on the factory is the whole
of 199 commits of effort in this area.

**The split is blocked by a test gap, not by size.** The three oversized inner
functions of the factory have no behavior test:

- `runSingleAutomationRule`, `listGithubCandidates`, `postGithubCompletion`
  appear in `tests/` **only** in `tests/debt-baseline.test.mjs`, which is the
  size ratchet and asserts nothing about behavior.
- The only other test naming `createGithubAutomation` is
  `tests/server-composition-root.test.mjs:67`, and it asserts the factory is
  *not called* in the composition root — a wiring pin, not behavior.
- `tests/card-start.test.mjs` matches the client-side strings
  `rpc.call("previewAutomationRule"…)` and `rpc.call("importGithubIssue"…)`.
  Those are UI call sites, not server behavior.

`server/github-issues.ts` is otherwise the best-factored file in the branch:
the factory holds 91 nested functions and 88 of them are already under 50 lines,
and the seams for labels, claims, intent, issue creation, comments, lists, and
release already live in `lib/github-*.mjs`. Only the factory shell and the three
named inner functions are oversized.

## 2. Decision API area

All three files are **byte-identical to `origin/master`**. This area has
received zero branch effort; every number below is a starting point, not a
partially-reduced ratchet.

| Symbol | Lines | Range | master | HEAD | delta |
| --- | --- | --- | --- | --- | --- |
| `server/decision-api-contract.ts` (file) | 108 | 1-108 | 108 | 108 | 0 |
| `server/decision-api.ts` (file) | **400** | 1-400 | 400 | 400 | 0 |
| `createDecisionApi` | 319 | 82-400 | 319 | 319 | 0 |
| `setDecisionPoint` | 84 | 289-372 | 84 | 84 | 0 |
| `server/decision-api-seams.ts` (file) | 340 | 1-340 | 340 | 340 | 0 |
| `createDecisionApiSeams` | 271 | 70-340 | 271 | 271 | 0 |
| `vetAutoContinue` | 55 | 199-253 | 55 | 55 | 0 |
| `seedFromPreset` | 49 | 114-162 | 49 | 49 | 0 |

`server/decision-api.ts` is the highest-risk item in the audit for a reason the
gate cannot report: it sits at **exactly** the 400-line ceiling. The gate flags
`lines > maxFileLines`, so this file is legal today and invisible to the
budget report, and it is absent from `fileBaseline` in
`tests/debt-baseline.test.mjs` because it is not oversized. It has **zero
headroom** — the first added line makes it a violation with no baseline to fall
back on, on a file that has never been split.

`seedFromPreset` at 49 is one line under the 50-line function ceiling and
`createDecisionApiSeams` at 340 is 60 lines under the file ceiling, so both are
one small edit away from crossing. Any repair here should move them away from
the boundary rather than settle next to it.

Unlike the GitHub area, the decision API *is* behavior-covered:
`tests/decision-api.test.mjs`, `decision-api-factory.test.mjs`,
`decision-judges.test.mjs`, `decision-point-route.test.mjs`, and
`decision-routers.test.mjs` all run it. The split is unblocked on tests; it is
merely not started.

## 3. Budget-checker delta

`scripts/check-source-budgets.mjs` is 311 lines with no function over 50, and it
passes: 267 changed owned files, 13 inherited entries, 0 violations. Three
defects shape how much trust the later phases can put in it.

**Split comparison bases.** `comparisonBases()` returns
`{ diff: mergeBase, debt: target, branchBase: mergeBase }`. New violations are
therefore scoped to `1f968be` while inherited debt is scored against `12c6664`.
A file that master has since shrunk is still measured against the newer tip,
while a file the branch merely touched is measured against a 199-commit-stale
merge-base. The two directions of the ratchet disagree by the width of the
branch.

**The baseline test is coupled to master's tip.**
`tests/debt-baseline.test.mjs` deepEquals the gate's `inherited` output against
`inheritedBaseline`, and those strings embed master's own line counts — for
example `cli-bundle-writer.ts:writeBundle#1: 68 lines (baseline 104)`. Any
advance of `origin/master` that touches an oversized file breaks the test with
no code change on the branch. This is deliberate ("the inherited debt set
changed; a split or a new violation must be recorded here") but it means the
branch cannot go green without reconciling master first.

**Unmatched labels cost a full-tree scan.** `bestFunction` first filters
candidates by label and, when the label is absent, falls back to comparing
against *every* baseline function with a lexical similarity score. On this
branch that is a few hundred functions per unmatched record, recomputed for
each oversized function of each changed file. It is correct and deterministic,
but it is the reason the gate is the slowest script in `quality:shape`.

## 4. origin/master delta

`200` commits ahead, `6` behind, measured at `1409058`. The merge-base is
`1f968be`; against it the branch changed `295` files, `+36899/-9415`. Both
figures drift as the branch grows, so re-derive them rather than trusting this
line:

```bash
git rev-list --left-right --count origin/master...HEAD
git diff --shortstat "$(git merge-base origin/master HEAD)" HEAD
```

The 6 missing commits are not workflow-only — they touch owned source, so every
later phase re-measures against a base that moves:

| Commit | Owned source it changes |
| --- | --- |
| `7e5d621` feat: surface BB Workflows setup status | `server.ts`, `components/settings/about-panel.tsx`, `components/settings/preset-onboarding.tsx`, `components/settings/workflow-dependency-card.tsx`, `tests/about-ui-contract.test.mjs` |
| `e0b1148` chore(master): release 0.50.0 | `package.json`, `package-lock.json`, docs |
| `940a7f4` docs: document workflow and decision boundaries | docs only |
| `50e751b`, `599f7ac`, `12c6664` | `.bb/workflows/*` only |

`7e5d621` is the one that matters for the gates: it edits `server.ts` and three
`components/settings/*` files, all inside the owned roots the budget gate
traverses.

## Ordered repair list

Ordered by dependency, then by risk. R1 is first because it is a hard
prerequisite: R2 cannot be done honestly without it.

1. **R1 — Give the three oversized GitHub inner functions behavior tests, and
   extract them while doing so.** `runSingleAutomationRule` (53),
   `listGithubCandidates` (58), `postGithubCompletion` (59). Extract to
   `lib/github-automation-run.mjs`, `lib/github-candidates.mjs`, and
   `lib/github-completion.mjs` behind the existing `GithubAutomationDeps`, each
   with a node test that fails if the behavior is inverted. Precedent:
   `run-bundle` and `artifact-manifest`. This is the only item where a split
   done *first* would be untestable.
2. **R2 — Collapse `createGithubAutomation` (701 lines, 242-942).** After R1 the
   factory is a wiring shell over 22 already-small functions. Target under 50.
3. **R3 — Split `server/github-issues.ts` (942 lines).** Natural seams already
   exist: the RPC contract (75-151), `runGithubMigrations` (152-215), `execGh`
   (230-237), and the factory (242-942). Land R2 first so the factory seam is
   small.
4. **R4 — Decision API, starting with the zero-headroom file.** Split
   `server/decision-api.ts` (exactly 400 lines, invisible to the gate) before
   anything else in the area, then `createDecisionApi` (319) and
   `setDecisionPoint` (84), then `server/decision-api-seams.ts` (340) and
   `createDecisionApiSeams` (271). Move `seedFromPreset` (49) away from the
   50-line ceiling rather than leaving it adjacent. Tests already exist.
5. **R5 — Reconcile with `origin/master` before R3 and R4 finish.** The 6
   missing commits edit owned source, and `inheritedBaseline` embeds master's
   line counts, so master's advance invalidates the deepEqual for reasons that
   have nothing to do with the branch. Do this as its own reviewed merge; never
   rebase or widen a recorded range to make it quiet.
6. **R6 — Only then, consider the budget-checker defects in section 3.** The
   split bases (R6a) and the `bestFunction` full-tree fallback (R6b) are real
   but neither blocks a split. Fixing them changes what the gate reports, so it
   belongs after the repair list has been executed against the current gate, not
   during.

## Review corrections

The adversarial review of this phase re-derived every symbol length, line range,
and branch count from `origin/master` and HEAD rather than from the tables above.
Four claims did not survive:

- `LinkedDiscussionSection` is 116 lines on master and on HEAD, not 135. The
  `20-135` range in the same row had been copied into both count columns.
- The factory holds 91 nested functions, 88 of them under 50 lines — not "25
  nested functions, 22 under 50". The conclusion is unchanged: only the shell and
  the three named inner functions are oversized.
- The branch is 200 commits ahead, not 199, and the section 4 diffstat was stale
  in both directions. It now names the commit it was measured at and the
  commands that re-derive it, because the figure changes with every phase.
- `server/decision-api-contract.ts` (108 lines) is the third file the section 2
  sentence claims are byte-identical to master but was missing from the table.

Two defects in the census itself were found the same way and fixed:

- The census copied the budget checker's traversal *narrower* than the gate
  copies it: it counted function declarations, expressions, arrows, and methods,
  but not class constructors, getters, setters, or the `default` label the gate
  gives a default-exported arrow. On a synthetic source holding one of each, the
  gate found four oversized members and the census found one. Because the census
  is the only gate that reads untouched files, that gap was a class of debt no
  gate could see. `syntheticNodeKinds` in `tests/debt-baseline.test.mjs` is the
  control: it fails if the census ever narrows again.
- The census pinned 32 of the 56 oversized functions, so growth in the other 24
  was bounded only by the total count. All 56 are pinned now; growing
  `lib/question-batch.mjs:parseAskGroups` from 80 to 110 lines fails the test
  with its own name, where before it passed.

The remaining inherited set outside these two areas
(`lib/preview-runtime.mjs`, `lib/trackable-evidence.mjs`,
`server/execution-*.ts`, `server/runtime/**`, `components/panels/inbox-panel.tsx`,
`components/settings/preset-manager-shell.tsx`, `components/creation/create-build-dialog.tsx`,
`components/ui/dialog.tsx`, `app.tsx`, `tests/server-cards.test.mjs`) is
unchanged by this audit and stays pinned in `tests/debt-baseline.test.mjs`.

## Gate repairs shipped by this phase

The branch was **red on a CI gate** when the audit started:
`.bb/workflows/resolve-remaining-debt.js:94` was 171 characters, over the
160-character limit, and `npm run quality:shape` is step 4 of `.github/workflows/ci.yml`.
Nothing local caught it because `scripts/check-source-shape.mjs` ran only through
`quality:shape` and in CI — never inside `npm test`.

Two changes, both bounded:

- The workflow line was split and its repeated agent options hoisted into one
  `agentOptions` object. No prompt text or agent behavior changed.
- `tests/debt-baseline.test.mjs` now also runs `scripts/check-source-shape.mjs`
  and fails on a non-zero exit, so a phase can no longer end with the shape gate
  red while `npm test` is green. It shares that script's existing diff-scoped
  base, so a file with no changed lines is still never reported. Verified with a
  negative control: injecting a 171-character line into `server/github-status.ts`
  fails the test, and the file restores clean.
