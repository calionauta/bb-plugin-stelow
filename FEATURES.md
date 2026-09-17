# Stelow plugin — feature inventory

Grouped by the job the user hires the feature for, not by file.
Source of truth for "what can this plugin do"; see `AGENTS.md`
(Feature inventory) for the update rule.

## 1. Capture
*When I have an idea, problem, or issue, I want it tracked as a card.*

- **New card composer** (`BoardPanel`, `createCard`). Prompt + file/image
  attachments, intent, planning depth, your review gates, agent preset from
  the analysis band. Planning depth and review gates render as compact
  rows under the composer — title plus current value always visible, so
  consequential choices stay discoverable without a wall of nine radio
  cards pushing content below the fold. One tap expands a row into the
  full radio cards (real inputs, min-h-11 targets) — no hidden select.
  The fixed-height dialog with inner scroll never jumps. Bordered
  settings sections visibly contain the controls. BB's own Project, Environment,
  branch, and provider/model controls are authoritative: Stelow forwards the
  chosen checkout unchanged and keeps later workers in it, and forwards the
  chosen provider/model/reasoning/permission to the spawn — a choice
  differing from the analysis band preset is pinned as the card's preset
  override, so restarts keep running what was picked. Spawns a hidden worker thread
  starting at triage.
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
- **Manual Git changes from Done** (`publicationStatus`, `CardDetailBody`). A
  completed card with a live BB environment can inspect its exact worker
  checkout and make a host-local commit through BB. The checkout selected in
  BB stays authoritative: a default-branch action is prominently labelled as
  a local save and explicitly says that BB cannot fetch, merge incoming remote
  changes, push, or create a PR from this panel. Feature branches retain
  PR-ready/draft/merge controls; local squash is advanced-only and unavailable
  on the default branch. Every write is rechecked on BB's host and kept in a
  card-local publication history. Detached HEADs,
  non-Git folders, unavailable hosts, failing checks, and missing approvals
  fail closed with the next actionable explanation.
- **Push now, tracked in the panel** (`publicationPushTerminal`,
  `publicationPushTerminals`). BB has no push action and never auto-reveals
  new shells, so the confirmed action runs `git push` in the card's own
  environment and streams the result into Push shells: ✓ Pushed, ✗ Push
  failed (exit), … Running, ○ Waiting (legacy typed-only shells),
  ○ Ended (shell exited, scrollback gone). One active shell per card — a
  push in flight blocks duplicates, retired shells are closed. Header
  separates title from action; each shell carries Copy terminal ID for
  sidebar lookup. A result refresh follows the run automatically; Check
  result re-checks any time. A swallowed send failure reports an error
  instead of a false success. Recorded in publication history like any
  other write.
- **Git changes layout.** Saved → Publish → On GitHub sections: one-line
  status each, buttons in their own rows (never inside prose). The outcome
  line states the remote truth ("not pushed yet" / "pushed to origin").
- **On GitHub links** (`lib/remote-url`). The remote is parsed from git's
  own `To <url>` push line (the SDK exposes none): View branch always,
  Open pull request (compare) when the base differs. GitHub-only; other
  hosts show no links rather than wrong ones.
- **Sync & push** (`publicationPullPush`). Rejected pushes (usually: behind)
  are the common lay-user case, so the failure carries its own one-click
  remediation: `pull --rebase` then `push` in the card's checkout — linear
  history, no merge commits. A conflicted pull aborts itself
  (`STELOW_SYNC_ABORTED`), leaving the checkout unchanged, and the panel
  names the manual exit. Offered on failed shells and whenever the branch
  is behind.
- **Local commit outcome and review** (`publicationCommitDiff`). Once BB saves
  a local commit, Done cards replace the disabled save control with a clear
  success state, current-HEAD indication, copyable SHA, and a read-only
  native-BB commit diff. Files render as collapsed accordions with
  expand/collapse all. The success state also discloses what remains —
  push in a terminal you watch (BB opens it with the command typed) and
  pull request via the provider or BB's native flow.
  The viewer is restricted to commits recorded in that
  card’s publication history, so it never becomes an arbitrary Git browser.
- **Exploratory cards** (`createCardInternal`). "Don't work in a project"
  gets an isolated persistent workspace under
  `~/.bb/stelow/exploratory/<cardId>` backed by the container project
  "Stelow exploratory work".
