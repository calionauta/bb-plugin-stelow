# Changelog

All notable changes to `bb-plugin-stelow`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to a single-version-per-release tag format
(`vX.Y.Z`) on the `master` branch.

## [Unreleased]

### Added

- **Reload-safe workers.** The dispose hook that stopped every live worker
  thread is removed — it fired on each hot-reload and massacred in-flight
  work. Workers survive reloads; boot reconcile re-syncs state.
- **Inbox history that persists.** Resolved items render under a Resolved
  section instead of vanishing; the badge counts unresolved action items
  only. Silent stops leave an agent comment trail, and repeated stalls
  escalate the paused hero copy.
- **Pointer cursors.** Every clickable across Stelow panels uses the hand
  cursor; disabled controls use not-allowed; text fields keep the I-beam.
- **Honest card-state signaling.** A worker that stops with no new output,
  question, or stage progress signals paused immediately (no 90s grace);
  the retry nudge tells the worker to ask genuinely new questions instead
  of staying silent; the paused hero fires only on known-stuck idle; inbox
  summaries complement kind labels; the card hides the inbox banner when
  the hero already communicates that state.
- **Contextual thread button.** The thread header shows "Stelow work item"
  only on a card's worker thread (via a new `cardByWorkerThread` lookup)
  and opens that card directly; other threads show nothing.
- **Inbox Resolved history.** Auto-resolved items stay visible under a
  collapsed Resolved section instead of vanishing; resolution is per-kind
  (resume clears error/paused, answers clear questions).
- **Manual-stop recovery.** Thread `starting`/`stopping`/`error` statuses
  map to card activity, opening a card reconciles with the live thread,
  and an idle worker always offers Resume next to Open thread.
- **Open-card zone order.** The Manage disclosure (preset, restart,
  archive) now comes collapsed right after What is happening, with
  Conversation closing the page as the final interaction zone.
- **Open-card redesign (contextual hero + progressive disclosure).** The
  open card now leads with a single hero derived from card state
  (decision > error > paused > working > calm) — one sentence plus one
  primary action — instead of competing error/paused/decision banners.
  Everything else collapses into three disclosures (What is happening /
  Conversation / Manage) with a fixed type scale, left-aligned
  single-column layout, and larger touch targets.
- **Intent correction after triage notifies the worker.** Changing a
  card's intent past triage asks for confirmation (appetite and the stage
  path are not recomputed) and sends the correction straight to the
  worker thread; a failed notify falls back to Retry guidance.
- **Exploratory workspaces.** "Don't work in a project" now creates an
  isolated workspace under `~/.bb/stelow/exploratory/<card-id/>` backed by a
  local "Stelow exploratory work" project, instead of failing on the Personal
  project. Advance, reseed, preset swap, details, artifacts and intent editing
  all resolve the exploratory workspace.
- **Per-card preset override with reset.** The card's Agent preset section has
  a Change dialog: board default first, user presets, every installed
  provider's models (with counts and load-failure notes), plus a Custom
  provider + filterable model combobox. A card override now beats band
  presets; reset restores the board default and drops the private row.
  Override rows stay out of preset listings.

### Fixed

- **Exploratory `bb stelow advance`.** The `data/stelow` helper was Git-only;
  it now accepts `STELOW_STATEDIR`/`STELOW_STATE`, resolves the project root
  correctly, and honors `STELOW_TRANSITIONS` in pre-condition checks.
- **Transitions parsing.** Comment markers (`(none — …)`) no longer leak
  fake stages into the CLI allow-list nor hide real rework targets from the
  card UI; `reject` targets are listed; the terminal `audit` block parses
  (the JS `\\Z` anchor was a literal "Z").
- **Worker stalls after answers.** Answering a card question now sends an
  explicit continuation turn — responding to the interaction alone never
  resumed the agent.
- **Worker errors.** Specific failure causes survive reconcile (the generic
  fallback is never stored); the kanban attention pill no longer duplicates
  the activity pill; the broken `W` shortcut and double-click worker open
  were removed.
- **Every card starts `unknown`.** The creation intent parameter is always
  persisted as `unknown` and the worker prompt classifies intent first,
  writing it to `state.md` before loading any phase skill.

### Changed

- **Worker prompt trimmed.** Intent-first instruction, state dir, advance
  and ask contracts only — redundant paragraphs removed.
- **Open card revamp.** Single sticky identity bar (intent control lives
  there now), micro-caps section scale, de-boxed comments, contextual
  actions (Resume in the error box, Open thread button in Progress, quiet
  Archive), tooltips explaining intent/stage, stage shown before intent.
