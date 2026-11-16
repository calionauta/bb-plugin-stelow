---
version: 1
product_type: software
generated_by: stelow-workflow-testing-ai-code
generated_at: 2026-10-28
workflow_id: card_rbkbfyqy
task: planning-testing
recipe: planning-research
quality: production
appetite: Lean
product_context: hybrid
ui_scope_present: true
shape_version: spec-product_v2
scope_map_version: card-rbkbfyqy-scope-map-v1
decision_reads:
  - dec_xpc78x6q (selection: D-hybrid-chip-with-own-drawer, scopes 3 and 4)
workspace: /home/deploy/repos/bb-plugin-stelow
checkout: fix/inbox-row-mobile-reflow at 68849b42 (= v0.87.0-13); newest tag v0.100.1
---

# Testing strategy — recent deliveries view (slice B)

## Inputs and assumptions

- **Quality `production`** from `plans/spec-product.md` frontmatter (v2, approved). Production sets
  breadth: critical paths get negative cases and recorded mutation proof; standard paths get core
  paths plus the obvious edges. Appetite `Lean` narrows how many *surfaces* exist, never which gates
  run — a Lean card with a wrong read is still a wrong read.
- **Product context `hybrid`.** New code: `lib/project-releases.mjs`, `server/runtime/project-releases.ts`,
  `server/project-releases-contract.ts`, two board components, one node test per layer. Existing code
  the card must not break: `runGitIn` (`server/runtime/git-evidence.ts:61-79`) and its five card-surface
  consumers, `parseReleaseTag`/`compareReleaseTags` (`lib/github-release.mjs:19,27`),
  `components/board/flow-strip.tsx`, `server/card-rpc-contract.ts` (373/400 lines), the shared drawer
  shell, and `FEATURES.md`. Those get regression obligations, not new tests where a test already exists.
- **No `spec-tech.md` exists yet**, so risk levels here are *derived* from the approved spec-product
  (its Dangers table D1–D9), the five scopes, and the measured stack research
  (`runs/exec_1u1m1qu8/plans/stack-research.md`). They are marked derived, and no critical path is
  invented: the two Critical rows are the two layers whose whole purpose is to stop a confident wrong
  claim.
- **UI is in scope**, so accessibility checks are mandatory. Unlike the 2026-10-01 strategy, this
  checkout *does* have a DOM harness: `happy-dom@20`, `@testing-library/react@16.3`, `axe-core@4.11`,
  with two working precedents — `tests/flow-drawer.test.mjs` (rendered drawer placement) and
  `tests/rendered-ui-audit.test.mjs` (axe over a real tree, including a knowingly broken tree that
  must be flagged). "Is the chip there and does opening it keep the board mounted" is therefore a
  rendered claim, not a source pin.
- **Test authorship is a plan constraint, not a review surprise** (scope-map open decision 5). Three of
  five scopes carry test obligations; a fresh-context author or red-teamer writes the parser cases, the
  reader's absence cases and the contract refusal cases. The implementing agent turns frozen text green
  and never authors its own only test.

## Tech Stack