- **Turn into project** (`promoteCard`). Exploratory-only action that
  creates a real BB project from the card's workspace. Files stay in
  place; the worker continues from the current stage. Offered only when
  the workspace actually holds source material; every other case is
  refused with the exit that fits it.
- **Workspace recovery** (`workspaceRecovery`, `attachRecoveryCheckout`,
  `lib/workspace-recovery.mjs`). An exploratory card whose work happened
  elsewhere offers exactly one evidenced next step instead of a guess:
  promote the workspace (real source is here), review a worker-reported
  registered checkout (the agent said where it wrote), choose between
  reported checkouts (more than one matches), or state plainly that only
  documents remain. Only registered projects on the same host that the
  worker named explicitly become candidates, and each must still show
  uncommitted Git evidence when checked. Attaching records the reviewed
  project, branch, HEAD, and changed-file count in the card's audit trail
  and keeps the original exploratory path — it never moves files, stages
  changes, commits, or pushes. Stelow's own seeded scaffolding (`skills/`,
  `data/`, `.stelow/`, `stelow.json`) is never mistaken for source, so an
  empty exploratory folder can no longer masquerade as promotable.
- **Recovered-diff integrity.** A recovered checkout is re-validated against
  the Git root that the person attached before Stelow renders its diff. If it
  now resolves somewhere else, the panel refuses the view and directs the
  person to re-check evidence rather than presenting a plausible diff from
  the wrong repository. Build audit receipts also name the host-verified Git
  root and exact HEAD, so a copied or stale receipt cannot mark work Done.
- **Recovery audits are real Build cards** (`createRecoveryAudit`). Once a
  checkout is attached, the panel offers Create recovery audit: one idempotent
  Build card in the registered project with a normal BB workspace, so review,
  host-recorded tests, commits, and PRs all work there. The original
  exploratory card stays an immutable mismatch record; both cards cross-link
  the handoff in their timelines. Worker-reported loose folders and
  patch/diff/bundle paths are listed as preserved evidence and are never
  auto-applied to any checkout.

## 2. Orient myself
*When I open Stelow, I want to see everything and find my card.*

- **One panel, five tracks** (`StelowPanel`, `STELOW_TRACKS`). A single
  Stelow sidebar row with Inbox / Build / Research / Explore / About tabs (subPath-routed,
  back-button friendly, last tab remembered). Track names, icons, and
  routes come from one table — renaming is one line. A card link resolves
  its track live. Panel identity and every navigation flows
  through `STELOW_PANEL_ID` / `goToTrack` / `goToCard` / `goToInboxCard`.
  The three card kinds (build / research / explore) are centralized in
  `lib/tracks.mjs` — one `normalizeKind` turns any stored value into a
  track, and the lightweight lifecycle (Inbox / Doing / Done)
  plus worker bands come from the same module, never scattered ternaries.
- **Board** (`BoardPanel`, `moveCard`). Columns are Inbox + workflow phases
  (Analysis/Planning/Execution/Review) + Done/Archived; cards sit in their
  stage's phase. The complete Build topology (inbox, phases, terminal
  outcomes, entry checkpoints, labels, and stage-to-column projection) is
  derived from one workflow catalog; Research/Explore own their separately
  derived Inbox/Doing/Done lifecycle. Columns collapse (persisted); cards
  move via drag-drop.
- **One state language.** Build Kanban tiles and the open-card header use the
  same ordered pills: board location, lifecycle state, worker state, then
  workflow type. The components and tones are shared; a generic “Status”
  label and the stage-as-status variant are not shown on the board, so a
  card reads the same way before and after opening it.
- **Inbox** (one word, every track). The first column means *captured,
  nothing running yet*: a card sits there while it has no worker, and
  leaving it is what starts the card. Moving a card that already has a
  worker into the Inbox is refused with a named exit (parking it would
  orphan the worker) — archive it or move it to a phase instead.
- **List view.** Same cards grouped by column, for narrow screens —
  on both boards, via a quiet icon toggle beside the filters (a view
  preference, not a CTA). Groups collapse per track (persisted; Archived
  starts collapsed). One shared row across tracks (Build geometry
  standard; strategy/technique rides the meta line).
- **Card keyboard.** Enter/Space on a focused card opens its detail;
  W opens its worker thread. The handler is bound to the card surface
  only, so typing in nested controls never navigates. Esc (or Back)
  returns to the board with that card focused.
