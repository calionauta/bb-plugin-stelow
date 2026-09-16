# Stelow for bb

Visualize and control [Stelow](https://github.com/calionauta/stelow) workflows inside bb. 🚀 Created by the original author of Stelow.

Turn humans and AI agents into a cross-functional product team: research opportunity spaces with 14 strategy playbooks, run single-stage explorations, then build through an orchestrated workflow — Shape Up proposals, interface trade-offs before code, typed scopes with spikes up front, gated reviews, and agent workers. 

One board, one quiet inbox.

## What it adds

- **Stelow board:** a bb navigation panel with Inbox / Build / Research / Explore / About tracks. Build cards flow through Analyze, Plan, Execute and Review to Done; research and explore cards move To-Do → Doing → Done. New cards start in Triage (build) or To-Do (research/explore). While the agent waits on a structured question the card stays in its column and signals it is waiting for an answer, with an inbox item. Every track explains itself.
- **Explore runs:** pick one technique (Shape Up, interface alternatives, critiques, tech planning…), supply the input, get one artifact — no triage, no pipeline, no gates.
- **Deterministic artifacts:** research round files and explore artifacts are pre-created by the plugin and validated in code; `bb stelow verify` lets the worker self-check before finishing.
- **Auditable Build completion:** a Build card can become Done only at Audit, after the host records test evidence, validates its `audit.md` receipt against the exact checkout and Git HEAD, and builds/checks Stelow's portable `audit-trail.md` receipt under `--strict`. The trail must attest that same repository and commit — a checkout that moved while it was written blocks completion instead of leaving two receipts for two different trees — and the card shows a compact verified / changed-since-completion state you can re-check.
- **About tab:** what Stelow is vs what the plugin adds, with each repo link and each version side by side.
- **Workflow actions:** start a Stelow agent thread, open generated artifacts, approve gates, advance stages, repair a stuck workflow, or archive a card.
- **Native approval receipts:** approvals are written to `.stelow/approvals/{dirHash}/` using Stelow's canonical filenames.
- **Artifact comments:** quote a passage in any rendered artifact and send it to the agent as a contextual comment.
- **Blocking questions:** single-choice and multi-choice forms replace the composer through `bb ui.requestInput` and the `bb stelow ask` CLI. The card stays in its column and signals it is waiting for an answer while a question is open.
- **Agent presets:** assign a provider/model reasoning/permission profile to any card (schema mirrors the bb Tasks plugin). The worker thread is started with the preset's execution options.
- **Sidebar badge:** the Stelow menu row shows a live count of unresolved inbox action items, and nothing else — a finished card is not blocked work. Finished cards carry their own emerald **Review** marker until you open them.
- **CLI:** inspect workflows, request structured input, advance stages, verify artifacts, fan out research, and manage presets.

The plugin keeps its own board store (cards, questions, presets, publication
history). `stelow.json` and `.stelow/` remain the source of truth for the
workflow itself — the board reads them, never replaces them. Details live in
[FEATURES.md](./FEATURES.md).

## Strategies and techniques

The **Research tab** offers 14 product strategies. Each runs one
`stelow-product-*` playbook and produces a `research-index.md` plus round
files that can be fanned out into Build cards:

- 💼 **Business models** — Cost and revenue model triggers to adapt and experiment with how the product makes money.
- 🧬 **Evolutionary strategy** — Adaptability, optionality, and experimentation beyond fixed roadmaps.
- 🎯 **Jobs to be done** — Segmentation, job map, desired outcomes, plus emotional and social jobs.
- 🎁 **Launch promotions** — MAGIC launch offers: loss leader, gift cards, and irresistible freebies.
- 🔭 **Market analysis** — PESTLE, foresight, Delphi, and Wardley maps on a market or niche.
- 🏪 **Marketplace playbook** — Supply and demand tactics for stimulating marketplaces.
- 🔓 **Open source strategy** — Delivering value by giving up control: business models and moats.
- 🗺️ **Opportunity mapping** — Ranked solutions for a problem, from opportunities to bets.
- 🎟️ **Paywall & onboarding** — Consumer-app monetization funnel, from paywall to trial policy.
- 💰 **Pricing** — How to charge, how to package and limit usage, and how to frame perceived value.
- 📣 **Product ads** — Ad categories by audience awareness stage, based on the transtheoretical model.
- 🧪 **Product discovery** — Short-cycle validation: idea, early adopters, MVP, and first sale.
- 💓 **Product health** — Success signals held in tension with counterbalance signals to avoid side effects.
- 🤝 **Trust building** — Perception pillars and guarantees that make trust concrete.

The **Explore tab** offers 8 one-shot techniques. Each runs one
`stelow-workflow-*` playbook with no triage, pipeline, or gates, and produces
a single `explore-<stage>.md` artifact:

- 📐 **Shape Up proposal** — Turn an idea into a shaped proposal with IN/OUT scope, appetite, and risks before planning.
- 🎨 **Interface alternatives** — Explore 1, 3, or 5 interface directions with explicit trade-offs before any code.
- 🔍 **Product plan critique** — Review a plan or proposal for gaps, risks, assumptions, and open questions.
- 🧱 **Tech plan + scopes** — Generate a technical plan with typed, dependency-ordered scopes from an existing document.
- 🏗️ **Codebase critique** — Structural review of a codebase: architecture, coupling, hotspots, and maintenance risk.
- 🖥️ **UX critique** — Evaluate an interface or live URL against heuristics, accessibility, and visual hierarchy.
- 🧪 **Testing strategy** — AI-aware testing plan with security gates and risk-based coverage targets.
- ✅ **Execution critique** — Post-implementation check verifying scope completion and surfacing gaps.

## Requirements

1. bb desktop ≥ 0.38 ([getbb.app](https://getbb.app) — macOS one-click download,
   `npx bb-app@latest` elsewhere; your agents run on your own subscriptions).
2. A normal bb project backed by a local workspace source.
3. Stelow skills and product playbooks: **bundled with the plugin** (shipped
   in `skills/`), so no external install step is required. The worker agent
   loads its stage guide or selected strategy from the plugin's own skills
   directory.
4. A `stelow.json` created by a Stelow workflow for board data.
5. Optional host tools (all fail-soft — the plugin never installs binaries
   itself): [`sem`](https://github.com/Ataraxy-Labs/sem) adds a one-line
   entity summary to the card Diff section (`~/.local/bin/sem` on the host
   is enough); without it the patch list renders on its own.

The singleton bb personal project has no workspace source, so the board asks you to select/create a normal project.

## Install

> Pending marketplace approval — install a released version from this repository:

```bash
bb plugin install "git:https://github.com/calionauta/bb-plugin-stelow.git@v0.20.0" --yes
bb plugin list   # stelow should show as running
```

Or in bb: Extensions → Plugins → Add plugin, paste
`git:https://github.com/calionauta/bb-plugin-stelow.git`, Install.
BB checks whether the installed plugin has a compatible update without
changing a running workflow. When one is available, the About tab shows it
and offers a confirmation step; BB then applies the released, verified bundle.

(`bb skill list` can confirm the bundled skills. Third-party plugins are
full-trust server code: install only sources you trust.)

For development (clone + hot-reload):

```bash
npm install
bb plugin build
bb plugin install . --yes
```

### Development checks

After `npm install`, one command gives both people and coding agents the
current quality picture:

```bash
npm run quality:report
```

It reports lint, unused-code, and duplication findings without blocking an
existing checkout on its initial backlog. `npm run architecture` is the
enforced boundary check; `npm run security:full` fails on high/critical npm
advisories. CI runs all of these automatically. Socket's deeper package scan
is optional and requires the repository's own Socket API token.

```bash
bb plugin dev
```

## Use

Open **Stelow** in bb's left navigation (the row shows a live badge of items needing your attention). Select a project with Stelow state, then:

1. Choose the workflow's **Appetite** and **Review mode** above the composer
   (defaults: **Lean** and **Auto**). Then enter a product request in the
   **composer** (bb's full new-thread editor). Those choices are written
   to the new workflow's `state.md` and `stelow.json`, so the worker does not
   ask for them again. After a successful creation, they also become the
   board's defaults for your next card. The card is created in **Triage** and
   the agent begins there.
2. The agent runs the pipeline and, the moment it needs a
   decision, opens a structured question. While a question is pending the card
   stays in its column, marked as waiting for your answer. Reply in the form, in the thread, or from the card
   detail's "Answer in thread" action. Unanswered questions stay answerable
   on the card — the agent waits instead of guessing.
3. Open product specs, interface proposals, and technical plans from the board;
   quote a passage to comment on it.
4. Approve the matching gate only after review; the plugin creates the portable
   receipt. Track planned scopes and execution tasks in the board.

### Cards and keyboard

- **Enter** / **Space** on a card opens its detail.
- **W** on a card opens the worker thread without a double-click.
- **Esc** (or the Back button) leaves the detail and returns focus to
  that card on the board.
- The card detail explains **Repair** and **Archive** with confirmation dialogs.
  Repair reseeds `state.md` and `stelow.json` and restarts the worker from
  triage; Archive converts the card to the Archived column and stops the worker.

### Agent presets

A preset is a named provider/model reasoning/permission (plus optional
environment, base branch, machine, and instructions) profile. Cards remember
their preset; the worker thread is spawned with that profile.

When the provider is **Pi**, the preset picker intentionally shows only the
configured Bifrost routes. It does not expose Pi's unrelated
OpenCode/OpenRouter route catalog.

```bash
bb stelow preset list
bb stelow preset add --name "Deep shape" --model gpt-5 --reasoning high
bb stelow preset add --name "Quick" --model gpt-5-mini --reasoning low --permission auto
bb stelow preset assign --card <card_id> --preset <preset_id>
```

To apply a changed preset to a running card, assign it and then click
**Repair** — the worker thread is recreated with the new profile.

### CLI

```bash
bb stelow status --project <proj_id>
bb stelow status --project <proj_id> --json

bb stelow ask \
  --thread <thr_id> \
  --question "Which direction should we use?" \
  --option "Option A" \
  --option "Option B"

bb stelow ask \
  --thread <thr_id> \
  --question "Which constraints apply?" \
  --multiple \
  --option "Offline" \
  --option "Accessible" \
  --option "Mobile"

# Batch independent questions into one call — the human answers them
# together instead of being pinged one by one:
bb stelow ask \
  --thread <thr_id> \
  --question "Which direction should we use?" \
  --option "Option A" \
  --option "Option B" \
  --question "Which constraints apply?" \
  --multiple \
  --option "Offline" \
  --option "Accessible"

bb stelow preset list|add|remove|assign

bb stelow advance --dry-run <stage>   # validate a transition without mutating
bb stelow done [--card <card_id>]     # verify in code and record completion
bb stelow verify [--card <card_id>]   # worker self-check: artifacts are valid
bb stelow doctor [--project <id>]     # detect workflow drift
bb stelow split [--card <card_id>]    # execute an approved card-split proposal
bb stelow preview [status|start|stop] [--card <card_id>]  # card workspace dev server
bb stelow playbook [--card <card_id>] # exact state and playbook paths
bb stelow fan-out --opportunity <id> [--card <card_id>]   # index opportunities into build cards
bb stelow seed --project <proj_id> --name <name> --intent <type>  # seed state files
bb stelow schema [command]            # machine-readable subcommand contracts
bb stelow sync-scopes [--json]        # parse spec-tech scopes (auto-runs on advance to execution)
bb stelow lock acquire|release|check --scope <id> [--file ...] [--ttl N] [--json]
bb stelow config get <field> [default]
```

## Deploy / hot-reload (CRITICAL)

Use the explicit development reload command after every plugin change:

```bash
npm run build:reload
```

It builds the current `dist/` bundle and runs `bb plugin reload stelow`,
which replaces this plugin in the already-running BB process. This preserves
active threads and is the reliable fallback when automatic hot-reload does not
refresh an open client panel. Reopen the Stelow panel afterwards; hard-refresh
the browser only if it still displays stale UI.

`npm run build` remains useful for build-only validation. `npm run reload` is
available when the bundle is already current. Bump `package.json#version` when
you need the Plugins screen to display a new version number, then run
`npm run build:reload`.

**NEVER run `systemctl --user restart bb-daemon.service` as a deploy step.**
A daemon restart SIGTERMs every running thread and each one is marked
"Thread interrupted because the host daemon disconnected". On 2026-08-25 this
exact pattern killed this thread four times in one day (16:22, 16:33, 18:22,
18:51 UTC) — the agent resumed, ran its deploy playbook with a daemon restart,
and terminated itself.

If a full daemon restart is ever truly required, do it outside of any active
thread and expect live threads to be interrupted.

## Gate behavior

| Stelow gate | Artifact | Receipt |
|---|---|---|
| `gate` | Product spec | `gate-approved.md` |
| `int-gate` | Interface proposals | `int-gate-approved.md` |
| `plan-gate` | Technical plan | `plan-gate-approved.md` |
| `diff-gate` | Working-tree diff | `diff-gate-approved.md` |

Approval creates a receipt only. The Stelow agent/router remains responsible for validating and advancing the state machine.

## Operator runbook: stuck asks

If a worker reports "The question could not be recorded" and the card stays
`idle` with no pending question, the ask timed out (or was interrupted) while
its persist to `expired_questions` failed. Diagnose in order:

1. Plugin log (`~/.bb/plugins/stelow/logs/plugin.log`): look for `stelow ask
   persist attempt` warnings — they name the card, thread, and exact DB error.
2. A single `SQLITE_BUSY` / `database is locked` warning followed by success
   is normal (one automatic retry); repeated non-busy errors mean the DB
   handle is closed (hot-reload timing) or the disk is full — restart the
   daemon outside active threads and retry the ask.
3. To unstick the card: send any message on the worker thread — the worker
   re-asks once, per protocol.

## Validate

```bash
npm run typecheck   # tsc --noEmit
npm run build       # bb plugin build && node scripts/postbuild.mjs
bb plugin list
```

See [CHANGELOG.md](./CHANGELOG.md) for per-release changes.
