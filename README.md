# Stelow for bb

Visualize and control [Stelow](https://github.com/calionauta/stelow) workflows inside bb without replacing Stelow's portable skills or file contracts.

## What it adds

- **Stelow board:** a bb navigation panel with Kanban columns for workflows, plus scopes and tasks.
- **Workflow actions:** start a Stelow agent thread, refresh state, open generated artifacts, and approve gates.
- **Native approval receipts:** approvals are written to `.stelow/approvals/{dirHash}/` using Stelow's canonical filenames.
- **PRD and plan review:** `.md` artifacts can open with the Stelow reviewer; select text and append a contextual review comment.
- **Blocking questions:** single-choice and multi-choice forms replace the composer through `bb.ui.requestInput`.
- **Agent integration:** `@workflow-name` mentions resolve fresh Stelow state into agent context.
- **CLI:** inspect workflows or request structured input from an agent/tool.

The plugin does **not** maintain a second workflow database. `stelow.json` and `.stelow/` remain the source of truth.

## Requirements

1. A normal bb project backed by a local workspace source.
2. Stelow installed as skills (`npx skills add calionauta/stelow -g` or Stelow's installer).
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

Open **Stelow** in bb's left navigation. Select a project with Stelow state, then:

1. Enter a product request and choose **Start workflow**.
2. Follow the agent's Stelow questions and generated artifacts.
3. Open product specs, interface proposals, and technical plans from the board.
4. Select text in a document and add a review comment.
5. Approve the matching gate only after review; the plugin creates the portable receipt.
6. Track planned scopes and execution tasks in the board.

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
```

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
npx tsc --noEmit
bb plugin build
bb plugin list
```
