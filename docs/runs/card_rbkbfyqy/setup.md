# Repository recon — `setup` stage

**Card intent:** `feature` — "Slice B — Recent deliveries view: per-project summary of what
recently shipped plus takeaways, reading CHANGELOG/release notes rather than duplicating
delivery records."
**Stage:** `setup` (`repository-recon`, recipe `setup-recon`)
**Workspace:** `/home/deploy/repos/bb-plugin-stelow` (git, branch `fix/inbox-row-mobile-reflow`,
HEAD `68849b42`, **dirty** — another thread's files are checked out here: `lib/jtbd-contracts.mjs`,
`skills/stelow-product-job-to-be-done/*`, two untracked `server/runtime/` modules. Nothing in
this recon wrote to the tree; every measurement is a read.)
**Recon receipt:** `context/recon-receipt.json` — contract `stelow-recon-v2`, kind
`feature-recon`, method **`cymbal`**, `missing: []` (cymbal, ripwire, sem, ast-grep, xerj all on
PATH). No tool fallback was needed or used.

Reconnaissance only. Nothing was built, no state was touched, and no claim below is a design.
Each is a located fact plus the reading it supports; the numbers marked `console` were executed
against this checkout, so the shape stage can re-run them.

**The one-sentence finding:** the release narrative this slice wants to read does exist, but it
has no single grammar, no ref-scoped reader, and — today, in this very checkout — its
working-tree copy is **twelve releases behind the tags**. A view that reads `CHANGELOG.md` off
the project path reports `0.87.0` as the newest release while `v0.99.0` published this morning.

---

## 0. The mandated input does not exist

The card says to read the parent triage context at
`.stelow/2026-10-10/sw-card_t804npi7/state.md`. That file is frontmatter only: `current_stage:
triage`, `artifacts: []`, `history: []`, and no body. There are no triage notes to read, and no
copy of the original request anywhere in the tree. The sibling card reached the same conclusion
(`sw-card_g89gtmwt/runs/exec_uoieod6y/recon/shape.md:58-65`): *"no quotation of the original
request is recoverable from any input artifact."*

So the slice paragraph in the prompt is the **only** statement of the requirement, and the words
*per-project*, *recently shipped*, *takeaways*, and *delivery records* have to be read from this
repository rather than from a parent document. This recon does that and does not invent one.

## 1. There is no delivery record type in the code

`grep -rn "delivery" server lib components` returns only `thread-send.ts`'s
`{delivery:"sent"|"queued"|"refused"}` — a message-dispatch verdict, unrelated to product
deliveries. There is no `delivery` table, module, RPC, or CLI noun.

What the repository actually records, and who owns each:

| record | where | granularity | written by |
|---|---|---|---|
| execution-evidence bundle | `docs/runs/<card>/manifest.md` (committed) | per card | `cli-bundle-writer.ts` at `done`/`export` |
| stage ledger | `cards` + `card_stage_events` (SQLite) | per card | `advance` |
| feature inventory | `FEATURES.md` (committed) | per feature | the commit that ships it |
| release narrative | `CHANGELOG.md` (committed, one per repo) | per release | release-please, on merge to `master` |

Measured corpus of the first one:

```console
$ ls docs/runs | wc -l ; find docs/runs -type f | wc -l
19
20
```

Nineteen card directories, twenty files — i.e. 19 `manifest.md` plus one hand-authored artifact.
This is the same near-empty corpus Slice A measured (`parseBundleManifest` → 0 rows for all 11
then; 19 directories now). **"Rather than duplicating delivery records" therefore describes
records that are already thin, and that a finished-cards list already renders.** §8 shows where.

## 2. `CHANGELOG.md` is the only release narrative, and it is large

```console
$ wc -lc CHANGELOG.md
   4502 231883 CHANGELOG.md
$ grep -c '^## \[' CHANGELOG.md
312
```

