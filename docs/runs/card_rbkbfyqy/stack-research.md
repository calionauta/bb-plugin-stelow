---
stage: planning
task: planning-stack
recipe: planning-research
skill: stelow-workflow-tech-planning
workflow_id: card_rbkbfyqy
generated_at: 2026-10-28T22:10:00Z
workspace: /home/deploy/repos/bb-plugin-stelow
scope_of_this_run: tech:5 (Discover Stack) only
intent: feature
appetite: Lean
product_type: software
ui_scope_present: true
decision_reads:
  - dec_xpc78x6q (selection: D-hybrid-chip-with-own-drawer, scopes 3 and 4)
checkout_state: branch fix/inbox-row-mobile-reflow at 68849b42 (= v0.87.0-13); newest tag v0.100.1
---

# Stack research — recent deliveries view

## 1. What this artifact is

This run delivers `tech:5 — Discover Stack` from the tech-planning skill: the technology base the
five scopes must be built against, and the stack facts that make some of them cheap and others
wrong. It does not produce `spec-tech_v1.md`, does not touch `state.md`, and does not approve
anything. Scope generation (`planning:10`) starts from §3 and §6 below and must not re-derive them.

Prerequisites are met: `plans/spec-product.md` carries `approved: true` (v2, 2026-10-28, three
questions answered at the gate). The scope map is `draft` and names the five scopes this research
serves — `scope-1-release-record-module` through `scope-5-inventory-and-proof`. The interface
selection `dec_xpc78x6q` (labelled chip with its own slide-over) is compatible with every finding
here; nothing below asks for a dependency the chip would need.

## 2. Detection, and why no stack question was asked

The skill's detection ran against the checkout: `package.json` present, `go.mod`/`Cargo.toml`/
`pyproject.toml` absent → `stack_source: existing:node`. Per the skill, a brownfield detection asks
nothing and runs no web comparison. There is no greenfield stack choice to make here, and picking
one would be the plan's first mistake: the feature has to live inside a plugin the host already
loads.

```yaml
tech_stack:
  primary: "node 22.22.2 + react 19.2 + typescript 5.7 (strict, noEmit, skipLibCheck:false) — bb plugin, SDK 0.4.108"
  ui: "tailwind v4 utilities + hand-written primitives in components/ui (no component library)"
  validation: "zod 4.6.7, contracts via defineRpcContract + composeRpcFragments"
  storage: "better-sqlite3 (dev) — not used by this feature"
  external_binary: "git 2.43.0 — the only runtime dependency this feature adds, and it is already the repo's"
  test: "node:test (+ --experimental-strip-types); rendered tests via happy-dom + @testing-library/react"
  lint_shape: "oxlint + scripts/check-source-shape.mjs (400 file lines, 50 function lines, 160 chars) + check-source-budgets"
  build: "bb plugin build && node scripts/postbuild.mjs; reload via bb plugin reload stelow"
  stack_source: "existing:node"
```

Versions are the ones installed in this checkout (`node_modules/zod`, `node --version`,
`git --version`), not the `^` ranges in `package.json`.

## 3. The only new external surface is `git`, and it behaves exactly as measured

No package is added. The reader shells out to the same binary the rest of the plugin already shells
out to, through a new runner because `runGitIn` (`server/runtime/git-evidence.ts:61`) collapses every
failure into `""` — which is the confusion this card exists to remove. The five capabilities the
plan depends on, each verified on this host today:

| Capability | Command | Verified result |
|---|---|---|
| Read every tag, regardless of the branch the checkout sits on | `for-each-ref --sort=-creatordate --format='%(refname:short) %(creatordate:unix)' refs/tags` | Works from a checkout 13 commits past `v0.87.0` on a feature branch; `v0.100.1` is visible |
| Tag date for both tag kinds | `%(creatordate:…)` | 416 tags: 297 lightweight (commit date) + 119 annotated (tagger date). One format covers both |
| Changelog text at a tag, not in the working tree | `git show <tag>:CHANGELOG.md` | 247,989 B at `v0.100.1` vs 231,883 B on disk at `v0.87.0` |
| Many releases share one day | `--sort=-creatordate` | 48 distinct days, 41 days carrying more than one release, max 37 in a day (`2026-09-15`) |
| Fleet cost | six repos in parallel | spine 30 ms wall (16–42 ms per repo); changelog blobs at tag 23 ms wall, largest 242 KB |

Two traps the reader must not step in, both measured:

1. **`git show` cannot tell you why it failed.** A missing path in the tree
   (`NOPE.md` at an existing tag) and a missing tag (`v9.9.9`) both exit **128**. The stderr text
   differs, and branching on stderr is a version-fragile habit. Use two steps: `rev-parse --verify
   refs/tags/<name>` (0/1, clean) and then `cat-file -e <tag>:CHANGELOG.md` (0/128). `^{tag}` peeling
   is **not** a usable existence check — it exited 1 with a type error on this repo's lightweight tags.
