# Stelow plugin — feature inventory

Grouped by the job the user hires the feature for, not by file.
Source of truth for "what can this plugin do"; see `AGENTS.md`
(Feature inventory) for the update rule.

## 1. Capture work
*When I have an idea, problem, or issue, I want it tracked as work.*

- **New work composer** (`BoardPanel`, `createCard`). Prompt + file/image
  attachments, intent, planning depth, review checkpoints, agent preset from
  the analysis band. Spawns a hidden worker thread starting at triage.
- **GitHub issue import** (`listGithubCandidates`, `importGithubIssue`).
  Tagged issues land in Triage; fresh issues preselected; owning project
  resolved per repo; intent guessed from labels/title (user-correctable).
  Label field offers the alphabetical label picker (all open-issue labels);
  assignee dropdown narrows to one person when the GitHub cache exposes
  assignees (hidden otherwise, never faked). Per-issue assignees shown inline.
- **GitHub completion write-back** (`postGithubCompletion`). Completed cards
  imported from an issue offer one explicit Manage action: post a factual
  English summary (scopes/tasks, prompt) as an issue comment via `gh`,
  optionally closing the issue behind the same confirm. Never automatic —
  Done in Stelow is not merged/deployed.
- **Exploratory work** (`createCardInternal`). "Don't work in a project"
  gets an isolated persistent workspace under
  `~/.bb/stelow/exploratory/<cardId>` backed by the container project
  "Stelow exploratory work".
- **Turn into project** (`promoteCard`). Exploratory-only action that
  creates a real BB project from the card's workspace. Files stay in
  place; the worker continues from the current stage.

## 2. Orient myself
*When I open Stelow, I want to see everything and find my card.*

- **One panel, three tracks** (`StelowPanel`, `STELOW_TRACKS`). A single
  Stelow sidebar row with Inbox / Work / Research tabs (subPath-routed,
  back-button friendly, last tab remembered). Track names, icons, and
  routes come from one table — renaming is one line. Legacy card links
  resolve the track live. Panel identity and every navigation flows
  through `STELOW_PANEL_ID` / `goToTrack` / `goToCard` / `goToInboxCard`.
- **Board** (`BoardPanel`, `moveCard`). Columns are workflow phases
  (Analyse/Plan/Execute/Review) + Done/Archived; cards sit in their
  stage's phase. Columns collapse (persisted); cards move via drag-drop.
- **List view.** Same cards grouped by column, for narrow screens.
- **Filters** (`FiltersBar`). Project, stage, intent, status, activity,
  needs-attention + reset.
- **Sidebar badge.** Unresolved inbox action items only (both tracks).
  Track tabs carry their own active counts. All realtime.
- **Build stamp** (`buildInfo`). Version in the header so reloads are
  checkable instead of vibes.

## 3. Decide and unblock
*When the agent needs me, I want to answer or approve fast.*

- **Inbox** (`InboxPanel`, `listNotifications`). Needs-you
  (question/error/paused), recent completions, resolved history,
  archived; per-item read/archive/restore; deep-links into card+event.
  The badge counts unresolved actions plus unseen recent completions
  (7-day window); opening a completed card marks it seen, never resolved.
- **Structured questions** (`ask`, `answerQuestions`,
  `answerExpiredQuestions`, `BatchStepper`, `QuestionForm`).
  Blocking single/multi-choice asks answered in one sitting: a stepper with
  question counter (N of M), Prev/Next plus direct jump tabs, radio for
  single-choice and checkbox for multi-choice, a free-text Other on every
  question, and explicit Skip (AI uses its recommendation). One atomic
  submit answers everything — one worker resume, one inbox resolution.
  Workers batch independent questions into one `bb stelow ask` call
  (repeat `--question` groups); dependent questions stay sequential.
  Timed-out asks stay answerable on the card, batched the same way.
- **Gate approvals** (`approveGate`). Product/interface/plan/diff gates
  with receipt files; review entry surfaces the artifact under decision.
- **Intent correction** (`updateCardIntent`). Fix the card's kind
  anytime; past triage it confirms first and notifies the worker.

## 4. Follow one card
*When I open a card, I want the full picture without reading the thread.*

