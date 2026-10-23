# SCOPE-6 — prompt cache economy for the research and explore spawns

Branch `fix/prompt-cache-economy-2026-10-23`, from `origin/master` (`2e9cba9d`).
Every measurement below was taken on this host, on that commit before the change
and on the branch after it. Tokens are `ceil(chars / 4)` — the suite's labelled
estimate (`lib/prompt-budget.mjs`), never a provider number.

## 1. What was wrong

### 1.1 The tracks interpolated a per-card value in their first sentence

Provider prompt caching is prefix matching: the reusable region ends at the first
byte that differs between two spawns. All five spawn paths put their per-card
values last — except the two tracks, and no test measured them.

| where (at `2e9cba9d`) | what it did |
| --- | --- |
| `server/runtime/track-prompts.ts:98-99` (`researchIndexStep`) | Step 1 opened with `${input.strategyLabel}` and `${input.strategySkill}` |
| `server/runtime/track-prompts.ts:214-215` (`exploreWorkStep`) | Step 1 opened with `${input.stage.label}` and `${input.stage.skill}` |
| `server/runtime/track-prompts.ts:64` (`protocolFooter`) | appended `doneProtocol` — the whole build completion path — before the per-card tail |
| `server/runtime/track-prompts.ts:93` / `:209` (`researchCardTail` / `exploreCardTail`) | state dir, workspace, card name, flavour, previous thread |

Measured divergence: **character 823** (research) and **824** (explore) — the
strategy label after `Step 1 — load the strategy playbook: the `. Everything
shared behind that byte was re-uploaded and re-paid on every spawn.

### 1.2 `DONE_PROTOCOL` carried the build completion path to the tracks

