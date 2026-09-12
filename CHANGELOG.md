# Changelog

All notable changes to `bb-plugin-stelow`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to a single-version-per-release tag format
(`vX.Y.Z`) on the `master` branch.

## [0.3.72] - 2026-09-12

### Changed

- **About sync status, demoted to a signal.** The paragraph is now a
  quiet status line (● dot + "N skills · synced X ago") opening the
  vendored inventory grouped Workflow/Product. Installed optional tools
  gained one-click reinstall-as-update.

### Fixed

- **Truncated upstream trees refuse the sync.** A partial GitHub tree
  could previously prune valid local skills as "retired"; fail-soft now
  keeps everything instead.

## [0.3.71] - 2026-09-12

### Changed

- **All stelow-* skills ship vendored, not just workflow.** The upstream
  sync discovers every top-level `skills/stelow-*/` directory (product
  playbooks included) and prunes retired names; worker prompts prefer the
  local copy with `npx skills add` as fallback only. Sync state moved to
  the stable plugin data dir (survives managed-install cache rotations)
  and one fail-soft pass runs at boot — About never shows "never" after
  a plugin update again.

## [0.3.70] - 2026-09-12

### Fixed

- **Skills verification age is honest.** The timestamp now advances only
  on fully clean syncs; a partial failure leaves the previous stamp, so
  About shows growing age instead of a fresh lie during outages.

## [0.3.69] - 2026-09-12

### Added

- **About shows upstream-skills freshness.** Every upstream verification
  (changed files or not) records its timestamp, `buildInfo` serves it
  live, and the About tab renders "Workflow skills synced X ago" next to
  the plugin version — the 6h auto-sync is now visible instead of silent.

## [0.3.68] - 2026-09-11

### Fixed

- **Archived terminality, second pass.** Gap analysis found five more
  resuscitation routes the first fix did not cover: `updateCard` re-strips
  against a fresh write-time read (a poll that read before Archive can no
  longer write after it), the sync entry skips archived cards before any
  thread read, and move/advance/answers/comments refuse archived cards
  with the named exit instead of half-executing. Dragging out of Archived
  now explains itself instead of silently no-op'ing.

## [0.3.67] - 2026-09-11

### Fixed

- **Archived cards stay archived.** Stopping the worker after Archive could
  settle late and flip the card back to Done (idle thread + terminal
  `audit` stage = spurious completion). `updateCard` now strips any status
  change out of `archived` in one shared rule, worker-thread events skip
  archived cards, and the Archive button reports a refused archive instead
  of a false success.

### Added

- **Fresh-install safety net.** CI runs typecheck + the full suite on every
  push/PR, and `tests/fresh-install.test.mjs` locks the first-boot
  contract: marketplace entries, every source-root read, packaging
  (`skills/`, `lib/`, `components/`, `hooks/` now ship), and
  fresh/upgrade-safe migrations.

## [0.3.66] - 2026-09-11

### Fixed

- **The About logo now actually renders on managed installs.** bb's builder
  has no image loader and serves only the built `app.js`/`app.css`, so the
  previous runtime `./assets/*.png` URL always 404'd outside a local
  checkout. The mark is now a 512 px asset served lazily as a data URI over
  a new `aboutLogo` RPC (memoized, null-safe with a text fallback), keeping
  the board bundles untouched. The dead `dist/assets` postbuild copy is
  gone; `tests/about-logo.test.mjs` locks the delivery contract, the asset
  budget, and the ban on runtime static-asset URLs.

## [0.3.65] - 2026-09-11

### Fixed

- **The About logo is now delivered with the running plugin.** Assets are
  copied into the runtime bundle and declared in the package, with a
  regression test for both publication contracts.

## [0.3.64] - 2026-09-11

### Added

- **A responsive Stelow identity mark in About.** The centered, transparent
  logo is bundled with the plugin and remains a compact 224–256 px wide,
  leaving the operational boards focused on work.

## [0.3.63] - 2026-09-11

### Changed

- **Boards now explain their agent-led workflow in plain language.** Build,
  Research, and Explore describe the specialized AI skills that run each card
  and preserve the user's role at Build review gates.
- **Kanban columns retain a deliberate reading width.** Open columns stay
  between 240 and 320 px; collapsed columns stay 56 px. A shared layout helper
  keeps Build, Research, and Explore aligned on wide screens.

## [0.3.62] - 2026-09-11

### Changed

- **Card lifecycle regressions now have explicit coverage.** Shared policies
  govern Worker visibility and archived-card presentation; contract tests keep
  the UI and RPC lifecycle rules aligned. The full test command runs them.

## [0.3.61] - 2026-09-11

### Fixed

- **Archived workflow details are clearly historical.** The former live
  progress section now says **Workflow history**, records where the card
  ended, and no longer implies an agent is still shaping it.

## [0.3.60] - 2026-09-11

### Fixed

- **Archived cards now present one terminal state.** Their detail hero says
  **Archived** rather than implying the old workflow phase is still active.

## [0.3.59] - 2026-09-11