- **Hero** (`heroFor`: decision/error/paused/working/calm). One sentence
  + one primary action per state; secondary actions as real buttons.
- **What is happening** (`ScopesList`, `StageTimeline`). Scopes in
  dependency order with task counts, blockers, 17-stage timeline with
  position/next stages, manual advance/return behind a preview dialog
  (what the target stage produces). Attachments, mentioned files,
  timed-out questions inline.
- **Artifact viewer** (`ArtifactViewerDialog`, `readCardFile`). Read-only
  Markdown/source render, quote-a-passage excerpt drafts, batch comment
  to the agent, gate question answerable inline.
- **Artifact inventory** (`ArtifactGroups`, `groupArtifactsByStage`). Every
  artifact together, grouped by producing stage in canonical order. The
  timeline keeps count-only badges — files and navigation never share a
  shape.
- **Manage** (preset pill + override, change preset, restart fresh,
  archive, worker history with readable archived threads).
- **Conversation.** Card/agent comment thread + composer that routes to
  the worker.
- **Thread embeds.** Card drawer inside threads
  (`stelow-card-detail`), "Open Stelow work" header action,
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
  preserved. Behind a confirm dialog.
- **Self-healing** (`syncThreadState`, 45s reconcile sweep, thread
  idle/active/failed events). Suspicious idle and stalls surface as
  paused with exactly one inbox event per idle period.

## 6. Configure the workforce
*When I want a different brain, cost, or permission, I want presets.*

- **Preset manager** (`listPresets`, `upsertPreset`, `deletePreset`,
  `setDefaultPreset`). Provider, model (catalog + searchable custom),
  reasoning, permission mode, environment kind. Built-ins protected.
- **Per-phase presets** (`listBandPresets`, `setBandPreset`).
  Analysis/planning/execution/review bands auto-swap workers at
  boundaries; unset bands inherit the card preset.
- **Per-card override** (`assignPreset`). Pinned preset for one card;
  takes effect on (re)start, with a stale-worker warning until then.
- **Board defaults** (`boardWorkflowDefaults`). Planning depth and
  review checkpoints remembered across cards.

## 7. Command and embed
*When I am an agent, CLI, or another surface, I want the same power.*

- **`bb stelow` CLI.** status, ask, seed, advance, preset management.
- **Mention providers.** `@` workflows/cards (with context resolve) and
  `@` workspace files in any composer, including the board's.
- **Realtime.** `card-state`, `board-changed`, `inbox-changed` keep
  panels, badges, and open cards live (debounced).
- **Background services.** Workflow-skills sync from `calionauta/stelow`
  (content-hash verified), scheduled reconcile, build stamp.

## 8. Research track
*When I need to understand before building, I want a lightweight
investigation that feeds the delivery board.*

- **Research panel** (`ResearchPanel`). To-Do / Doing / Done / Archived
  columns over research cards only; project + attention filters;
  collapsible columns; sidebar badge; no stages, no gates.
- **Strategy picker** (`researchStrategies`). Composite strategy runs on
  the same request: one round at a time, each appending a `###` section
  to the brief — never parallel batches to merge. "Explore another
  strategy" starts a fresh worker on a new playbook; history pills join
  run labels (`A + B`); reseed restarts the original strategy clean.
- **Research brief** (`researchBrief`, `parseResearchBrief`). The worker
  writes `brief.md` (findings + `## Opportunities` checkboxes) into its
  own state dir; the card renders it with per-strategy groups and
  available/total counts. Non-conforming briefs refuse with an exit.
- **Fan-out** (`fanOutResearch`, `FanOutDialog`). Checked opportunities
  become delivery work cards at triage (exploratory research fans out
  into isolated exploratory cards); spawned boxes check off so retries
  never duplicate; both-ways comment trail.
- **Shared machinery.** Hero, questions, artifacts viewer, presets,
  retry/restart/reseed, worker history, inbox, and realtime are the same
  components as delivery. Stage advance and intent editing refuse on
  research cards with the valid exit named.

## Cross-cutting rules (apply to every feature above)

From `AGENTS.md` (State honesty): no phantom waits, per-kind inbox
resolution, one primary action per card state, destructives behind
confirms in Manage, `min-h-11` touch targets with `cursor-pointer`.