- **Filters** (`FiltersBar`). Project, stage, intent, status, activity,
  needs-attention + reset; the Filters chip badges the active-filter count.
  The attention count in each Build/Research header is a shortcut that turns
  on the needs-attention filter. One shared bar: project + attention are the
  common facets, build adds the rest by config — Research renders the
  identical popover, pills, and checkbox, never a forked row.
- **First-visit setup, not tours.** No stepper onboarding: Build, Research,
  and Explore each open a setup dialog once (localStorage) about agent
  presets — what they decide, band defaults, per-card pins. Build adds a
  second step for Planning depth + your review gates as board defaults.
  Preset setup counts across tracks: configuring on one tab silences the
  others (Build still opens into its defaults step). Opening Agent
  Presets never dismisses the setup dialog underneath.
  Each track owns its preset band (build phases, research, explore),
  so changing one default never leaks into another. Manage agent
  presets groups bands by track (Research, Explore, Build) instead of a
  flat phase list. Planning depth + your review gates stay where they
  belong (per card in New issue → Settings, mirrored in the Build setup
  step). Dismissing (Got it/Done, Esc, or backdrop) never
  nags again; only the active track opens its dialog.
  Every step may carry its own primary action, so configuration
  surfaces where it is explained. Inbox teaches with a ghost sample
  row instead of a seeded notification — no badge or history pollution.
- **Sidebar badge.** Unresolved actions and unread completions; it always
  agrees with the Inbox's primary **Needs attention** list. A completion is
  emerald review work, not an amber blocked workflow, and clears when its Done
  card is opened. Per-tab active counts (About carries no count). All realtime.
- **About tab** (`AboutPanel`). Two sections — Stelow (upstream) and this
  plugin — each with its own paragraph, repo link, and version side by
  side (`buildInfo` carries both; the upstream version syncs with the
  skills). The Stelow section opens with the identity mark, served lazily
  as a data URI over the `aboutLogo` RPC (bb serves only built bundles,
  never static files) with a silent text fallback. The plugin section shows the immutable Stelow version pinned into this plugin release (opening the vendored inventory grouped Workflow/Product), asks BB for the installed plugin's compatible update status, and offers an explicit confirmation before BB applies it. Versions read as tags (`v0.20.0`), never raw commit shas; the confirmation names the installed and candidate versions, a "Last checked … · Check again" line forces a fresh check on demand, and a post-update read that fails during reload says the plugin is reloading instead of reporting a false failure. Mount-time reads share one in-flight check with a one-minute reuse window, so the sidebar and About never double-hit upstream resolution. A separate sidebar indicator announces availability; neither path mutates a running workflow before that confirmation. It also offers Reset onboarding (two-step
  confirm) to replay the first-visit setup dialogs. Work tracks describe
  themselves; product identity lives in exactly one place, never next
  to the wrong version.
- **Build stamp** (`buildInfo`). Both versions on the About tab so reloads are
  checkable instead of vibes.

## 3. Decide and unblock
*When the agent needs me, I want to answer or approve fast.*

- **Inbox** (`InboxPanel`, `listNotifications`). **Needs attention**
  (question/error/paused, whether already read), recent completions, an All-clear empty state,
  resolved history last, archived; per-item read/archive/restore;
  deep-links into card+event. The Resolved filter explains itself
  (needed-you-once, cleared on its own) and each row names HOW it cleared
  (answered, withdrawn, resumed, completed — recorded as `resolved_reason`
  where observed; legacy rows keep the generic kind label).
  The badge counts the same action and review requests shown by **Needs attention**;
  an unopened completion reads **Ready for review** — the request it actually is —
  until the Done card is opened, which is also what clears the card's Review
  marker on the board.
  The toolbar is one row: four tabs with semantic status dots (amber waits,
  emerald resolved, zinc archived, primary all) and a single Unread-only
  checkbox — no detached Show label.
- **Question recovery.** A worker may wait only for a real card form: a live
  structured ask or the durable interrupted-request recovery form. A stale chat message
  or split proposal cannot hide progress; it is safe to submit the same ask
  once when no form is visible, while the host rejects actual duplicates.
  A specific question also supersedes a generic paused notice — or a raw
  error report — for that card, so one action is counted once and the
  Inbox says what needs answering.
  Recovery says plainly that the initial interactive request was interrupted,
  that there is no deadline, and that the saved answer resumes work — it never
  exposes the internal `timed-out` state as a second, redundant title.