### Fixed

- **Archived cards are immutable in the UI.** An archived Build card that
  stopped during triage now shows its workflow type as read-only context,
  never as an editable selector.
- **Worker is omitted when it has nothing to say.** Archived cards without
  worker history, preset controls, or a GitHub link no longer render an empty
  bordered section.

## [0.3.58] - 2026-09-11

### Changed

- **Card actions now live where the card is identified.** A compact
  **Card actions** menu in the detail header holds Restart fresh, Archive,
  and permanent Delete. The Worker section now contains only worker context,
  preset controls, and history.
- **Workflow type is safe after triage.** Build cards can be classified while
  in triage. Afterwards the type is a read-only pill; **Reclassify workflow…**
  starts a fresh worker from triage on the selected route rather than silently
  changing a label beneath an existing plan. Research and Explore never show
  the Build-only type control.

### Fixed

- **Lifecycle updates refresh every open card surface.** Archive, delete, and
  reclassification now publish card state changes, including the thread-panel
  view.

## [0.3.47] - 2026-09-10

### Fixed

- **Card creation works again across all tracks.** Build, Research, and
  Explore shared an INSERT with 25 placeholders for 24 columns. SQL
  placeholders now derive from the canonical column list, with a mismatch
  guard and regression contract test.

## [0.3.46] - 2026-09-10

### Changed

- **Explore always runs at maximum depth.** New explorations seed
  appetite Complete with the strongest review mode (was silent
  Lean/Auto), and the worker prompt carries a depth contract: full
  exploration, every variant the stage offers, ask instead of
  auto-deciding — but never park for approval, since explore has no
  gates and nowhere to advance to. No UI change (there were never
  depth selects on Explore); artifact flow untouched.

## [0.3.45] - 2026-09-10

### Changed

- **About refinements.** Optional-tools rows sorted alphabetically
  with per-tool repository link; plannotator marked as unused in bb
  (gates resolve in the plugin review UI — no install offered);
  section headers bumped to readable size; repo buttons carry the
  GitHub icon.

## [0.3.44] - 2026-09-10

### Added

- **Changed symbols in Diff via `cymbal`.** When installed,
  `cardDiff` lists changed symbols with caller impact (blast radius
  at a glance) below the entity summary — same HEAD baseline,
  same fail-soft rule. Upstream skills also refined: Verification
  sizes review by entities (sem-first) and runs affected tests
  first (`sem impact --tests`); Execution mandates `sg -r` for
  cross-file renames.

## [0.3.43] - 2026-09-10

### Added

- **One-click install per tool in About.** Each optional-tool row has
  an Install button (explicit consent): official installers only,
  everything into `~/.local/bin`, no sudo, success verified by
  re-probe, failures show per-row error + install log. Rows are
  alphabetical with plain-language benefit and technical notes.

## [0.3.42] - 2026-09-10

### Added

- **Optional tools section in About.** Live presence probe (`toolStatus`
  RPC) for sem, cymbal, ripwire, ast-grep and plannotator — each row
  states the capability it unlocks plus the install command, so tools
  can be added later without a setup wizard.

### Fixed

- **Onboarding reset covers presets.** Reset in About cleared three
  track keys but kept the shared presets flag, so the presets step
  never replayed. All four keys clear now. The Build dialog also drops
  the "Step 2 of 2" counter when it opens straight at the defaults
  panel (a counter referencing an unseen step made no sense).

## [0.3.41] - 2026-09-10

### Changed

- **README documents optional host tools.** `sem` is now listed under
  Requirements as the opt-in binary behind the Diff entity summary —
  the plugin never installs binaries itself (fail-soft by design).

## [0.3.40] - 2026-09-10

### Added

- **Entity summary in Diff via `sem`.** When the `sem` binary is
  installed on the host, `cardDiff` heads the patch list with a
  one-line entity summary (added/modified/deleted/renamed/moved,
  cosmetic-only flag) from `sem diff HEAD --format json` — same
  baseline as the git diff, fully local, no cloud. Absent `sem`,
  timeout, or off-shape output degrades to no summary line, never an
  error. Server now ships with `sem` installed (`~/.local/bin`).

## [0.3.39] - 2026-09-10

### Fixed

- **Diff review gaps (code-verified).** `cardDiff` now diffs against
  HEAD — staged changes were invisible before, contradicting the
  "working tree vs HEAD" label. Untracked dirs expand to individual
  files (`-uall`; `skills/` no longer yields a broken Open button),
  git runs at the repo toplevel (root-relative paths), and non-repo
  returns `found:true/isRepo:false` so the UI stops confusing it with
  card-not-found. Fresh repos without HEAD degrade to untracked-only.

## [0.3.38] - 2026-09-10

### Added

- **Diff section on cards.** Working tree vs HEAD per file, rendered
  with bb's own diff viewer (plain-text fallback when the host lacks
  it) — visible at the diff-gate and audit stages, fetched lazily on
  open. Untracked files open in the viewer; clean trees and non-repos
  say so. Read-only throughout.