- **Preset dialog UX.** Custom choice first, option counts, scroll fade
  affordance, filterable inline model list with free-text fallback.

### Fixed

- **`stelow advance` / `doctor` after skill renames.** The `data/stelow`
  SCOPE-2 helper still hardcoded the old `stelow-product-orchestrator` path in
  its `TRANSITIONS` fallback and the advance pre-condition Python block. Both
  now resolve `stelow-workflow-orchestrator`. Also fixed the stale mirror
  reference in `references/transitions.md`.

### Architecture

- **DRY: stop duplicating Stelow skills.** The plugin dropped the 13
  `stelow-product-*` playbooks from its bundle (consumed from the agent skills
  hub via `npx skills add calionauta/stelow`) and renamed the vendored workflow
  guides to the repo-authoritative `stelow-workflow-*` prefix.

- **Auto-sync vendored workflow skills.** `lib/workflow-skills-sync.mjs`
  fetches the `calionauta/stelow` repo tree, compares git blob hashes against a
  `.sync-state.json`, and rewrites only the changed core skills
  (`stelow-*` + `stelow-workflow-*`) into the plugin's skills dir. Registered on
  `bb.background.schedule` every 6h (`STELOW_SKILLS_SYNC_CRON` overrides;
  default `33 */6 * * *`). Fail-soft: network/API errors just log and keep the
  current skills — the board never breaks.

- **Worker prompt updated** to load workflow skills from the plugin and product
  playbooks from the stelow repo hub, matching the split distribution.

### Security

- **Artifact manifest path hardening.** Absolute paths and parent-directory
  traversal (`..`) in artifact manifests are now rejected; every resolved
  artifact path is verified to stay inside the project workspace
  (`resolveArtifactPath` in `lib/artifact-manifest.mjs`, used by the server's
  document-read path).

- **Optional third-party CLIs are user-installed only.** References under
  `skills/stelow-product-orchestrator/references/cli-tools/` (`pi-tasks`,
  `rpiv-todo`, thermo-nuclear code-quality review, and safe-change) no longer
  instruct the agent to run unpinned third-party installers automatically.
  They are framed as optional tools the user installs and pins/verifies
  themselves; absent them, the guidance falls back to built-in workflow steps.

- **Replace unsupported `Columns` host icon** with the valid `Columns2` icon
  in the board nav, thread panel action, and manifest metadata.

### Design

- **Board/List filter spacing.** The view toggle (Board/List) and the "New
  work" CTA now sit `gap-3` apart on desktop so they read as two distinct
  controls, keeping `gap-2` on mobile to preserve width.

### Added

- **Contextual preset configuration.** Removed the duplicate board-header
  Presets button. **Configure presets** now lives only beside Worker policy,
  where its phase assignments directly explain what a new card will use.

- **Shared worker policy at creation.** New cards no longer ask for a
  per-card Worker preset. The composer now summarizes the board's effective
  preset per phase and links directly to configuration; cards always begin
  with the shared Analysis preset and follow phase assignments thereafter.

- **Delightful preset-form loading.** While the real provider/model catalog is
  loading, Manage presets shows a purposeful preparation state instead of
  provisional fields. The editor appears only with the configured options.

- **No provisional preset editor values.** The preset modal waits for its
  preset data before opening; its new-preset form begins neutral while provider
  data is loading, then seeds from the actual configured default. The board
  also states plainly that its Worker preset, not BB's general composer picker,
  controls execution.

- **Authoritative worker-preset selector.** New-card creation now presents the
  configured Stelow presets directly. The selected preset, falling back to the
  built-in default, determines the worker's provider/model/reasoning/permission
  independently of the general BB composer controls.

- **Preset editor derives real defaults.** Opening the new-preset form now
  seeds provider, model, reasoning, and permission mode from the configured
  default preset instead of relying on a stale hardcoded UI value.

- **Focused Pi preset routes.** The Pi model picker now lists only its intended
  Bifrost routes — Harness Coding plus GPT-5.6 Sol, Terra, and Luna — instead
  of exposing Pi's unrelated OpenCode/OpenRouter catalog. The selected
  Harness Coding route remains present when the picker opens.

- **Reliable preset create/edit mode.** New presets now begin with a `null`
  identifier, immediately switch to edit mode after creation, and expose a
  clear **New preset** action. Existing accidental empty-ID presets are
  repaired automatically while retaining their card and workflow-phase links.

