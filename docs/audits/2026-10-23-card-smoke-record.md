# Build-card smoke record — opencode / opencode-go / deepseek-v4.1-flash / high

Date: 2026-10-23. Branch `smoke/build-card-2026-10-23`, cut from
`f5442249` (`fix: audit repair batch, nine scopes, verified as one tree (#410)`).
Host: the deploy box, project `proj_a6wdkdcfkk` (`bb-plugin-stelow`).

**Outcome: the card was created, and after the opencode account was funded the
same card was restarted on the `opencode-go` plan. It then ran the whole build
path — triage through audit, 21 artifacts, three questions — and stopped at the
gate, which cannot pass in this repo: the host runs `npm test` with
`NODE_ENV=production`, where React ships no `act`. The docs change itself is
delivered and green in the card's checkout (commit `f23e4b34`). Attempt 1 died
on the provider's empty account; attempt 2 completed every stage and parked at
`audit`. No card was deleted or recreated.**

## 1. The card

| Field | Value |
|---|---|
| Card id | `card_wxpaf8ll` |
| Display name | `Smoke probe (docs-only): the audits/ bullet in docs/README` |
| Track / intent | build / `refactor` |
| Knobs | quality `production`, exploration 3 (hybrid), red-first `advisory`, review gates `Auto` |
| Card preset | `preset_zdoy3hg8` — "Smoke opencode deepseek-v4.1-flash high" (attempt 1; attempt 2 in §8) |
| Preset provider / model / reasoning / permission | `acp-opencode` / `opencode/deepseek-v4.1-flash` / `high` / `full` |
| Preset workspace | `new-worktree` |
| Worker thread | `thr_dg7cf3sfsz` (attempt 1); `thr_ua93npd44g` (attempt 2, §8) |
| Worker environment | `env_qxt8sftq2r`, managed worktree, branch `bb/stelow-smoke-probe-docs-only-the-audits-bullet-i-thr_dg7cf3sfsz`, based on `origin/master` = `f5442249` |
| State dir | `/home/deploy/repos/bb-plugin-stelow/.stelow/2026-10-23/sw-card_wxpaf8ll/` |

The card's requested work was a small, real, verifiable docs change: list all
seven `docs/audits/2026-10-23-*-record.md` files in the `audits/` bullet of
`docs/README.md`, docs-only, `npm run lint` stays green.

## 2. How the provider and model id were resolved

`bb provider models --provider opencode` is **not** the CLI's form — it exits
with `error: unknown option '--provider'`. The documented form is positional:
`bb provider models [providerId]`.

`bb provider models opencode` answers **`No models available`**: `opencode` is a
route name in the catalog (`routeProviderId`), not a BB provider id. The provider
whose display name is *opencode* has id `acp-opencode`:

```
$ bb provider list
pi            Pi
acp-opencode  opencode
codex         Codex
claude-code   Claude Code
acp-cursor    Cursor
```

`bb provider models acp-opencode` lists `opencode/deepseek-v4.1-flash` with
`supportedReasoningEfforts: [low, high, max]`, so `high` is a supported level and
the requested model is real. No substitution was made.

## 3. The documented path used

1. Preset, through the CLI (`bb stelow preset add`):

   ```
   bb stelow preset add --name "Smoke opencode deepseek-v4.1-flash high" \
     --provider acp-opencode --model opencode/deepseek-v4.1-flash \
     --reasoning high --permission full --workspace new-worktree
   # OK preset_zdoy3hg8 Smoke opencode deepseek-v4.1-flash high
   ```

2. Card, through the platform RPC (`bb plugin rpc call stelow createCard
   --input-file …`, the path `docs/remaining-debt-audit.md` records as
   shell-drivable), with `"start": false`.
3. `bb stelow preset assign --card card_wxpaf8ll --preset preset_zdoy3hg8`.
4. Start, through the RPC `startWorker` with `{"cardId":"card_wxpaf8ll"}`.

**Why parked-then-started, and not `start: true` with a `presetId`:** the
creation resolver takes `base = reliablePreset ?? bandPreset ?? selected`
(`server/cards-create.ts:145-152`), and this host has the `analysis` band pinned
to `preset_default` (`stage_presets`). An `analysis` band preset is what
`bandForKind("build")` returns (`lib/tracks.mjs:72-73`), so `presetId` alone is
superseded at creation. Starting a parked card resolves through the card's
pinned preset instead (`server/workers.ts:132-137` → `getReliablePreset(…, cardId)`),
which is the only path where the preset itself — including its `new-worktree`
workspace — decides the spawn. No setting outside this card was changed.

## 4. Timeline (UTC, 2026-10-23) — attempt 1

