# Stelow plugin — feature inventory

Grouped by the job the user hires the feature for, not by file.
Source of truth for "what can this plugin do"; see `AGENTS.md`
(Feature inventory) for the update rule.

## 1. Capture
*When I have an idea, problem, or issue, I want it tracked as a card.*

- **New card composer** (`BoardPanel`, `createCard`). Prompt + file/image
  attachments, intent, planning depth, review checkpoints, agent preset from
  the analysis band. Spawns a hidden worker thread starting at triage.
  The creation modal stays a real modal on phones (full-viewport with an
  explicit close, `fullscreenOnMobile`) instead of collapsing into a
  bottom sheet.
- **GitHub issue import** (`listGithubCandidates`, `importGithubIssue`).
  Tagged issues land in Triage; fresh issues preselected; owning project
  resolved per repo; intent guessed from labels/title (user-correctable).
  Label field offers the alphabetical label picker (every repo label, not
  just labels on open issues); assignee dropdown lists assignable users
  per tracked repo merged with assignees seen on issues. Per-issue
  assignees shown inline.
- **GitHub completion write-back** (`postGithubCompletion`). Completed cards
  imported from an issue offer one explicit Manage action: post a factual
  English summary (scopes/tasks, prompt) as an issue comment via the
  github plugin's own RPCs, optionally closing the issue behind the same
  confirm. Never automatic — Done in Stelow is not merged/deployed.
- **Exploratory cards** (`createCardInternal`). "Don't work in a project"
  gets an isolated persistent workspace under
  `~/.bb/stelow/exploratory/<cardId>` backed by the container project
  "Stelow exploratory work".
- **Turn into project** (`promoteCard`). Exploratory-only action that
  creates a real BB project from the card's workspace. Files stay in
  place; the worker continues from the current stage.

## 2. Orient myself
*When I open Stelow, I want to see everything and find my card.*

- **One panel, five tracks** (`StelowPanel`, `STELOW_TRACKS`). A single
  Stelow sidebar row with Inbox / Build / Research / Explore / About tabs (subPath-routed,
  back-button friendly, last tab remembered). Track names, icons, and
  routes come from one table — renaming is one line. Legacy card links
  resolve the track live. Panel identity and every navigation flows
  through `STELOW_PANEL_ID` / `goToTrack` / `goToCard` / `goToInboxCard`.
  The three card kinds (build / research / explore) are centralized in
  `lib/tracks.mjs` — the server normalizes legacy `delivery` rows to
  `build` silently, and the lightweight lifecycle (To-Do / Doing / Done)
  plus worker bands come from the same module, never scattered ternaries.
- **Board** (`BoardPanel`, `moveCard`). Columns are workflow phases
  (Analyse/Plan/Execute/Review) + Done/Archived; cards sit in their
  stage's phase. Columns collapse (persisted); cards move via drag-drop.
- **List view.** Same cards grouped by column, for narrow screens —
  on both boards, via a quiet icon toggle beside the filters (a view
  preference, not a CTA).
- **Filters** (`FiltersBar`). Project, stage, intent, status, activity,
  needs-attention + reset; the Filters chip badges the active-filter count.
  The attention count in each Build/Research header is a shortcut that turns
  on the needs-attention filter. One shared bar: project + attention are the
  common facets, build adds the rest by config — Research renders the
  identical popover, pills, and checkbox, never a forked row.
- **First-visit setup, not tours.** No stepper onboarding: Build, Research,
  and Explore each open a setup dialog once (localStorage) about agent
  presets — what they decide, band defaults, per-card pins. Build adds a
  second step for Planning depth + Review checkpoints as board defaults.
  Preset setup counts across tracks: configuring on one tab silences the
  others (Build still opens into its defaults step). Opening Agent
  Presets never dismisses the setup dialog underneath.
  Each track owns its preset band (build phases, research, explore),
  so changing one default never leaks into another. Manage agent
  presets groups bands by track (Research, Explore, Build) instead of a
  flat phase list. Planning depth + Review checkpoints stay where they
  belong (per card in New issue → Settings, mirrored in the Build setup
  step). Dismissing (Got it/Done, Esc, or backdrop) never
  nags again; only the active track opens its dialog.
  Every step may carry its own primary action, so configuration
  surfaces where it is explained. Inbox teaches with a ghost sample
  row instead of a seeded notification — no badge or history pollution.
