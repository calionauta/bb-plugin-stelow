# Remaining debt audit

Phase 1 of the remaining-debt resolution branch. This report measures the four
areas named by the branch and produces the ordered repair list that the later
phases execute. It fixes nothing in the measured areas; the only code change it
ships is the shape-gate repair described under *Gate repairs*.

The numbers in the per-area tables are the **pre-split record**: each measured area
is labelled with what actually shipped, and the tables are kept as the
before-picture rather than rewritten. The figures in *Status* lines and in
*Phase 2 result*, *Phase 3 result*, and *Phase 4 result* are current. The gate figures quoted inline
were re-measured on this branch (`refactor/app-slices-1-11`) with
`node scripts/check-source-budgets.mjs` and a TypeScript AST census that mirrors
that gate's traversal. Master values come from `git show origin/master:<path>`.
The two must agree, or the census does not describe the same shapes the gate
measures.

The adversarial review of this phase re-measured every symbol and line range in
the tables and corrected four of them, listed under *Review corrections*. Three
later adversarial reviews — of the phase that closed R4's last clause, of its
own corrections, and of the phase that repaired the budget gate — re-derived
every number in *Phase 3 result* and *Phase 4 result* from the tree. Between
them they rejected seventeen claims in this file: a wrong file count, two
miscounted duplications, three stale diffstats, a symbol reported as deleted that
is alive at 7 lines, a pair of guards wrongly described as live that are dead
like the one beside them, a line count no commit ever had, five sentences that
were stale, self-contradicting, or less accurate than the review found them, and
three in section 3 — the full-tree fallback was filed as a cost rather than as
the correctness defect it was, `baseline 104` was presented as that function's
own master line count, and the section 4 count was a commit behind. All are
corrected above; the *Review corrections* list records what the first review
found, not what the file now says.

## How to read the deltas

`check-source-budgets.mjs` scores two different references, and both matter:

- **New violations** are scoped to the *merge-base* with `origin/master`,
  currently `1f968be` — 208 commits behind the branch tip.
- **Inherited debt** is scored against the *target tip* of `origin/master`,
  currently `12c6664`.

So "baseline" in the tables is the master value the gate subtracts, and a
negative delta is real progress that the gate already accepts. Progress is
recorded as a ratchet in `scripts/source-debt.json`, the ledger the gate and
`tests/debt-baseline.test.mjs` both read; a split must lower those entries
deliberately. The fork's own line is no longer a third base: it was never
evidence about the branch's present debt, and dropping it is part of R6.

## 1. GitHub automation area

**Status: repaired (R1, R2, R3 landed).** The measurements below are kept as
the pre-split record; what shipped is measured in
"Phase 2 result" at the end of the section.

`server/github-issues.ts` was the largest owned file in the tree and the only
oversized file under `server/`. The branch had changed it by 23 added and 23
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

### Phase 2 result (re-derived from the shipped tree)

The area is now eleven `server/github-*.ts` files. `server/github-issues.ts` is
the seam and nothing else; every file is under the 400-line ceiling and every
function under the 50-line one, so the five entries the baseline pinned for this
area are gone rather than replaced.

| File | Lines | Owns |
| --- | --- | --- |
| `server/github-issues.ts` | 58 | the seam: client, warn-once, handler map, both schedulers |
| `server/github-automation-context.ts` | 92 | deps shape, kill switch, warn-once |
| `server/github-client.ts` | 117 | the typed `github` plugin RPC bridge, status, pickers |
| `server/github-status.ts` | 25 | the shared unavailable-status shape |
| `server/github-migrations.ts` | 91 | tables, column ALTERs, the label backfill |
| `server/github-issue-flow.ts` | 293 | candidates, the shared import path, issue creation |
| `server/github-automation-rules.ts` | 232 | rule row shape, backlog guard, the tick |
| `server/github-rule-rpcs.ts` | 210 | the five rule RPCs |
| `server/github-comments.ts` | 140 | the issue-comment mirror and the gated post |
| `server/github-completion.ts` | 96 | the completion write-back and its body |
| `server/github-rpc-contract.ts` | 165 | the wire shapes |

R1 landed as 43 behavior tests over `tests/helpers/github-harness.mjs` (a real
database plus a fake `github` plugin behind the real RPC seam), in three files
by area. The three functions the audit named — the tick, the candidate listing,
and the write-back — are covered by the tests that fail when their behavior is
inverted; the negative controls are listed in the phase report.