312 releases, 4,502 lines. Cost of the *interesting* part, measured by offset of the Nth `## [`
heading: the newest 10 releases end at byte 7,923; 20 at 15,769; 29 at 20,731. So a view that
shows "the last N releases" needs roughly 0.8 KB per release, and the whole 200 KB
`readCardFile` cap (`server/cards.ts:286`) still covers 311 of the 312 — it truncates the oldest
entry, not the newest. That is the right end to lose, but the truncation flag has to be surfaced,
not swallowed.

## 3. Six of fourteen projects have one

```console
$ # default source path of every project on this host, then <path>/CHANGELOG.md
projects: 14 — with CHANGELOG: 6
  bb-plugin-stelow 231,883 B · stelow 225,574 B · ensaiter 211,970 B
  gogogo-fullstack-template 168,717 B · degustia 15,796 B · ai-credits 7,381 B
```

The eight without are the exploratory workspaces (`/home/deploy/.bb/stelow/exploratory/*`), a
scratch repo, and a bare parent directory used as a project. So a per-project view is **not**
empty on day one — unlike Slice A's — but it renders a row for fewer than half the projects, and
every exploration project reads "no releases", which is true and must not look like a failure.

## 4. The grammar is five grammars, and document order is not release order

Heading shapes sampled from the six files that have one:

```
bb-plugin-stelow   ## [0.87.0](https://…/compare/v0.86.0...v0.87.0) (2026-10-20)   release-please, linked
stelow             ## [0.84.1-alpha] - 2026-10-22                                  Keep a Changelog, bracketed
gogogo-…           ## 0.57.0 (2026-10-25)   +  ## What's Changed                   semantic-release, no brackets
ai-credits         ## [v0.1.1] - 2026-08-28                                        `v` prefix
degustia           ## [Unreleased]                                                 an unreleased section first
```

A four-pattern parser (`[v]N.N.N` with a link, bracketed, parenthesised, dashed) classifies:

```console
bb-plugin-stelow        311/312   (1 = `## [Unreleased]`)
stelow                  142/143   (1 = `## [Unreleased]`)
gogogo-fullstack-tpl    105/133   (28 = `## What's Changed`, an H2 inside a release body)
ai-credits                6/6
ensaiter                105/105
degustia                 12/13    (1 = `## [Unreleased]`)
```

Two consequences, both load-bearing:

- **`^## ` is not "a release."** In the semantic-release dialect the H2 level is reused for body
  sections (`## What's Changed`), and `[Unreleased]` is a non-release that every Keep-a-Changelog
  file carries. A reader that counts H2s over-reports by 28 rows on one project and invents a
  release version called `Unreleased`.
- **"Take the first N" is wrong.** `ai-credits` orders its headings `v0.1.1, v0.4.1, v0.4.0,
  v0.3.0, …` — the oldest release is first. Recency must come from the parsed version or the
  parsed date, never from position. This is the same class of defect as the sibling's
  `latestSpecTech` lexicographic max (`spec-tech_10.md` loses to `spec-tech_9.md`): a sort that
  looks obviously right and is not.

Dates are present in every parsed heading above, so a date-ordered view is possible without
asking for a version scheme — but 6 files is not a grammar guarantee, and a release with no date
must degrade to "order unknown", not to today.

## 5. The checkout's copy is behind the tags — measured today

This is the finding most likely to change the shape.

```console
$ git branch --show-current ; node -p "require('./package.json').version"
fix/inbox-row-mobile-reflow
0.87.0
$ grep -m1 '^## \[' CHANGELOG.md
## [0.87.0](…compare/v0.86.0...v0.87.0) (2026-10-20)
$ git tag --sort=-v:refname | head -3
v0.99.0
v0.98.2
v0.98.1
$ git for-each-ref --sort=-creatordate --count=3 --format='%(refname:short) %(creatordate:short)' refs/tags
v0.99.0 2026-10-28
v0.98.2 2026-10-27
v0.98.1 2026-10-27
$ git rev-list --count v0.87.0..v0.99.0
76
$ git log -1 --format='%h %ci' origin/master
e874c627 2026-10-28 12:38:40 -0300
```