2. **`%(creatordate:short)` is formatted in the process timezone.** The day the wire carries must be
   derived from `%(creatordate:unix)` by one explicit formatter in the reader, or the same tag can
   read as two different calendar days on two hosts. The spec already says `day` is computed in the
   reader; this is the reason.

`execFile` defaults matter too: `maxBuffer` is 1 MB by default, so a 242 KB blob is already at a
quarter of it while growing every release. The planned 4 MB is ~16× the largest blob measured and
costs nothing when unused.

## 4. What the fleet actually looks like, measured today

`bb project list` returns **14 projects** on this host. Their shape, checked one by one:

| Shape | Count | Consequence |
|---|---|---|
| Git repo with semver tags | 6 | The only projects that can render a release row |
| Git repo with no tags (`sessionmap`) | 1 | `no tags` state — a fact about the project, not a fault |
| Existing path that is not a repository | 6 | `no repo` state |
| Path that does not exist (`/tmp/opencode/e2e-card-proj`) | 1 | `path missing` — distinct from `no repo`, and the distinction is only visible if `fs` statistics run before `git` does |

So eight of fourteen projects answer with an absence, and the design's claim that absence is a state
rather than an empty list is not a nicety — it is the majority case on the operator's own machine.

**The working tree lies, and here is the size of the lie.** This checkout sits at `v0.87.0-13`; the
newest tag is `v0.100.1`, dated today. Read the changelog from the tree and you get **311 documented
version headings** with the newest ten tags all reading as undocumented; read the same file at
`v0.100.1` and you get **332 documented version headings**, the newest release included. `stelow`
shows the same gap at rest: 89 of its 231 tags (39%) have no changelog heading, and its changelog
sits three tags behind its newest release.

**Version order is wrong here, measurably.** `stelow` carries `v1.4.5-alpha` (2026-09-12) beside
`v0.86.0-alpha` (2026-10-27). Sorting by version puts a six-week-old release at the top of a project
whose last release was yesterday. Tag date descending, version text as tie-break, is the only order
that survives this fleet.

**Six changelogs, four dialects, one of them hostile to naive parsing.**

| Project | Heading form | `## ` headings | Version headings | Non-version `## ` |
|---|---|---|---|---|
| bb-plugin-stelow | `## [0.100.1](…compare…) (2026-10-28)` | 333 | 332 | `[Unreleased]` |
| ensaiter | same release-please form | 105 | 105 | — |
| stelow | `## [0.84.1-alpha] - 2026-10-22` | 143 | 142 | `[Unreleased]` |
| degustia | `## [0.2.1] - 2026-08-09` | 13 | 12 | `[Unreleased]` |
| ai-credits | `## [v0.1.1] - 2026-08-28` (the `v` is inside the bracket) | 6 | 6 | — |
| gogogo-fullstack-template | `## 0.59.1 (2026-10-28)` | 143 | 112 | 31 × `## What's Changed` |

The last row is the D4 danger, confirmed at full size: splitting at the next `## ` would cut that
project's entries into 31 fragments whose bodies are one bullet long. Split at the next heading that
*parses as a release*, not at the next `## `. The `ai-credits` row is the second half of the same
lesson: tag matching must normalise one leading `v` on either side, or that project's five tags match
nothing.

Two smaller facts that shape the parser: `parseReleaseTag` (`lib/github-release.mjs:19`) strips the
prerelease suffix, so `v0.84.1-alpha` and `v0.84.1` compare equal — correct for a filter and a
tie-break, wrong for matching a changelog entry, which needs the exact text. And non-version tags are
real: 7 in this repo (`archive/stash-0` …), 3 in `stelow`, 2 in `gogogo`, 1 in `ensaiter`.

**Numbers in the spec have already drifted.** The shape pass recorded 32 same-day groups, max 35, a
244 KB blob and newest tag `v0.99.0`; today it is 41 groups, max 37, 242 KB, `v0.100.1`. Scope
generation must carry the *rule* (tie-break is load-bearing) and re-measure the number at execution,
never quote the figure as a constant.

## 5. Stack-shaped constraints on the five scopes

These are not style preferences; each is a gate that fails a commit.

1. **`lib/` modules are `.mjs` + a hand-written `.d.mts`.** `tests/declaration-surface.test.mjs`
   checks that every declared name is bound in the sibling module (190 declaration files, 718 names).
   A pure release module without its declaration file is a red gate, and a declaration that advertises
   a function the module no longer exports is the lie that test was written for.
2. **Shape budgets are 400 file lines / 50 function lines / 160 characters per line**, enforced on
   changed files by `test:source-shape` + `test:source-budgets`. A parser that handles four dialects,
   five absence states and a total order will cross 50 lines per function unless split by
   responsibility (dialect split, takeaway extraction, ordering) rather than by convenience.
3. **`server/card-rpc-contract.ts` is at 373/400 lines.** Adding `projectReleases` there is a budget
   regression by construction. The house answer exists: fragments compose in `server/rpc-contract.ts`
   (duplicate keys throw at import), and `github-rpc-contract.ts` / `scope-map-rpc-contract.ts` are
   precedent for a standalone contract file registered in `RPC_FRAGMENTS`.