`server/runtime/plugin-protocols.ts:101` at `2e9cba9d`, 2,479 characters. Only one
sentence in it applies to a track ("research/explore cards complete only after
`bb stelow verify` passes"); the remaining ~2,300 describe the `audit` stage,
`verify --tests`, the gap-triage/gap-scopes loop, `audit.md` and the run bundle.
Both tracks rendered all of it through `protocolFooter`, on every spawn, while the
sentence they owed sat in the middle of the block. A research worker was told to
run `bb stelow advance execution` — a command for a stage machine it does not have
— and was told its card completes at `audit`, a stage it never reaches.

### 1.3 Nothing measured the tracks

`tests/prompt-cache-order.test.mjs:62` at `2e9cba9d` declared
`BUILD_PATHS = ["spawn", "restart", "reseed"]`. The order check, the cross-card
floor and the printed measurement all ran over the three build paths only, so the
tracks' 7.2% / 9.6% was invisible to the suite that exists to catch exactly this.

### 1.4 The five advisory clauses, and the surface that was asked about

The prompt corpus carries five clauses that are advisory — commands that report or
spend and never gate a card. At `2e9cba9d`:

| clause | where | the advisory sentence |
| --- | --- | --- |
| `bb stelow verify-tasks` | `plugin-protocols.ts:105` | "advisory only, it never blocks `done`" |
| `bb stelow gap-triage` | `plugin-protocols.ts:105-106` | "advisory only; the routing below never changes" |
| `bb stelow export --check` | `plugin-protocols.ts:119` | "reports … without writing anything" |
| `bb stelow review` | `plugin-protocols.ts:165` (`REVIEW_PROTOCOL`) | "never run it unasked, never auto-run it" |
| `bb stelow draft` | `plugin-protocols.ts:169` (`DRAFT_PROTOCOL`) | "judge 100% before using … never retry in a loop" |

The surface asked about is `bb stelow playbook`. **It cannot serve them**, so they
were not lifted (see §6.1 for the evidence).

## 2. What changed

| file | change |
| --- | --- |
| `server/runtime/plugin-protocols.ts:111-142` | `DONE_PROTOCOL` split into `DONE_PROTOCOL_CORE` (108 chars), `DONE_PROTOCOL_TRACK` (178) and `DONE_PROTOCOL_BUILD` (2,300); `DONE_PROTOCOL = core + " " + build` (2,409) |
| `server/runtime/track-protocol-clauses.ts` (new) | the track bag: `cardOwnerRules`, `doneProtocolTrack`, `reviewProtocol`, `draftProtocol`, `userInputContract` |
| `server/runtime/runtime-core.ts:61` | builds the track prompts from that bag instead of assembling a set inline |
| `server/runtime/track-prompts.ts` | shared steps take **no arguments** (`researchSteps`, `researchRoundStep`, `researchRegistrationStep`, `exploreWorkStep`, `exploreArtifactStep`); every per-card value moved to `researchCardValues` / `exploreCardValues` under one heading; prompt order is prelude → steps → user contract → protocol footer → card values → request |
| `lib/prompt-clause-budgets.mjs:53-61` | `doneProtocol` 2479 → **2409**, `doneProtocolTrack` **178** (new), `reviewProtocol` **227** (new — the track bag was never budgeted); every other ceiling unchanged, none raised |
| `tests/helpers/prompt-paths.mjs` | `renderSpawnPairs()` renders every path for two different cards; `TRACK_PROTOCOL_CLAUSES` drives the track fixture; `allClauseTexts()` |
| `tests/prompt-cache-order.test.mjs` | all five paths: order check on the **last** shared clause, per-path floors (tracks 0.75, builds 0.85), a track-completion assertion, and the chars/prefix/token numbers printed every run |
| `tests/prompt-budget.test.mjs` | path ceilings ratcheted down; clause findings computed over both bags; the `DONE_PROTOCOL` assembly asserted |
| `tests/prompt-path-contract.test.mjs`, `tests/runtime-track-prompts.test.mjs`, `tests/explore-*.test.mjs` | assertions moved from the interpolated text to the placeholder + values pair |

The steps now name `<state-dir>`, `<workspaceRoot>`, `<card>`, `<strategy>`,
`<strategy-skill>`, `<strategy-id>`, `<round-no>`, `<round-stamp>`, `<round-file>`,
`<stage>`, `<stage-skill>` and `<artifact>`; "Your card values" at the end defines
each once. No placeholder was added without the value that fills it, and the
`explore` artifact filename still comes from `exploreArtifactFile(stage.id)` — the
same resolver the seal and `verify` read.

## 3. Measurements

Same fixture before and after (`/tmp` script, two cards: `sw-card_alpha` /
`sw-card_beta`, different requests, different strategies, different stages):

| path | chars | prefix chars | prefix % | cacheable tokens | re-paid tokens | total tokens |
| --- | --- | --- | --- | --- | --- | --- |
| build spawn — before | 13,318 | 12,199 | 91.6% | 3,050 | 280 | 3,330 |
| build spawn — after | 13,248 | 12,129 | 91.6% | 3,033 | 280 | 3,312 |
| research — before | 11,414 | 823 | **7.2%** | 206 | 2,648 | 2,854 |
| research — after | 9,650 | 9,005 | **93.3%** | 2,252 | 162 | 2,413 |
| explore — before | 8,603 | 824 | **9.6%** | 206 | 1,945 | 2,151 |
| explore — after | 6,706 | 6,142 | **91.6%** | 1,536 | 141 | 1,677 |

Suites' own numbers, printed by `node --experimental-strip-types --import
./tests/register-ts-source.mjs --test tests/prompt-cache-order.test.mjs` (its
fixture is the same two cards, with `sw-card_probe` / `sw-card_other` and a
strategy-named round file, which moves a percentage point's tenth):

| path | chars | prefix chars | prefix % | cacheable tokens | re-paid tokens | total tokens |
| --- | --- | --- | --- | --- | --- | --- |
| spawn | 13,280 | 12,139 | 91.4% | 3,035 | 287 | 3,321 |
| restart | 12,957 | 11,941 | 92.2% | 2,986 | 258 | 3,244 |
| reseed | 12,420 | 11,941 | 96.1% | 2,986 | 121 | 3,106 |
| research | 9,689 | 9,015 | 93.0% | 2,254 | 169 | 2,423 |
| explore | 6,702 | 6,152 | 91.8% | 1,538 | 149 | 1,687 |

Both tables clear the deliverable's 75% with room: the tracks move from 7.2% /
9.6% to 93% / 92%, and the prompt each worker reads also got smaller — research
11,414 → 9,650 characters, explore 8,603 → 6,706, because the build completion
payload left them.

### 3.1 No build clause was lost

Differential of the spawn prompt against `2e9cba9d`, byte by byte: the first
difference is at character 7,367, the last at 7,441, and 5,891 characters after it
are identical. The only change is one fragment removed:

```
-; research/explore cards complete only after `bb stelow verify` passes
+ (nothing)
```

That sentence still exists, in the track half (`DONE_PROTOCOL_TRACK`), where it
applies. `tests/prompt-budget.test.mjs` asserts the assembly
(`DONE_PROTOCOL === core + " " + build`, the build half keeps its `audit` stage,
the track half keeps the `verify` rule and no `audit` stage) so a future edit
cannot move build prose into the track half unnoticed.

### 3.2 Sentence survival in the tracks

Every rule-length sentence of the old research and explore prompts was checked for
verbatim survival in the new ones. The misses fall into three groups:

- 7 research / 3 explore sentences that interpolated a per-card value: same
  instruction, now written with its placeholder (Step 1, Step 3, Step 3b's target /
  read-back / sub-step name, Step 4, Step 5). Nothing was dropped — the values
  moved to the card-values block.
- 14 build-only completion sentences in each track, dropped on purpose (§1.2).
- "Your work owns its own state dir (…) inside the workspace (…)", replaced by the
  two card-values lines that state the same two facts and the ownership.

A fourth entry in the raw output is an artefact of the check's fixture, not a lost
clause: that fixture passed `REVIEW_PROTOCOL_SENTINEL` where production passes
`REVIEW_PROTOCOL`, which glued the sentinel and the following sentence into one
"missing" string. Production renders the real clause, and it is present.

## 4. Red proof — the prefix test fails on the old order

`server/runtime/track-prompts.ts` was reverted to `2e9cba9d` (`git show
HEAD:server/runtime/track-prompts.ts`), the new test run, the output captured, the
file restored. Command:

```sh
node --experimental-strip-types --import ./tests/register-ts-source.mjs --test \
  tests/prompt-cache-order.test.mjs
# exit 1
```

The failure, verbatim:

```
not ok 3 - a track prompt states the track completion rule and not the build one
  error: 'research tells its worker what actually finishes the card'

not ok 4 - two different cards share most of the same path's prompt
  error: |-
    research: two cards share at least 75% of this prompt, so a new worker on a different card
    reuses that prefix instead of re-paying it. Measured 8.9% (823 of 9201 chars) — under the
    floor, so a per-card value moved back into the shared prefix. Divergence: ...other.

    Step 1 — load the strategy playbook: the |Opportunity mapping method (st
```

8.9% rather than the 7.2% in §3 because that hybrid state keeps the new protocol
bag while the old template rendered `protocols.doneProtocol` (absent from the track
bag) as the literal `undefined` — a shorter footer, hence a shorter prompt. The
number that matters is the divergence: **823 characters**, exactly the byte
measured on `2e9cba9d`. After restoring the file the same test passes (6/6).

## 5. Gates

| gate | exit |
| --- | --- |
| `npm run --silent typecheck` | **0** |
| `npm run --silent quality:shape` (includes `lint`, 39 inherited findings, 0 new) | **0** |
| `npm test` (8640 lines of output, 0 `not ok`, 0 `# fail` non-zero) | **0** |

## 6. What I did not do and why

### 6.1 The five advisory clauses were not lifted into the playbook

`bb stelow playbook` is a **path index**, not a prose surface:
`lib/playbook.mjs:133-136` renders one line per entry —

```
${entry.label}: ${entry.path}${entry.missing ? "  (missing — …)" : ""}
```

— plus the fixed sentence "Read in order. Do not search for alternatives." Its
entries come from `lib/state-dir-files.mjs` (fixed filenames), `lib/recipe-catalog.mjs`
(declared outputs) and the current run directory. The "playbook" it points *at* is
the stage reading list under `skills/stelow-workflow-*`, which is synced from
upstream and must never be hand-edited.

So serving those five clauses there would need one of: a prose section inside a
path listing (a new mechanism), a new prose file the command prints, or editing the
synced `skills/` tree (forbidden). The brief says to record that instead of
inventing a mechanism, so: **recorded, not built.** The clauses stay where they are;
both tracks still render `REVIEW_PROTOCOL` and `DRAFT_PROTOCOL`, and the three
advisory build clauses stay inside `DONE_PROTOCOL_BUILD`.

### 6.2 The tracks' completion rule was not deleted — it was moved

A previous session's detector ("a clause rendered into a path that cannot act on
it") accused `doneProtocol` in the tracks and was refuted by reading the text
(FEATURES.md, "One planned optimization was refuted…"). That lesson is honoured:
research and explore still carry the sentence that finishes their card
(`DONE_PROTOCOL_TRACK`), and only the build payload left. Deleting the clause —
which would have been the cheaper way to shrink the prompt — was not done.

### 6.3 No live provider-cache measurement was taken

The numbers in §3 are prefix measurements on rendered fixtures, which is what the
suite can assert deterministically. Confirming the saving on the wire needs spawned
workers and a provider that reports cached tokens; `FEATURES.md` already carries
that evidence for the build reorder (`tests/prompt-cache-order.test.mjs` prints the
fixture numbers on every run instead of pretending to be provider usage).

### 6.4 The skill pointer is still a glob

`WORKFLOW_SKILLS` still tells a build worker to load `stelow-workflow-entry` and
`stelow-workflow-router`, and the tracks still point at their playbook. Narrowing
it changes which methodology a worker sees; that is a workflow-authoring decision,
already recorded in `FEATURES.md` as measured-but-not-fixed. Out of scope here.

### 6.5 `NEVER_SEED` still says "your state dir above"

The clause reads "Your workflow is already seeded in your state dir above", but
since the build reorder the state dir renders *below* the clause. It is a
pre-existing wording inaccuracy (introduced by that reorder, not by this change),
and fixing it means editing a shared clause and every build prompt for a word.
Recorded here so it is not rediscovered as a surprise; not changed.

### 6.6 `docs/model-tier-economics.md` was checked and left alone

The brief says it quotes no token figures. It does quote two — ~62,000 and ~56,000
tokens — but both are context-window figures for the Prewalk / mid-thread-switch
question, not prompt-clause or prefix sizes, so nothing in it became false. No edit.

### 6.7 Nothing was published

No push, no merge, no tag, no release. `skills/` and `data/stelow` were not touched
by hand, and no capability documented in `FEATURES.md` was removed — the two
behavioural changes are the tracks' cacheable prefix and which half of the
completion rule each kind of card reads.