- **Sidebar badge.** Unresolved actions plus unseen recent completions
  (7-day window); per-tab active counts (About carries no count). All realtime.
- **About tab** (`AboutPanel`). Two sections — Stelow (upstream) and this
  plugin — each with its own paragraph, repo link, and version side by
  side (`buildInfo` carries both; the upstream version syncs with the
  skills). The plugin section also offers Reset onboarding (two-step
  confirm) to replay the first-visit setup dialogs. Work tracks describe
  themselves; product identity lives in exactly one place, never next
  to the wrong version.
- **Build stamp** (`buildInfo`). Both versions on the About tab so reloads are
  checkable instead of vibes.

## 3. Decide and unblock
*When the agent needs me, I want to answer or approve fast.*

- **Inbox** (`InboxPanel`, `listNotifications`). Needs-you
  (question/error/paused), recent completions, an All-clear empty state,
  resolved history last, archived; per-item read/archive/restore;
  deep-links into card+event.
  The badge counts unresolved actions plus unseen recent completions
  (7-day window); opening a completed card marks it seen, never resolved.
- **Structured questions** (`ask`, `answerQuestions`,
  `answerExpiredQuestions`, `BatchStepper`, `QuestionForm`).
  Blocking single/multi-choice asks answered in one sitting: a stepper with
  question counter (N of M), Prev/Next plus direct jump steps, radio for
  single-choice and checkbox for multi-choice, a free-text Other on every
  question, and explicit Skip (AI uses its recommendation). One atomic
  submit answers everything — one worker resume, one inbox resolution.
  Workers batch independent questions into one `bb stelow ask` call
  (repeat `--question` groups); dependent questions stay sequential.
  Timed-out asks stay answerable on the card, batched the same way.
  Options carry descriptions plus optional detail: `preview` (inline
  glance, expandable) and `artifact` (workspace-relative path opening in
  the viewer on cards, plain filename in threads). Workers attach them
  per option (`--desc/--preview/--artifact`); unresolvable paths degrade
  to no affordance and never block answering. Option shapes mirror the
  Option schema in upstream `ask-patterns.md` — one concept, two repos.
  Path validity has one pure definition (`normalizeAskArtifactPath`,
  unit-tested) shared by parser, server, and thread renderer.
- **Gate approvals** (`approveGate`). Product/interface/plan/diff gates
  with receipt files; review entry surfaces the artifact under decision.
- **Workflow classification.** Correct the type freely while a Build card
  is in triage (`updateCardIntent`). After triage, **Card actions →
  Reclassify workflow…** starts a fresh worker from triage on the new route;
  it never changes only the label beneath an existing plan.

## 4. Follow one card
*When I open a card, I want the full picture without reading the thread.*

- **Hero** (`heroFor`: decision/error/paused/working/calm). One sentence
  + one primary action per state; secondary actions as real buttons.
- **What is happening** (`ScopesList`, `StageTimeline`). Scopes in
  dependency order with task counts, blockers, 17-stage timeline with
  position/next stages, manual advance/return behind a preview dialog
  (what the target stage produces). The timeline never paints everything
  passed: off-route stages render struck-through (not in this intent's
  route) and mode-skipped stages show ⊘ with the reason — green means
  executed, nothing else does. Attachments, mentioned files,
  timed-out questions inline.
- **Artifact viewer** (`ArtifactViewerDialog`, `readCardFile`). Read-only
  Markdown/source render, quote-a-passage excerpt drafts, batch comment
  to the agent, gate question answerable inline.
- **Artifact inventory** (`ArtifactGroups`, `groupArtifactsByStage`). Every
  artifact together, grouped by producing stage in canonical order. The
  timeline keeps count-only badges — files and navigation never share a
  shape. Timeline badges deep-link into the producing stage's group with
  a highlight ring.
