# Changelog

All notable changes to `bb-plugin-stelow`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to a single-version-per-release tag format
(`vX.Y.Z`) on the `master` branch.

## [Unreleased]

### Added

- **Per-workflow state: stelow is now multi-card per project.** Each card owns
  its own state file at `<root>/.stelow/<date>/<dirHash>/state.md` (plus
  `invariants.json` and `lock`) instead of sharing a single project-root
  `state.md`. The card stores its `dir_hash`; the helper resolves the dir from
  `STELOW_STATEDIR` (set per workflow by the server), so `advance`/`status`
  touch only that card's state. Removed the old one-active-card-per-project
  guard — N cards can now run concurrently in the same project without
  colliding. Legacy cards (no `dir_hash`) keep working via the root `state.md`
  fallback.

### Fixed

- **Realtime now works over Tailscale (port 8096).** The bb-tcp-proxy was a
  plain HTTP forwarder that never upgraded WebSocket, so the board, the
  sidebar count, and card state only refreshed on manual reload. Rewrote it as
  a Node proxy in `~/bin/bb-tcp-proxy.js` with `upgrade` support — board
  updates, drag-and-drop moves, and archives now reflect live without a
  refresh.
- **Card stays in Triage until triage is done.** A freshly-created card was
  immediately promoted `draft → in-progress` as soon as its worker thread went
  active, so it never showed in the Triage column and "jumped" to Running.
  The sync now reads `current_stage` from `state.md` and keeps the card in
  `draft` (Triage) while the stage is `triage`, only moving to Running after
  the agent advances.
- **intent and stage sync from state.md.** If a card is created with
  `intent=unknown`, the sync adopts the intent the agent records in the
  project's `state.md` (only when that state.md belongs to this card). The
  reported `stage` also follows `current_stage` from `state.md`.
- **state.md re-seeded per card.** A single `state.md` lives per project, so
  creating a card reused an existing `state.md` that belonged to a *different*
  card (wrong name/intent). The seed now re-writes `state.md` for the card
  being created when it belongs to another card (or is missing).
- **One active card per project.** Because `state.md` is a single per-project
  file (per the state-contract), creating a card now blocks if the project
  already has a non-archived card, with a clear message to archive/pause it
  first — preventing two cards from fighting over the same state.
- **Sidebar badge shows a number only.** The count pill now renders just the
  number, matching bb's own sidebar accessory styling, instead of "N live".
- **Board header counts live cards only.** "N cards" in the board header now
  uses the same live definition as the sidebar badge (in-progress / draft /
  planning / awaiting-answer), so archived, completed, and blocked cards are
  excluded and the two counters stay coherent.

### Added

- **Full bb composer on the board.** The new-card form now uses bb's own
  `NewThreadComposer` (tiptap editor): type `@` for mentions, use the `+`
  action menu to attach files, skills, automations, or a plugin reference,
  and pick project/provider/model right in the form. Attached files are
  copied to the thread storage and listed as `Attached files:` in the card
  prompt — same behavior as bb threads.
- **Bundled Stelow skills.** The plugin ships the 27 `stelow-*` skills in
  `skills/` and declares them via `bb.skills`, so a fresh install no longer
  depends on `~/.claude/skills/stelow-*` symlinks or the
  `calionauta/stelow` repo being checked out. The agent prompt now reads the
  stage guides from the plugin's own skills directory.
- **Workspace-file mention provider** (`@` + filename resolves to
  `Workspace file: <path>` when the route has a project context).
- **Timed-out questions are answerable later.** If a `bb stelow ask` times
  out (user away), the question is persisted and the card **stays in Gate
  pending** — it does not look abandoned. The agent is told to STOP and wait
  (never guess, never re-ask); the card shows "Waiting for your answer — the
  agent paused" with the original options still clickable. Answering records
  it as a card comment and delivers the answer to the worker thread, which
  resumes the workflow.

### Changed