| Concern | Tool | Detection |
|---|---|---|
| Language | Node 22.22.2, TypeScript 5.7 strict (`tsc --noEmit`), `.mjs` for pure modules | `package.json`, `tsconfig.json`, `node --version` |
| Unit | `node:test` + `node:assert/strict` (`node tests/*.test.mjs`) | `package.json#scripts.test` |
| TS unit | `node --experimental-strip-types --import ./tests/register-ts-source.mjs --test <files>` | `scripts.test:github-runtime` |
| Rendered UI | `register-tsx.mjs` + `dom-setup.mjs` (happy-dom + testing-library) | `scripts.test:kanban-layout`, `tests/flow-drawer.test.mjs` |
| Accessibility | `axe-core`, WCAG 2.0/2.1/2.2 A+AA tags only | `tests/rendered-ui-audit.test.mjs` |
| Lint | `oxlint app.tsx server.ts server components hooks lib tests` | `scripts.lint` |
| Shape / budgets | `check-source-shape.mjs` (400 file lines, 50 function lines, 160 chars) + `check-source-budgets.mjs` (roots include `tests/`) | `scripts.quality:shape` |
| Suite boot cost | `check-test-boot-cost.mjs` — measured today **475 leaf commands, 466 start node (98.1%)**, `~14.9 s` of pure boot per full run, ceiling **99.8%** | `scripts.quality:shape` |
| Architecture | `dependency-cruiser` (no `lib/` → `server/` edge) | `scripts.architecture` |
| Duplication | `jscpd --min-lines 30 --min-tokens 150` over `tests` too | `scripts.duplicates` |
| Dead code | `knip` (non-blocking today) | `scripts.deadcode` |
| Security | `npm audit --omit=dev --audit-level=high` | `scripts.security:production` |
| Coverage | **none configured — do not add one** | `package.json` (no c8/nyc/vitest) |
| Suite wiring | `tests/suite-wiring.test.mjs` fails any `tests/*.test.mjs` not referenced by a `package.json` script | the file itself |
| Declaration surface | `tests/declaration-surface.test.mjs` — fails when a declared name is unbound (257 `.d.mts` files measured today) | the file itself |

Two measured constraints shape the whole plan:

1. **Boot cost is a real budget.** 98.1% of leaf commands are separate node processes against a 99.8%
   ceiling whose own docstring says *never raise it to accommodate a new command; fold the test
   instead*. The new test files therefore join an existing multi-file `node --test` invocation (one
   process for the pure + contract tests, one for the reader, one for the rendered surface), and the
   ceiling is not touched.
2. **Every `components/**.tsx` is swept by the token tests without a file list.** `card-design-tokens`
   walks `components/` recursively, so the new chip and rows are policed the moment they land: a
   re-spelled `<summary>`, a raw `text-[12px]`, or a `line-clamp-*` sharing a class list with `block`
   fails without anyone remembering to register the file. The corollary is a rule for this card: **do
   not add a new file to `SECTION_FILES` to make a check reach it, and do not leave it out to make a
   check miss it** — the surface is board chrome, and the exemption gets named in the review receipt.

## Coverage and Risk Targets

| Path Type | Examples in this card | Required Evidence |
|---|---|---|
| **Critical** | `lib/project-releases.mjs` (ordering, tag↔notes matching, body bounds, takeaway extraction, absence enumeration); `server/runtime/project-releases.ts` (six typed states, deadline, buffer bound, no-repo vs path-missing split) | One node test per dialect and per refusal; negative cases for every absence state; a **recorded hand-mutation** per critical invariant (seven below), each naming the test that goes red; totality proven by sorting the same input twice; a timezone-pinned day assertion; `npm run typecheck` |
| **Standard** | `server/project-releases-contract.ts`, the wiring handler, `components/board/release-strip.tsx`, the drawer body, `FEATURES.md` entry | Contract refusal shapes asserted verbatim; a rendered test for the three board states and the no-reflow claim; placement asserted through `lib/drawer-side.mjs`, never a class string; axe clean; one feature-inventory line matched to measured behaviour |
| **Experimental** | **none, and that is the honest answer.** The one unsettled reading is the fleet line's "how many shipped" (projects carrying a release record vs projects whose newest tag is inside the window — scope-map open decision 2) | The assertion is written only after the gate settles the claim; until then the test pins the *shape* (a count and a "carry none" count are both present and never conflated with `FlowStrip`'s finished-card count), not a number |

Critical is not a label for "new code". It is this card's only risk domain, named in the spec: *a
confident wrong claim*. Eight of the operator's fourteen projects answer with an absence, and three of
six release-bearing checkouts sit behind their own tags, so a read that is merely plausible will be
wrong on the machine that uses it.

## Test Scopes

All paths are relative to the workspace. `test-unit`/`test-contract` are node processes; `test-behavior`
is rendered; `test-regression` is an obligation to keep an existing suite green rather than a new file.