- **Diff review** (`cardDiff`, host `experimental_Diff`). The working
  tree vs HEAD, per file, inside the card — shown at the diff-gate and
  audit stages only. Untracked files open in the viewer; non-repos and
  clean trees state so explicitly. Read-only: never stages, never
  mutates the index.
- **Optional tools** (`toolStatus`, `installTool`, About section). Live presence probe
  for the host binaries the workflow can use (sem, cymbal, ripwire,
  ast-grep, plannotator) with per-tool purpose and install command —
  install anytime, everything degrades silently without them. Each row
  also offers one-click install (explicit consent, official installers
  only, ~/.local/bin, verified by re-probe) with per-row error + log. When `sem` is installed on the host, a one-line
  entity summary (added/modified/deleted/renamed, cosmetic-only flag)
  heads the file list — absent otherwise, never an error. When `cymbal`
  is installed, a second line lists changed symbols with caller impact
  (blast radius at a glance) under the same fail-soft rule.
- **Worker section** (`WorkerSection`, always visible right under the
  hero in both tracks): preset pill + provider/model + inline note
  (applies to the next worker — Resume keeps the current one), real
  "Change preset…" outline button, stale-preset warning with restart
  action, then a divider with recovery/danger actions — restart fresh,
  archive, delete archived cards behind confirms — all real outline
  buttons, archive/delete in destructive tone. Worker history collapses
  inside the same section; GitHub import/completion lives here too
  (build only).
- **Conversation.** Card/agent comment thread + composer that routes to
  the worker.
- **Thread embeds.** Card drawer inside threads
  (`stelow-card-detail`), "Open Stelow" header action,
  `stelow-artifact` message chips, blocking question form.

## 5. Recover
*When the worker stalls or fails, I want one obvious fix.*

- **Retry** (`retryWorker`). Nudges the same worker in place; nothing
  resets. Refused on archived cards.
- **Restart worker** (`restartWorker`). Fresh thread on the current
  preset from the current stage; applies preset changes. Predecessor
  archived with an inline mention for context.
- **Restart fresh** (`reseedCard`). New worker from triage; scopes and
  comments kept.
- **Worker ledger + lineage** (`worker-ledger`, `workflow-lineage`).
  Every worker thread recorded; mirrored into the workflow's own
  `stelow.json` so history survives plugin DB loss.
- **Preset-staleness detection.** Cards whose worker predates a preset
  change offer Restart instead of Resume.
- **Archive card** (`cancelCard`). Stops + archives the worker; history
  preserved. Behind a confirm dialog. Drag-to-archived stops the worker
  identically (shared shutdown) — parking never orphans a running
  worker. Archived cards offer Delete instead of a redundant Archive.
- **Delete archived card** (`deleteCard`). Hard delete offered only on
  archived cards from Manage, behind an English confirm dialog. Removes
  the card row plus comments, presets, questions, inbox events, and
  ledger rows; stops + archives the worker thread.
- **Failure cause** (`workerFailureCause`, `lib/worker-failure.mjs`).
  A worker that dies before producing output (e.g. a provider 400 on the
  first inference call) arrives with no error text; the latest
  `provider/error` detail is resolved once and stored as the card's
  `last_error`, so the Failed pill, the detail hero, and the inbox event
  name the cause instead of going blank.
- **Self-healing** (`syncThreadState`, 45s reconcile sweep, thread
  idle/active/failed events). Suspicious idle and stalls surface as
  paused with exactly one inbox event per idle period. No-op polls
  write nothing and publish nothing — panels reload only on real
  changes, and background refreshes never flash loading UI (first
  load owns the skeleton).

## 6. Configure the workforce
*When I want a different brain, cost, or permission, I want presets.*

- **Preset manager** (`listPresets`, `upsertPreset`, `deletePreset`,
  `setDefaultPreset`). Provider, model (catalog + searchable custom),
  reasoning, permission mode, environment kind. Built-ins protected.
  The New-preset form stays collapsed behind Show/Hide (editing
  auto-expands); list + band routing are the frequent jobs.
