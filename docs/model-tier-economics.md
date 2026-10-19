# Model-tier economics: why Stelow does not need Prewalk

Prewalk ([technique](https://stencil.so/blog/prewalk),
[Pi extension](https://github.com/ThewindMom/pi-prewalk)) is a planner/executor
split where the expensive model explores, writes the plan, and makes the first
edit — then the *same conversation* continues on a cheaper model:

```text
frontier model                                  fast model
──────────────                                  ──────────
inspect → reason → plan → todo → first edit  →  continue → verify
                                    │
                                    └── one conversation, one handoff
```

The published SWE-Bench Pro experiment reports 97% of frontier performance,
41% lower cost, and 1.9x faster completion. Stelow was asked whether it would
benefit from the same arrangement.

This document records the answer and the measurements behind it. The short
version: **Prewalk solves a problem Stelow already solves by other means, and
Stelow's existing solution is 4x cheaper on the axis Prewalk optimizes.** The
real lever is elsewhere, and it is not a model swap.

Measured on a live host, 2026-10-19: 19 worker threads, 31 cards, 186 turns,
from `~/.bb/plugins/stelow/data.db` plus `bb thread log`.

---

## 1. Where worker time actually goes

Each stage instance was anchored at the moment it wrote the artifact it is
judged on, and everything running between that write and the `advance` was
counted.

**Only instances that closed within 6 hours are counted.** A stage instance
stays "open" while the card waits on a human, a host hold, or a pause, so its
wall-clock duration is mostly silence rather than work. The cap is not a
cosmetic filter: one card (`card_1fgz8lge`) sat in `audit` for **41.5 hours**,
of which **2479 minutes were a single silence** between an assistant message and
the next tool call. Counting it would have attributed a night of waiting to
`audit`'s tail, and an earlier draft did exactly that (it reported 2730 tail
minutes for `audit`; see the correction at the end of this section).

| stage | instances | mechanical items after the artifact | share of the stage | tail (min) | stage (min) |
|---|---|---|---|---|---|
| **execution** | 6 | 316 | **39%** | **142** | 311 |
| **audit** | 6 | 241 | **46%** | **243** | 380 |
| context | 5 | 48 | 20% | 38 | 61 |
| setup | 6 | 32 | 18% | 4 | 63 |
| verification | 3 | 9 | 4% | 13 | 213 |
| shape | 6 | 8 | 8% | 3 | 44 |
| planning | 5 | 7 | 7% | 1 | 92 |
| critique | 3 | 1 | **1%** | 1 | 86 |

`audit` still has the highest *share* of post-artifact mechanical work (46%),
and `execution` carries the largest absolute count (316 items, 39%). `critique`
is the opposite at 1%, because its output is the loop itself.

But the magnitude is **minutes, not hours**: about 4 hours of tail across all six
`audit` instances (243 minutes), not 45. The honest reading is that the tail is a
real inefficiency and a real waste of LLM attention — but it is not the multi-day
sink the uncapped number suggested.

**Correction.** An earlier version of this document reported `audit` at 2730
tail minutes over 7 instances, and called it "the longest stage on the board".
Both were wrong. The 2730 came from including the 41-hour instance above, whose
"tail" was a night of waiting on a human rather than work. And "longest stage"
is not true in any measure: `triage` carries the largest raw sum (16713 min
across 18 instances, itself driven by five instances that sat open for hours),
and by median `audit` sits behind both `triage` and `verification`. The stale
version also carried item counts from the uncapped run (audit 259, execution
313); the table above is recounted with the same cap as the durations, so items
and minutes describe the same instances.

The tail mixes real gates with navigation. Across the capped instances, **434
commands** run after the artifact in the tails of `audit` + `verification` +
`execution`; **80 are one of Stelow's own gates** (`verify`, `export`, `done`,
`advance`, `doctor`) and **21 are pure navigation** - reading a run directory,
the state dir, or `audit-trail.md` just to find out where something is. The rest
is inspection, test runs, polling, and database reads:

    bb stelow verify --tests | tail -6                  # a real gate
    bb stelow playbook | head -100; cat .../state.md    # navigation
    timeout 900 bb stelow export | tail -6              # a real gate
    python3 -c "sqlite3 ... DELETE FROM execution_runs WHERE id='exec_...'"
    grep -n "artifacts:" state.md | head -2
    sleep 90; bb workflows list | python...

The uncapped run of this same count gave 586 / 87 / 20; the difference is the
41-hour instance, which contributed idle prompts rather than work.

Per target, which is what the fix is answerable to:

| target | commands | covered by naming it? |
|---|---|---|
| run dir / `exec_` id | 213 | **partly** -- see below |
| `state.md` | 107 | already named by `playbook` |
| `audit-trail.md` | 22 | **no** -- not a declared output |
| `registered.json` | 8 | **no** -- a receipt the host writes |
| `config get state_dir` | 3 | **yes**, fully |

**The honest limit:** of the 225 run-dir commands, 184 already *knew the root*
and were listing or reading inside it (`find ... -type f`, `ls -R`, a `diff` of
two recon outputs). Naming the root does not delete those; only a subcommand
that returns the answer would. What naming the root fixes is the step before --
the worker that had no root to start from.

The persistent case is the run directory. The host knows every one of them at
launch: each recipe already declares its task outputs (38 outputs across 16
recipes, e.g. `verification` → `verification/tests.json`,
`verification/report.md`), and the launch record stores `artifact_root` per
run. None of that reaches the worker, so four consecutive commands were spent
rediscovering a path the host had written down:

```bash
bb stelow config get state_dir
bb stelow storage --card card_48uuhus1
ls -la .stelow/.../audit-trail.md
ls -d .stelow/.../runs/exec_g9j8lr...
```

That is remaining-fragility #6 from
[`rfc-worker-robustness.md`](./rfc-worker-robustness.md) — *"the host knows the
exact paths; it should tell instead of letting the worker search"* — charging
its toll where the post-artifact share is highest, `audit` (46%).

## 2. Why a mid-thread model switch loses to what Stelow already does

Stelow already changes models between stages: every `advance` can trigger a band
swap that spawns a fresh worker on the new stage's preset, archives the previous
one, and links the two by mention (`server/workers-respawn.ts`). Continuity
comes from `state.md` on disk, not from conversation history — deliberately, and
the code says so:

> *The replacement starts with an empty history by design — fresh delegation is
> the rule, not an accident*

Prewalk and Stelow are therefore opposite resolutions of the same problem.
Prewalk preserves context to avoid re-reading it. Stelow discards context and
re-reads a small file. The comparison is decidable by price, and cache makes it
one-sided.

**Workers run at 97–99% cache hits.** Measured on the four workers that emit
`thread/tokenUsage/updated`:

| card | tokens | cached | cache % |
|---|---|---|---|
| card_48uuhus1 | 477,684 | 476,911 | **99.8%** |
| card_vycec2p8 | 62,173 | 61,470 | 98.9% |
| card_m5f145jq | 51,611 | 50,944 | 98.7% |
| card_d7osxj8y | 57,395 | 51,032 | 88.9% |

A model switch invalidates that cache: the accumulated context is re-billed as
a *cache write* (~12.5x the read price) on the executor's first turn. A fresh
thread instead pays ~62,000 tokens of fresh input once (measured median across
the 7 low-turn worker threads; the figure scales with how much of `state.md` and
the playbook a spawn primes) and rebuilds from `state.md`. The table below uses
70,000 as a deliberately conservative stand-in, which makes the respawn look
*more* expensive than measured - so the 4x holds a fortiori.

| executor | mid-thread switch @50% | respawn | respawn wins by |
|---|---|---|---|
| frontier | $4.299 | $1.050 | 4.1x |
| mid | $0.860 | $0.210 | 4.1x |
| cheap | $0.086 | $0.021 | 4.1x |

With a 3x larger accumulated context the ratio becomes 12.5x. The break-even is
the same for every executor tier, because both sides are the same context
tokens times the same cache multiplier:

```
mid-thread switch is cheaper only below ~56,000 tokens of context
```

56k is approximately a newly-spawned thread. Near the start of a thread the next
`advance` spawns a different model through the band swap anyway — which is
section 3.

The idea is not worthless: `frontier → cheap` at 60% of a card is still −55.8%
against all-frontier, and keeping the cache warm would only make it −56.4%. But
Prewalk captures that saving *by* switching models, and Stelow captures it *by
respawn*, more cheaply. Adopting Prewalk would trade a 70k-token handoff for a
229k-token one.

## 3. The lever Stelow already had, and was not pulling

Upstream classifies every stage, in `stages.yaml`:

```yaml
triage economy · shape best · planning best · execution standard · verification economy
```

The router groups by **phase**, not by hint:

| band | stages it divides | hints inside |
|---|---|---|
| `analysis` | triage, select, setup, context, shape | economy x2, standard x2, **best x1** |
| `planning` | critique, gate, scope, interface, int-gate, selection, architecture, planning, plan-gate | **best x4**, economy x4, standard x1 |
| `execution` | execution, verification | standard, economy |
| `review` | diff-gate, audit | economy, standard |

**One preset serves `planning`, which contains `architecture` (best) and `gate`
(economy) at the same time.** The hint is written, versioned, validated — and
read by nobody except `server/decision-tier.ts`, which is shadow-only.

On the measured host:

```
bands the code resolves  : analysis, execution, explore, planning, research, review
bands with a row         : analysis, execution, planning
bands MISSING a row      : explore, research, review  -> fall to preset_default
distinct presets in stage_presets: 1
all pointing at          : opencode/space-bunny-free
```

Time by hint: `standard` 62.7% (2060 min), `economy` 22.6% (744 min), `best`
10.2% (336 min).

**A cheap model is already configured — it was simply the model for
everything.** 23% of stage time is already in stages upstream marks `economy`,
running on the default preset because the band resolved to a single one. Nothing
was missing except the routing the catalog already declared; section 4 is that
routing.

## 4. Shipped

1. **`model_hint` is routed on.** Each stage's hint is now a band consulted
   ahead of its phase band (`lib/preset-staleness.mjs#presetBandsForCardKindStage`),
   assignable under its own **Model tiers** group in Manage agent presets. The
   change is additive by construction: the first band with a preset pinned wins,
   so an install that pins no tier routes exactly as before, and a card pin or
   the reliable override still beats every band.

   It is deliberately a **separate key in `stage_presets`**, not a change to
   `bandForCardKindStage`. Rewriting the phase band would have made
   `refreshRestartPending` report every advance as a stale preset, because it
   compares `worker_preset_id` against the resolved `preset_id` on its own.

2. **The run directory is named.** `bb stelow playbook` now prints the current
   run's artifact root and every file its recipe declares
   (`lib/recipe-catalog.mjs#recipeOutputs`), and the native reconciliation
   message names each staging → canonical copy instead of saying "register them
   at their canonical paths" without ever writing those paths down.

   Two details are load-bearing. Expected outputs carry **no missing-file
   verdict**: a file a run has not written yet is not a broken install. And the
   root is the card's latest run **for the current stage, in any state** - not
   the active run, because by the time a worker asks the run is `succeeded`, so
   an active-run lookup answers null exactly when the question is asked; and not
   the newest run of any stage, which would pair one stage's directory with
   another stage's filenames.

## 5. Did naming the run actually close it?

Checked against the 87 runs on disk rather than against the intent.

**Coverage: the declared outputs are the real ones.** Across those 87 run
directories, 150 files were actually written and the recipes declare 181. The
declared set covers **149 of the 150**; the single undeclared file is
`context/recon-receipt.json` from `setup-recon`, which the fixed-name registry
below names anyway. So `playbook` now names essentially everything a run
produces *and* everything the card keeps outside a run, not a convenient
subset.

**Latency: the worker never needed a new turn for it.** `bb stelow playbook` is
mandated as step one of every spawn prompt (`server/runtime/plugin-protocols.ts`,
`start-workflow-prompt.ts`, `cards-create-prompt.ts`), so the paths arrive in
the first tool call instead of after a hunt. That is the part that survives even
where the count below is small: a command removed is not just its tokens, it is
the round trip around it.

**What it does not fix, stated plainly.** Naming a root does not stop a worker
from `find`-ing *inside* it, and 184 of 225 run-dir commands were exactly that —
a worker that wants to know which files a specific run wrote still enumerates
them rather than reading a list. That half needs the steps *named as tasks*
(proposal C below), or a subcommand that returns the answer. What was closed is
the layer above it: the worker is told the root, the receipts, the layout, and
the recipe's declared outputs, so the enumeration it still performs starts from
the right directory with a known file list to check against.

**The receipts were the other half, and they are now named too.** The first
pass stopped at run directories and left a whole class uncovered: the files that
sit at a *fixed name* in a *fixed directory*. `audit-trail.md` was grepped 22
times and appears in 10 of the 44 state dirs on this host; `invariants.json` in
18; `scope-map.json` in 6; `audit.md` in 10. The host knows every one of those
paths — `lib/audit-trail-contract.mjs` even owns `AUDIT_TRAIL_FILE` as a
constant — and told the worker none of them, so one worker rebuilt
`.stelow/<date>/sw-card_<id>/audit-trail.md` by hand from memory.

`lib/state-dir-files.mjs` is now the single registry of those names, and
`bb stelow playbook` prints them: `state.md`, `session.log`, `audit.md`,
`audit-trail.md`, `invariants.json`, `scope-map.json`,
`context/recon-receipt.json` (the one file in the measured runs that a recipe
writes but does not declare), the four gate receipts from
`server/runtime/gate-vocabulary.ts` (`gate-approved.md`, `int-gate-approved.md`,
`plan-gate-approved.md`, `diff-gate-approved.md`), the state dir's full
subdirectory layout as one row, and the workspace-root `stelow.json`.

**Validated, not asserted.** For every command across the 19 live worker
threads, the state-dir path it references was extracted and checked against the
playbook a worker now sees: **215 of 216 references (99.5%) are named.** The one
that is not is a worker reading `.stelow/<date>/sw-card_x/transitions.md` — a
file that does not exist, in a directory it guessed. That is precisely the
failure naming prevents, and the real path is now printed.

Two rules keep that honest. A **conditional** receipt (anything a card earns
later) is named without a missing-file verdict, because a file not yet built is
not a broken install and a verdict there would teach the worker to ignore the
verdict that is real. And the path is **derived, never guessed**: without a
verified state dir the rows are omitted entirely, since a confidently wrong path
is worse than the search it replaces. The prompt's first instruction now names
that list too, so a worker reads it in one call instead of reconstructing it.

**One bug this check found, now fixed.** The root was read from the card's
newest run of *any* stage while the outputs came from the *current* stage's
recipe. A card sitting in `audit` whose newest run was the previous
`verification` got a `verification` directory labelled with `audit` filenames --
the archaeology this document is about, wearing a confident label. 1 of 18 live
cards was in that shape. The lookup is now stage-scoped, the stage is resolved
from `state.md` before the query (not the card's `stage` column, which can lag),
and the outputs come from the run's own `recipe_id` so the two can never
disagree. `tests/runtime-cli-inspection.test.mjs` pins it.

## 6. Intra-stage granularity: three proposals

The tail is 46% mechanical in `audit`, so the question "can part of a stage run
somewhere cheaper" is real. Three shapes, scored on DRY and SOLID.

### A. Mid-thread model switch (the Prewalk arrangement)

Add a `threads.update` model change when a stage's artifact lands.

*Rejected by measurement, not by taste.* The switch re-bills the whole
accumulated context as a cache write; a respawn pays ~70k fresh tokens against
a ~229k accumulated context, so the existing mechanism is 4x cheaper on the same
axis. It also violates SRP at the seam: `workers-respawn` would own both "a
preset changed" and "this turn is cheap enough", and each new trigger becomes a
branch in one function. `per-call-model` is `false` in
`lib/bb-workflow-capabilities.mjs` for the native path, and this would quietly
re-implement the capability on the coordinator path only — a second source of
truth for the same question.

### B. A third singleton preset for "cheap actions"

Resolve a `tail_preset` for post-artifact work.

*Rejected on YAGNI and on the delegation registry.* There is no call site with a
declared output contract to route to it: the tail is ad-hoc shell, not a typed
action, so the preset would be configurable and unused. Reusing
`generation_preset` is worse — `lib/delegation-map.mjs` registers generation
sites as disposable, hidden, read-only, text-in/text-out, and `assertDisposableSpawn`
refuses anything else. The `audit` tail writes (`bb stelow done`, `export`,
`db-surgery`), so routing it there would make the registry lie.

### C. Declare the tail as recipe tasks (**recommended**)

The mechanism already exists and is already how the expensive half of every
stage runs. Recipe tasks carry `output`, `output_schema`, `requirements`, and
`failure_policy`; the renderer resolves each through `agent(...)`. A cheap model
is then a *property of a declared task*, not a new router: add the mechanical
steps as tasks with their own tier hint, and the per-task model override becomes
the one place a tier is attached. It is DRY (one catalog, one renderer, one
resolver), it is OCP (a new tail step is data in the catalog, not a branch in
`workers-respawn`), and it is SRP (the router picks a *task*, the task carries
its own tier).

Its cost is the honest one: a task must have a contract, so the ad-hoc `grep`,
`ls` and `db-surgery` commands have to be **named and typed** before they can be
routed. That is work — and it is also the fix, because a named step is one the
host can run deterministically without a model at all. Which is the real
answer: `bb stelow audit-trail`, `bb stelow verify --tests` and friends cost no
tokens, and **free beats cheap**.

So the ordering is: pull the tier routing (shipped), name the steps (shipped, for
the paths), and only then decide per task whether it needs a model at all. A
tail step that survives that question is one worth giving a cheap model; most of
what this repo measured does not survive it.

## 7. Reproducing

The analysis reads the plugin's own database plus thread event logs; no
inference. `bb stelow playbook` and `bb thread log <id> --json --all` are the
two inputs.

```
sqlite3 ~/.bb/plugins/stelow/data.db \
  "SELECT card_id, stage, entered_at FROM card_stage_events ORDER BY card_id, entered_at;"

bb thread log <thread-id> --json --all
```

**The one filter that matters.** Durations are computed from
`card_stage_events`, whose rows do not close while a card waits on a human, a
host hold, or a pause. Any caption that does not cap long instances is
measuring silence, not work - and this document's first draft did not, which is
why the correction in section 1 exists. Cap at 6 hours, then verify each
surviving outlier against the thread's own event log by looking for the longest
gap between items: a 2479-minute gap is a night of waiting.

Caveats worth carrying: the per-tier prices used for the cost table are
illustrative, but the **4x respawn advantage is a ratio of context size, not of
price**, so it does not depend on them. The 55% saving of `frontier → cheap`
does depend on price and scales linearly with the real spread.
`thread/tokenUsage/updated` reaches only 4 of 19 workers — the rest emit
`contextWindowUsage/updated` alone — so the cache percentage is a sample of
four. No direct measurement of cross-model cache invalidation was made; the
calculation uses the provider's cache-write price.