4. **Handlers are built at module scope, not inline in the handler table.**
   `server/runtime/wiring/rpc-surfaces.ts:67` documents why (`buildFlowMetrics`: pure read plus a
   fail-soft async read composed in one function). That file is 316 lines — a sibling wiring module
   for the releases read keeps it under budget and keeps the precedent readable.
5. **Input contracts take `optionalInput`.** A new RPC must accept `null` for "no argument" or every
   caller that omits it fails shaped-input validation; the docstring in `server/rpc-input.ts` records
   the SDK typing rule. Output fields are required with `nullable` where empty — a `undefined` key
   disappears from the payload, and the house rule is that a client never branches on a missing key
   (`tests/card-briefing.test.mjs:153`).
6. **The slide-over already exists as a prop.** `components/ui/responsive-drawer-shell.tsx` takes
   `side?: "bottom" | "right"` (default bottom); `FlowStrip` uses `side="right"` and
   `tests/flow-drawer.test.mjs` asserts placement by calling `lib/drawer-side.mjs`, not by matching a
   class string. The chip therefore needs zero new UI dependency, and its placement test should follow
   the same rendered-DOM idiom (happy-dom + testing-library, `npm run test:rendered-ui`).
7. **The chip must not live inside `FlowStrip`.** That component returns `null` when
   `summary.count === 0` (`components/board/flow-strip.tsx:44`), so a chip mounted there would vanish
   on a project with releases and no finished cards — the exact coupling §"surface" of the spec
   forbids.
8. **One type step, no icons.** `lib/design-tokens.ts` names the scale (`TEXT_STATE`, `TEXT_SECTION`,
   `TEXT_BODY`, `TEXT_META`, `TYPE_SCALE`) and `text-[11px]` is counted against a ratcheting ceiling.
   The chip and the rows use a named step; nothing new enters the scale.

## 6. What must not be added

- **No dependency.** Everything needed is Node's `child_process`, `node:fs`, zod (already a
  dependency) and the existing drawer shell. A changelog parser would be a dependency, a second
  dialect opinion and a version to track — the four dialects above are cheaper to read than to adopt.
- **No cache layer in this plan.** Tags are append-only, and both fleet reads together cost ~53 ms
  warm (30 ms spine + 23 ms of blobs, the latter only when a drawer opens). A cache
  buys milliseconds and costs an invalidation story for a feature whose source never rewrites.
- **No change to `runGitIn`.** Its fail-soft contract serves five card surfaces; the truthfulness this
  card needs is a new runner with typed failures, and the two runners coexisting is the accepted cost
  recorded in `architecture/selected-architecture.md`.
- **No GitHub Releases API.** Already out of scope in the spec, and the stack agrees: no token, 60
  requests/hour unauthenticated, and nothing to say about a project whose notes are only local.

## 7. Risks the downstream plan inherits

| # | Risk | Stack evidence | What the plan must carry |
|---|---|---|---|
| R1 | Contract growth breaks the file budget | `card-rpc-contract.ts` at 373/400 | New fragment file + registration; never an inline addition to the 373-line file |
| R2 | Parser grows one file over 400 lines and functions over 50 | dialects + states + ordering in one module | Split by responsibility at scope-1, with the dialect table as data |
| R3 | Absence tests pass while the reader still says "no releases" for a broken repo | `git show` exits 128 for both causes | A test that asserts `unreadable ≠ no releases`, and a two-step existence check |
| R4 | A rendered-surface test pins a class string and passes on broken layout | `tests/flow-drawer.test.mjs` calls `lib/drawer-side.mjs` | Keep placement rules in a pure module, assert rendered DOM |
| R5 | Numbers in the spec are quoted as constants and go stale | 32→41 groups, 35→37, 244→242 KB, 0.99.0→0.100.1 in one day | Re-measure at execution; assert behaviour, not the count |
| R6 | Changelog read cost grows with history | 242 KB now, append-only | Bounded read (4 MB, 10 s) plus a per-project settle, so one huge file cannot stall the fleet call |

## 8. Limitations of this research

Everything above was measured on this host, on this checkout, today; the two `bb` reads
(`bb project list`, `git for-each-ref`) are the only fleet-wide probes. No browser was driven and no
drawer was rendered — the placement claim is read from source and from the test that already guards
it. `npx skills` and `npx @vedanth/context7` were not run: no new library API is being written
against, and the standards skill is already installed at `.agents/skills/` (detection-first rule).

## 9. Handoff

```
stage          : planning
task           : planning-stack
status         : done
artifacts      : runs/exec_1u1m1qu8/plans/stack-research.md
next-candidate : planning-testing (plans/testing-strategy.md), then planning-alignment
gate           : none (this task has humanBoundary: none)
rework-on      : architecture
```

Nothing outside this artifact was written. `state.md`, gates and completion state were not touched.