- **Per-phase presets** (`listBandPresets`, `setBandPreset`).
  Analysis/planning/execution/review bands auto-swap workers at
  boundaries; unset bands inherit the card preset. Research and Explore
  have their own band defaults, configured from each board's Agent
  Presets entry (fall back to the board default when unset).
- **Per-card override** (`assignPreset`). Pinned preset for one card;
  takes effect on (re)start, with a stale-worker warning until then.
- **Board defaults** (`boardWorkflowDefaults`). Planning depth and
  review checkpoints remembered across cards.

## 7. Command and embed
*When I am an agent, CLI, or another surface, I want the same power.*

- **`bb stelow` CLI.** status, ask, seed, advance, doctor, preset management,
  fan-out, verify. Advance mechanics delegate to the upstream `stelow`
  helper (synced like skills, no fork); transitions always resolve from
  the vendored copy.
- **Worker self-check** (`bb stelow verify [--card] [--json]`). The same
  predicates the sync gate enforces, runnable by the worker before
  finishing: per-round PASS/FAIL for research, artifact check for
  explore, machine-readable JSON on request. Prompts require it; the
  sync stays the backstop — prompt, CLI, and gate share one definition
  of PASS (`lib/research-artifacts.mjs`).
- **Mention providers.** `@` workflows/cards (with context resolve) and
  `@` workspace files in any composer, including the board's.
- **Realtime.** `card-state`, `board-changed`, `inbox-changed` keep
  panels, badges, and open cards live (debounced).
- **Background services.** Workflow-skills sync from `calionauta/stelow`
  (content-hash verified), scheduled reconcile, build stamp.

## 8. Research track
*When I need to understand before building, I want a lightweight
investigation that feeds the build board.*

- **Research tab** (`ResearchPanel`). To-Do / Doing / Done / Archived
  columns over research cards only; shared `FiltersBar` (project +
  attention); collapsible columns; per-tab
  active counts; no stages, no gates.
  The New research dialog shows the effective agent preset
  (`research` band default, else board default) with a Configure
  presets entry; per-investigation pins live in the card's Manage
  section. Like the build creation dialog, it stays a full-viewport
  modal with an explicit close on phones (`fullscreenOnMobile`).
- **Strategy picker** (`StrategyPicker`, `researchStrategies`). Visual
  radio-cards (emoji + name + one-line summary) with instant search over
  label, summary, and keywords; no preselected default — Start stays
  disabled until an explicit pick. Shared by the creation modal and
  "Explore another strategy" (which badges already-ran playbooks).
  Composite strategy runs on
  the same request: one round at a time, each appending a `###` section
  to the index — never parallel batches to merge. "Explore another
  strategy" starts a fresh worker on a new playbook; history pills join
  run labels (`A + B`); reseed restarts the original strategy clean.
- **Research index** (`researchIndex`, `parseResearchIndex`,
  `lib/research-index-sections.mjs`). The worker writes `research-index.md`
  (Summary + Outputs table + `## Opportunities` checkboxes) into its own
  state dir; the card renders the Summary as prose and the Outputs table
  with its Artifact column resolved to clickable artifact buttons (same
  reviewer as build cards — read, quote, comment). Opportunities render as
  a status list (✓ fanned out) — selection happens only in the fan-out
  dialog, never fake checkboxes — plus available/total counts.
  Non-conforming indexes fall back to the raw body without the
  Opportunities section so nothing duplicates the fan-out panel.
- **Round files** (`researchRoundFiles`, `lib/research-rounds.mjs`). Every
  round persists its native playbook output verbatim (one file per
  round, one per sub-step when a playbook fans out, e.g. JTBD) under
  the state dir's `rounds/` and registers each in the manifest;
  `research-index.md` stays the machine-read aggregator for fan-out. The card
  lists rounds newest-first with run status (ready / pending /
  missing) plus missing composite substeps plus unregistered state-dir files;
  history carries timestamps.