The project's default source path is on a **feature branch**, its `CHANGELOG.md` and
`package.json` both say `0.87.0`, and **twelve minor releases shipped after that** — `v0.99.0`
landed the morning of this recon. The tags are local and cheap (`for-each-ref`: 90 ms), and the
tagged copy of the file is correct:

```console
$ git show v0.99.0:CHANGELOG.md | grep -m1 '^## \['
## [0.99.0](…compare/v0.98.2...v0.99.0) (2026-10-28)
```

**What this supports:** "what recently shipped" is not a property of the working tree. Any read
of `CHANGELOG.md` through the project source path inherits whatever branch that checkout happens
to be on — and this repository's own checkout is 76 commits behind its newest release. A view
that does this renders confidently wrong data on the operator's own machine, which is the
`plannedTaskGhosts` failure ("a check that cannot fail is worse than no check") in its most
ordinary form: the panel cannot tell a stale branch from a quiet week.

## 6. There is no ref-scoped file read in this SDK

The cheap reader is `bb.sdk.files.read({ path })` (`FilesArea`, SDK 0.4.108). Its argument type
is `FileReadArgs = { hostId?, path, rootPath?, signal? }` — **no `ref`, no offset, no length**:

```console
$ grep -c 'ref?:' node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts
0
```

That corrects the sibling recon, which cites `host.read_file`'s `ref` at `bb-plugin-sdk.d.ts:18109`
(`sw-card_g89gtmwt/runs/exec_89wrnsyu/recon/setup.md:51-53`). Line 18109 in the installed bundle
is `type EnvironmentDeleteResult`, and the field does not exist anywhere in the file. Any
committed/tag-scoped read therefore goes through git, which today means `runGitIn`
(`server/runtime/git-evidence.ts:61-79`): `execFile("git", …)`, `timeout: 15_000`,
`maxBuffer: 1 MiB`, and a **fail-soft** contract that collapses every failure into
`{ok:false, stdout:""}`. Content reads are new: the only file-content read through git today is
none — `gitTouchedSince` (`:227-241`) reads `log --name-only` and never a blob.

Reading a tag's copy of a 232 KB file through that runner is one subprocess and one buffer well
under the 1 MiB default, so the cost is bounded; the *honesty* cost is that a git failure looks
exactly like an empty release list unless the caller distinguishes them (the `unreadable` vs
`empty` distinction Slice A pinned is the same requirement here).

## 7. GitHub release notes are not reachable through the existing GitHub seam

The GitHub client is issues and PRs only:

```ts
// server/github-client.ts:54
listItems: (input: { kind?: "issue" | "pr"; state?: "open" | "closed"; repo?: string }) => …
```

`server/github-status.ts:11-16` maps `repos: [{repo, projectId}]` — `owner/name` → project, which
is exactly the join a per-project GitHub read would need. But nothing in the seam fetches
releases, tags, or release bodies.

The one release fetch that exists is hardcoded to this plugin's own repository:

```js
// lib/github-release.mjs:13
const RELEASES_URL = "https://api.github.com/repos/calionauta/bb-plugin-stelow/releases/latest";
```

…and it is only used by the update check (`server/runtime/plugin-update.ts:51`). It answers "is
there a newer plugin", not "what shipped in this project". Notably, `project.gitRemoteUrl` exists
in the host model (SDK zod at `:5060`; measured live on all 14 projects) and is referenced
**nowhere** in `server/`, `lib/`, or `components/` — so `owner/name` for a per-project GitHub read
is available and unwired. An unauthenticated `api.github.com` read is 60 requests/hour/IP, which
rules out a per-row fan-out.

## 8. Two homes are possible, and one of them already shows finished work