- **Split choices are unambiguous.** Candidate deliveries are checkbox cards;
  **Keep as one card** is visually separated and mutually exclusive. The
  outcome is stated once per choice, and the host rejects a contradictory
  answer even if it did not come from the panel. The split summary states
  that selecting every delivery archives the parent after creating children;
  partial selections leave its remainder in place. Timed-out multi-choice
  answers keep every selected value and record split approval just like live
  forms, so recovery never changes the decision. As choices change, a live
  outcome notice names whether the parent stays, or whether selecting every
  delivery will archive it after creating the child cards.
- **Question presentation is semantic and language-consistent.** Every
  question carries a `standard` or `split` kind from the host interaction
  through durable recovery (with a safe legacy fallback). Shared presentation
  copy is English-only. Workers author question text, option labels, and
  descriptions in English; the host rejects Portuguese structured content
  before it reaches a card. Controls, recovery status, and split consequences
  therefore never guess a locale or mix languages.
- **Unread is a view, not a work state.** Every Inbox tab has an `All updates`
  / `Unread only` secondary filter. It narrows the selected lifecycle view
  without changing the attention badge or hiding a read-but-unresolved action.
- **Structured questions** (`ask`, `answerQuestions`,
  `answerExpiredQuestions`, `BatchStepper`, `QuestionForm`).
  Blocking single/multi-choice asks answered in one sitting: a stepper with
  question counter (N of M), Prev/Next plus direct jump steps, radio for
  single-choice and high-contrast checkbox for multi-choice, a free-text
  Other on ordinary questions, and explicit Skip (AI uses its
  recommendation). One atomic
  submit answers everything — one worker resume, one inbox resolution.
  Workers batch independent questions into one `bb stelow ask` call
  (repeat `--question` groups; `--multiple` also accepts the unambiguous
  mode-first form used after a tag); dependent questions stay sequential.
  Timed-out asks stay answerable on the card, batched the same way.
  Options carry descriptions plus optional detail: `preview` (inline
  glance, expandable) and `artifact` (workspace-relative path opening in
  the viewer on cards, plain filename in threads). Workers attach them
  per option (`--desc/--preview/--artifact`); unresolvable paths degrade
  to no affordance and never block answering. Within one question, an
  option that carries no artifact inherits the first one attached to a
  sibling, so the approval option is never the only one blind to the
  document under decision (`inheritAskArtifact`, unit-tested); options
  with their own documents — competing proposals — keep them. Option
  shapes mirror the
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

- **Board cards** (`CardHeading`, `CardRetryButton`). A card’s requested
  outcome is a full-width, wrapping heading; Build cards name their specific
  workflow stage (`Critique`, `Audit`, etc.) and workflow type below it — never
  the Kanban column or duplicated lifecycle labels such as `In progress` or
  `Completed`. A parked Inbox card claims no checkpoint it never reached and
  reads Not started instead. The same stage/type summary is reused in the open card. A blue
  live border means a worker is executing; an amber attention border means the
  card is waiting on the user, so neither state needs another tag. Idle
  recovery is a separate Resume action. Tiles signal failures with the Failed
  chip only — the reason stays one hover away on the chip, while the full error
  text and its retry live in the open card. The same compact hierarchy is reused
  in Build, Research, and Explore, so narrow columns do not turn a title or a
  workflow state into an ambiguous, clipped chip.
- **Hero** (`heroFor`: decision/error/paused/working/calm). One sentence
  + one primary action per state; secondary actions as real buttons. The
  decision state always offers Open thread, and names a concurrent worker
  error inside itself (answering resumes the worker) instead of hiding the
  reason behind the Failed chip — with a Retry worker alternative beside
  the question for the failure itself. Answering any question clears the
  interrupted turn's failure; an error arriving while a question is open is
  superseded at birth, so one card counts once.
