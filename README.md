# Stelow for bb

Visualize and control [Stelow](https://github.com/calionauta/stelow) workflows inside bb. Created by the original [author of Stelow](https://github.com/calionauta).

One board, one quiet inbox: shape proposals, explore interface directions,
plan typed scopes, and execute with gated reviews and agent workers — with
blocking questions, agent presets, and GitHub issue automation on top.

> [!TIP]
> Install now: [https://getbb.app/marketplace/stelow](https://getbb.app/marketplace/stelow)

## Docs (single source of truth)

The manual lives on the Stelow site, not here:

- [Overview + getting started](https://calionauta.github.io/stelow/docs/)
- [What the plugin adds](https://calionauta.github.io/stelow/docs/plugin/what-plugin-adds/) (core vs plugin)
- [Install on bb](https://calionauta.github.io/stelow/docs/plugin/install-bb/)
- [Board and inbox](https://calionauta.github.io/stelow/docs/plugin/board-and-inbox/) ·
  [Agent presets](https://calionauta.github.io/stelow/docs/plugin/agent-presets/) ·
  [Automation rules](https://calionauta.github.io/stelow/docs/plugin/automation-rules/) ·
  [GitHub issues](https://calionauta.github.io/stelow/docs/plugin/github-issues/) ·
  [Team playbook](https://calionauta.github.io/stelow/docs/plugin/team-playbook/) (experimental)

`stelow.json` and `.stelow/` remain the source of truth for the workflow
itself — the board reads them, never replaces them.

## Requirements

1. bb desktop ≥ 0.43 ([getbb.app](https://getbb.app)).
2. A normal bb project backed by a local workspace source.
3. Stelow skills: **bundled with the plugin** (shipped in `skills/`), no
   separate install step.

## Install

Marketplace (Extensions → Plugins → Stelow), or:

```bash
bb plugin install "git:https://github.com/calionauta/bb-plugin-stelow.git@<tag>" --yes
```

(check the [releases](https://github.com/calionauta/bb-plugin-stelow/releases)
for the latest tag). Third-party plugins are full-trust server code:
install only sources you trust.

## Use

1. Open **Stelow** in bb's left navigation, select a project, choose
   run knobs (quality defaults to production, supervision to high,
   exploration to 3 + hybrid) and **Review mode** (default Auto), and
   submit a request. The card starts in Triage and the agent begins there.
2. Answer structured questions in the form, the thread, or the card. The
   agent waits instead of guessing.
3. Open specs, plans, and diffs from the board; approve gates to record
   portable receipts.
4. Cards: **Enter** opens, **W** opens the worker thread, **Esc** goes back.

CLI essentials: `bb stelow status`, `ask`, `advance`, `verify`, `review`,
`preset list|add|assign` (full surface in [FEATURES.md](./FEATURES.md)).

## If a card looks stuck

A worker reporting "The question could not be recorded" with an `idle`
card and no pending question means the ask timed out while persisting.
Check the plugin log (`~/.bb/plugins/stelow/logs/plugin.log`) for
`stelow ask persist attempt` warnings; one `SQLITE_BUSY` retry is normal,
repeated non-busy errors mean a closed DB handle or full disk. To unstick:
send any message on the worker thread — the worker re-asks once.

## For maintainers

- [FEATURES.md](./FEATURES.md) — internal feature inventory (job-grouped).
- [docs/README.md](./docs/README.md) — maintainer docs index and policy.
- [CHANGELOG.md](./CHANGELOG.md) — per-release changes.
- After any change: `npm run build:reload`. Never restart the host daemon
  as a deploy step (it kills every running thread).