R3 also surfaced one real defect the old shape hid: the dedupe read liveness by
card existence (`liveImportedKeys`) but the claim only by `card_id IS NULL`, so
a link whose card was gone was offered as importable by the candidate list and
refused as in-flight by the import path — forever. `lib/github-claims.mjs` now
agrees with itself, and `FEATURES.md` records the rule.

## 2. Decision API area

**Status: repaired (R4 landed).** The measurements below are kept as the
pre-split record; what shipped is measured in "Phase 3 result" at the end of
the section.

The area received **zero** branch effort when this audit was written — all
three files were byte-identical to `origin/master` — so every number below is a
starting point, not a partially-reduced ratchet.

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

### Phase 3 result (re-derived from the shipped tree)

The split landed as `73c4741` and turned the area into **twelve
`server/decision-*.ts` files, nine of them new**; the largest is
`server/decision-store.ts` at 226 lines. Every file the phase below touched is
now well under the 400-line ceiling, and — the part R4 asked for explicitly —
nothing was left *adjacent* to one:

| Symbol | Before | After |
| --- | --- | --- |
| `server/decision-api.ts` (file) | 400 (zero headroom) | 70 |
| `createDecisionApi` | 319 | 34 |
| `setDecisionPoint` | 84 | 7, now a method in `decisionPointHandlers` |
| `server/decision-api-seams.ts` (file) | 340 | 57 |
| `createDecisionApiSeams` | 271 | 15 |
| `vetAutoContinue` | 55 | 19 |
| `seedFromPreset` | 49 | 45 |

`server/decision-api-contract.ts` is untouched at 108, as the audit expected.

The test gap the GitHub area had does not exist here, and the split did not
create one: `tests/decision-seam-runtime.test.mjs` drives
`createAutoContinueVeto` and `tests/decision-seed-runtime.test.mjs` drives
`createDecisionSeed`, each over a real point store, so both advisory seams stay
behavior-covered through the split.

R4's last clause was that `seedFromPreset` be moved *away* from the 50-line
ceiling rather than left next to it. It sat at 49 — one line of headroom, and
the census could not report it because the gate flags `lines > 50`. `73c4741`
left that clause open, and closing it surfaced two real findings:

- **Duplicated resolution tail.** `seedFromApi` and `seedFromPreset` each ended
  with the same six lines — resolve, log on acceptance, return — differing only
  in the label naming the judge. The whole call site measured 7 lines on the api
  side and 16 on the preset side, the difference being that the preset call
  spent ten lines on `resolveSeedIntent({…})` to wrap a seven-line `apiAnswers`
  literal where the api side passed `result.answers` straight through.
  Extracted to `applySeedIntent` in `server/decision-seed.ts`, which drops the
  two call sites to 19 and 45 lines. `routeAt` was already computed once in
  `seedBuildIntent` and fed to both paths, so this did not fix a live drift —
  what it removes is the chance that a future edit applies the threshold at one
  call site and not the other.
- **The threshold was never tested on either path.** Every seed assertion that
  existed before this phase used a confidence of 0.9 or 0.95 against the
  harness default `routeAt` of 0.6, so nothing could tell a threshold that is
  *enforced* from one merely passed along. Reverting to that test file and
  zeroing `routeAt` leaves the suite green. Four scenarios now pin the tail, in
  a new `tests/decision-seed-runtime.test.mjs`: a preset verdict and an api
  verdict below the point's `routeAt` both fail soft to `unknown` and neither
  announces itself as seeded; a below-threshold api answer stays silent rather
  than warning; and — because every accepted seed in the file was a `feature` —
  a `bugfix` verdict from the preset judge and an `investigate` answer from the
  api route each seed the choice they named, and the trail names it at info.

  Each of those scenarios dies on its own mutation, and each mutation was run
  against the shipped test: zeroing `routeAt` on the preset path only, zeroing
  it on the api path only, returning a hardcoded `"feature"` for every accepted
  answer, raising the trail from info to warn, dropping the intent from the
  trail message, and deleting the trail log altogether. Two of them were found
  by review rather than by the first draft of these tests — a tail that forced
  every accepted seed to `"feature"`, which is the tail's entire output, and a
  trail raised to warn, both left the whole decision suite green until the
  non-feature verdicts and the level-aware count went in.