- **Workflow progress** (`ScopesList`, `StageTimeline`) sits beside the
  **Workflow map** as two sibling sections that never pretend to be each
  other: progress is where this card is, the map is what each stage does.
  Scopes in dependency order with task counts, blockers, 17-stage timeline with
  position/next stages, manual advance/return behind a preview dialog
  (what the target stage produces). The timeline never paints everything
  passed: off-route stages render struck-through (not in this intent's
  route) and mode-skipped stages show ⊘ with the reason — green means
  executed, nothing else does. A completed card keeps Audit as its historical
  verification record, cannot reopen that terminal checkpoint. More generally,
  the current checkpoint is always inert; only a legal next checkpoint or a
   prior checkpoint can be selected. A stage that produced documents carries a
   count-only suffix (`2 files`) — never a control, so the pill stays one click
   target and files keep one shape — and the section summary states the card's
   file count as the single route into Artifacts. The map explains phases, Done,
   and attention as a real disclosure with a state-explicit chevron (no
   CSS-variant hope); it lists every stage with what it produces and a link to
   the upstream skill or behavior doc that defines it. Pill tooltips name the
   owning skill and point at the map. Pill clicks keep their rerun/advance
   meaning and never navigate away. Attachments, files named in the request,
   timed-out questions inline.
- **Files named in your request.** The card lists only the paths the
  request spells out that actually exist in the workspace (never a basename
  guess, which used to surface an unrelated file): six at most, and nothing
  at all when the request names none.
- **Artifact viewer** (`ArtifactViewerDialog`, `readCardFile`). Read-only
  Markdown/source render, quote-a-passage excerpt drafts, batch comment
  to the agent, gate question answerable inline.
- **Artifact inventory** (`ArtifactGroups`, `groupArtifactsByStage`). Every
  artifact together, grouped by producing stage in canonical order. The
  timeline keeps count-only badges — files and navigation never share a
  shape. Timeline badges deep-link into the producing stage's group with
  a highlight ring. The trail never depends on the agent registering its own
  output (`unregisteredArtifactPaths`): any other document the workflow wrote
  in its state dir is listed under **Produced but not registered**, so a
  produced artifact cannot be invisible. The workflow's own `state.md`, its
  backups, logs, and JSON bookkeeping are never artifacts.
- **Diff review** (`cardDiff`, host `experimental_Diff`). The working
  tree vs HEAD, per file, inside the card — on active cards at the
  diff-gate and audit stages, plus completed cards whose tree went dirty
  again (pending changes stay reviewable while the commit action lives
  in Git changes). Otherwise Git changes alone owns Done. Untracked
  files open in the viewer; non-repos and
  clean trees state so explicitly. Read-only: never stages, never
  mutates the index.
- **Preview** (`PreviewSection`, `previewState`/`previewStart`/`previewStop`,
  `bb stelow preview`). Runs the card's own web app and shows it inside the
  panel: the stack is detected from the workspace (Next/Vite/Astro/Svelte,
  Go, Django/FastAPI/Flask/Streamlit, a self-contained page), the dev server
  starts on loopback in the worker's own checkout — the project source when
  that worktree is gone — and the running app renders in a sandboxed frame
  with "Open in a new tab" always beside it. One action per state; the exact
  command, port, checkout and log are always on screen. Reaching it from
  another device uses the bb connect share URL when paired and loopback when
  not: exposure is never a gate, and the panel says which one it is. One
  server per checkout, so two cards on one source share it, capped at 3
  running previews; a workspace with nothing to serve shows no button.
  A start that never announces an address fails loudly after 60s with its
  log attached instead of sitting in "Starting…" forever; the log opens
  itself while starting or failed, with a live elapsed clock. Pairing and
  sharing hints are real buttons (pairing dashboard, port-share retry),
  never highlighted dead text.
- **Optional tools** (`toolStatus`, `installTool`, About section). Live presence probe
  for the host binaries the workflow can use (sem, cymbal, ripwire,
  ast-grep) with per-tool purpose and install command —
  install anytime, everything degrades silently without them. Each row
  also offers one-click install (explicit consent, official installers
  only, ~/.local/bin, verified by re-probe) with per-row error + log, plus
  one-click reinstall-as-update for installed tools. A separate "Ready via
  npx" group discloses the on-demand dependencies (skills hub, ctx7,
  last30days, thermo-nuclear) with usage and consent rules — info only,
  no commands shown, no buttons. When `sem` is installed on the host, a one-line
  entity summary (added/modified/deleted/renamed, cosmetic-only flag)
  heads the file list — absent otherwise, never an error. When `cymbal`
  is installed, a second line lists changed symbols with caller impact
  (blast radius at a glance) under the same fail-soft rule.