- **Output contracts** (`RESEARCH_STRATEGIES`). Each strategy declares
  `single`, `variant`, or `composite` (+ expected substep slugs for
  composite); missing substeps surface explicitly on the round, never as
  silent done.
- **Fan-out** (`fanOutResearch`, `FanOutDialog`, `bb stelow fan-out`).
  "Select To Build" opens a selection-first dialog — nothing is
  pre-checked, nothing creates until the user confirms the chosen
  opportunities (selection resets only on open, never on background
  index reloads). Checked opportunities become build cards at triage
  (exploratory research fans out into isolated exploratory cards); spawned
  boxes check off so retries never duplicate; both-ways comment trail.
  Workers fan out via `bb stelow fan-out --opportunity <id>` only after
  structured user confirmation — IDs from the index, never prose.
- **Artifact chips in the thread** (`::stelow-artifact` message
  directive). The research worker's final message emits one directive per
  produced file (index + round + sub-steps), rendered by bb's thread
  renderer as a clickable chip that opens the file in bb's viewer.
  Directive syntax is stripped before the same message is mirrored into
  card comments (plain Markdown there).
- **Shared machinery.** Hero, questions, artifacts viewer, presets,
  retry/restart/reseed, worker history, inbox, and realtime are the same
  components as build. Stage advance and intent editing refuse on
  research cards with the valid exit named.
- **Artifact guarantee** (`lib/research-artifacts.mjs`,
  `researchRoundIntegrity`). Round validity (non-empty, substantive,
  never a mirror of the index) is enforced in code, not in prompt text:
  the plugin pre-creates every round file at spawn, and readiness
  requires a reviewable index AND every round valid. An index with an
  invalid round is not Done — each invalid round surfaces as an inbox
  error naming what to re-run. The worker prompt states the contract;
  the sync is what makes it true.
- **Completed research** (`isResearchReadyForReview`,
  `lib/research-ready.mjs`). An idle worker with an index that parses to
  ≥1 opportunity is complete — never a `paused` stall. The sync moves the
  card directly to Done, resolves paused signals, and emits one `completed`
  event per index fingerprint (a grown index earns a fresh one). The board
  column is the sole status; a user comment on a completed research card
  returns it to Doing and resumes the worker.

## 9. Explore track
*When I want a single product step without the board, I want one stage,
one input, one artifact.*

- **Explore tab** (`ExplorePanel`, `createExploreCard`, `stageCatalog`).
  To-Do / Doing / Done / Archived columns over explore cards only;
  shared `FiltersBar` (project + attention), collapsible columns,
  per-tab active counts; no triage, no pipeline, no gates. The New
  exploration dialog shows the effective agent preset (`explore` band
  default, else board default) with a Configure presets entry.
- **Stage catalog** (`STAGE_CATALOG`, `lib/stage-catalog.mjs`). One entry
  per single-runnable workflow stage (Shape Up, interface alternatives,
  plan critiques, tech planning, codebase/UX critiques, testing
  strategy, execution critique) mapping to its bundled skill. Single
  source for the picker, the worker prompt, and the card detail.
- **One artifact per card** (`exploreArtifact`,
  `lib/research-artifacts.mjs`). The plugin pre-creates
  `explore-<stage>.md` at spawn (reseed re-creates it after wiping);
  Done requires real substance in that file, fingerprinted per content
  so restarts earn a fresh completion event. Thin/missing artifacts
  idle as unfinished, never as Done.
- **Shared machinery.** Board column components, list view, status
  pill, hero, questions, presets, retry/restart/reseed, worker
  history, inbox, and realtime reuse the Research definitions
  (`LightweightTrackCard`, `LightweightTrackList`,
  `markThreadRunning`, `noteAgentOutput`) — Explore adds only its
  catalog, prompt, and artifact path, never a forked copy.

## Cross-cutting rules (apply to every feature above)

From `AGENTS.md` (State honesty): no phantom waits, per-kind inbox
resolution, one primary action per card state, destructives behind
confirms in Manage, `min-h-11` touch targets with `cursor-pointer`.