- **Ask timeout stops the agent.** Previously the worker was told to proceed
  with best judgment on timeout. Now the ask command returns a STOP instruction
  and the worker prompt says: on timeout, do not proceed; the question stays
  pending and answerable; the answer resumes the workflow. `syncThreadState`
  keeps an idle card in Gate pending while a question remains unanswered.
- **Card header de-duplicated.** When activity and status agree (e.g. both
  `awaiting-answer`) only one tag shows; the breadcrumb shows the column
  state (`Gate pending`) plus the workflow stage (`Triage`) instead of only
  the stage. The intent label now shows the current intent next to the select.
- **Ask timeout is configurable** via `STELOW_ASK_TIMEOUT_MS` (default 1h)
  for testing and tuning.

## [0.1.4] - 2026-08-20

### Fixed

- **Cards now start in Triage instead of Running.** `createCard` wrote
  `status: "in-progress"` from the first INSERT, so a new card landed in the
  Running column and never passed through shaping. It now seeds
  `status: "draft"`, and `syncThreadState` promotes the card to
  `awaiting-answer` when a structured question is pending (listing it under
  "Gate pending") and to `in-progress` when the agent resumes real work.
- **Question form not rendering.** The worker prompt only said "call
  `bb.ui.requestInput`" without being categorical. The prompt now states the
  rule verbatim: any time the agent needs input it MUST call `bb stelow ask`
  (the structured form wired to `stelow-question`), never just write text like
  "waiting for your choice". The card flips to Gate pending automatically while
  the form is pending.
- **Realtime reloads now debounce** (`useDebouncedRealtime`, 250 ms) so bursts
  of mutations stop stampeding the board/card-detail RPC loaders.

### Changed

- **Repair uses a confirmation Dialog** instead of the fragile timed
  double-click (`setTimeout` + `confirmingRepair`). The dialog explains that
  state.md and stelow.json are reseeded and the worker restarts from triage.
- **Archive requires a destructive confirmation Dialog** instead of silently
  cancelling the card.
- **Filter UI collapses to a single "Filters" popover** with an active-count
  badge and a Reset button; the "Needs attention" toggle stays inline.
- **Keyboard and focus:** board cards are keyboard-operable (Enter/Space opens
  the card, `W` opens the worker thread), column containers expose `role=list`
  / `role=listitem` for the focus chain, and focus returns to the card detail's
  close button on a host-initiated detail restart.

### Added

- **Sidebar accessory badge:** the Stelow menu row shows a live count of cards
  in Triage/Shaping/Running/Gate pending, tinted as a primary badge when live
  (same pattern the Tasks plugin uses).
- **Defensive "awaiting answer" banner:** the card detail renders an amber
  banner with a path to the pending question when `activity` is
  `awaiting-answer`, so the form is never unreachable.
- **Agent presets** (schema mirrors the bb Tasks plugin):
  - New `presets` table: provider, model, reasoning level, permission mode,
    environment kind, base branch, machine, instructions, plus built-in and
    default flags. A read-only built-in `Default` preset ships and is used when
    a card has no explicit preset.
  - New `card_presets` join table; `createCard` and `reseedCard` persist the
    assignment and carry the preset's provider/model/reasoning/permission into
    the worker thread spawn (`executionInputSources: "explicit"`).
  - `reseedCard` now also stops the previous worker thread and spawns a fresh
    thread with the chosen preset, so swapping a preset and clicking Repair
    cleanly transfers the model + context.
  - New RPCs: `listPresets`, `upsertPreset`, `deletePreset`, `assignPreset`.
  - New CLI: `bb stelow preset list|add|remove|assign`.
  - Card detail surfaces a preset dropdown.

### Internal

- Added `awaiting-answer` to the `statusSchema` enum used by board/card types.
- Server/`app` compile clean at SDK `0.4.8` / bb `0.39.0`; `dist/data` and
  `dist/references` are copied by `postbuild.mjs`.
- Reconciled `package.json` version to `0.1.4` to match the published tag.

[0.1.4]: https://github.com/calionauta/bb-plugin-stelow/compare/v0.1.3...v0.1.4