- **Portable reconnaissance receipts** (`recon.sh`, `RECON_PROTOCOL`,
  `reconReceiptStatus`). Stelow preflights optional analysis tools from the
  target Git workspace and writes `context/recon-receipt.json`; BB injects the
  portable contract at workflow handoff and shows a non-blocking audit warning
  when a completed Build card lacks a valid receipt.
- **Worker section** (`WorkerSection`, always visible right under the
  hero in both tracks): preset pill + provider/model + inline note
  (applies to the next worker — Resume keeps the current one); completed
  cards instead show the preset recorded for their completed worker, real
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
  resets. Refused on archived cards — and on completed/blocked ones, where
  reopening happens through a card comment or a fresh restart.
- **Done is terminal for attention.** Background sync never writes a
  completed card (no re-error after finishing), and a stale error
  underneath Done never flags needs-attention or Retry. The board and the
  detail agree because both read the same rule.
- **Review is not attention** (`hasPendingReview`, `pendingReview`). Done
  staying terminal for attention left a Done column that looked inert, so
  finishing work is now its own quieter, emerald signal instead of being
  folded into the amber one. `needsAttention` still means exactly one thing —
  a worker is blocked on you — and the Inbox badge still counts exactly the
  actions its primary filter lists. The review marker rides the completion's
  own read state: `bb stelow done` writes it unread, opening the card clears
  it, and the board listens to `inbox-changed` so the marker never lingers.
- **Auto-continue** (`syncThreadState`, `lib/auto-continue.mjs`). A worker
  that narrates progress and stops idles after every stage (the provider
  ends a turn on any final text). While the finished turn left fresh
  output or stage progress, no question is pending, and the per-stage
  budget (10 consecutive resumes without a stage advance) remains, the
  host resumes the worker in place with the same nudge a manual Retry
  sends — no human click per stage. A silent stop or an exhausted budget
  still surfaces as paused with exactly one inbox event per idle period;
  manual Retry/Restart reseeds the budget.
- **Automatic spawn retry** (`applyWorkerFailed`, `lib/spawn-retry.mjs`).
  A worker that dies before producing any output from a transient
  start-phase cause (skill-tree fetch race, thread.start failure, 502/503,
  lost host session) is respawned automatically — up to 3 attempts with
  1–2s / 2–4s / 4–8s jittered backoff — instead of paging the human.
  Retries are idempotent (one in flight per card, attempts claimed in the
  DB per failed thread, fresh-state revalidation before each spawn); only
  the final exhaustion writes Failed with its single inbox event.
  Mid-workflow failures and refusals never auto-retry.
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
  worker. Archived is terminal: settling worker threads can never flip
  the card back (single `updateCard` rule, re-checked at write time), and
  every worker-touching RPC (move, advance, answers, comments, strategies)
  refuses archived cards with the named exit. Archived cards offer Delete
  instead of a redundant Archive.
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
  `setDefaultPreset`). Provider, model, reasoning and permission mode come
  from BB's own pickers (live catalog with search, same as the new-card
  composer) shared with the card override dialog; environment kind stays a
  preset field. Built-ins protected.
  The New-preset form stays collapsed behind Show/Hide (editing
  auto-expands) and band routing behind its own disclosure; the frame
  scrolls instead of overflowing the viewport.
- **Per-phase presets** (`listBandPresets`, `setBandPreset`).
  Analysis/planning/execution/review bands auto-swap workers at
  boundaries; unset bands inherit the card preset. Research and Explore
  have their own band defaults, configured from each board's Agent
  Presets entry (fall back to the board default when unset).
- **Per-card override** (`assignPreset`). Pinned preset for one card;
  takes effect on (re)start, with a stale-worker warning until then.
- **Board defaults** (`boardWorkflowDefaults`). Planning depth and
  your review gates remembered across cards.
- **One disclosure affordance** (`DisclosureSection`, `DisclosureChevron`).
  Every collapsible shares one bordered disclosure (right chevron when
  closed, rotates down when open); native details/summary keeps the
  accessible state, the chevron mirrors it visually. `SettingsSection`
  visibly groups any revealed configuration controls with their heading.

## 7. Command and embed
*When I am an agent, CLI, or another surface, I want the same power.*

- **`bb stelow` CLI.** status, ask, seed, advance, doctor, preset management,
  fan-out, verify. Advance mechanics delegate to the upstream `stelow`
  helper and skills pinned together at plugin release (no fork and no runtime
  mutation); transitions always resolve from
  the vendored copy. `seed` refuses card workers (`lib/card-seed-guard.mjs`):
  their workflow is pre-seeded at spawn with the card id as owner, and a
  second seed would orphan a name-derived workflow at the project root —
  the refusal redirects to the card's own state dir.