| # | Scope | Type | Evidence owed |
|---|---|---|---|
| 1 | Pure release module (`lib/project-releases.mjs`) | `test-unit` | `tests/project-releases.test.mjs` — one case per dialect, per absence, per refusal; window and flag readings; total order; explicit day formatting |
| 2 | Declaration parity for the new pure module | `test-contract` (existing) | `lib/project-releases.d.mts` present, every export bound; `declaration-surface.test.mjs` green with no baseline widening |
| 3 | Strict reader (`server/runtime/project-releases.ts`) | `test-integration` | `tests/project-releases-reader.test.mjs` — real temp repos on disk for the six states; injected exec *only* for the deadline and buffer bounds |
| 4 | `runGitIn` untouched (five card surfaces keep fail-soft) | `test-regression` | `git-evidence` behaviour unchanged; `npm run test:card-details`, `test:paths`, `test:worktree-reclaim` green; no edit to the five consumers |
| 5 | `projectReleases` contract + wiring | `test-contract` / `test-integration` | `tests/project-releases-contract.test.mjs`: input tolerance and refusals, no `undefined` key in any output, two states distinct on the wire, reachable from the composed `rpcContract`; handler composition with an injected reader |
| 6 | Board chip + slide-over surface | `test-behavior` (rendered) | `tests/project-releases-surface.test.mjs`: three states, fixed phrase for a missing takeaway, board still mounted after opening, starts closed, independent of `FlowStrip` |
| 7 | Accessibility of chip and rows | `test-a11y` (rendered) | axe WCAG A/AA over the chip and the open drawer: 0 violations; the chip is a real control with an accessible name that carries the release |
| 8 | Injection and path hygiene on the strict reader | `test-security` | A project directory whose *name* carries shell metacharacters never executes anything; no absolute path reaches the wire |
| 9 | Feature inventory and portable pattern | `test-regression` + recorded proof | `FEATURES.md` section 2 bullet states measured behaviour; upstream blueprint proposal recorded; `dist/` grep recorded as commit evidence, never as a test |
| 10 | Full suite | `test-regression` | `npm test` green before push; new files wired into scripts or `suite-wiring` fails |

### Scope 1 — the parser, case by case

Each case names the wrong behaviour it catches; a case that cannot name one is deleted.

1. **Four dialects parse** — release-please linked, Keep-a-Changelog dashed, semantic-release bare,
   `v` inside the bracket (`## [v0.1.1] - ...`). Catches a regex narrowed to this repository's own
   heading form, which would silently empty ai-credits.
2. **Body ends at the next release heading** — a body containing `## What's Changed` still yields the
   release's own takeaway. Catches D4 at full size: gogogo carries 31 of those headings, and splitting
   at the next `## ` produced one-bullet fragments.
3. **`[Unreleased]` is excluded by the version pattern**, not by being first. Catches a rule that holds
   only until someone writes a changelog with `[Unreleased]` at the bottom.
4. **Tag↔notes matching is exact normalised text** — one leading `v` stripped on either side, prerelease
   kept. Catches `compareReleaseTags` being reused here: it compares the numeric triple and treats
   `0.84.1-alpha` as `0.84.1`, which would lend a prerelease the stable release's notes.
5. **Archive/backup tags never become rows** — `archive/stash-0`, `backup/...`, `pre-merge-backup`.
   Reuses `parseReleaseTag`, which already pins `dev → null` in `tests/github-release.test.mjs`.
6. **Ordering is by tag day, then version text** — the stelow case: `v1.4.5-alpha` (12 Sep) sits beside
   `v0.86.0-alpha` (27 Oct), so version order puts a six-week-old release on top. Catches D2.
7. **The order is total** — sorting the same input twice is deeply equal, and two releases sharing one
   date never swap places between renders. Catches D6 without quoting "37 in a day": the number is
   re-measured at execution, the rule is what is asserted.