The new tests needed their own file. Adding them to
`tests/decision-seam-runtime.test.mjs` pushed it past the 400-line ceiling, and
the budget gate correctly refused it rather than being handed a new baseline
entry. The two advisory seams are now tested separately —
`decision-seam-runtime.test.mjs` (209 lines) keeps the auto-continue veto,
`decision-seed-runtime.test.mjs` (263) takes the triage seed.

Extracting the tail also broke a pin in `tests/decision-routers.test.mjs`, on
the literal `triage intent seeded from Decision API`. That pin is a copy pin —
it passes on broken logic and breaks on a good refactor, the two things a pin
must not do — and the behavior it claimed is asserted on real captured log
lines in the seed runtime test for *both* judges. It was removed rather than
satisfied by keeping the wording hostage to the source shape. Removing the
source string costs no coverage: with the new block deleted entirely, losing
the api trail or losing the preset trail still fails the suite.

**Known, deliberately not fixed here.** `seedFromPreset` still guards
`!("choice" in parsed)` before reading `parsed.choice`, and that branch is
unreachable: in `kind: "choice"` mode `parsePresetJudgeOutput` returns
`ok: true` only alongside a validated string `choice`, so the sibling error
string `"verdict shape mismatch"` is dead. Verified against fourteen judge
outputs (fenced, unfenced, malformed JSON, unknown choice, missing key, array,
`null`, `"str"`, criteria-shaped, non-numeric and missing confidence, empty
fence, two-block) — every rejection comes back as `ok: false`, and the only
`ok: true` return in that mode is the one that carries `choice`.

The guard survives because it is TypeScript's only narrowing on the parser's
un-narrowed `PresetJudgeChoice | PresetJudgeCriteria` union: deleting it fails
`tsc` with `Property 'choice' does not exist`. Killing it properly means an
`@overload` pair on `parsePresetJudgeOutput` so `kind: "choice"` returns only
the choice shape — roughly ten lines in one small `.mjs`, and a reasonable
follow-up, but it edits a shared `lib/` contract with its own suite and has no
size pressure behind it, so it was left out of a phase whose subject was a
line-count repair rather than smuggled in beside it.

The same dead guard exists twice more, at `server/decisions/scored-batch-judge.ts:83`
and `server/decisions/artifact-criteria-judge.ts:108`, where `!("verdicts" in
parsed)` is structurally identical: in `kind: "criteria"` the only `ok: true`
return also always carries `verdicts`, so the sibling `"judge verdict shape
mismatch"` string is dead there too. No test anywhere references either string.
One `@overload` on `parsePresetJudgeOutput` retires all three, which is the
argument for doing it once rather than three times.

## 3. Budget-checker delta

**Status: repaired (R6 landed).** The measurements below are the pre-split
record. `scripts/check-source-budgets.mjs` was 311 lines with no function over
50, and it passed then: 267 changed owned files, 13 inherited entries, 0
violations. It is now 302 lines beside a 75-line `scripts/budget-lineage.mjs`
and still passes, at **303 changed owned files, 7 inherited entries, 0
violations**. Three defects shaped how much
trust the later phases could put in it; all three are gone.

**The similarity fallback could waive anything.** `bestFunction` filtered
candidates by label, and when a label was absent it compared the function
against *every* baseline function with a lexical score, waiving the finding at a
floor of 0.15. `pathAffinity` called two same-named functions in different files
"the same logical path", so a name collision scored 1.0 on its own. Measured on
this branch before the repair, three of the seven inherited entries had **no
lineage at all** and were waived that way — their files do not exist on
`origin/master` or at the merge-base:

| Entry | Matched against | Similarity | Shared run |
| --- | --- | --- | --- |
| `cli-bundle-writer.ts:writeBundle` | `server.ts:plugin/run/exportRunBundle` (104 lines) | 0.240 | 43 tokens |
| `cli-review-subject.ts:deliverableSubject` | `server.ts:plugin/qualitySeal` (66 lines) | 0.299 | 18 tokens |
| `cli-split.ts:reportSplit` | `server.ts:plugin/fanOutResearch` (59 lines) | 0.244 | 42 tokens |

`docs/runtime-architecture.md` named `deliverableSubject` as the caveat and
called it the only one; all three were affected, and the reason the file gives
for it — that its ancestor "was named differently on master" — was wrong, since
there is no ancestor on master at all. Two of the three were *bigger* than the
function that waived them and were accepted only because the old rule allowed a
token-shrink to stand in for the line growth it had actually committed.