- **Worker self-check** (`bb stelow verify [--card] [--tests] [--json]`). The same
  predicates the sync gate enforces, runnable by the worker before
  finishing: per-round PASS/FAIL for research, artifact check for
  explore, machine-readable JSON on request. Build `--tests` runs only the
  checkout's conventional test command (no shell text from the card) and
  records command, exit, output digest, Git root, and HEAD in a host ledger
  (`lib/audit-verification.mjs`); `done` accepts only a passing run at the
  audited HEAD. Prompts require it; the
  sync stays the backstop — prompt, CLI, and gate share one definition
  of PASS (`lib/research-artifacts.mjs`).
- **Explicit completion** (`bb stelow done [--card]`, `lib/completion.mjs`).
  Done-ness was inferred from `audit` + idle, so narrate-and-stop looked
  identical to stuck. The worker commits; the host verifies in code —
  build only at `audit`, research/explore only with a passing `verify`
  and no pending question. Every refusal names the fix. The old
  audit-idle auto-complete is gone: an audit-idle worker is resumed with
  the done instruction (budgeted), then pauses with the instruction on
  the card — completed cards read "Done — ready to review", never a lit
  audit with no next step.
- **Portable audit receipt** (`scripts/stelow audit-trail`). After bb's
  stricter checkout-bound `audit.md` gate passes, Build completion invokes the
  upstream helper to build and check the deterministic cross-host lineage
  receipt. The plugin never owns a second trail format; another host can
  verify the same `audit-trail.md` from durable state and content hashes.
  The receipt attests the whole tree the work was verified in — Git root,
  `HEAD`, the tracked worktree diff, and the untracked manifest — so a later
  commit, an uncommitted edit, or a new untracked file all make it stale.
  `lib/audit-trail-contract.mjs` is the ONE place the plugin reads that
  output: it pins the projection's contract version and keeps the completion
  gate and the card's freshness badge from disagreeing.
- **One tree, one receipt.** `audit-trail build --strict` runs only after the
  `audit.md` gate, `check --strict` re-validates it, and the gate then binds
  the trail's own snapshot to the Git identity the receipt was verified at. A
  checkout that moved in between blocks completion with the fix named, rather
  than leaving Done holding a receipt and a trail that describe two different
  trees. `--strict` also refuses to seal a receipt that would omit a workflow
  document nobody registered — a produced file is never silently dropped from
  the lineage links.
- **Audit evidence, labelled** (`AuditTrailStatusRow`, `auditTrailStatus`).
  A completed Build card carries two receipts one word apart. Stelow's trail
  is attributed to the stage that produced it — not shown as an unregistered
  stray file — and both are labelled for what they are: the host's `audit.md`
  (acceptance criteria, tests, checkout) and Stelow's portable trail (state,
  artifacts, worktree snapshot). Freshness is asked for on demand, never on
  every board read, because `check` re-derives the projection. A finished card
  opens its Artifacts section by default: the evidence is the deliverable.
- **Stelow identity prefix** (`sw-`). Per-workflow state dirs, cardless
  workflow ids, and both generators (owner-derived here, random upstream)
  share one prefix.
- **Host-served playbook** (`bb stelow playbook [--card]`,
  `lib/playbook.mjs`). The card's state file, transitions, and the
  ordered reading list for its current stage as exact paths — workers
  read what they are given instead of discovering skills through shell
  pipelines. Missing files fail loud, never silently dropped.
