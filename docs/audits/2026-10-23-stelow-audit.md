# Stelow audit — plugin + upstream

**Type:** audit record, with the answer it prompted.
**Date:** 2026-10-23
**Source:** thread `thr_8ahzqb3cye` of this project — seven parallel auditors,
plus first-hand verification of the worst findings by the thread that ran it.
**Scope measured:** 100,078 LoC / 706 source files in this repository, plus the
upstream `scripts/stelow` (3,871 lines) and its generators.
**Structure:** Part I is the audit as delivered. Part II answers the one
question it left open — whether the upstream/plugin split is itself among the
causes, and what would justify merging the two.
**Not normative:** behaviour stays owned by the gate named in Part II §5, not by
prose describing it. A record that starts quoting current numbers instead of
pointing at the gate becomes a second source of truth and drifts by nature.

---

# Part I — The audit

All seven auditors came back, and the most serious findings were verified
first-hand. The audit follows.

**Measured scope:** 100,078 LoC / 706 source files (`lib` 270 `.mjs` modules,
`server` 274, `components` 162), 511 test files, 6,001 lines of `docs/` plus
3,687 in `FEATURES.md`. Upstream: `scripts/stelow` 3,871 lines + 5 generators.
`npm run test:fast` green. The work sits on branch `fix/context-policy-parity`,
with `artifact-registration.ts` and `cli-done-refusals.ts` uncommitted.

## Verdict

The architecture is **good** — better than average: a 7-line composition root,
explicit seams, small files (max 541 lines), zero orphan files in knip, a single
`requestInput` in the whole repository, a single writer for a legal transition.
The problems are not of design; they are of **boundary with upstream** and of
**facts with two owners**. Three blockers, and the most serious one is not in
the code: it is in the pin process.

## The map (who owns each fact)

| Fact | Canonical owner | Mirrors / re-derivations |
|---|---|---|
| Legal transitions | `stages.yaml` → generated `transitions.md` → `data/stelow` | four `lib/` projections |
| Current stage | `state.md` `current_stage` | `cards.stage` (projection), `stelow.json` (`workflows[].stage`, `board-read.ts:278`) |
| Status/activity | `cards.status` + `activity` (via `writeCard`, single owner) | — |
| Artifacts | `state.md` `artifacts:` (no table) | "unregistered" sweep (`card-detail-artifacts.ts:120`), `.registered.json` |
| Questions | `expired_questions` + live interaction in the host | `inbox_events`, `ask_contracts`, `question_evidence`, `split_proposals` |
| Claims/lock | `card_claims` (SQLite, PK workspace+file) | `respawn_inflight` (durable), merge lock in memory (`Set`) |
| Run ledger | `execution_runs` | `verification_runs`, `card_stage_events`, `scope_retry_ledger` (no writer in production) |
| Prompt clauses | `WORKER_PROTOCOL_CLAUSES` + `CLAUSE_ORDER` + `CLAUSE_CHAR_CEILINGS` + `TrackPromptProtocols` | four parallel lists per key |

**Sync flow:** a 45 s timer (`reconciler.ts:8`) + `thread.idle/active/failed`
events + boot + card open → `syncThreadState` → dispatch by `kind` to research /
explore / build. `track-sync-core.ts` holds only 7 pure predicates (87 lines, no
I/O); build shares **nothing** of it except by copy.

The four projections of the transition graph are `lib/workflow-moves.mjs` (the
host re-implementation, with a parity test against the helper),
`workflow-catalog.mjs`, `transition-facts.mjs` and `stage-skips.mjs`.

## Blockers

**B1 — The pin is a branch tip, not a release.** `npm run
check:pin-provenance` exits **1**: *"pin e1c03cb is not on upstream main
(diverged)"*. The commit was squash-merged as `e7d87e7`, leaving the pin
orphaned. `check-upstream-drift` passes (tree == pin), which is exactly the
split your `AGENTS.md` documents as a trap.