- **New-card workflow controls.** The board now lets the user set the two
  canonical workflow axes before creating a card: Appetite (`Lean`, `Core`, or
  `Complete`) and Review Mode (from `Auto` through the full code-diff gate).
  They default to **Lean** and **Auto**, are validated by the RPC contract, and
  are persisted to both the seeded `state.md` and `stelow.json`. The spawned
  worker receives the declared values and does not re-ask for them during
  setup.

- **Last-used workflow defaults.** After a card is created successfully, its
  Appetite and Review Mode become the preselected choices for the next card.
  This is stored as plugin UI preference data, never in a workflow's canonical
  files; a fresh installation still starts at Lean + Auto.

- **Stage timeline: advance one step, return many — with correct verbs.**
  Clicking a passed stage now opens a "Return to X?" dialog (was always
  "Advance to X?", wrong directionally). Forward movement is restricted to
  one stage at a time (the next legal stage — gates apply); going back is
  allowed for any number of stages and labeled as safe/reversible.

- **Per-card preset removed from the card detail.** Presets are configured
  once, globally, per workflow phase from the board's **Presets** button. The
  card's per-preset dropdown/assign (which could conflict with the phase
  preset) is gone; the card now just shows an informative chip of the phase's
  active preset. Dead `switchPreset`/`presets`/`presetSwitching` code removed.

- **Scopes/tasks are ordered and dependencies are explicit.** The card's
  Scopes list is now sorted **topologically by dependency** — a scope that
  depends on or is blocked by another appears after it, so reading top→bottom
  follows execution order. Tasks within a scope are sorted by progress
  (in-progress → pending → blocked → done). A scope waiting on an unfinished
  dependency gets a ⛔ "waiting on N" badge and an amber border; dependency
  chips show the scope's real name and turn amber when its dependency isn't
  done yet (missing deps shown as dashed). No framework, all client-side
  (topological sort + status rank).

- **Board columns are the workflow phases.** Columns are now
  Analysis → Planning → Execution → Review (+ Done, Archived) instead of
  abstract lifecycle states (Triage/Shaping/Running). An active card sits in
  the column of its current phase (derived from its stage), so the board
  visualizes exactly where in the workflow each card is. The `blocked` column
  is removed — stelow never records card-level `blocked` status (only
  scope/task dependencies, which stay in the card). Drag & drop a card to a
  phase column moves it to that phase's entry stage; dropping on Done/Archived
  sets the terminal status. Needs-attention remains an overlay (badge + count)
  across any phase column.

- **Workflow timeline in the card detail.** The 17 stages now render as a
  vertical timeline grouped by phase (Analyse / Plan / Execute / Review),
  replacing the loose "Advance stage" buttons. Each stage is a chip showing
  passed ✓ / current (highlighted) / upcoming, with the phase as a visual
  group label — so the card's position in the flow is clear at a glance. The
  timeline doubles as the advance control: click a future stage to advance, a
  passed one to go back, one step at a time (the confirm dialog and its per-
  stage preview still apply). Phase groupings live in a single `STAGE_BAND`
  map (cross-referenced with server `STAGE_BANDS` for presets), so phases are
  an aggregation of stages, not a rival axis.

- **[KISS/DRY] Attention is a single flag; "Gate pending" is no longer a
  column.** A pending question is now purely an *activity* signal — the card
  stays in its real stage column (e.g. Running) and shows the attention badge
  "Answer required". The "Gate pending" column is gone (it misrepresented
  workflow position: gates can occur at any stage, not after planning).
  Server returns exactly one `needsAttention` boolean; the label is derived
  client-side from the card's own `activity`/`status` (a single
  `attentionLabel()` helper) rather than a parallel enum.

- **Board card: removed the redundant status pill.** On the board, the
  column already communicates the card's status, so the status pill was noise.
  A board card now shows intent + stage (the phase, which differentiates cards
  within a column) + the activity pill. Status remains in the card detail,
  where the column is not visible; the detail also drops the now-duplicated
  status pill (its breadcrumb already shows status + stage).

- **Attention is unified.** The board no longer distinguishes "needs
  attention" from "needs repair" as separate visual states. A single flag
  (`needsAttention`) answers "does this card need a human now?", and a `kind`
  (`question` / `error` / `completed` / `idle`) picks the reason and its action.
  Idle-stuck cards now count as needing attention, so a stopped worker on an
  active card is no longer invisible on the board. Idle only surfaces after
  the worker has sat idle ~90s (two reconcile cycles), so a card that merely
  finished a turn is not falsely flagged. The card detail's "Repair" is now
  "Resume". Cards that were already idle before the `last_idle_at` column
  existed are backfilled on the next reconcile poll (with `updated_at` as a
  fallback onset proxy), so legacy idle cards surface too instead of never
  counting as attention.