8. **`day` comes from one explicit formatter over the tag's unix timestamp** — the same input renders
   the same `YYYY-MM-DD` under `TZ=UTC` and `TZ=America/Sao_Paulo`. Catches `%(creatordate:short)`,
   which is process-timezone formatted and would make one release read as two days on two hosts.
9. **Takeaway: indented prose paragraph → first bullet → `null`**, in that order, and never labelled an
   explanation when it came from a bullet. Catches a fallback that invents prose, and a row that renders
   empty instead of the fixed phrase.
10. **The window is five rows, not five days** — a project releasing twice a day and a project
    releasing monthly both get five. Catches a day-span reading that fits none of the six projects.
11. **The module is clock-free and I/O-free** — same inputs with `Date.now` forced to two different
    values produce identical output. Catches a `new Date()` creeping in during refactor, which is the
    usual way a pure module stops being pure.

### Scope 3 — the reader, case by case

Real repositories under `mkdtempSync` (the `tests/git-common-dir.test.mjs` idiom), because a mocked
`execFile` proves only that the mock was called.

1. **Six states, one per fixture**: `ok`, `no tags`, `no release record` (tags but no parsable heading),
   `no repo`, `path missing`, `unreadable`. Each state's string is asserted verbatim.
2. **`unreadable ≠ no tags`** — an unreadable repo never renders the `no tags` sentence. This is the
   card's central assertion; it fails the moment the reader reuses `runGitIn`'s fail-soft mapping.
3. **`no repo` and `path missing` are different sentences** — one fixture with no default source, one
   with a path that no longer stats. `projectRoot`'s single `null` is split at this boundary.
4. **Row-level `no notes`** — a tag whose changelog entry does not exist is a row that says so, not a
   dropped row and not an empty row.
5. **Deadline** — injected exec that never settles: the call resolves within the aggregate deadline,
   the slow project reads `unreadable`, and every other project still answers. Injected here because a
   real 15-second stall is neither deterministic nor cheap in CI.
6. **Buffer bound** — injected exec emitting more than the bound reads `unreadable`, never
   truncated-to-empty. Catches the `execFile` 1 MB default silently truncating a growing changelog.
7. **Backup tag never survives into the spine**, asserted at the reader (fixture repo with a real
   `archive/stash-0`), not only in the parser.
8. **Two-command discipline** — a project read that never opens a drawer never reads a changelog blob.
   Observable by counting invocations of the injected exec; catches the board render growing a
   subprocess.

### Scope 6 — the surface, rendered

1. Project selected → one chip naming version and day; no project → fleet line naming the newest
   release and how many shipped. Both at fixed height.
2. **A project with releases and zero finished cards still shows the chip** — render with a flow
   summary of `count: 0`. Catches mounting inside `FlowStrip`, which returns `null` at
   `flow-strip.tsx:44`.
3. Opening the chip mounts the drawer **and leaves the board mounted** — assert the board's own node is
   still in the document and not hidden. Catches the inline-expander bug the flow strip's docstring
   records.
4. Placement is asserted through `lib/drawer-side.mjs` (`drawerPanelClass("right")`), never by matching
   a class string — the `tests/flow-drawer.test.mjs` rule.
5. Each of the six absence states renders its own sentence and none reads as "nothing shipped".
6. Starts closed; re-reads when opened (no refresh button, no age stamp — absence is asserted, because
   a control that reappears later is how a "no refresh" claim quietly dies).
7. A release with no takeaway shows the fixed phrase rather than an empty row.

## Mutation fit and the recorded hand-mutation gate

Mutation scores are not a target and full-suite mutation is not a gate (oracles, not scores, are the
bottleneck). The cheap, mandatory version is one recorded hand-mutation per critical invariant: invert
the behaviour, run the named test, observe red, record the observed failure in the run receipt. A guard
that stays green under its own mutation is rejected, not filed.