| Time | Event | Evidence |
|---|---|---|
| 17:29:40.470 | preset `preset_zdoy3hg8` created | `presets.created_at` |
| 17:29:58.004 | card created, parked (`start: false`), stage `triage` | `cards.created_at`, RPC `{cardId: card_wxpaf8ll, threadId: null}` |
| 17:29:58.727 | creation-time title burst refused on the parked card | comment: "Title burst did not start on the Default (generation preset unset) preset — the spawn was refused." |
| 17:31:03.494 | preset assigned to the card | `card_presets.assigned_at` |
| 17:31:08.474 | build started: worker thread `thr_dg7cf3sfsz` spawned | `threads.created_at` |
| 17:31:08.724 | card comment: `Worker started on preset "Smoke opencode deepseek-v4.1-flash high", continuing from Triage.` | `comments` |
| 17:31:09.370 | title-burst thread `thr_4kqejcxpy2` spawned on the same preset | `threads.created_at` |
| ~17:31:10 | managed worktree ready, branch from `origin/master` at `f5442249` | `system/thread-provisioning` |
| 17:31:17.179 | first (and only) turn accepted by the provider bridge | `turn/input/accepted` seq 20 |
| 17:31:17.848 | **provider error**; turn `status: failed` | `provider/error` seq 21, `turn/completed` seq 22 |
| 17:31:17.974 | card `activity = error`, `needsAttention = true` | `cards.updated_at` |

First stage entered: `triage` (the entry stage) at creation. No later stage was
ever entered; `bb stelow metrics --card card_wxpaf8ll`, read at 17:34Z, reports
`- triage: 4m 27s` and `Cycle time: not started (never left triage)`.

## 5. The failure, verbatim — attempt 1

Worker thread `thr_dg7cf3sfsz`, event seq 21 (`provider/error`, 17:31:17.848Z):

```
Internal error: Upstream request failed: Insufficient account funds:
{"service":"session","errorName":"provider.quota"}
```

`turn/completed` (seq 22) carried `"status":"failed"`. `provider/warning`
(seq 23) repeated the same summary. The card row records the same string in
`last_error`, and `cardDetail` reports `activity: "error"`,
`needsAttention: true`, `stage: "triage"`, `status: "draft"`, no
scopes, no artifacts, no questions, and one `workerHistory` entry whose
`tokenUsage` is `null`.

The title-burst thread `thr_4kqejcxpy2` (same provider and preset) failed the
same way 1.6 s earlier, at 17:31:16.280Z, with the identical `provider.quota`
detail.

**Is it the model or the account?** The provider process itself was healthy: an
`acp-opencode` thread created 24 minutes earlier (`thr_zvzfcyh6rr`, 17:07Z) ran
seven turns, and its events name `muse-spark`, not `deepseek`. The refusals are
specific to the paid `deepseek-v4.1-flash` request, and the provider's own name
for the cause is the account balance. The plugin classified the cause as
non-retryable, so no automatic spawn retry fired.

## 6. Prompt and token evidence

The worker prompt is inspectable as the thread's first outbound message
(`client/turn/requested`, seq 1 of `thr_dg7cf3sfsz`; `bb thread log
thr_dg7cf3sfsz --json --limit 1`).

| Measurement | Value |
|---|---|
| Prompt length | 13,217 chars |
| First per-card byte | offset 12,033 (`sw-card_wxpaf8ll` in the state-dir path; the project path and the `2026-10-23` date before it are shared for the day) |
| Shared prefix | 12,033 chars = **91.0%** |
| Est. tokens (`ceil(chars/4)`, the labelled estimate in `lib/prompt-budget.mjs`) | ~3,305 total, ~3,009 shared, ~296 re-paid per spawn |
| Provider token usage events | **none** — no `thread/tokenUsage/updated`, no `thread/contextWindowUsage/updated`; `cardDetail.workerHistory[0]` reports `tokenUsage: null`, `tokenUsageSource: null` |
| Tokens actually reported by the provider | **0** |

The prompt keeps the post-reorder shape the change is about: shared clauses
first, then one block of card values (state dir at 11,978, dir hash at 12,033,
intent at 12,535) and the request last (12,739). The automated harness on this
commit agrees with the live prompt:

```
prompt cache order: cross-card prefix per path — spawn: 91.4% of 13280 chars
(12139 cacheable) · restart: 92.2% of 12957 (11941) · reseed: 96.1% of 12420
(11941) · research: 93.0% of 9689 (9015) · explore: 91.8% of 6702 (6152)
```

**A cross-card number this record does not claim:** comparing the live prompt to
the only other real build prompt on disk (`card_qz4xb8xi`, 2026-10-22) yields a
13.3% shared prefix, but the two texts diverge at char 1,748 inside the playbook
paragraph (`your state dir's receipts` vs `and stage playbook paths`) — a prompt
wording change between versions, not a per-card interpolation. That figure is
version drift, and reporting it as a cache measure would be wrong.