## [0.3.37] - 2026-09-10

### Fixed

- **About shows the real version again.** The unified plugin root broke
  the build-info lookup (it still probed the old dist-relative paths),
  printing "vdev". Candidates now assume the unified root.

## [0.3.36] - 2026-09-10

### Changed

- **Timeline tells the truth about skipped stages.** Off-route stages
  render struck-through (not in this intent's route); mode-skipped
  stages show ⊘ with the reason (e.g. skipped in Auto). Green now
  means executed — computed per card from its intent + review mode,
  cross-checked against transitions.md in tests.

## [0.3.35] - 2026-09-10

### Changed

- **Timeline artifact badges deep-link with context.** Clicking a
  stage's count opens Artifacts scrolled to that stage's group with a
  highlight ring — no more landing on the bare section top. The
  section now reads as the audit trail (`N files · audit trail`).

## [0.3.34] - 2026-09-10

### Fixed

- **Drag-to-archived stops the worker.** Parking a card via drag used to
  only flip its status, orphaning a live worker on a hidden board. It
  now shares the Archive button's shutdown path.
- **No Archive button on archived cards** (Delete stays as the only
  destructive action there).

## [0.3.33] - 2026-09-10

### Fixed

- **Single status pill at terminals.** Archived/completed build cards
  rendered "Archived Archived" (column + status resolving to the same
  word) — now one pill.
- **Archive button reads Archive everywhere** (was "Archive research"
  on all cards).
- **Timeline pills match Pill density** (`min-h-8`, same metrics as
  status pills instead of 44px targets).

## [0.3.32] - 2026-09-09

### Fixed

- **Bundled installs resolve the plugin root.** Git-managed installs run
  `dist/server.js`, so `import.meta.url` pointed at `dist/` and every
  `skills/` read 404d (ENOENT on transitions.md at card creation).
  The root now resolves to wherever transitions.md lives, covering
  source, bundled, and unknown layouts (fail-open).
- **Research modal trailing void.** The strategy picker's sr-only radio
  inputs (absolute, 1px) escaped their capped scroll list and stretched
  the dialog's scroll area by ~350px — invisible on shorter lists, which
  is why Explore never showed it. The list now contains its absolutely
  positioned descendants.

## [0.3.31] - 2026-09-09

### Fixed

- **Resizing into a narrow viewport no longer crashes the plugin.**
  The compact fullscreen dialog rendered Radix Portal/Content without a
  Radix Root (compact mode omits it), throwing on open-while-narrow and
  on every desktop→narrow resize with a creation modal open — which
  disabled the whole slot for the session. It now renders plain
  portaled divs with the same look plus Escape-to-close.

## [0.3.30] - 2026-09-09

### Added

- **Build onboarding wizard.** The setup dialog gains a second step for
  Planning depth + Review checkpoints as board defaults — presets and
  defaults never share a screen again.
- **Explore owns its preset band.** `explore` joins the band table, so
  all three tracks configure presets independently.

## [0.3.29] - 2026-09-09

### Fixed

- **Thread asks never render an undefined artifact.** Option artifact
  paths normalize through one shared pure function (parser, server,
  thread renderer) instead of three hand-rolled variants.

## [0.3.28] - 2026-09-09

### Added

- **Option details on asks.** Options carry `preview` (inline expandable
  glance) and `artifact` (workspace-relative path opening in the card
  viewer; plain filename in threads). Workers attach per option via
  `--desc/--preview/--artifact`; bad paths degrade silently, never
  block. Shapes mirror upstream `ask-patterns.md` Option schema.

### Changed

- **Question stepper drops tab roles** for group + `aria-current="step"`.

## [0.3.27] - 2026-09-09

### Added

- **Reset onboarding** on the About tab (two-step confirm): clears the
  first-visit flags so every track shows its setup dialog again.
- **Header buttons carry icons** (Plus for creation, Settings for Agent
  Presets, Github for import, Archive for the inbox archive toggle).

### Changed

- **Inbox order:** All-clear empty state first, Resolved history last.

## [0.3.26] - 2026-09-09

### Changed

- **Onboarding says presets, not agents.** Titles now read Choose your
  (research/exploration) agent preset; the Build dialog drops Planning
  depth + Review checkpoints (a separate concern, set per card in
  New issue → Settings).
- **Preset form header is stable.** The New/Edit header with Show/Hide
  always renders; only the body waits on the provider catalog (before,
  a tall spinner swapped in and flashed into the collapsed form).

## [0.3.25] - 2026-09-09

### Fixed

- **One onboarding at a time.** Keep-alive mounts every track, so
  first visit stacked three setup dialogs. The dialog now opens only
  while its own track is active.

## [0.3.24] - 2026-09-09

### Added

- **First-visit setup dialogs** on Build, Research, and Explore: agent
  presets (plus Planning depth + Review checkpoints as board defaults
  on Build), shown once each. Ends with configured state or an
  explicit skip — never passive reading.

### Changed

- **Preset form collapses.** The New-preset form in Manage agent
  presets stays behind Show/Hide; editing auto-expands.
- **Create dialog slims down.** Start new issue drops the preset box
  (Agent Presets lives in the header now); Settings keeps Planning
  depth + Review checkpoints.
- **Question stepper drops tab roles** for group + `aria-current="step"`.

### Removed

- **Track info bars.** The static preset-routing lines on Build,
  Research, and Explore are gone — the setup dialog and the dialogs
  that need the info carry it instead.

## [0.3.23] - 2026-09-09

### Changed

- **Sidebar label reads Stelow • Product Hub.** Short, • separator,
  names the place where everything product-related lives.
- **Track switcher is a nav, not a tablist.** Route navigation gets
  `nav` + `aria-current="page"` (the GitHub repo-tabs pattern) instead
  of tab roles that promised tabpanels and arrow keys routed views
  don't have. Same routes, same keyboard, honest semantics.

## [0.3.21] - 2026-09-09

### Changed

- **Preset buttons say what they manage.** Build/Research/Explore headers
  read Agent Presets, matching the dialog title and the plugin's own
  vocabulary (agent presets everywhere, never bare).

## [0.3.20] - 2026-09-09

### Removed

- **Onboarding tours.** The per-track Tour steppers are gone: audit
  showed half their steps duplicated headers, buttons, and dialogs.
  The three non-discoverable rules survive as static one-liners where
  they apply (preset routing per track, batch answers in the Inbox
  header, append-only rounds in the strategy dialog).

### Fixed

- Research header grammar ("an index").

## [0.3.19] - 2026-09-09

### Fixed

- **Panels no longer flicker on every sync poll.** `updateCard` is now a
  no-op (no write, no `card-state` publish, no `updated_at` bump) when
  no field actually changed — previously every 45s poll reshuffled
  board order, rewrote "Idle since" labels, and reloaded all panels.
  Panel loads also enter the loading state only on first mount, so
  background refreshes update silently instead of blanking to
  skeletons and unmounting the tour.

## [0.3.18] - 2026-09-09

### Changed

- **Dismissed tours collapse in place.** The Tour entry point keeps its
  full-width slot and container in every state — dismissing folds it to
  a one-line box with Show instead of swapping in a relocated button.
- **Build speaks issues.** The creation entry points read New/Start new
  issue (one name for manually created and imported work); the header
  drops the phase list and describes the flow.

## [0.3.17] - 2026-09-09

### Fixed

- **Upstream version available immediately.** `data/stelow-package.json`
  ships snapshotted (byte-identical to the sync source) so About shows
  the Stelow version on fresh installs, not only after the first
  skills sync.

## [0.3.16] - 2026-09-09

### Changed

- **About covers both releases side by side.** The tab now sections
  Stelow (upstream) vs this plugin, each with its own paragraph, repo
  link, and version — the upstream version syncs from the stelow repo
  alongside the skills, so the two can never be confused. Title first,
  tagline after.

## [0.3.15] - 2026-09-09

### Added

- **About tab.** What Stelow is, what each track is for, a Learn-more
  button to the stelow repo, and the running build stamp — product
  identity in exactly one place instead of the Build header.
- **Explore onboarding tour.** The Explore board joins the shared
  first-run Tour (one stage / catalog / artifact), like Inbox, Build,
  and Research.

### Changed

- **Build tab describes itself.** The header now explains the phased
  board (Analyse → Plan → Execute → Review → Done); the generic
  product tagline, About link, and version stamp moved to About.

## [0.3.14] - 2026-09-09

### Added

- **`bb stelow verify` worker self-check.** The deterministic complement
  to prompting: the worker runs the same predicates the sync gate
  enforces before finishing (`PASS` per round, `FAIL` naming the fix,
  `--json` for machines). Research and explore prompts require it;
  prompt, CLI, and sync share one definition of PASS in
  `lib/research-artifacts.mjs`, so the three can never disagree.

## [0.3.13] - 2026-09-09

### Added

- **Explore track.** A fourth tab for single-stage runs: pick one workflow
  stage (Shape Up, interface alternatives, critiques, tech planning,
  testing strategy…), supply the input, get one artifact
  (`explore-<stage>.md`). No triage, no pipeline, no gates. Own catalog
  (`stageCatalog`), card lifecycle (To-Do / Doing / Done), worker prompt,
  completion event, and detail body — all other machinery (board
  components, list view, status pill, inbox, retry/restart/reseed,
  presets) reuses the Research definitions instead of forked copies.

### Changed

- **Card kind `delivery` is now `build`, everywhere.** RPC contract, card
  rows, board copy ("Build board", "build flow", "build cards"), and code
  (`BUILD_PHASES`, `BUILD_TERMINALS`). Legacy rows migrate silently:
  stored `delivery` values read as `build` (`normalizeKind`) and converge
  via a startup `UPDATE`. Track concepts (build / research / explore,
  lightweight columns, worker bands) are centralized in
  `lib/tracks.mjs` — one line to rename or extend.
- **Artifact guarantee is enforced in code, not in prompt text.** Round
  validity (non-empty, substantive, never a mirror of the index) lives in
  `lib/research-artifacts.mjs` (unit-tested); the plugin pre-creates
  every round and explore file at spawn (reseed re-creates after
  wiping), and research readiness requires a reviewable index AND every
  round valid. An index with an invalid round is not Done — each invalid
  round surfaces as an inbox error naming what to re-run. The worker
  prompt states the contract; the sync is what makes it true. (Kept in
  the plugin per `AGENTS.md` owned-vs-vendored rules: `skills/` stays a
  pristine upstream mirror; structure enforcement belongs to the host.)

## [0.3.12] - 2026-09-09

### Changed

- **Sidebar label now reads "Stelow — Product Workflow"** so the panel's
  purpose is explicit in bb's navigation: it is an opinionated product
  workflow (Shape Up, gates, scopes), not a generic task runner.

### Fixed

- **A research round that mirrors the index is never presented as its
  artifact.** When the round file only contains the research index (identical
  content or the index heading), the playbook output was never written — the
  round shows as missing instead of opening the wrong file as if it were the
  round's output.
- **Loose-file scans compose absolute paths from the listed directory.**
  Entries from `files.list` are relative to the listed dir; treating them as
  absolute broke loose-file links and let `research-index.md` / `state.md`
  leak through as loose files.
- **Research completions emit a single inbox event**, and user-initiated
  board moves no longer ping the inbox with a "Completed" notification.
  Previously recorded duplicate generic completions for research cards are
  cleaned up on startup.

## [0.3.11] - 2026-09-09

### Fixed

- **Stable expanded-card scrolling.** Detail views no longer reload from every
  background card-state event; explicit actions refresh only the data they
  changed, preserving the reader's scroll position.
- **More reliable research output writes.** Research workers now label output
  artifacts correctly and are instructed to use native file writing or verify
  one shell write at a time rather than chain fragile heredocs.

## [0.3.10] - 2026-09-09

### Fixed

- **Clear open-card context.** Build card headers now distinguish their board
  column from their workflow status; Research keeps its single shared status.
- **Reliable strategy scrolling.** The full strategy-list area captures
  trackpad scrolling, including gaps between cards.

## [0.3.9] - 2026-09-09

### Changed

- **Visible detail status.** Open card headers now display the current board
  status as a pill for Build and Research.

## [0.3.8] - 2026-09-09

### Fixed

- **Stable track loading.** Build and Research now use page-shaped skeletons
  during their first load, preventing the onboarding, filters, and board from
  visibly assembling as RPC results arrive.
- **Strategy selection.** Follow-up strategy selection persists user choice,
  and strategy cards size to their content with contained scrolling.
- **Concise cards.** Closed cards no longer repeat the board column's status.

## [0.3.7] - 2026-09-09

### Changed

- **Research output labels.** Renamed the clickable output column from
  "Path" to "Artifact".

## [0.3.6] - 2026-09-09

### Fixed

- **No stale review-state behavior.** Removed remaining `researchReady`
  presentation paths and obsolete completion guidance; a completed index is
  represented only by Done.

## [0.3.5] - 2026-09-09

### Changed

- **Research completes directly into Done.** Completed indexes no longer use
  a separate review pill; Done is the single review surface. A new comment on
  a completed research card reopens it in Doing.
- **Selection-first build handoff.** The action is now "Select To Build";
  selection starts empty and only confirmed opportunities create build cards.

## [0.3.4] - 2026-09-09

### Added

- **Clickable research outputs.** The research index now renders
  structurally: Summary as prose, and the Outputs table with its Path
  column resolved to clickable artifact buttons that open the same
  reviewer as build cards (read, quote a passage, comment to the agent).
- **Artifact chips in the thread.** The research worker's final message
  emits `::stelow-artifact` directives per produced file (index + round +
  sub-steps), rendered by bb as clickable chips that open the file in the
  workspace viewer. Directive syntax is stripped before the message is
  mirrored into card comments (plain Markdown there).

### Changed

- **No fake checkboxes in the index.** The opportunities list in the card
  is a status overview — fanned-out items show a ✓ and "fanned out";
  selection happens only in the fan-out dialog.
- **No duplicated Opportunities section.** The raw index body no longer
  renders its own `## Opportunities` list above the interactive panel;
  contract-missing indexes fall back to the body without that section.

## [Unreleased]

## [0.3.3] - 2026-09-09

### Changed

- **Dedicated Worker section right under the hero** (both tracks). Preset
  pill + provider/model, real "Change preset…" outline button, and the
  note about when a preset applies are now one contextual block instead
  of a floating row. Recovery/danger actions (restart fresh, archive,
  delete) sit below a divider inside the same section, with worker
  history collapsed below. The buried Manage accordion below Artifacts
  is gone.

## [0.3.2] - 2026-09-08

### Changed

- **Worker row is always visible under the hero**: preset pill +
  provider/model, a real "Change preset…" outline button, and the
  stale-preset warning with its restart action. Preset no longer hides
  inside the collapsed Manage accordion.
- **Manage is now a danger zone only** (restart fresh, archive, delete)
  with real outline buttons — archive in destructive tone — plus worker
  history.

## [0.3.1] - 2026-09-08

### Changed

- **Strategy contracts come from upstream.** `product-strategies.json`
  syncs like the helper into `data/`; presentation stays local and the
  embedded list stands when the file is absent. Contract drift between
  playbooks and board is now structurally impossible.

## [0.3.0] - 2026-09-08

### Added

- **Research index replaces brief end to end.** `research-index.md`
  (Summary/Outputs/Opportunities) with native round files; output
  contracts (`single`/`variant`/`composite` + JTBD substeps) in the
  strategy registry; missing substeps surface on the card.
- **`bb stelow fan-out`.** Opportunity-ID-only fan-out from workers
  (RPC re-validates); prompt discipline requires structured user
  confirmation first.
- **Ask persist robustness.** Persist errors are logged with
  card/thread context; one retry on lock contention; regression tests;
  operator runbook in README.
- **`bb stelow advance --dry-run/--json`, `bb stelow schema`.**
  Exit codes pass through instead of collapsing.

## [0.2.0] - 2026-09-08

### Added

- **`bb stelow sync-scopes/lock/config` wrappers.** Same workspace/card
  resolution as `advance`/`doctor`; `lock` preserves helper exit codes
  (1 = conflict). Advancing into `execution` auto-syncs scopes
  best-effort, so the vendored Step 2e works without a `scripts/stelow`
  binary in the workspace.
- **Worker prompt equivalents.** Spawn/reseed prompts point at the `bb
  stelow` wrappers wherever vendored skills show `scripts/stelow`
  commands (single shared sentence).
- **Vendored content sync.** Single-source cli-tools, `visual_review.md`
  canonical gate doc, R4 skill splits, fence fixes, link-integrity
  repairs — all propagated from upstream with zero sync errors.
- **Upstream delegation for advance mechanics.** `data/stelow` is now a
  synced copy of upstream `scripts/stelow` (mode-skips, gate refusals
  and non-git roots ported there first); the transitions mirror and its
  fallbacks retire in favor of the vendored copy. New `bb stelow doctor`
  passthrough; workflow contract tests pin template, board order and
  transitions to the same 17 stages.

- **Round files on research cards.** Every strategy round persists its
  native playbook output verbatim (one file per round, one per sub-step
  when a playbook fans out) and registers each in the manifest; the
  card lists rounds newest-first with run status plus unregistered
  state-dir files. `brief.md` stays the fan-out
  aggregator; history carries timestamps.
- **Board/List on both boards.** Research gains the list view; the switch
  is now a quiet shared icon toggle beside the filters (a view
  preference, not a CTA) instead of a boxed segment next to the action
  buttons. The redundant Research empty-state hero is gone — first-run
  guidance lives in the tour.
- **Direct preset access.** Build and Research headers gain a Presets
  button opening the preset manager without starting anything; agent
  configuration in both creation dialogs is now its own block instead
  of inline text.
- **Floating mobile sheets.** Compact dialogs render as floating cards
  with backdrop margins on every side, not edge-to-edge panels.
- **Visual strategy picker.** Choosing a research strategy is now emoji
  radio-cards (name + one-line summary) with instant search over label,
  summary, and keywords — shared by the creation modal and "Explore
  another strategy" (which badges already-ran playbooks). No preselected
  default: Start stays disabled until an explicit pick.

### Fixed

- **Waiting on a question never moves the card.** Opening a structured
  question stored the wait in `status` (`awaiting-answer`), which
  normalized to `pending` — a Doing research card fell back to To-Do
  while the question was open, and the ask transport forced
  `in-progress`, dragging draft Triage cards to Running on their first
  question. One rule now holds on both tracks: a pending question is
  activity only, never board position (`lib/card-question-state`,
  shared by server and board, pinned by a node test). Legacy rows heal
  to `in-progress` on read and are rewritten on the next sync; worker
  prompts and the README no longer promise a "Gate pending" column.
- **Strategy picker on mobile.** The options list no longer nests its
  own scroll region inside the sheet scroll (scroll trap); it expands
  and the sheet scrolls as one column, autofocus is desktop-only so
  the keyboard doesn't cover the list, and a fieldset min-width fix
  removes the horizontal overflow. Disabled rows no longer hover.
- **Blocked submits keep the draft.** A submit rejected for want of a
  strategy (or a failed create) used to resolve successfully from the
  composer's view, wiping what the user typed. Guards now throw so the
  draft is kept, per the composer contract — in both creation dialogs.
- **Ask refuses unknown threads fast.** `bb stelow ask --thread` with an
  id that owns no card (provider session id, dirHash) exited 1 blaming
  storage after showing the question nowhere; now it exits 2 naming the
  fix ($BB_THREAD_ID). Prompts show the literal command, the storage
  message carries the cancel reason, and the sync state file moved out
  of `skills/` (daemon log spam).
- **Failed cards name their cause.** A worker that died before producing
  output (e.g. a provider 400 on the first inference call) left the card
  at Failed with a blank error. The latest `provider/error` detail is now
  resolved once and stored as `last_error`
  (`workerFailureCause`, `lib/worker-failure.mjs`, node-tested), so the
  Failed pill, the detail hero, and the inbox event read
  e.g. `Provider error 400: Internal server error`.
- **One research status everywhere.** A ready brief rendered two competing
  states on the kanban card (`Doing` + `Ready for review`) and no status
  pill at all in the expanded view. `ResearchStatusPill` is now the single
  status on the kanban card, the list row, and the expanded view —
  `Ready for review` replaces the column label when the brief is ready.

### Changed

- **Work track is now Build.** The delivery tab, its `build/card/...`
  routes, and all copy drop the "Work" qualifier ("Build cards",
  "Paused", "Intent", "Settings") — cross-track references read the
  track title from the central `STELOW_TRACKS` table instead of
  hardcoding it. No backward compatibility: old `work/...` links
  fall back to the Build board.

### Added

- **Tour nav visibility.** Back/Next/Done use real button hierarchy
  (Next/Done solid primary, Back outline) in a fixed footer row, so
  tour navigation no longer dissolves into the background.

- **Shared tours for Inbox, Work, and Research.** One `Tour` stepper for
  all three tracks: full steps on first use, a one-line summary bar once
  content exists, a quiet reopen once dismissed (per-track localStorage).
  Every step may carry its own primary action, rendered in the content
  zone while navigation owns a fixed footer row. Inbox teaches with a
  ghost sample row instead of a seeded notification.
- **Unified filters.** `FiltersBar` with optional facets: project +
  attention shared by both boards, delivery adding stage/type/status/
  activity by config. Research drops its forked filter row for the
  identical popover, pills, and checkbox. The popover dismisses on
  outside click or Escape; selections apply live.

- **Work tour.** First-run progressive disclosure on the Work board: a
  3-step tour on the empty state (start work, per-phase agents with the
  live routing, tune later), collapsing to a one-line agent routing bar
  once cards exist. Dismissible, reopenable, persisted in localStorage.
- **Research preset band.** Investigations get their own `research` preset
  default instead of inheriting the analysis band, configured from the
  New research dialog (board default fallback). Spawn, restart, and
  strategy rounds resolve it; `createResearchCard` accepts an optional
  per-investigation `presetId`.

- **Batched question answering.** Workers batch independent questions into
  one `bb stelow ask` call (repeat `--question` groups); the card, the
  artifact viewer, and the thread form answer them in one sitting via a
  stepper with counter, direct jump tabs, radio/checkbox options, a
  free-text Other on every question, and explicit Skip. One atomic submit
  (`answerQuestions` / `answerExpiredQuestions`) resumes the worker once.
  Timed-out questions batch the same way and resume the current worker.
- **GitHub import filters.** The label field offers the alphabetical label
  picker; an assignee dropdown narrows to one person when the GitHub cache
  exposes assignees; per-issue assignees render inline.
- **GitHub completion write-back.** Completed cards imported from an issue
  offer one explicit Manage action: post a factual English summary as an
  issue comment via `gh`, optionally closing the issue. Never automatic.

- **One Stelow panel with track tabs.** Inbox, Work, and Research live
  as tabs under a single Stelow sidebar row (subPath-routed, last tab
  remembered, legacy card links resolve live). Track names, icons, and
  routes come from one table. The sidebar badge counts unresolved inbox
  action items across both tracks; each tab carries its own active
  count.
- **Research track.** A Research tab beside Work and Inbox: To-Do /
  Doing / Done cards with composite strategy rounds on the same request
  (each round appends to `brief.md`, never rewrites), a parsed
  opportunities convention, and fan-out that turns opportunities into
  delivery work cards without duplication.
  Delivery surfaces (stages, gates, intent) refuse on research cards
  with named exits. Covered by brief-parser and strategy unit tests.
- **Turn exploratory work into a project.** Exploratory cards gain a
  "Turn into project…" action that creates a BB project from the card's
  workspace. Files stay in place and the worker continues from the current
  stage; project cards never see the option. Covered by a naming and
  create/adopt/conflict unit test.
- **Scope/task progress everywhere.** Open cards show per-scope n/m task
  counts plus task dependency chips; board and list rows carry scope and
  task done/totals from a per-workspace-cached lookup.

### Fixed

- **Proportional Board/List toggle.** The Work view switch is a fixed-height
  (44px) two-column segmented control with equal halves and centered
  labels, matching the action buttons beside it.
- **Inbox keeps stale content while reloading.** Only the first mount
  skeletons; later polls show a quiet updating hint instead of blanking.
- **Uniform header and filter controls.** Work toggle segments, action
  buttons, and research filters share one height and text size; the
  research project filter is horizontal so the row aligns.
- **Panel drops the board legacy.** Single panel id/path is now
  `stelow` (was `board`); track routes, thread actions, and comments
  no longer reference it. Old panel URLs are not preserved —
  early development, no backward-compat tax.
- **Timeline count links to its artifacts.** The count is now its own
  button (navigation and files no longer share a chip); it opens the
  Artifacts section and scrolls to it. Stage chips meet touch targets
  and scroll horizontally on mobile instead of wrapping.
- **Track tabs order and memory.** Order is Inbox, Research, Work with
  Inbox as the default; explicit track routes persist the last tab while
  the bare root only reads it (it used to clobber the memory), and the
  tab bar scrolls instead of squeezing on mobile.
- **Artifacts live with their stages.** File pills no longer sit among
  navigation pills in the timeline (count-only badges remain); a shared
  Artifacts section lists everything grouped by producing stage, in both
  tracks. Order pinned by unit test.
- **Inbox counts fresh completions.** The badge now includes unseen
  completions from the last 7 days alongside unresolved actions;
  opening a completed card marks it seen (read, never resolved).
- **Strategy picker is alphabetical.** Playbooks scan predictably;
  opportunity-mapping stays the suggested default.
- **Dead card-seen tracking removed.** The unreachable `markCardSeen`
  endpoint and its always-NULL columns are gone; attention reads presence
  directly. No behavior change.
- **Research copy matches the concept.** The input is a question or topic,
  not an opportunity space — that is the result. Empty state, header, and
  creation dialog reworded; the dialog also reflects composite rounds.
- **Research empty-state wording.** "A question or a space" read as
  ambiguous — it now says "an opportunity space".
- **Skills sync verifies content hash.** The raw CDN can serve a stale
  blob for a fresh tree sha right after pushes; the sync pinned stale
  bytes under a fresh sha forever. Fetched content is now verified
  against the tree sha before recording, with retry on mismatch.
  Covered by a blob-sha unit test; suite grows from 5 to 6.

### Added
- **Worker lineage in stelow.json.** Per the upstream Worker Lineage
  contract, spawn/reseed/restart mirror the thread ledger into the
  workflow's own state (host-readable, survives plugin DB loss). Merges
  retry on write conflicts instead of clobbering concurrent stage
  advances; covered by round-trip, preservation, and failure-path tests.
- **Artifact review surface.** Read-only viewer (Markdown/source render)
  with multi-excerpt draft comments sent to the agent in one organized
  batch, pending gate question inline, and workspace-kind links that open
  in bb's official viewer. Review entry point from the decision hero.
- **Advance refuses mode-skipped gates.** `plan-gate`/`diff-gate` in a
  review mode that skips them now fail with the redirect (to execution /
  audit) instead of parking the worker on a review nobody configured.
- **Gate-tool fallback in worker prompts.** When `visual_review` is
  unavailable, Auto writes the approval receipt and advances; gated
  modes open a structured ask; chat-parking is forbidden.
- **Regression tests for ask-cancel and worker lifecycle.** Ask
  cancellation matrix and worker ledger/stall/flag transitions run
  against real SQLite; suite grows from 3 to 5.
- **Honest paused verbs.** The paused hero offers Resume (not Retry) when
  there is no error, matching the board's attention label.
- **Mode-gated interface picks in worker prompts.** Spawn and retry
  prompts now state the review-mode discipline (Auto / Product Spec Gate
  → LLM decides; Interface-Gates+ → human picks), matching the new
  upstream `human-gates.md` policy that ships via skills sync.
- **Reload-proof questions.** Transient ask cancellations (timeout,
  plugin reload/restart, aborted request) persist the question and park
  the card in awaiting-answer instead of losing the decision; explicit
  dismissals pass through. The persist is guarded against storage torn
  down mid-write, with an honest re-ask-once fallback.
- **Worker ledger.** Every worker thread per card is recorded (initial,
  band-swap, restart, reseed) with preset and reason; a Worker history
  section in Manage opens current and archived threads.
- **Robust preset staleness.** An explicit restart-pending flag (set on
  assign, self-healed by thread-birth comparison) replaces id-equality
  inference; fresh cards no longer get a pseudo-override row.
- **Official thread mention.** Respawned workers reference the archived
  predecessor with a native mention chip, not just copied text.
- **Restart worker applies preset changes.** Provider/model are fixed at
  spawn, so Resume can never switch them. While the running worker
  predates the override the hero offers Restart worker (fresh worker on
  the effective preset, continuing from the current stage), with the
  previous archived thread referenced for context recovery and trailed on
  the card.
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
- **Delete archived cards.** Manage on an archived card (research or
  build) offers Delete behind an English confirm dialog (`deleteCard`
  RPC: archived-only, removes the card row plus comments, presets,
  questions, inbox events, and ledger rows, stops + archives the worker
  thread). Archive stays the reversible exit; delete is the deliberate
  erasure.
- **Fullscreen creation on phones.** The New card / New research dialogs
  stay real modals on compact viewports (full-viewport with an explicit
  close, `fullscreenOnMobile` on `DialogContent`) instead of collapsing
  into a bottom sheet; desktop centering is unchanged.

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