**B2 — The host's manifest writer calls a verb that does not exist.**
`artifact-registration.ts` (new, uncommitted) calls
`runHelper(["artifacts","add",…])`. Verified by running the pinned helper:
`stelow: unknown subcommand 'artifacts'` → **exit 2**. Worse: on this branch the
worker prompt was switched to *"do NOT edit state.md: the host writes the
artifact manifest"* (`track-prompts.ts:149,231`), so research/explore lose the
one writer that worked. `registerAuditArtifact` also passes an **absolute**
path, which `lib/artifact-manifest.mjs:12` rejects, and it runs **after** the
gate that requires the registration (`cli-done-build.ts:163` vs `:176`). Root
cause: the host was written against **uncommitted** upstream work (there, a new
`write_manifest()` exists, unpushed, saying *"advance and artifacts add both go
through here"*). B1 and B2 are the same mistake: the plugin follows upstream
work-in-progress.

**B3 — The scope-batch claims protocol cannot start.** `scopeStartGate:56`:
`if (batches.length === 0) return { ok: true, coordinated: false }`, and
`batchIdsForCard:300` derives the ids **from the claims themselves**, tagged
`batch::scope`. The tag is written by `acquireScopeClaims`, called only by
`claimScopeBatchRun`, called only behind that gate. Circular. Consequence:
`mergeScopeBatchRun`, `retryScopeBatchRun`, `verifyScopeBatchRun` have no
importer in production → `lib/scope-merge.mjs`, `lib/scope-retry.mjs` and the
`scope_retry_ledger` table are dead.

## Single source of truth — real violations

**S1 (the worst of all) — the skill that 10 of 18 stages load teaches how to
bypass the only guard.** `skills/stelow-workflow-orchestrator/SKILL.md:328`:
*"Update `stelow.json` directly — it is the canonical source of truth"*, with a
`wf.stage.current_stage = NEW_SLUG`. The helper reads `state.md` and refuses any
transition outside the table (`stelow:920`). A worker that obeys the skill
writes to a file the guard does not read — and `board-read.ts:278` reads
`stelow.json` as a fallback. It costs 4,997 tokens per spawn across 10 stages to
teach that.

**S2 — `any_of` means the opposite on each side.** `workflow-moves.mjs:84`: an
empty `any_of` ⇒ `false` (rule does not fire). `stelow:577`: `if not any_of:
return True` ⇒ fires (stage refused). Latent only because the single rule today
has an `any_of`.

**S3 — The host drops the 5th verb.** Upstream validates
`next/accept/reject/rework/annotate`; the host projects four. Masked because
`diff-gate` also has `reject: execution`.

**S4 — Two answers to "does `context` run".** The timeline path
(`stage-skips.mjs`) receives no `quality`/`explorationCount`; the move path
(`parseNextStages`) does. The panel paints `context` as next while `bb stelow
advance context` is refused.

**S5 — A manifest with two readers that disagree.** The JS merges every
`artifacts:` block; the helper keeps the **first** and deletes the rest. The same
file yields two lists.

**S6 — `current_stage` read by 6 regexes**, two of them unanchored
(`board-read.ts:240`, `card-seams.ts:132`), and `board-read` rebuilds the state
dir path by hand, walking around the ownership resolver.

**S7 — `userInputContract` is a dead field.** `track-prompts.ts:19` declares it,
`runtime-core.ts:63` fills it, nobody reads it: `:160` interpolates the
**import** directly. The docstring promises "passed in at construction, so it
can never paste a second, drifting copy" — the promise is false for the most
expensive clause (1,874 chars). No test sees it, because the fixture passes the
same const.

**S8 — Two clauses rendered and undeclared.** `cardOwnerRules` (706 chars) and
`reviewProtocol` (227) sit outside `TRACK_PATH_CLAUSES`: deleting them passes
the whole suite.

## Honest state / phantom waits

- **`--force` punches through the substance floor** (`question-gate.mjs:262`),
  against its own docstring (*"never the substance floor, because a probe that
  can be forced through is a probe that will be"*) — and
  `tests/question-substance.test.mjs:85` **certifies the bug**: `forced: true →
  allowed`.
- **Restore reopens the question it promised to hold**: `questionsWithheld` is
  counted, not closed; the next sync reopens the badge and the new worker is
  blocked by `questionOpenGuard` answering a question it did not ask (reproduced
  by the auditor).
- **Phantom wait on a finished card**: `openExpiredQuestionIds` does not filter
  terminal status; the hero shows *"Waiting — the agent is preparing a
  question"* with zero open questions.
- **Failed read → question disappears**: `pending-questions.ts:58` returns `[]`
  where the neighbouring module documents `null` ("unknown is not zero").
- **Eternal error badge in research/explore**: `markThreadRunning` does not clear
  `last_error` (build does, and a test pins it).
- **"Mark done" has two writers**, against the docstring that says "every track
  writes through this one writer".

## Concurrency

Workspace claims are correct (one table, fencing, TTL, reaper, release on
terminal, verified `--scope`). The scope-batch ones are not: **they never
renew** (exclusivity is lost after 30 min), **they steal silently** (no
`stolen[]`, no trail), `--ttl` is documented and ignored, and a failed release
is swallowed (`claim-coordination.ts:36`). The merge lock is an in-memory `Set`
— a different failure model for the same concept.

## Token economy — where the money is

| Path | chars | ~tokens | prefix cacheable across 2 cards |
|---|---|---|---|
| build spawn | 13,307 | 3,327 | 90.9% ✅ (already fixed) |
| build restart | 12,984 | 3,246 | 91.6% ✅ |
| build reseed | 12,447 | 3,112 | 95.6% ✅ |
| **research** | 10,955 | 2,739 | **7.5%** ❌ |
| **explore** | 8,360 | 2,090 | **9.9%** ❌ |

The shared clause block costs 11,859 chars (~2,965 tok): `doneProtocol` 609,
`splitProtocol` 559, `userInputContract` 469. Skills add up to **98,101
tokens**; the orchestrator alone, 4,997.

**Cheapest gains (tokens per risk):**
1. **Reorder the track prompts** — `strategyLabel` enters at char 823 and
   `stage.label` at 824; the prefix dies in the first paragraph. Move the
   interpolation to the tail: 7.5% → ~79%. **~2,000 tok saved per subsequent
   spawn.** Medium risk.
2. **Split `DONE_PROTOCOL`** — 2,084 of its 2,436 chars are Build-only and
   **contradict** the track contract ("STOP and end your turn" vs "never just
   announce completion"). −521 tok on every research/explore spawn. Low risk.
3. **Move 5 advisory clauses into the playbook file** (`cliEquivalents` 270,
   `reconProtocol` 126, `commitStyle` 95, `draftProtocol` 104, `workflowSkills`
   136): **−730 tok (−22%) per build spawn**. Low-medium risk.
4. **Make `userInputContract` a parameter, or delete the field** — 0 tokens,
   restores the guarantee. Trivial.
5. **Declare `cardOwnerRules` + `reviewProtocol`** — 0 tokens. Trivial.
6. **`Required<Pick<…>>` on `buildSharedPrefix`** — a missing mandatory clause
   becomes a compile error instead of test prose.

A cost that is not tokens but weighs: the 45 s poll is **per card, uncapped**,
and rescans the entire research artifact tree (1,920×/day for one idle card).

## Removable noise

- 275 exports with no external reader (including `buildSharedPrefix`, used only
  in its own file); `contextAskGate` is a stub that always returns `allowed:
  true`; `NON_AUTO_SKIPS = []` and `MODE_DOES_NOT_RUN` have no reader;
  `.trackSync` is built twice and never read; `gatePreservation` is duplicated
  as a literal in `start-workflow-prompt.ts:14`.
- 2 orphan files (`frozen-acceptance-row.tsx`,
  `tests/fixtures/restore-dogfood.mjs`).
- **Prose that aged**: `prompt-cache-order.test.mjs:43` claims "currently red on
  all three build paths" — it is green at 90.9%. `prompt-clause-budgets.mjs:5`
  cites 93.7% (measured 94.8%). `docs/file-locking.md` is cited by a test and
  does not exist.
- `docs/remaining-debt-audit.md` (1,967 lines) contains numbers the file itself
  documents as having been wrong five times across adversarial reviews — it is a
  second source of truth that can only drift by nature. The gate
  (`check-source-budgets.mjs`) is the authority; the doc should point, not
  repeat.
- 257 hand-written `.d.mts` for 270 `.mjs`: the type surface exists twice.
  `declaration-surface.test.mjs` checks *names*, not signatures.

## Is a BB workflow worth it?

**For this audit, no** — and the numbers prove it: a workflow's value is
fan-out with durable state, but the product here is *consolidated judgment*,
which exists only in one context. A run would have added a ledger, polls and
acceptance by 7 read-only agents. That is what happened anyway: 7 parallel
auditors plus first-hand verification.

**For what it is worth, yes, and a lot:** a deterministic `stelow-audit` as a
**release gate** — not an agent workflow, but a script that runs
`check-upstream-drift` + `check-pin-provenance` + the upstream's 5 `gen:*:check`
+ `npm test`, and fails closed. Three of this audit's blockers are caught by
gates that **already exist** and simply did not run together.

## Repair plan (ordered by risk × return)

**Wave 0 — stop the bleeding (30 min, zero product risk)**
1. Re-pin to upstream `origin/main` and re-sync (B1). The helper content is
   identical — neutral.
2. Decide B2: either revert the line "the host writes the artifact manifest"
   (the worker's writer comes back, and it works today), or port `artifacts add`
   upstream and cut a release before using it. Do **not** leave a middle ground:
   today the host claims something it cannot deliver.

**Wave 1 — facts with a single owner (1 day)**
3. `current_stage`: one exported reader, 7 call sites, and the two unanchored
   regexes die (S6).
4. Manifest: one resolution rule (S5) — refuse to write the second block,
   instead of each reader deciding.
5. `userInputContract` as a parameter + a complete `TRACK_PATH_CLAUSES` (S7,
   S8) — trivial.
6. `--force` vs the substance floor: choose which of the two lives, and align
   docstring and test (the current test is the bug).
7. Orchestrator skill: replace the `stelow.json` section with `bb stelow
   advance`, and delete the unvalidated `Trigger` table (S1 — it costs tokens
   *and* teaches wrong).

**Wave 2 — token economy (1–2 days)**
8. Reorder the track prompts (biggest gain, medium risk).
9. Split `DONE_PROTOCOL`; move the 5 advisory clauses to the playbook; lower the
   ceilings with them.

**Wave 3 — noise and concurrency**
10. Delete the dormant scope-batch (B3) **or** fix the bootstrap — today it is
    dead code pretending to be a feature.
11. Poll: skip when the idle edge has not changed; cap concurrency.
12. `last_error: null` in `markThreadRunning`; a single "mark done"; prune
    exports, stubs and aged prose.

**Do not unify** (verified as a legitimate difference): the per-track completion
predicate, auto-continue, progress detection, read-streak, the audit park prose,
the research/explore settled handlers. A single abstraction there would break
all three tracks.

> Do you want me to execute **Wave 0** now (re-pin + writer decision, which is
> where the plugin is actually broken), or would you rather I start with
> **Wave 1** while the pin is decided upstream?

*End of Part I. The repair waves above are the audit's own plan; they were not
re-verified when this record was filed.*

---

# Part II — Answer: the split is not the aggravating factor

Answer given on 2026-10-23 to the question Part I left open: is the division
between upstream (`stelow`, agnostic) and `bb-plugin-stelow` (the
implementation) among the causes of those findings — and would everything be
better off inside the plugin?

## 1. Count, do not opine

Every finding, sorted by who owns it and whether one repository would have
prevented it.

| # | Where the defect lives | Would one repo prevent it? |
|---|---|---|
| B1 | the pin, by definition | **yes** — a monorepo has no pin |
| B2 | a guess at an unseen interface | **partly** — merges the guess, keeps the interface |
| B3 | entirely inside the plugin | no |
| S1 | upstream prose, sync-owned | **only the latency** |
| S2 | bash rule vs TS projection | no — the language boundary stays |
| S3 | same | no |
| S4 | two host-side projections | no |
| S5 | bash helper vs JS reader | no |
| S6 | entirely inside the plugin | no |
| S7 | entirely inside the plugin | no |
| S8 | entirely inside the plugin | no |

Of eleven: merging fixes **one**, softens **one**, shortens **one**'s latency,
and leaves **eight** untouched. The split did not aggravate the problem — it was
the *diagnostic instrument* that made a pre-existing problem visible.

## 2. Where the audit's reasoning slipped

The audit got the diagnosis right ("facts with two owners") and the address of
the second owner wrong. **It is not "the other repository" — it is the other
language.**

`server/runtime/helper-script.ts` opens with the rule already written down:
*"Every stage decision is made by the upstream `scripts/stelow` state machine,
not reimplemented here."* And `lib/workflow-moves.mjs` is a second
implementation of the same rule, in TypeScript, with a parity test against the
pinned helper as compensation.

Merge the two repositories: both files still exist, one in bash and one in
TypeScript. Nothing deletes the duplication except deleting it.

So the question decomposes into two that the audit's phrasing conflated:

- **(a) Two repositories, one process** — pin, dispatch, visibility. Costs
  release latency and lets an agent write against code it cannot see. This is
  what merging fixes, and it is the *smaller* cost.
- **(b) Two languages, two implementations of the same rules** — the actual
  drift surface. **Survives a merge.** Only a full port of the helper to
  TypeScript removes it (`data/stelow` is 3,871 lines of bash).

"Everything in the plugin" = (a) plus the port. (a) alone buys one blocker. The
port buys (b) and **spends the portability asset the split exists to protect**.

## 3. Why the upstream half is load-bearing, not a library

- `data/stelow` is `#!/usr/bin/env bash`, and its own header says *"No npm deps
  — bash + python3 only."* It runs anywhere an agent can run a shell: Claude
  Code, Codex, Cursor, a human at a terminal.
- `skills/` is methodology in markdown, consumed by the host, not compiled by
  it.
- `data/stelow-stage-catalog.json` (version 2) publishes stages, phases, routes
  and tools **as data**, and the helper answers `status`, `advance` and `next`
  in `--json`. The plugin projects published data instead of re-deriving it, and
  has a parity test against the pinned helper.
- `data/upstream-forks.json` exists precisely because **intentional divergence**
  is a named, versioned, reviewable concept (three `standing-divergence`
  entries). A single-repo design would have had no reason to build that
  instrument.

The strongest evidence that the boundary is in the right place: **upstream
already learned this exact lesson on its own**, in `data/stelow:598`:

> The router used to re-derive this with its own awk/grep over the transitions
> reference: a fourth implementation of the rule… One owner: the helper asks
> itself.

That is the same failure the audit found in the plugin. The agnostic repository
generated the correct pattern, and the plugin inherited it through the CLI
boundary. In a monorepo, the same fix would be "import the function" — which
only works *after* the port, the expensive version of "everything in the
plugin".

The insurance is real and has to be stated precisely: `scripts/stelow` + skills
+ `state.md` is a methodology that runs on any agent. The plugin is one host's
adapter. Merge them and the adapter becomes the product — protecting that
boundary is the right call.

## 4. What the split actually costs an agent

Not selling the split as free. It charges in three currencies.

**(a) The upstream source is not in the environment.** The agent sees
`data/stelow`, `skills/` and the catalog — a vendored subset, not the
repository. It cannot *read* the rule it must obey; it can only *run* it. **B2
is the exact proof:** the host was written against a `write_manifest()` that
exists only on an unpushed upstream branch. This is the largest cost, and it is
a **tooling** cost, not a design one: `bash data/stelow schema <verb>` answers
the question offline in one command.

**(b) Two-step releases, and the tax falls hardest on prose.** One wrong
sentence in a synced skill costs: branch → PR → upstream release → dispatch →
pin → sync → commit. Prose drifts because prose is what the tax discourages
fixing. **S1 is the evidence:** a paragraph teaching how to bypass the only
guard, in the skill 10 of 18 stages load, at 4,997 tokens per spawn.

**(c) The language boundary forbids sharing code.** Bash cannot import from
TypeScript, so the options are duplication or a CLI contract. S2/S3/S5 live
exactly in that gap. The contract is the right answer and the plugin already uses
it in most places — which is why "should this be one repo?" is the wrong
question and "does the host **consume** or **re-derive**?" is the right one.

## 5. The gate that is missing is one command away

```console
$ bash data/stelow schema artifacts
schema: unknown command 'artifacts' (known: advance, ask, audit-trail, check,
config, decide, doctor, guard-judge, lock, scope, seed, status, sync-scopes)
$ echo $?
2
```

Two commands, offline, against the pinned binary, and the binary refuses the
verb the host wrote into `server/runtime/artifact-registration.ts:144`. **B2 is
not a design consequence of the split: it is a one-command check nobody ran.**

The host invokes a short, declarable set of helper verbs in production paths —
`advance` (`server/runtime/wiring/rpc-surfaces.ts:305`,
`server/execution-advance-card.ts:106`), `sync-scopes`
(`server/execution-advance-preflight.ts:136`,
`server/runtime/cli/cli-helper-passthrough.ts:70`), and the inspection verbs in
`server/runtime/cli-inspection.ts`. One list, one test, failing closed:

```js
// Probe existence without mutating state and without trusting `schema`,
// which is itself an incomplete inventory (`next` is not in it):
// a real verb refuses an invalid argument as `<verb>: unknown flag …`.
const unknown = /unknown (sub)?command/;
for (const verb of HOST_HELPER_VERBS) {
  const { stderr } = await runHelper([verb, "--help"], tempDir);
  assert.doesNotMatch(stderr, unknown, `pinned helper does not know '${verb}'`);
}
```

That is the **fourth** boundary instrument. The registry already has three:
`check-upstream-drift.mjs` with `upstream-forks.json` for intentional
divergence, `check:pin-provenance` in `ci.yml:25` for release provenance, and
`workflow-moves.test.mjs` for rule parity. The two blockers of the last audit
sit precisely in the instrument that does not exist. This repository already
believes the governing principle — *a design rule with no test is not a rule* —
and applied it to UI vocabulary. It has not yet applied it to its most
expensive boundary.

## 6. The triggers that would make me say "merge" (falsifiable)

1. **Standalone acceptance fails.** If `scripts/stelow` + skills, with no plugin
   present, cannot take a card through one full cycle, the insurance is already
   void — you are paying the cost of a split whose benefit you do not have. Then
   merge, and say so plainly.
2. **More than half of the plugin's fix commits need an upstream edit.** Count
   them over a release cycle. If the boundary is where the bugs are, the split
   is charging rent on the wrong thing.
3. **The boundary gates do not converge.** If the verb contract, upstream drift
   and pin provenance are still not all green after the next release cycle, the
   discipline is not maintainable at this size — that is evidence for one
   repository with a generated contract, not for another patch.
4. **A second host appears** — a Claude Code plugin, a Codex port, a shell-only
   runner. Then the split is proven and any merge becomes actively wrong.

## 7. What this does not claim

Not that the split is free (§4 exists for that). Not that the plugin's boundary
is fine: B3, S4, S6, S7 and S8 are internal debt, and the audit's Waves 1–3
remain correct — the split decision changes none of them. And not that the
decision is cheap to reverse in either direction: the split keeps the cheap
direction open; a merge spends it.

**Verdict: keep the split, add the gate it is missing.** If trigger 1 fires, the
fear of depending on BB has already materialized without anyone noticing — and
the honest answer then is not "rethink the architecture", it is "merge".