## 7. Two smaller things the run surfaced

- **The card's environment label is stale on the parked-then-started path.**
  The worker really runs in a managed worktree (`env_qxt8sftq2r`,
  `isWorktree: true`, path
  `…/worktrees/thr_dg7cf3sfsz-1/bb-plugin-stelow`), and
  `cardDetail.fileEnvironmentId` names it. But `cardDetail` also reports
  `environmentLabel: "shared"` and `workspaceKind: "project"`: the label was
  written at creation (when the base preset was `preset_default`,
  `project-default`) and the later `new-worktree` start did not rewrite it. A
  reader of the card would believe it shares the checkout.
- **`bb provider models opencode` reads as a missing model.** See §2: the
  command succeeds with `No models available` because `opencode` is a route
  name; the provider id is `acp-opencode`.

## 8. Retry on the funded opencode-go plan (attempt 2, same card)

The card was still parked at `triage` with `activity: error`, so it was
restarted, not recreated: a new preset was assigned to the same card and the
worker was replaced. The old thread was archived with `ended_reason: restart`;
the card id, state dir, comments and worktree were reused.

### 8.1 `opencode go` is a plan on the same provider id, not a provider id

| check | result |
|---|---|
| `bb provider list` | `pi`, `acp-opencode`, `codex`, `claude-code`, `acp-cursor` — **no `opencode-go`** |
| `bb provider models --json` | `opencode-go` appears only as `routeProviderId` (33 models) |
| `bb provider models pi` | lists `opencode-go/deepseek-v4.1-flash`, efforts low/high/max |
| `bb provider models acp-opencode` | lists `opencode-go/deepseek-v4.1-flash`, efforts low/high/max |

The provider that served attempt 1 (`acp-opencode`, display name *opencode*)
also carries the Go route, so the plan is selected by the model-id prefix on the
same provider id. Resolved: **provider `acp-opencode`, model
`opencode-go/deepseek-v4.1-flash`, reasoning `high`** — model family kept, route
moved from pay-per-use `opencode/…` to the funded `opencode-go/…`. No silent
substitution.

### 8.2 Restart path (documented surfaces only)

```
bb stelow preset add --name "Smoke opencode-go deepseek-v4.1-flash high" \
  --provider acp-opencode --model opencode-go/deepseek-v4.1-flash \
  --reasoning high --permission full --workspace new-worktree
# OK preset_7hzaf2ko
bb stelow preset assign --card card_wxpaf8ll --preset preset_7hzaf2ko
bb plugin rpc call stelow restartWorker   # {"cardId":"card_wxpaf8ll"} -> {ok:true}
```

New worker `thr_ua93npd44g` on `preset_7hzaf2ko`; `thr_dg7cf3sfsz` archived at
18:10:14.822Z.

### 8.3 Stage path and timeline (UTC, 2026-10-23)

| Time | Event |
|---|---|
| 18:10:10.304 | preset `preset_7hzaf2ko` created |
| 18:10:14.822 | worker `thr_ua93npd44g` spawned; first stage `triage` |
| 18:10:47.947 | `select` |
| 18:11:08.478 | `setup` — run `setup-recon` 18:11:08.554 → 18:13:25.778 |
| 18:13:25.778 | **first stage artifact**: `runs/exec_qcsxzohl/recon/setup.md` (the manifest had 0 after attempt 1) |
| 18:13:34.719 | `context` — `strategic-context` → 18:19:26.042 |
| 18:19:56.653 | `planning` — `planning-research` → 18:31:26.299 |
| 18:31:20.222 | `execution` — docs edit made directly, no native run |
| 18:33:01.660 | `verification` — run 18:33:01.782 → 18:43:26.028 |
| 18:43:50.378 | `audit` — `execution-audit` 18:43:50.439 → 18:56:56.097 |
| 19:11:12.836 | `bb stelow done` refused (verbatim in §8.6) |
| 19:15:22.455 | **first question** |
| 19:47:00 | worker idle at `audit`, card `in-progress`, `needsAttention: true` |

### 8.4 Questions (three, all answered)

| Asked | Question | Answer |
|---|---|---|
| 19:15:22.455 | The host gate runs in the shared checkout, which another thread left with eight uncommitted edits; its suite fails there. How should I get a green host run? | `Stash their edits briefly` (19:17:42.716) |
| 19:18:35.055 | Stashing did not help: with that checkout clean the gate still fails, so the red gate is branch commit `99dfc487`, not the WIP. | `Switch to master for the gate` (19:24:27.002) |
| 19:29:47.171 | The host runs the gate with `NODE_ENV=production`; React ships without `act`, so the test dies even on clean master. Patching the test setup would break this card's "no test files change" rule. | `Leave the card blocked` (19:35:51.798) |

### 8.5 Provider, prompt and token evidence