- **Exceptional card split** (`bb stelow ask --tag split`, `bb stelow split`,
  `lib/split-proposal.mjs`). The default is one focused card with scopes;
  triage (or Choose work, before its choice is committed) may propose a
  split only for 2+ substantial, independently auditable deliverables with
  distinct outcomes and acceptance criteria — never for bullets, files,
  UI/API slices, steps, or small fixes. The structured multi-select ask
  explicitly states its consequence: selected deliveries become child cards,
  unselected deliveries remain on the parent, and “Keep as one card” vetoes
  the split. It accepts only those recorded option values, so a free-text
  answer cannot accidentally create work. The host creates children only
  from the recorded, human-approved proposal — full approval archives the
  parent, partial approval keeps it narrowed to the remainder. Never
  unilateral, never by worker claim. A standard ask answered at the split
  point warns that its answer executes nothing, with the exact re-ask
  repair. The open card offers Propose split at triage/select once a worker
  exists to propose from — parked Inbox cards show no trigger, and the
  trigger RPC refuses threadless cards outright. One click
  drives the worker into the --tag split protocol (refused past the split
  point or while a proposal awaits an answer). One shared gate
  (`lib/split-proposal.mjs`: `splitEligibility`, `splitActionState`,
  `recordSplitAnswer`) decides for the worker ask, the executor, the
  trigger, and the card flag on state.md truth — the UI reads the flag,
  never local stage rules. Standard questions at the split point carry a
  host-appended consequence disclosure (scope-only, creates no cards,
  Propose split stays available), so a scope pick never reads like a
  split decision. Children inherit the parent's appetite and review mode
  (parsed whole from the indented state.md config block — never
  truncated). An archived card's thread keeps its way back: the thread
  header still links to its card. Refactor/bugfix cards skip
  product-strategy questions at the context stage by host refusal
  (`lib/context-ask-gate.mjs`, `--force` to override) — intent plus stage
  decide, never worker judgment. Config values are schema-bound at the
  write   boundary (strict enums) and parse whole at the read boundary
  (seed→read round-trip pinned by test). Review gates require evidence:
  a standard ask at a gate stage (`gate`, `int-gate`, `selection`,
  `plan-gate`) with no `--artifact`/`--preview` on any option is refused
  by the host (`lib/gate-ask-evidence.mjs`, `--force` to override), and
  the card hero falls back to question-attached evidence when the
  manifest lists nothing. Label-only options work unchanged everywhere
  else. Per-option evidence opens inside the option row as the shared
  outline button (Open document, same viewer, never a hand-rolled color
  beside the amber panel); the inline glance expands below.
- **Stale-question notices** (`bb stelow ask` snapshots, `lib/question-staleness.mjs`).
  Asking records what each questioned document contained and where its
  checkout stood (doc hash + Git HEAD, latest wins per card and path).
  Every card read compares open questions against their baseline: a revised
  or removed document, or a checkout that moved (with the touched paths),
  raises an amber notice naming what changed and pointing at the existing
  exits — re-open the doc, request changes, regress the stage. Advisory
  only: questions stay answerable, nothing auto-replans.
- **Deferred start on every track.** Build, research, and explore
  creation all offer Start immediately (checked): unchecked parks the
  card in the Inbox with no worker — no run, no burn, no badge. Parked
  cards offer Start on the card; dragging out of the Inbox starts through
  the same shared spawn as preset restarts (Research/Explore to Doing,
  Build into a phase, which is written first and reverted if the spawn
  fails). Split children and imports always start: approved work never
  parks.
- **Preset fence.** `preset add/remove/assign` refuse card workers (presets
  are managed from the card UI); `preset list` stays open.
- **Mention providers.** `@` workflows/cards (with context resolve) and
  `@` workspace files in any composer, including the board's.
- **Realtime.** `card-state`, `board-changed`, `inbox-changed` keep
  panels, badges, and open cards live (debounced).
- **Background services.** Upstream skills sync from `calionauta/stelow`
  (every stelow-* skill, content-hash verified, retired names pruned;
  state in the stable data dir, one fail-soft pass at boot),
  scheduled reconcile, build stamp.

## 8. Research track
*When I need to understand before building, I want a lightweight
investigation that feeds the build board.*

- **Research tab** (`ResearchPanel`). Inbox / Doing / Done / Archived
  columns over research cards only; shared `FiltersBar` (project +
  attention); collapsible columns; per-tab
  active counts; no stages, no gates.
  The New research dialog shows the effective agent preset
  (`research` band default, else board default) with a Configure
  presets entry; the provider/model picked in BB's composer is forwarded to
  the spawn and pinned as the card's preset override when it differs;
  per-investigation pins live in the card's Manage
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
  Inbox / Doing / Done / Archived columns over explore cards only;
  shared `FiltersBar` (project + attention), collapsible columns,
  per-tab active counts; no triage, no pipeline, no gates. The New
  exploration dialog shows the effective agent preset (`explore` band
  default, else board default) with a Configure presets entry; the
  provider/model picked in BB's composer is forwarded to the spawn and
  pinned as the card's preset override when it differs.
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