- **Presets are configurable from the board header.** A **Presets** button in
  the Stelow board header opens the preset manager (create/edit/delete,
  set default, and the per-workflow-phase presets) without digging into a
  single card's drawer. The card-drawer entry point is unchanged.

- **Respawn reliability for phase-preset transitions.** The band-boundary
  respawn now resolves the real per-workflow state dir (from `stelow.json`)
  instead of guessing the current date, retires the old worker only after the
  new spawn succeeds, and marks the card `error` (with `last_error`) if the
  spawn fails — no more zombie cards with no worker and a stale `running`
  state. The board `advance` path triggers the phase-preset swap too, matching
  the CLI path.

- **Worker preset per workflow phase.** Presets can now be configured per
  stage phase (analysis / planning / execution / review) in the preset
  manager. When a card advances into a phase whose preset differs from the
  one its worker was spawned with, the worker is automatically respawned with
  that phase's preset on the same state dir (state.md is preserved, so the
  new worker continues from the current stage — no context reset). A phase
  with no configured preset falls back to the card's preset (or the default),
  so existing cards behave exactly as before. Add `test_bands.mjs` to verify
  the stage-phase mapping and fallback.

- **Artifacts flow: cards now surface the documents the workflow produces.**
  `transitions.md` declares a per-stage `artifact:` glob (e.g. shape →
  `plans/spec-product_*.md`, planning → `plans/spec-tech_*.md`, scope →
  `scopes/scope-report_*.md`). `stelow advance` now (a) **blocks** the transition
  when the required artifact file is missing, and (b) **records** the produced
  path into `state.md` → `artifacts.<stage>` (repo-root-relative, merged so
  earlier artifacts are preserved). The card detail reads those artifacts and
  shows a new **“Assets produced by the workflow”** section with each file as a
  clickable chip (opens the document in the review panel).

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

- **Status vs. activity: distinct, non-competing visuals.** `status` (the
  workflow's column anchor, e.g. "In progress") stays a solid pill; `activity`
  (the transient worker state) is subordinated as a dashed pill with its own
  glyphs — working (breathing dot), waiting-for-you (amber hourglass), error
  (red X). A worker resting in the normal idle state renders **no** activity
  badge, so a card no longer shows a jarring "Paused" beside "In progress".
  The play glyph is now reserved for the working state only; `in-progress`
  uses a solid dot instead, removing the play-icon collision that made a card
  read as both running and paused at once.

- **Artifacts are clickable right in the agent's message.** Stage skills now
  emit a `::stelow-artifact{path="…" display="…"}` message directive per
  artifact, rendered by a new plugin `messageDirective` as a clickable chip
  that opens the file in the workspace viewer. This fixes the old bare
  `plans/…` references in comments, which resolved against the project root
  and 404'd (real files live under `.stelow/<date>/<dir>/`).

- **Card ask questions are now real interactive forms.** An open Stelow
  question on a card rendered as buttons that only pre-filled the thread
  composer (easy to miss, required a manual send, and offered no multi-select).
  The card now shows the same option-picker as the thread's native interaction
  and answers through `threads.interactions.respond` — picking option(s) and
  pressing **Submit answer** forwards a structured response to the worker, no
  manual composer edit needed. `More pending questions` reuses the same form.
- **Artifacts and mentioned files open as dedicated plugin tabs.** The chips
  previously called `openThreadPanel`, which can be declined when the card
  detail is itself a plugin tab (no thread side panel). They now navigate to a
  `review-document/<path>` tab that renders the full markdown reviewer (read,
  inline comment, selection), reachable from the board or the card.

- **Pending stelow ask questions now surface on the card.** The card only
  showed an awaiting-answer banner when `activity` was exactly
  `awaiting-answer`, and `listCards`/`cardDetail` only promoted to it when the
  thread was `running`. A card whose worker is `idle` with a pending
  interaction (the normal state after `bb stelow ask` parks the workflow) hid
  the question entirely. Both now detect pending interactions regardless of the
  stored/thread activity, so an open question is always visible and answerable.
- **Repair only shows on idle, unfinished cards** (not when there is an open
  question to answer or an active error — those already have a clear action).
- **Comments render as Markdown** (bb's chat renderer) instead of raw text, so
  agent comments keep bold, lists, and clickable file references.
- **Artifacts use repo-root-relative paths** so the review file opener resolves
  them under the project (absolute paths containing `/` were rejected by the
  workspace-safety check and 404'd).

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