| Measurement | Value |
|---|---|
| Provider / model / reasoning | `acp-opencode` / `opencode-go/deepseek-v4.1-flash` / `high` |
| Turns | 8 started, 8 `complete`; **0 provider errors** |
| Prompt (spawn) | 13,453 chars; first card-specific byte at 12,033 → **89.4%** shared prefix; ~3,364 est. tokens, ~3,009 shared |
| Provider token totals | **none** — no `thread/tokenUsage/updated`; `workerHistory[0]` = `tokenUsage: 205632`, `tokenUsageSource: "context-estimate"` |
| Context window at end | 205,632 / 1,000,000 (a provider context reading, never a token total) |
| Provider-reported cache read | **absent** — this provider sends context usage only |

### 8.6 Terminal state: parked at `audit`, `done` refused

Card comment 1792782672836 (19:11:12.836Z), verbatim:

```
bb stelow done refused: Run `bb stelow verify --tests` successfully from this Build card before marking it Done. The host records the command, result, checkout, and HEAD.
```

`verification_runs` for this card: six rows, **every one `exit_code = 1`** — three
at branch HEAD `99dfc487`, three at `f5442249` (clean `origin/master`).

**The gate defect, verified independently.** Same tree, same test file, only the
environment differs:

```
$ NODE_ENV=production node tests/workspace-recovery.test.mjs
    at exports.act (…/react-dom-test-utils.production.js:20:16)
$ env -u NODE_ENV node tests/workspace-recovery.test.mjs
workspace recovery test ok: promotion and attachment are mutually exclusive evidence-led paths
```

The gate spawns the suite from the host process (`runHostTests`,
`server/runtime/git-evidence.ts:299-316`, `execFile` with **no `env` override**),
so it inherits `NODE_ENV=production`. React then resolves to the production build
without `act`. This is why a green gate is impossible for this repo as it stands,
and it does not depend on the card's docs change. The worker's audit records the
same defect from its own run.

### 8.7 Interventions (on the run, never on the card's content)

1. **`kill -TERM` at 19:10:58Z** on the worker's own wait loop:
   `while pgrep -f "npm test" >/dev/null; do sleep 10; done`. `pgrep -f` matched
   the loop's own `bash -c` command line, so it could never exit (11 minutes
   while `npm test` had already finished, log `exit=0`). After SIGTERM the
   worker read the log and proceeded. The flawed command is the worker's, not
   the plugin's.
2. **Three answers** (§8.4). On the last two the worker stashed the shared
   checkout's 12 dirty paths, checked out `origin/master`, ran the gate, and
   restored them. I verified the restoration: branch `fix/context-policy-parity`,
   the same 12 dirty paths as the pre-intervention snapshot (sorted-list diff
   empty), no card stash left behind.

### 8.8 The card's work: real, committed, not merged

- Commit `f23e4b34` in the card's worktree: `docs/README.md`, +14/−2 — names all
  seven `docs/audits/2026-10-23-*-record.md` with one-line subjects and keeps the
  scope-6 sentence. No code or test file touched.
- Artifacts: 21 (`bb stelow manifest --card card_wxpaf8ll`); `cardDetail` lists
  24 paths because the audit run's nested
  `runs/exec_a02ul1ax/audit/{requirements,evidence,report}.md` count there too.
- Nothing was pushed; the commit lives on
  `bb/stelow-smoke-probe-docs-only-the-audits-bullet-i-thr_dg7cf3sfsz` in the
  card's own worktree.

## 9. What was left in place

Nothing was deleted, archived, or advanced, and no other card was touched.
`card_wxpaf8ll` sits at `audit`, `status: in-progress`, `activity: idle`,
`needsAttention: true`, with its worker `thr_ua93npd44g`, its worktree
(`env_qxt8sftq2r`) and preset `preset_7hzaf2ko` intact. The shared checkout was
restored and is byte-identical to its pre-intervention state. `skills/` and
`data/stelow` were not touched.

## 10. What a person should look at first

1. **The host test gate sets `NODE_ENV=production`.** No Build card in this repo
   can be marked Done until the gate runs the suite as CI does (`NODE_ENV=test`
   or unset) or the test setup stops depending on it. This is the retry's real
   finding, and it is bigger than one card.
2. **The docs change is delivered, not merged:** commit `f23e4b34` on the card's
   worktree branch. Review it. It is not in the shared checkout: the
   `docs/README.md` diff there lists audit briefs that do not exist in the tree
   and is the other thread's parked WIP (the worker's closing note blamed that
   16-line bullet on its own context run; the file does not contain this card's
   seven-record list, so the attribution is wrong).
3. The `bb provider models opencode` trap in §2 (`No models available` means
   "route name, not provider id"), and the stale `environmentLabel: "shared"`
   on a card whose worker really runs in a worktree (§7).