**Split comparison bases.** `comparisonBases()` returned
`{ diff: mergeBase, debt: target, branchBase: mergeBase }`, so a file the branch
merely touched could be measured against a 199-commit-stale copy of itself. The
fork's line is gone: two bases remain, and both are on the requested ref.

**The baseline test was coupled to master's tip.**
`tests/debt-baseline.test.mjs` deepEquals the gate's `inherited` output against
`inheritedBaseline`, and those strings embedded master's own line counts — for
example `cli-bundle-writer.ts:writeBundle#1: 68 lines (baseline 104)`, a number
that had nothing to do with the file. Any advance of `origin/master` that
touched an oversized file broke the test with no code change on the branch.

### Phase 4 result (R6)

Inheritance now needs evidence, in one of three named forms, and every report
names which one applied:

- **Same file.** The symbol exists in the baseline ref at the same path. Real
  descent, and the cheapest case: an index lookup, no scoring.
- **Proven move.** A candidate in another file whose body shares a run of at
  least 20 consecutive tokens with the current one (`lineageTokens` in
  `scripts/budget-lineage.mjs`). The code travelled, so the debt travelled with
  it. `server/runtime/workflow-seeding.ts:seedWorkflow` is this case: 72 lines,
  a 64-token run out of `server.ts`.
- **A record.** `scripts/source-debt.json` holds the key and a ceiling for
  branch debt whose ancestor the gate cannot see. This is where the three
  entries above now live, at the size they actually are.

Similarity no longer appears in any of it: the multiset and bigram scorers,
`pathAffinity`'s use as proof, and the full-tree fallback are deleted, which is
also why the gate got faster (6.5s against 9.6s on the same tree — it is no
longer the slowest script in `quality:shape`).

A move that *grows* is a violation again, and a record is a ceiling rather than
a licence: recorded debt one line over its entry is reported. So is a new
function that reuses a name, a new function whose body is a verbatim copy, and a
new oversized file written in the same shape as an old one. The last of those
used to be waivable by a whole-file similarity score, the same way the function
fallback was.

The ledger is the census's old tables, moved out of
`tests/debt-baseline.test.mjs` so there is one record instead of two that can
drift. The test now reads it, keeps every ratchet, and replaces the total-count
guard (51) with a stronger one: every oversized symbol in the tree has to be
recorded, and a recorded one that stopped being oversized still has to be
dropped. It also checks that a recorded ceiling is actually over its budget.

`tests/source-budgets.test.mjs` is the new gate-level suite — nine scenarios on a
throwaway repository, run against the real checker: inherited debt, grown debt,
a same-size rewrite, a name collision with no lineage, a copied body under a new
name, a committed relocation, a recorded entry and a record that outgrew itself,
plus the two file cases. `tests/budget-lineage.test.mjs` pins the run threshold
from both sides, 19 tokens a coincidence and 20 a move.

Six of those nine scenarios are new guard rather than regression pin: run
against the checker as it was, the suite fails at the name collision, which the
old gate reported as `inherited lib/collide.mjs:alphaHandler#1: 55 lines
(baseline 55)` and exited 0 on. Dropping `lineageTokens` to 2, ignoring the
ledger, dropping the growth requirement, and dropping the recorded ceiling each
break the scenario that names them.

## 4. origin/master delta

`208` commits ahead, `6` behind, `328` files changed against the merge-base,
`+42104/-11179`, measured at `1ee4ecc` and therefore *not* counting the phase
that repaired the budget gate. Both figures drift as the branch grows — so does
the insertion count as soon as that phase is committed — which is why they are
worth re-deriving rather than reading:

```bash
git rev-list --left-right --count origin/master...HEAD
git diff --shortstat "$(git merge-base origin/master HEAD)" HEAD
```

The 6 missing commits are mostly workflow-only, but one of them is not, so every
later phase re-measures against a base that moves:

| Commit | Owned source it changes |
| --- | --- |
| `7e5d621` feat: surface BB Workflows setup status | `server.ts`, `components/settings/about-panel.tsx`, `components/settings/preset-onboarding.tsx`, `components/settings/workflow-dependency-card.tsx`, `tests/about-ui-contract.test.mjs` |
| `e0b1148` chore(master): release 0.50.0 | `package.json`, `package-lock.json`, docs |
| `940a7f4` docs: document workflow and decision boundaries | docs only |
| `50e751b`, `599f7ac`, `12c6664` | `.bb/workflows/*` only |