- **The board.** `FlowStrip` (`components/board/flow-strip.tsx:39-43,100`) is a project-scoped
  surface: it takes `projectId` from the board filter and calls `flowMetrics`. It already renders
  "finished count", median/p90 lead and cycle, and a per-card table that opens cards
  (`FEATURES.md:2390-2400`), sourced from `cards WHERE status='completed'`
  (`server/runtime/flow-metrics.ts:28-34`).
- **The card.** `BuildDetailContent` composes the card's sections in a fixed order
  (`components/detail/build-detail-content.tsx:78-110`): banner → hero → review tools → catch-up
  → workspace → progress → stage → artifacts → conversation.

**What this supports:** a "recent deliveries" list of *recently finished cards* would duplicate
`FlowStrip` exactly, on the same project axis, from the same ledger. The card's own "rather than
duplicating delivery records" clause is pointing at precisely that overlap, and the honest
reading of this slice is that **the new axis is releases, not cards** — a distinction `FlowStrip`
does not draw and its data cannot answer.

The card home carries the cost rule and a fact-home problem the sibling already paid for: a
project-scoped list under a card-scoped title is two homes for one fact
(`tests/card-information-hierarchy.test.mjs:1-33`, `FACT_HOMES` at `:34`), and the separate-RPC
rule (`server/card-detail-rpc-contract.ts:21-34`) says a subprocess on the open-card path is only
allowed when the reader asks. `projectRoot()` (`server/runtime/root-paths.ts:36-49`) already
resolves a project's default source path and is fail-soft to `null`, so either home can locate a
repo without new plumbing for *paths* — only the read itself is new.

If a section is chosen, the enforced shape rules apply: `SECTION_SURFACE`
(`components/disclosure.tsx:22`), `DisclosureSection` (`:109`), and closed-by-default unless
`startsOpen({live,blocking})` (`:72`) — a settled release list is history, so it starts closed.

## 9. Cost, priced

- One full-file read per project per call (no range support, §6): the six measured CHANGELOGs
  total **861,321 bytes** (the five largest: 853,940), and 6 of 14 projects have a file at all. A
  fleet-wide read is ~0.86 MB of host I/O and no subprocess if the SDK reader is used; a
  tag-accurate read is
  +1 git subprocess per project (`git for-each-ref`: 90 ms measured; `git show`: one more).
- The CLI's fleet read (`bb stelow metrics`, `server/runtime/cli/cli-metrics.ts:17`) takes
  `--json` and `--card` but **no `--project`** — the existing agent-facing metrics surface is
  card/fleet, not per-project, so an agent-facing "releases per project" verb has no near neighbour
  to extend; it would be new.

## 10. "Plus takeaways" has no substrate — except prose in the same file

Nothing in the repository produces a per-release takeaway. The closest thing is release-please's
generated notes, which in this repo are mostly one-line conventional subjects (Features / Bug
Fixes), but **176 of 312 releases carry an indented prose paragraph** under the bullet — the *why*,
written by whoever wrote the commit body. Example, `0.83.0`:

> retire the supervision knob …
>   The new-card composer no longer asks for a checkpoint cadence, because nothing enforced one.
>   … Its only consumer was methodology prose … priced at a full headless harness spawn …

That is the only in-repo text that reads like a takeaway, and it is in the same file, at the same
cost. A takeaway *generated* by a model would be a new generation surface (and would need the
`docs/decision-routing.md` boundary read before anyone puts a model in the read path); a takeaway
*extracted* from that indented paragraph is a parse rule on the same failure surface as §4.

## 11. Files in the blast radius