| # | Mutation (what to break) | Test that must go red |
|---|---|---|
| M1 | Sort by version descending instead of tag day | Parser case 6 (stelow's two lines) |
| M2 | End the body at the next `## ` | Parser case 2 (gogogo's 31 body headings) |
| M3 | Match notes through `compareReleaseTags` | Parser case 4 (`0.84.1-alpha` vs `0.84.1`) |
| M4 | Collapse `unreadable` into `no tags` in the reader | Reader case 2 |
| M5 | Drop the five-row clamp | Parser case 10 |
| M6 | Format the day with `%(creatordate:short)` | Parser case 8 (two timezones) |
| M7 | Mount the chip inside `FlowStrip` | Surface case 2 (releases, zero finished cards) |

Mutation fit is **high** for scope 1 and 3, **low** for 2, 5 and 9 (declaration and contract wiring:
a mutant that renames a key is caught or it is not, and chasing it costs more than it signals), and
**not applicable** beyond M7 for 6 and 7, where the failure is a rendered absence rather than a logic
branch.

## CI/CD Gates

Blocking, all expressed as conditions on real commands. Nothing here is an advisory wish. The CI
workflow runs exactly `typecheck`, `quality:shape`, `quality:report`, `architecture`, `npm test`,
`check:pin-provenance` and `security:production`; `lint` and `quality:shape` additionally run as the
repository's commit hook, so a finding on new code fails the commit rather than a CI job hours later.

1. **BLOCK** — `npm test` exits non-zero, or any new `tests/*.test.mjs` is not reachable from a
   `package.json` script (`tests/suite-wiring.test.mjs` is the enforcement; a test outside the suite is
   a hope).
2. **BLOCK** — `node scripts/check-test-boot-cost.mjs` fails, **or its ceiling was raised**. New tests
   fold into one existing `node --test` invocation per lane; the 99.8% ceiling is untouched.
3. **BLOCK** — `npm run typecheck` exits non-zero.
4. **BLOCK** — `npm run quality:shape` or `npm run quality:report` exits non-zero: a new source or test
   line over 160 chars, a file over 400 lines, a function over 50, or a new budget violation not carried
   by the baseline.
5. **BLOCK** — `npm run lint` reports findings in the changed files (it is a pre-commit hook here; a
   finding on new code is a failed commit, not a later cleanup).
6. **BLOCK** — `npm run architecture` reports a new `lib/` → `server/` (or reverse) edge. The pure
   module must not grow an import of the reader.
7. **BLOCK** — any of the five absence states renders as "nothing shipped", or two states share one
   string. The assertion is behavioural (rendered sentence per state), and its mutation (M4) is recorded.
8. **BLOCK** — a recorded hand-mutation leaves its named test green. Seven mutations, seven red tests;
   a missing receipt blocks the diff gate, because a guard nobody inverted is a guard nobody has tested.
9. **BLOCK** — axe reports any WCAG A/AA violation on the rendered chip or open drawer.
10. **BLOCK** — `npm run security:production` reports findings, **or** the strict reader interpolates a
    project path or tag into a shell string instead of passing argv to `execFile` with `shell: false`.
    Named test: a directory literally called `a;touch pwned` is read without creating `pwned`.
11. **BLOCK** — a test asserts a number quoted from the spec (41 same-day groups, max 37, 242 KB,
    `v0.100.1`) instead of the rule that survives re-measurement. Quoted numbers drift within a day;
    that is why the strategy asserts the rule.
12. **BLOCK** — the rendered surface test pins a Tailwind class for placement instead of calling
    `lib/drawer-side.mjs`, or a new file is added to `SECTION_FILES` to reach a check it should pass on
    its own merits.
13. **WARN** — flaky rate above 5%. Any test that depends on wall-clock time, network or a shared temp
    path counts as flaky by construction and is a defect, not a retry candidate.

## Test authorship and the fail-observed boundary

- Cases are described by this plan (the human-side artifact) and **authored or red-teamed from a fresh
  context** for the parser, the reader's absence states and the contract refusals. The implementing
  agent may run them, and must not be their only author.
- Where a guard is used, the sequence is FAIL-OBSERVED-FREEZE-PASS: observe the planned case failing
  before implementation, record the observed failure, freeze the test text, then implement to green.
  The frozen text is never edited to make it pass.
- **No mandated in-loop TDD ritual** for the implementer. ProgramBench 2026 measured a mandated cycle at
  −3.6pp pass rate for +55% cost, and DeepSWE 2026 measured zero gain from agent-written
  unit/integration tests. Independent case authorship is the lever; the ritual is not.
- Targeted locally, full in CI: run the impact subset during work (`test:github-release`,
  `test:kanban-layout`, the new files), then `npm test` once before the push.

## Anti-Patterns

- ❌ **A coverage number, or adding a coverage tool to reach one.** None is configured; 100% is not a
  goal and adequacy is not achievable.
- ❌ **Mocking git in the reader test.** Real temporary repositories for the six states; the only
  injected seam is the deadline and the buffer bound, which real disk cannot produce deterministically.
- ❌ **> 3 mocks per test, or a mock for a plain object.** A tag row is `{version, day}` — construct it.
- ❌ **Presence tests** — "the file exists", "the class is present", "the dist bundle contains the
  string". The `dist/` grep is release evidence recorded in the commit trail; it is not, and must not be
  written as, a test.
- ❌ **Unreasoned oracles** — an assertion that cannot name the wrong behaviour it catches.
- ❌ **Assertion roulette** — one behaviour per case; a failure must name its cause without bisecting.
- ❌ **Circular validation** — the same context writing the parser, its fixtures and its verdict on
  whether the fixtures are right; and no same-model judging of its own equivalent mutants.
- ❌ **Quoting a measured constant as a requirement** (D6's "35 releases in a day"). Assert the rule.
- ❌ **Suite growth without pruning.** New test files are earned by a failure mode; when parser cases
  duplicate `tests/github-release.test.mjs`'s tag filter, delete them and call the pinned function.
- ❌ **A test that needs a browser.** No Playwright, no chromium: the rendered lane is happy-dom, and a
  plan step needing a real browser is a bad step.
- ❌ **Wall-clock or timezone dependence.** The only clock-adjacent rule is the day formatter, and it is
  pinned under two `TZ` values.
- ❌ **Copying a 30+ line block between tests** — `jscpd` runs over `tests/` at 30 lines / 150 tokens.

## Risk-based feedback loop

1. Name the missed behaviour (a wrong newest release, a collapsed absence, a row without text).
2. Add one case that captures the invariant, in the layer that owns it.
3. Run the affected file, then the lane (`test:kanban-layout` for the surface, the reader suite for
   scope 3), then `npm test`.
4. Feed the invariant back into the scope table above, so the next card inherits it.

## What this strategy does not cover

- **No coverage metric and no mutation score**, by design; the signals are behavioural assertions plus
  seven recorded mutations.
- **No real fleet mutation**: the reader is exercised against fixtures, not against the operator's six
  repositories. The measured fleet facts (14 projects, 6 with tags, 8 absences) are used to choose
  fixtures and must be re-measured, never asserted.
- **No real browser, no screenshot, no visual regression**: the a11y lens runs on a component fragment,
  so it cannot judge page-level landmarks (which is why `rendered-ui-audit.test.mjs` scopes axe to
  WCAG tags only).
- **The `min-h-11` / `cursor-pointer` touch-target rule remains stated, not tested.** A rendered test
  could assert the class, but that is exactly the presence pin this document bans; it stays a review
  obligation, recorded honestly rather than dressed as a gate.
- **The fleet line's wording** waits for the scope gate's decision on what "how many shipped" counts.
  The strategy pins the shape today and the sentence after the decision.

---

## Hand-off (workflow mode)

```
stage          : planning
task           : planning-testing
status         : done
artifacts      : runs/exec_1u1m1qu8/plans/testing-strategy.md
next-candidate : planning-alignment
gate           : none (this task has humanBoundary: none)
rework-on      : architecture
```

Nothing outside this artifact was written. `state.md`, gates and completion state were not touched.