`7e5d621` is the one that matters for the gates: it edits `server.ts`, three
`components/settings/*` files, and a test — all five inside the owned roots the
budget gate traverses. The other five commits touch no owned root.

## Ordered repair list

Ordered by dependency, then by risk. R1 is first because it is a hard
prerequisite: R2 cannot be done honestly without it.

1. ~~**R1 — Give the three oversized GitHub inner functions behavior tests,
   and extract them while doing so.**~~ **DONE.** 43 tests in three files by
   area; the three named functions are covered and their negative controls
   were executed. The seams went to `server/` slices rather than `lib/`,
   because these are host-wired paths, not pure decisions.
2. ~~**R2 — Collapse `createGithubAutomation` (701 lines, 242-942).**~~ **DONE**
   with R3: the seam is 58 lines and holds no logic.
3. ~~**R3 — Split `server/github-issues.ts` (942 lines).**~~ **DONE.** Ten
   slices, the largest 293 lines; see "Phase 2 result" above.
4. **R4 — Decision API, starting with the zero-headroom file.** **DONE, in two
   parts, and the credit is split.** `73c4741` did the structural split:
   `server/decision-api.ts` 400 → 70 (it no longer sits *at* a ceiling,
   invisible to the gate), `createDecisionApi` 319 → 34, `setDecisionPoint` 84
   → 7 as a method in `decisionPointHandlers`, `server/decision-api-seams.ts`
   340 → 57, `createDecisionApiSeams` 271 → 15, and `vetAutoContinue` 55 → 19. The later
   phase did only what `73c4741` left open — R4's final clause, moving
   `seedFromPreset` off the 50-line line rather than leaving it at 49 beside it
   — and in doing so found and fixed a threshold that no test enforced on either
   path. See "Phase 3 result" above.
5. **R5 — Reconcile with `origin/master`.** The 6 missing commits include
   `7e5d621`, which edits owned source (`server.ts` and three
   `components/settings/*` files), and `inheritedBaseline` embeds master's own
   line counts, so master's advance invalidates the deepEqual for reasons that
   have nothing to do with the branch. The other five are release, docs, and
   workflow-only. Do this as its own reviewed merge; never rebase or widen a
   recorded range to make it quiet. R1–R4 are now landed *ahead* of this
   reconciliation rather than gated on it — the splits did not depend on it —
   so R5 is the whole of what remains **of the two areas this audit measured**.
   It is deliberately not done from this branch's own phase work: it is a merge,
   and a phase that merges cannot also claim an honest before/after for the
   merge itself. The tree-wide debt the audit deliberately did not measure is
   untouched by all of this and still pinned — 4 oversized files and 47
   oversized functions, listed in `tests/debt-baseline.test.mjs`.
6. ~~**R6 — Only then, consider the budget-checker defects in section 3.**~~
   **DONE.** The split bases and the full-tree fallback are both gone: a
   finding is inherited only through same-file descent, a run-proven move, or a
   ceiling recorded in `scripts/source-debt.json`, and each report says which.
   The gate went from 9.6s to 6.5s on the same tree, the recorded set is the
   same seven entries with the reason corrected on three of them, and the
   similarity scorers are deleted rather than tightened. See "Phase 4 result"
   above.

## Review corrections

The adversarial review of this phase re-derived every symbol length, line range,
and branch count from `origin/master` and HEAD rather than from the tables above.
Four claims did not survive:

- `LinkedDiscussionSection` is 116 lines on master and on HEAD, not 135. The
  `20-135` range in the same row had been copied into both count columns.
- The factory holds 91 nested functions, 88 of them under 50 lines — not "25
  nested functions, 22 under 50". The conclusion is unchanged: only the shell and
  the three named inner functions are oversized.
- The branch was 200 commits ahead at the time, not 199, and the section 4
  diffstat was stale in both directions. It now names the commit it was measured
  at and the commands that re-derive it, because the figure changes with every
  phase. (It has since moved again — section 4 is the current figure.)
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
  was bounded only by the total count. All 56 were pinned then, and every one
  still is; growing `lib/question-batch.mjs:parseAskGroups` from 80 to 110 lines
  fails the test with its own name, where before it passed. The set has since
  shrunk to 47 as R1–R4 landed, and the total is separately ratcheted at 51.

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