| File | Why it is in scope |
|---|---|
| `CHANGELOG.md` (4,502 L / 231,883 B, 312 releases) | the record itself; five dialects, 176 prose bodies |
| `lib/github-release.mjs:13,44` | the only release reader; hardcoded repo, latest-only, update-panel consumer |
| `server/runtime/plugin-update.ts:51` | its sole caller — the boundary any shared release reader must not break |
| `server/github-client.ts:52-60`, `server/github-status.ts:11-16` | `owner/name` ↔ project join that exists; no releases verb |
| `server/runtime/git-evidence.ts:61-79,227-241` | `runGitIn` (fail-soft, 15 s, 1 MiB) — the only way to read a tagged copy |
| `server/runtime/root-paths.ts:36-49` | project → default source path, the repo locator |
| `server/runtime/flow-metrics.ts:28-34`, `components/board/flow-strip.tsx:39-43` | the existing project-scoped "finished work" surface this slice must not duplicate |
| `server/cards.ts:85-95,279-291` | `readCardFile` + `readTextFile` (200,000-char cap, `\0` refusal) — the cheap read path and its ceiling |
| `server/card-rpc-contract.ts:120` | the RPC shape a per-card read would mirror |
| `server/card-detail-rpc-contract.ts:21-34` | the separate-call cost rule for any card home |
| `components/detail/build-detail-content.tsx:78-110`, `components/disclosure.tsx:22,72,109` | section composition and the only legal section shape |
| `tests/card-information-hierarchy.test.mjs`, `tests/card-surface-consistency.test.mjs`, `tests/card-design-tokens.test.mjs`, `tests/vocabulary-one-owner.test.mjs` | the four tests a new section, fact, size or noun trips |
| `FEATURES.md:2390-2400` (flow metrics), `:1885-1895` (run bundle) | the prose that already claims this ground |
| `AGENTS.md#Releases`, `.github/workflows/release.yml` | release-please is the writer; only `feat`/`fix`/`perf` reach the file |

One documentary drift, noted because it is about release prose: `AGENTS.md` points at
`docs/release-runbook.md` and `docs/release-incidents.md`; neither exists in `docs/`, and
`grep -rn "release-runbook"` over the tree returns nothing. The CHANGELOG is the only release
documentation in the repository today.

## 12. Open questions the shape stage must resolve (not answered here)

1. **Which state is "shipped": the tag, the release, or the file?** §5 shows the working-tree
   file disagrees with the tags by twelve releases. Tag-time (`for-each-ref` + `git show`) is
   correct and costs subprocesses; working-tree is free and lies here today. This is the single
   decision that determines whether the panel is trustworthy, and it cannot be deferred to
   implementation.
2. **Whose releases?** Per-project across the fleet (14 projects, 6 with data, one read each),
   the current project only, or the project of the card whose section it is? The card's phrase
   "per-project summary" implies the fleet; the surfaces in §8 are project-scoped or card-scoped,
   neither is fleet-scoped.
3. **What is a release row?** A version and a date, or a version with its bullet list, or one
   "takeaway" line per version? §4 fixes the parse and §10 fixes where prose can come from; the
   display unit is a product choice with a real cost difference (0.8 KB vs ~3 KB per row).
4. **Does the corpus get a fallback?** Eight of fourteen projects have no CHANGELOG. If the
   answer is "tags only", the view answers for more projects; if "CHANGELOG only", it answers for
   fewer but says what changed. Whichever is chosen, an absent file must read as *no release
   record*, never as *no releases*.
5. **Board strip or card section (§8)?** The board is project-scoped and already carries the
   finished-work strip this slice must not duplicate; the card is card-scoped and would repeat a
   project fact. The fact-home rule and the separate-call rule both point in different directions,
   and Interface is where that tension is supposed to be resolved, not silently.
6. **Is "takeaways" a generation or an extraction (§10)?** Extraction stays inside the file and
   the parse; generation adds a model to a read path that the repo's decision-routing policy
   currently keeps clear of artifact acceptance.

---

**Evidence hygiene.** Every code fact carries a file and line. §1, §2, §3, §4, §5, §6 and §9 were
executed against this checkout or this host's project list, and the commands are shown inline so
the shape stage can re-run them. The two most perishable numbers are §3 (6 of 14 projects — the
fleet changes) and §5 (0.87.0 vs v0.99.0 — the branch will move); re-measure both before
committing to a plan, because the second one is the whole argument.
