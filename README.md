# Stelow for bb

Visualize and control [Stelow](https://github.com/calionauta/stelow) workflows inside bb without replacing Stelow's portable skills or file contracts.

## What it adds

- **Stelow board:** a bb navigation panel with Kanban columns for workflows, plus scopes and tasks. New cards start in **Triage**; they move to **Gate pending** while the agent waits on a structured question and to **Running** when the agent is actively working.
- **Workflow actions:** start a Stelow agent thread, open generated artifacts, approve gates, advance stages, repair a stuck workflow, or archive a card.
- **Native approval receipts:** approvals are written to `.stelow/approvals/{dirHash}/` using Stelow's canonical filenames.
- **PRD and plan review:** `.md` artifacts can open with the Stelow reviewer; select text and append a contextual review comment.
- **Blocking questions:** single-choice and multi-choice forms replace the composer through `bb ui.requestInput` and the `bb stelow ask` CLI. The card moves to Gate pending automatically while a question is open.
- **Agent presets:** assign a provider/model reasoning/permission profile to any card (schema mirrors the bb Tasks plugin). The worker thread is started with the preset's execution options.
- **Sidebar badge:** the Stelow menu row shows a live count of Triage/Shaping/Running/Gate-pending cards.
- **Agent integration:** `@workflow-name` mentions resolve fresh Stelow state into agent context.
- **CLI:** inspect workflows, request structured input, advance stages, and manage presets.

The plugin does **not** maintain a second workflow database. `stelow.json` and `.stelow/` remain the source of truth.

## Requirements

1. A normal bb project backed by a local workspace source.
2. Stelow skills: **bundled with the plugin** (shipped in `skills/`), so no
   external install step is required. The worker agent loads the stage guides
   from the plugin's own skills directory.
3. A `stelow.json` created by a Stelow workflow for board data.

The singleton bb personal project has no workspace source, so the board asks you to select/create a normal project.

## Install

```bash
npm install
bb plugin build
bb plugin install . --yes
```

For development:

```bash
bb plugin dev
```

## Use

Open **Stelow** in bb's left navigation (the row shows a live badge of cards in
Triage/Shaping/Running/Gate pending). Select a project with Stelow state, then:

1. Choose the workflow's **Appetite** and **Review mode** above the composer
   (defaults: **Lean** and **Auto**). Then enter a product request in the
   **composer** (bb's full new-thread editor): type `@` to mention, or use the
   `+` menu to attach files/skills before starting. Those choices are written
   to the new workflow's `state.md` and `stelow.json`, so the worker does not
   ask for them again. After a successful creation, they also become the
   board's defaults for your next card. The card is created in **Triage** and
   the agent begins there.
   The compact **Worker policy** line shows the configured preset for each
   workflow phase and opens **Configure presets** when you need to change it.
   A new card always starts with the shared Analysis preset, then adopts each
   later phase's preset automatically; absent assignments use the built-in
   default.
2. The agent runs the triage → select → … pipeline and, the moment it needs a
   decision, opens a structured question. While a question is pending the card
   sits in **Gate pending**. Reply in the form, in the thread, or from the card
   detail's "Answer in thread" action.
3. If nobody answers before the ask timeout, the card shows the question as
   **timed out** with the options still clickable — the agent proceeds with
   its best judgment, and any late answer is delivered to the worker thread
   for its next turn.
4. Open product specs, interface proposals, and technical plans from the board.
5. Select text in a document and add a review comment.
6. Approve the matching gate only after review; the plugin creates the portable
   receipt.
7. Track planned scopes and execution tasks in the board.

### Cards and keyboard

- **Enter** / **Space** on a card opens its detail.
- **W** on a card opens the worker thread without a double-click.
- The card detail explains **Repair** and **Archive** with confirmation dialogs.
  Repair reseeds `state.md` and `stelow.json` and restarts the worker from
  triage; Archive converts the card to the Archived column and stops the worker.

### Agent presets

A preset is a named provider/model reasoning/permission (plus optional
environment, base branch, machine, and instructions) profile. Cards remember
their preset; the worker thread is spawned with that profile.

When the provider is **Pi**, the preset picker intentionally shows only the
configured Bifrost routes: Harness Coding, GPT-5.6 Sol, Terra, and Luna. It
does not expose Pi's unrelated OpenCode/OpenRouter route catalog.

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

bb stelow preset list|add|remove|assign
```

## Deploy / hot-reload (CRITICAL)

Deploying plugin changes is **`npm run build` only**. The bb server
hot-reloads the plugin when `dist/` becomes newer than the source.

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

## Validate

```bash
npm run typecheck   # tsc --noEmit
npm run build       # bb plugin build && node scripts/postbuild.mjs
bb plugin list
```

See [CHANGELOG.md](./CHANGELOG.md) for per-release changes.
