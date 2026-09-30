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
  consequential choices stay discoverable without a wall of option cards
  pushing content below the fold. One tap expands a row into the
  full controls (real inputs, min-h-11 targets) — no hidden select.
  Review gates are a pure multi-select (product spec, interface
  direction, build scopes, technical plan, code diff) with Select all /
  Clear and one-click preset templates; nothing picked means Auto and the
  composer remembers the last used selection.
  The fixed-height dialog with inner scroll never jumps. Bordered
  settings sections visibly contain the controls. BB's own Project, Environment,
  branch, and provider/model controls are authoritative: Stelow forwards the
  chosen checkout unchanged and keeps later workers in it, and forwards the
  chosen provider/model/reasoning/permission to the spawn — a choice
  differing from the analysis band preset is pinned as the card's preset
  override, so restarts keep running what was picked. Spawns a hidden worker thread
  starting at triage. A failed submit never closes the dialog or loses the
  draft (the throw contract): a persistent warning names the cause in place
  — e.g. Build on a project without a Git source — so another workspace can
  be picked and resubmitted.
  The creation modal stays a real modal on phones (full-viewport with an
  explicit close, `fullscreenOnMobile`) instead of collapsing into a
  bottom sheet.
- **GitHub issues** (`listGithubCandidates`, `importGithubIssue`,
  `listAutomationRules`, `saveAutomationRule`). One Build entry point with
  two tabs: Import now (manual pull while you watch) and Auto-import
  (per-project label watchers on BB's scheduler). Both share one matcher
  (`lib/automation-rules.mjs`, exact labels with AND semantics), one intent
  heuristic (`lib/github-intent.mjs`), and one creation path with a single
  `github_imports` dedupe claimed before any work starts — manual and
  automatic never draft the same `repo#number` twice, even racing. The
  dedupe reads liveness by card existence, never by a bare link: a link
  whose card is gone reads as not-imported everywhere (candidate list,
  tick, and import), so a deleted card's issue can come back instead of
  being offered as importable and then refused as in-flight forever. Each
  flow carries its own explicit Start immediately checkbox, both defaulting
  to parked Bucket drafts (creation dialogs default to started instead).
  Manual import adds one shared Isolated worktree checkbox
  (`components/isolated-worktree-check.tsx`, one copy source, progressive
  disclosure): checked workers start on a separate copy via the same
  isolation gate as rules, refused with the redirect when no New-worktree
  preset exists, and parked isolated imports pin their preset for the
  later Start.
  Rules cap at 10 drafts per tick. The list filters by every watched label
  plus project and assignee, and imported rows name the author, the card
  status, whether the completion was posted back, and possibly-related
  open issues by title overlap. Both tabs filter through one shared field
  set (`components/github-filter-fields.tsx`): label chips are the server
  query and re-search on every edit (emptying them clears instead of
  erroring), project and assignee narrow client-side, and every control
  shares one height with a visible label. The Auto tab scopes rules through
  its own project picker (defaulting to the board project, re-anchored on every
  open) — the dialog works from boards with no active project too. The save
  button names its project, so labels carried over from another project
  can never land a rule silently.
- **Automation rules.** Per-project watchers from the GitHub tab above:
  labels (comma-separated, all required, exact case), an optional author
  allowlist (empty means anyone; the plugin cannot see GitHub roles, so
  this is explicit logins only), an optional worker-instructions template
  appended to the issue prompt, plus start policy. Enabling a rule marks
  already-tagged issues as seen without drafting (backlog guard) — only
  genuinely new issues create cards; if GitHub is unreachable the rule is
  saved disabled instead of firing blind later. A dry-run preview names
  what would match now and exactly why the rest would not — including
  which project a foreign-repo issue belongs to, so a miss never reads
  as an empty watcher; each rule lists
  its recent runs with the per-run outcome (Started, Parked, Already
  imported). Auto-start is gated on the effective spawn environment
  (band routing wins over passed presets): without an isolated worktree
  destination it fails closed (save refuses, ticks park with the fix
  named). Rules never move cards, merge code, or import behind the user's
  back. The whole feature is one decoupled module set
  (`server/github-issues.ts` is the seam; migrations, the client bridge,
  the issue flow, the rules, the rule RPCs, the comment mirror, and the
  completion write-back are one slice each, `components/github/` the UI,
  pure core in `lib/`): evolve it
  there, and `STELOW_GITHUB_ISSUES=0` on the host switches off its
  scheduler, RPCs, and panel button without touching anything else.
  Operator guide (flows, trust model, kill switch, module map):
  [docs/github-issues.md](./docs/github-issues.md).
- **GitHub completion write-back** (`postGithubCompletion`). Completed cards
  imported from an issue offer one explicit Manage action: post a factual
  English summary (scopes/tasks, prompt) as an issue comment via the
  github plugin's own RPCs, optionally closing the issue behind the same
  confirm. Never automatic — Done in Stelow is not merged/deployed. The
  comment carries a hidden card marker that is verified back on the issue
  before counting as posted, so retries never double-post and a send
  without a visible comment reports itself instead of succeeding silently.
- **GitHub issue creation at card birth** (`createLinkedGithubIssue`). The
  Build creation dialog offers one opt-in checkbox (off by default) when the
  project has a mapped repo: the card is always created first, then `gh`
  creates the issue (same auth, no second token — taskboard's pattern) with
  a hidden card marker in the body, and the link lands in `github_imports`.
  Title and body only; a failed creation keeps the card and names the cause,
  and an uncertain write (response lost) reports itself under a
  machine-detectable `[STELOW_CREATE_OUTCOME_UNCERTAIN]` marker instead of
  inviting a double-creating retry. Already-linked cards return their link.
- **Done-note draft for GitHub** (`draftDoneComment`, `postIssueComment`).
  Completed cards with a linked issue offer "Draft GitHub comment…": the
  cheap generation preset (band fallback, same cascade as prose bursts)
  drafts a completion note from the card's scopes, generated on dialog open
  so tokens spend only on intent. The draft is fully editable, deliverable
  artifacts ride as a detachable checklist, and Post sends the final text
  through the human-gated comment RPC. The factual
  `postGithubCompletion` path stays untouched.
- **Linked discussion mirror** (`getLinkedDiscussion`, `postIssueComment`).
  Cards linked to an issue render a read-only Linked discussion section on
  every track: issue comments as a separate badged stream that never renders
  as agent chatter and never routes to the worker (external text is context,
  never instructions). Unlinked cards on a mapped project offer creation
  from the same section instead. Identity is a content fingerprint (the
  plugin type carries no comment ids), storage dedupes on it, edits/deletes
  upstream are not tracked. Fetched live on card open plus a 5-minute mirror
  poll for linked, non-terminal cards (terminal cards serve their frozen
  snapshot); new rows publish `github-discussion` so open details refresh.
  A composer posts back through `postIssueComment` behind an inline confirm
  naming the destination (`repo#number`, public and hard to undo) — human
  gesture only, payload validated server-side, mirror refreshed on success.
- **Manual Git changes from Done** (`publicationStatus`, `BuildDetailBody`). A
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
- **Interface Contrast contracts.** Validated decision receipts distinguish
  agent-authored evidence from human authority, preserve Shape and Scope Map
  versions, and carry explicit disposition routes. Scope X-ray is a read-only
  server projection of approved nodes, dependency edges, provenance, and
  freshness. Scope-map challenges name
  their destination and stale artifact set. Native `needs_input` boundaries
  preserve contract ID, boundary ID, versions, and answer schema so a stale
  answer cannot silently resume a run. Refactors with more than one delivery
  scope require an approved Scope Map before execution; one-scope refactors stay
  lightweight.
  A boundary question renders as the moment it records. A `reaction` boundary
  is captured **before** the agent has synthesised anything, so its option
  list is withheld and the card says why; a `confirmation` boundary is captured
  after synthesis and keeps its options. The boundary's `kind` is read from
  the `[Stelow boundary <id>]` marker the run already requires, and the framing
  is decided once in `lib/execution-boundary-marker` and sent to the card whole,
  so a question can no longer ask for a first reaction while listing the
  options that would replace it. A receipt naming a human decision reports the
  route's own stale-artifact set (the card used to be told nothing went stale),
  and the trail line says that `human` is not a stage. A run that is still
  moving says where its live step progress streams; a paused or finished one
  points nowhere. The runtime validator now covers every field the published
  schema declares — including `nextAction`, which a receipt must fill, since a
  receipt with no next move is not evidence.
- **Scope Mapping in Explore** (`scope-mapping`). Explore can run the
  `stelow-product-scope-mapping` method as one focused technique. It writes the
  readable `explore-scope-map.md` artifact first and may include validated
  `scope-map.json` evidence. The result stays a draft until an approval receipt
  exists; Explore never creates a second Build stage or execution lifecycle.
  See the [Interface Contrast and Scope Map guide](docs/interface-contrast.md).
- **Interface Contrast in Explore** (`interface-contrast`). Explore can run the
  reaction-first method as one focused technique: a bounded comparison against a
  preserved first reaction, ending in a recorded pick. The objection that kept
  this out — a decision needs an owner, and Explore has no `selection` stage —
  does not hold, because the Explore card detail already renders
  `DetailQuestionSections`, the same component Build cards use, so a structured
  question with options, per-option documents, previews and staleness works
  there today. What Explore cannot do is own a decision that becomes a build,
  which the technique's blurb says out loud. Explore also dispatches a skill
  rather than a recipe, so the Build track's capability gate never applies here.
  Its deliverable contract is derived from what the method actually produces, not
  from its wireframe sibling: a real contrast rendering is 380 words and
  table-free, so copying `interface-alternatives`' 800 words and 2 table rows
  would have failed correct work and stamped "missing or thin" on a document that
  is neither. The contract requires the three sections the method names —
  fixed constraints, evidence, next action — and at least two option headings,
  because a comparison with no options is not a comparison. That rule matches
  the stems real briefs use (`Option A` and `Proposal A` both occur, in the same
  document set on one card) rather than one spelling: requiring the word
  "Option" failed a faithful contrast that used "Proposal".
- **One deliverable filename per technique, read by everything.** The Explore
  deliverable is named once in the catalog (`primaryArtifact`) and resolved by
  one function, because four surfaces used to disagree about it: the prompt that
  tells the worker what to write honoured the declared name, while the card's
  declared capability, the review CLI's subject and the quality seal all assumed
  `explore-<id>.md`. For `scope-mapping`, which declares
  `explore-scope-map.md`, the worker wrote that name and the seal looked for a
  name that never existed — so the quality seal for that technique was silently
  dead, and declaring a `primaryArtifact` was exactly what killed it. The prompt
  now asks the same resolver the checks ask, so a technique cannot switch its own
  verification off by naming its own file.
- **An option's letter never routes it to a different option's section.** The
  letter fallback exists for a brief that names its options by letter alone
  (`## Proposal A`), and it must not fire on a heading that *describes* an
  option. On a real card it did: `Hybrid A+C` shares the letter `a` with
  `## Option A — Extend the existing Scope stage`, so clicking the hybrid
  scrolled to Option A, which was not even one of the offered choices. The route
  now fires only on a bare option marker — the letter plus generic marker words,
  nothing that could belong to a described option.
- **When a stage registers several documents, the one that names the options
  wins.** Manifest order is not evidence of which document a question is about.
  The `interface` stage on that card registered four entries, the first of which
  was a *different decision* — a placement contrast with two options, while the
  question offered three layouts and a hybrid living in a sibling file. The
  recovery took the first, so every option opened a document containing none of
  their content. Each candidate is now scored by how many of the ask's options it
  actually contains, with manifest order as the deterministic tie-break, so a
  stage with one document and an undecidable stage both behave exactly as before.
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
  track, and the lightweight lifecycle (Bucket / Doing / Done)
  plus worker bands come from the same module, never scattered ternaries.
- **Board** (`BoardPanel`, `moveCard`). Columns are workflow phases
  (Analysis/Planning/Execution/Review) + Done/Archived — the Bucket is not
  rendered as a column (its header button + gallery own it); cards sit in their
  stage's phase. The complete Build topology (inbox, phases, terminal
  outcomes, entry checkpoints, labels, and stage-to-column projection) is
  derived from one workflow catalog; Research/Explore own their separately
  derived Bucket/Doing/Done lifecycle. Columns collapse (persisted); cards
  move via drag-drop.
- **A drop that changes nothing changes nothing.** Dragging is the most
  accidental gesture in the UI, and `moveCard` was doing real work to a no-op:
  a card nudged a few pixels and released in its own column was rewritten to
  that column's *entry* stage, so a card being worked right now at `plan-gate`
  silently teleported back to `critique` — reporting success, with no confirm
  and nothing to undo. A move to the position the card already holds is now a
  silent no-op, and a move to a phase the card is already *inside* refuses,
  naming the stage it is at and the stage a re-entry would impose, pointing at
  the explicit restart affordance that confirms and says what it discards.
  Stage progress moves by doing the work. The terminality rule is now scoped
  to what actually protects state — nothing takes a card *out* of `archived`,
  while a card already there accepts a drop on its own column without stopping
  a worker for nothing. A genuine move into another phase is untouched.
- **One state language.** Build Kanban tiles and the open-card header use the
  same ordered pills: board location, lifecycle state, worker state, then
  workflow type. The components and tones are shared; a generic “Status”
  label and the stage-as-status variant are not shown on the board, so a
  card reads the same way before and after opening it. Tiles and the
  breadcrumb name the card's project in one muted line — context without
  clutter; list rows already carried it.
- **Bucket** (one word, every track). Captured, nothing running yet: a card sits there while it has no worker, and
  leaving it is what starts the card. The Bucket renders nowhere as a column — each track header offers it
  as a button (count included) opening an expanded gallery modal — fixed
  dimensions (70vw wide, 85dvh tall, internal scroll), the same board tiles at the board's own column bounds
  (240–320px, auto-fill per row, natural height — never stretched), filling left to right then down,
  vertical scroll. Creation dialogs link the same gallery from their
  "park in Bucket" copy through one shared opener; the checkbox word rides
  the board label map, never a pasted string. Moving a card that already has a
  worker into the Bucket is refused with a named exit (parking it would
  orphan the worker) — archive it or move it to a phase instead.
- **List view.** Same cards grouped by column, for narrow screens —
  on both boards, via a quiet icon toggle beside the filters (a view
  preference, not a CTA). Board filters are multi-select facets shared by
  every track: project, stage (canonical sequence, never just stages with
  cards), type, status, and activity as checkbox lists with removable
  pills, empty meaning all, toggled through one helper
  (`toggleFilterValue`, `matchesFilterValue`). The picked view (board, list, hill) persists
  per track in local storage — returning from a card restores it instead
  of resetting to board. Closed tiles and list rows name the executing
  scope in one shared pill (`DoingNowPill`, truncated with the full
  doing set one hover away) whenever the worker runs or waits — the same
  selection the detail "Doing now" line reads, defined once in
  `lib/doing-now.mjs`. The open card names the first in-progress scope
  explicitly, keeps each scope's own task list under `ScopesList`, and
  shows wall-clock elapsed time per scope plus the total window. Groups
  collapse per track (persisted; Archived starts collapsed). One shared
  row across tracks (Build geometry standard; strategy/technique rides
  the meta line).
- **Hill view (Build track).** The same filtered cards as dots on a figuring-out /
  executing curve, for the glanceable question columns can't answer — research
  and explore cards carry no scopes or workflow stages, so their toggles hide
  it rather than pile every dot at zero.
  Position derives from board data alone (task, scope, then stage
  fraction via `lib/hill-position.mjs`); x is exact and never jittered,
  so no card reads ahead of another — shared ratios genuinely coincide,
  and dot area grows with slice size so a 10-scope slice reads bigger
  than a 1-scope one at the same honest position. Dots sit exactly
  on one shared curve formula (line and dots read the same numbers, so
  nothing floats); crowding resolves into count pills anchored at their
  leftmost card. Click-only: a pile opens the shared card gallery modal
  (same tiles as the board, uniform grid, vertical scroll), and a lone dot
  opens its card directly. Hover never previews anything.
  The hill holds work only: archived cards are off it (they left the board
  and the workflow — with no rule they inherited a position from their old
  stage and read as "figuring out"/"executing"), and the status line counts
  Done cards as done, never as executing, so a board with nothing running
  can never read as executing. Only cards still in the workflow split across
  the two halves (`hillTally`, `isOnHill` in `lib/hill-position.mjs`).
  Progress never reads as a percentage anywhere — counts, bars, and region
  words instead. Curve
  draw, staggered entrances, and attention pulse animate under
  `prefers-reduced-motion` guards. Scope strips
  (`ScopeStrip`, shared by tiles and rows) and the build detail phase
  rail reuse the same counts, so progress reads as shape everywhere.
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
  Every track ends on a Stay in touch step: report a bug or idea through
  the plugin repo, optionally follow along on X and LinkedIn.
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
  surfaces where it is explained. Setup also checks the optional BB
  Workflows integration: it reports whether the built-in plugin is
  installed, enabled, and ready, explains the native-execution benefit,
  and offers an explicit install or enable action without hiding the
  sequential fallback. Inbox teaches with a ghost sample
  row instead of a seeded notification — no badge or history pollution.
- **Sidebar badge.** Unresolved actions and unread completions; it always
  agrees with the Inbox's primary **Needs attention** list. A completion is
  emerald review work, not an amber blocked workflow, and clears when its Done
  card is opened. Per-tab active counts (About carries no count, but carries
  an update badge when a plugin update is known). A tab count is the cards
  its own board holds: terminal outcomes are out, and so is the Bucket —
  the Bucket is not a rendered column and carries its own count on its own
  header button, so counting it made the Build tab read 5 beside a board
  holding one card, with the same parked card visible in two places.
  One shared update signal
  (BB candidate or newer GitHub release, `updateAvailableFrom`) drives the
  sidebar accessory, the About tab badge, the About header, and the status
  box from a single store: the first `buildInfo` read fills it, and a forced
  Check update or a post-apply read republishes it — a check inside About
  lights every surface at once instead of only the one that asked.
- **About tab** (`AboutPanel`). Two sections — Stelow (upstream) and this
  plugin — each with its own paragraph, repo link, and version side by
  side (`buildInfo` carries both; the upstream version syncs with the
  skills). The Stelow section opens with the identity mark, served lazily
  as a data URI over the `aboutLogo` RPC (bb serves only built bundles,
  never static files) with a silent text fallback. The plugin section shows the immutable Stelow version pinned into this plugin release (opening the vendored inventory grouped Workflow/Product), asks BB for the installed plugin's compatible update status, and offers an explicit confirmation before BB applies it. The update verdict renders as one tone-coded status box directly under the plugin title (`role="status"`) instead of a bare line: current, available, checking, not-BB-managed, and unreachable each name their state and the path forward. The box owns the whole update flow — verdict, the "Update plugin…" apply action (confirm/cancel in place), the reload warning, and the freshness check — so nothing cross-references a button living elsewhere. A failed fresh check keeps the last known verdict (`applyFailedCheck`) instead of erasing it — a transient registry blip never hides a real candidate — and the apply is timeboxed so the reload severs the RPC channel into an honest info-tone "reloading" message (`role="status"`, never red, never a stuck button) while genuine failures keep the error tone (`role="alert"`). The shared amber "↑" badge (`UpdateBadge`) marks update-available everywhere: sidebar accessory, About tab, About header, and as the status box's leading mark. Copy branches on install source (`isPathInstall`, unit-tested): path installs get the checkout pull + rebuild + reload path, every other source gets a no-checkout variant that never sends store users to a terminal. Installs BB cannot update (local checkouts) additionally learn the newest GitHub release from a fail-soft lookup (`lib/github-release.mjs`, supplement-only while BB offers no candidate), with a link and the checkout pull + rebuild + reload path — "Check update" re-reads both sources. The line always names the RUNNING build next to the published tag ("Running v0.50.0; v0.51.0 is published on GitHub"): naming only the published tag read as a claim about the install, so a checkout behind the release looked up to date. One comparison decides it (`updateComparison` in `lib/plugin-update.mjs`): current, behind, ahead, or unknown — an unparseable version or a failed lookup is unknown, never "up to date". Versions read as tags (`v0.20.0`), never raw commit shas; the confirmation names the installed and candidate versions, a "Last checked … · Check update" line forces a fresh check on demand, and update notices render with the verdict instead of below the description. The plugin section reads as three cards — Status (verdict, notices, freshness), Contents (what the plugin gives, skills pin beside the content it describes, team pointer), Resources & maintenance (repo link, Reset onboarding) — so version, freshness, and skills never scatter. A post-update read that fails during reload says the plugin is reloading instead of reporting a false failure. Mount-time reads share one in-flight check with a one-minute reuse window, so the sidebar and About never double-hit upstream resolution. Neither path mutates a running workflow before that confirmation. It also offers Reset onboarding (two-step
  confirm) to replay the first-visit setup dialogs. Work tracks describe
  themselves; product identity lives in exactly one place, never next
  to the wrong version. The plugin section also carries a one-line
  team pointer (experimental): single-user bb, one bb per teammate,
  GitHub as the team room, linking the site team section and
  `docs/team-playbook.md`.
- **BB Workflows status.** The About tab and first-visit setup identify the
  built-in Workflows plugin as installed, disabled, starting, or ready. The
  English explanation names durable native execution, resume, cancellation,
  structured outputs, and safe fan-out; explicit install or enable actions
  are shown only when the host needs them, while the sequential fallback stays
  visible.
- **Open on an execution run lands where you can see it.** Each run's **Open**
  deep-links into the card at that run, and the link now has an observable
  outcome. It used to have none: the scroll asked for the nearest block, which
  by definition moves nothing when the target is already on screen, and the
  focus was told not to scroll — so opening a run with the Execution runs
  section already visible produced no motion and no change at all. The card
  navigated; the reader saw precisely nothing. The run is now brought to the
  middle of the viewport every time and the opened row draws a ring, so *which*
  run is answered. The target is derived from one shared helper rather than
  hand-written: a run row names itself (`executionRunRowId`) and a link says
  where it aims (`executionRunFocus`), because borrowing the link's target for
  the row put `execution-needs-input-questions` on both the run row and the
  card's question section — two elements answering to one id, and a focus
  effect searching for a third thing, which is why a run waiting on a person
  navigated and then did nothing.
- **A run's row can answer why it failed.** A run row showed recipe, status and
  stage, and dropped every other field the RPC was already sending — the host's
  own run id, the failure reason, start and end times, whether this was a retry
  of an earlier one, which adapter ran it. So a card with two failed runs and
  two successful ones read as four undifferentiated lines, and the only way to
  learn why something failed was to leave the card and find the host's own
  transcript. Every row now carries a disclosure showing exactly those fields,
  and a run a deep link just opened starts expanded — the link exists because
  someone asked what happened to this run, so answering it with the status label
  the link replaced would be no answer at all. It stays closable, because a
  disclosure nobody can dismiss is a dialog. A run that failed with no recorded
  reason says exactly that rather than dressing the absence up as a cause, and
  durations use the card's shared `formatDuration` instead of a relative clock
  that re-bases every second and would make two runs disagree with each other
  as the page ages. The section header reports outcomes ("1 failed · 2
  succeeded") rather than an active count that reads "0 active" on a card whose
  four runs all finished.
- **Every fact on the card has exactly one home.** A summary strip was added to
  the top of the open card and then removed again, and the reason is the rule
  worth keeping. Its four fields were the blocker, the stage, the file count and
  the scope tally — and all four were already on the card in a better place: the
  hero's title is the authoritative state line ("Needs your decision — 2
  questions", "Working — Execution"), the progress disclosure's hint is the
  scope tally and its action button is the file count, both visible with those
  sections closed. So the strip added a fifteenth bordered box and a ninth
  border treatment to restate the card four times. The rule the hierarchy test
  pins: a fact stated at the top of the card must be stated where it is DECIDED,
  not where it is convenient, and nothing above a section may repeat what that
  section's own hint will already say.
- **Finished runs are history, so they collapse.** The run list was a
  permanently-open bordered box holding one bordered row per run, which meant a
  card with a dozen finished runs pushed everything below it a dozen rows down
  the page — on the card kind where people usually came for something else. It
  is a disclosure now: open while work is in flight, because then it is the live
  surface; closed once nothing is running, and open again when a deep link names
  a specific run. The outcome tally stays in the header, so closing it costs the
  reader the rows and not the facts.
- **A named vocabulary, and a design system that is a list of tests.** The
  chevron was already shared — twelve components imported it — which is exactly
  what hid the leak: eight of them still hand-rolled the whole pattern around it,
  with SEVEN different summary paddings between them, so the same accordion felt
  like a different control depending on which card it was in. And one constant
  literally named `DISCLOSURE_SUMMARY_CLASS` existed in two files with DIFFERENT
  contents, so the same "show more" rendered as a link in one place and as body
  text in another — the most expensive kind of duplication, because nothing in
  review catches a copy whose name says shared. Meanwhile `text-[11px]` appeared
  102 times: the card had a real type scale, invented by whoever needed a small
  section heading first, and therefore invisible to review, because a reviewer
  cannot check a rule that was never stated. There are three disclosure families
  now — SECTION, ROW, LINK — and five named type steps, each with the job that
  earns it. `TEXT_SECTION` sits at 11px, BELOW `TEXT_META` at 12px, because
  section headings are uppercase and letter-spaced and read smaller than body
  text while still commanding the eye; split those two halves and you get either
  loud headings or unreadable ones. The tab bar's 13px became `TEXT_TAB` rather
  than being forced onto a step that does not fit — a tab is a target, not a
  label, and it is a real fifth role that nobody had written down.
  A `DESIGN.md` was written as the index, and its own rule is that a design
  rule with no test does not belong in it — a sentence in markdown does not
  intercept a commit, and `AGENTS.md` has said "min-h-11, cursor-pointer" for a
  long time next to 76 raw buttons. A test does. The index itself then failed
  that rule: nothing loaded it, three of its five distinctive claims were
  already in the test docstrings, and it could name a test that no longer
  existed without failing. Its six lines of unique content live in `AGENTS.md`
  instead, which is the instruction file every session actually reads.
- **One surface, and one rule for opening.** The open card drew its sections
  eight different ways — `border p-3`, `border p-4`, `border bg-background/60`,
  `border bg-muted/20` — each written into whichever component needed it. Eight
  siblings that do not match do not read as eight sections of one thing; they
  read as eight unrelated panels, and the reader has to work out which matter
  from the decoration instead of the content. That is the surface half of a type
  scale, so it is a token now (`SECTION_SURFACE`) rather than a convention: one
  shape, and everything that makes a section differ is its TONE — a colour the
  reader already learned from the hero — never a different border. The hero
  keeps the card's one deliberate exception, more padding and a tone, and writes
  it as the token plus that exception. `BuildGaps` and the research and explore
  quality panels stopped being free-standing `border p-4` boxes, and the workflow
  map stopped hand-rolling its own `<details>`, chevron and background: a second
  implementation of the same pattern is correct only until one of them changes.
- **History does not get the first screen.** Progressive disclosure only works
  when the default is closed and the reader earns the opening, and half the
  sections were opening unconditionally. `startsOpen({ live, blocking })` names
  the only two exemptions — something happening right now, and something the
  reader is blocked on — and everything else is history that has to be asked
  for: the files the request NAMED, settled before the worker started; the
  workflow map, which describes stages rather than this card's state; the gaps a
  past run recorded; a quality panel whose verdict is "nothing to report". A
  preview opens while it is starting or running, because then it IS the live
  surface, and closes once it is up — its URL is in the header either way. Every
  count stays in the hint, so closing a section costs the reader the list and
  not the number.
- **Review tools lead a finished card.** The diff and the publication panel used
  to sit below Artifacts and the workflow map — six sections down, past the diff's
  own visibility gate — on the one card kind where they are the entire reason to
  open it. A completed card now leads with them; an in-flight card keeps them
  below, where there is nothing yet to review.
- **A failure reaches the card as the reason the host gave.** Found in
  production: card_k9gei1jy's own comment log read "Native scope-map failed with
  native status queued" and "Native interface-contrast failed with native status
  running" — two sentences that contradict themselves, from the same five lines.
  The reason is a four-link chain and the truth dies at the second link. The
  recipe script returns `{ state, error }` and `scriptOutcome` already folds the
  real message into `scriptError`; the reconciler typed the native status as
  `{ state: string }`, so the message was unreachable; it wrote the literal
  `unknown-native-state` at the one point where the state had just been matched
  from a known set; and the comment interpolated `run.nativeStatus` — the value
  BEFORE the transition — into a sentence about the one after. The signature
  carries the reason now, the code stores it once, and the log reads back the
  row it just wrote. When the host genuinely gives no reason, the card says
  "the host reported a failure without a reason", which is a gap about the
  reason and a different, true claim — not a claim about a state it just knew.
- **The card holding your file is a link, not a sentence.** A blocked card was
  told `held by card "Restore archived cards to board columns"`, and that was
  the whole of it: a reader who wanted to see what that card was doing to the
  file had to copy a display name and hunt it on a board of dozens, doing a
  join the system had already made and dropped. The record is the truth now
  (`lib/lock-blocked`): the sentence is derived from it, and the holder's id
  rides alongside in two columns, so the inbox row can link the blocker instead
  of re-finding the name in prose. A link parsed out of a sentence is a link
  that eventually points at the wrong card and fails by still looking right.
- **The card log is named for what it is.** The section was called
  "Conversation", hinted "talk to the agent", labelled its textarea "Write to the
  agent" and its button "Send to agent" — four names for a feature that is not a
  conversation. `addCardComment` writes with `target: "card"`: it appends a note
  to the card's log, which the worker reads on its next poll. There is no live
  channel, and a section promising one teaches people to wait for a reply that
  is not coming. It is "Notes for the agent" now, and the thread — which IS the
  real conversation — moved into the section HEADER, so it is one click away
  with the section still closed. The note composer stays: five words of
  course-correction do not justify losing your place on the card to go find a
  thread. Removed capability, none: the ambiguity was the feature.
- **Build stamp** (`buildInfo`). Both versions on the About tab so reloads are
  checkable instead of vibes.

## 3. Decide and unblock
*When the agent needs me, I want to answer or approve fast.*

- **Inbox** (`InboxPanel`, `listNotifications`). **Needs attention**
  (question/error/paused, whether already read), recent completions, an All-clear empty state,
  resolved history last, read; per-item **Mark as read** / **Show again**
  (the reversible pair, driven by read state); deep-links into card+event.
  The vocabulary is a notification's, never a card's: an item says
  **Set aside**, not *Archived*, and its filter is **Read**, not *Archived* —
  "archive" is a card's fate, and a button on a notice that reads as an
  action on the card it names is a wrong affordance. An item carries BOTH
  reversible actions, because **read and handled are different facts**: a read
  question that has not been answered still needs an answer, so it stays in
  **Needs attention** and in the badge, and the read button says so and names
  the Read filter as where it went. **Set aside** is the dismissal, with
  **Bring back** as its exit. Collapsing the two into one button made "Mark as
  read" read as broken — the item stayed and the badge did not move — which is
  a phantom affordance, so both are back. Marking read is a timestamp,
  reversible, and touches no card. The Resolved
  filter explains itself
  (needed-you-once, cleared on its own) and each row names HOW it cleared
  (answered, withdrawn, resumed, completed — recorded as `resolved_reason`
  where observed; legacy rows keep the generic kind label).
  The badge counts the same action and review requests shown by **Needs attention**;
  an unopened completion reads **Ready for review** — the request it actually is —
  until the Done card is opened, which is also what clears the card's Review
  check. Archiving a card closes EVERY open row, completions included, and
  completion does not. That asymmetry is the point: an archived card is off the
  board with its worker stopped, so an open review request for it is a
  notification demanding an action nobody can take, and it would hold the badge
  above zero forever. The rows are resolved rather than deleted, so a card
  archived before anyone reviewed it still shows in Resolved reading "Closed
  with the card" — the honest account. `read_at` is left alone throughout: a
  read is something a person did, and recording one for work nobody saw is the
  one lie this table must not tell. `hasPendingReview` therefore asks about
  `resolved_at` as well as `read_at`, since only a card's death ends a review,
  not an unread row — this is the card's own attention
  marker on the board.
  The toolbar is one row: four tabs with semantic status dots (amber waits,
  emerald resolved, zinc archived, primary all) and a single Unread-only
  checkbox — no detached Show label.
- **Severity tiers** (`lib/inbox-severity.mjs`). Needs attention sorts
  escalating first: stalls past 72h, repeated errors, and week-old actions
  outrank fresh items, each with reason chips (`stalled 3d`, `error ×2`)
  and an escalating mark. Tiers reorder only — the badge still counts
  every open action, resolved history stays chronological, and nothing is
  ever filtered or suppressed. Scored at event write, re-scored on the
  reconcile sweep; thresholds live in one file, no migration to retune.
- **Severity bump** (`maybeBumpSeverity`, Inbox severity router). With the
  router in Decision API mode, the reconcile sweep judges up to 3
  unjudged routine items per tick (older than 5 minutes) with one yes/no
  — confident blockers promote to escalating with a `model-judged` chip.
  Never demotes, resolves, or re-judges; failures keep deterministic
  tiers standing. An item with no reason list yet counts as unjudged, so
  the sweep reaches items the deterministic tiers wrote first.
- **Concurrency, before it collides.** Two scopes of one card fan out only when
  their transitive file sets are pairwise disjoint, and a scope that declared
  no `target_files` now **refuses the batch** rather than counting as an empty
  set: an unknown footprint is not a smaller one, and two unknown footprints
  are not known to be disjoint. That refusal carries its own code
  (`PARTITION_UNDECLARED`, naming the scopes) because it is a different fact
  from an overlap and a reader who cannot tell them apart cannot fix either.
  A single undeclared scope still runs — there is nothing for it to be
  disjoint from. On top of the same claim ledger the lock protocol already
  keeps, the card shows **Shared files**: which of its files another card also
  holds, which scope, and when the lease ends. It is the state *before* a
  collision, which the lock wall cannot report because it only speaks once one
  has happened; it renders nothing under a managed worktree — isolation is why
  there is nothing to say — and a lapsed lease is named as lapsed rather than
  shown as held.
- **Other agents in the same checkout.** The claim ledger can only see cards: a
  thread outside Stelow never acquires a claim. That is not a rare corner, because
  a card's spawn environment comes from its preset and the built-in fallback
  preset is `project-default` — the **shared project checkout** — so a host with
  no New-worktree preset configured puts every card in one working tree. The same
  **Shared files** section therefore carries a second, cross-thread half, and it
  is the half that finds the collision nobody claimed:
  - **Check for other agents** is a control, not a fact. It costs a
    `bb thread list --json` (~0.6s) plus one `git status` of the checkout, so it
    is spent when the reader asks and never on the open-card path.
  - A card in a **managed worktree** answers `isolated` before any subprocess, and
    the section does not render — isolation is the reason there is nothing to look
    for, and a scan that could never find anything is theatre that costs 700ms.
  - The host thread list is **cached for 30s**, because it is a fact about the
    host and not about a card; opening a card twice costs one call.
  - The answer names **who is here** and **which of the files you hold are dirty**,
    as two lines, and never says *which* agent touched *which* file — a shared
    working tree has no per-agent ownership, and inventing one would be a
    confident lie. So the lines read `src/a.ts is dirty in a shared working tree`.
    Only the **count** of other threads is reported, not their ids or titles: the
    count is what tells a reader whether to look further, and naming threads this
    check cannot attribute anything to would invite exactly the attribution the
    first bullet refuses.
  - The four questions are asked in **one order, and an unmeasurable fact
    outranks whatever sits behind it**. How many other agents share the checkout
    is a question about the host alone — it reads the cached list, costs no
    subprocess, and is true whatever this card holds — so it is asked first, and
    everything after it is only reachable if there is somebody to compare
    against. An empty checkout is therefore reported as `no-threads` whatever the
    card claims, and costs no `git status`. This ordering is load-bearing rather
    than cosmetic: claims are empty at rest, so a report that asked the file
    question first answered "nothing overlaps" for every card on the host and
    suppressed the thread count that was already sitting in the cached list.
  - **An answer nobody measured is named, never rendered as a clean one.** A card
    that has claimed no files gets `unknown-footprint` — *"1 other agent is in this
    checkout. This card has not claimed any files, so nothing here can say whether
    their work overlaps yours."* — and a claim ledger that could not be read lands
    on the same answer, because it measured nothing. `no-checkout` (a card with no
    checkout Stelow can read) and `unavailable` (a host that could not be read) say
    the same thing about themselves. The family is one exported list,
    `EXPOSURE_REASONS`, which the RPC schema, the server's type and this copy all
    derive from — a reason invented in one place and forgotten in another is a
    reason the reader is shown somebody else's answer for. `unreadable-tree`
    completes it: a working tree that could not be read is overlap-unknown, not
    overlap-none. None of them renders as *"No other agent is working in this
    checkout."*
  - The file list stays **this card's claims only**, intersected with what is dirty
    in the shared tree; it is never the whole dirty set.
  - Two declared limits. The on-disk `bb stelow lock` lives inside each card's own
    state directory, so by itself it gives **no cross-card protection** — it
    protects a card against its own repeat runs. And nothing here mediates a worker
    running `git reset --hard`, or any other command that rewrites a shared tree.
  - It is a **report, not a guard**: it refuses nothing, resolves nothing, and
    changes no decision.
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
- **File-claim coordination.** Cards sharing one checkout coordinate files
  through a workspace-level claim registry: `lock acquire` reserves the
  files, a card that hits another live card's file parks that scope (no
  retry loop) and gets a paused Inbox event naming the holder and the
  automatic unlock (release or lease expiry), and the host resumes exactly
  the waiting cards with an agent-only nudge when the files free. Done,
  archive, cancel, and delete release every claim; expired leases are
  reaped on the reconcile sweep.
- **A lock is visible on the card, not only in the Inbox.** The open card
  says which files a scope holds, by name, and which file another live card
  is holding from it. It used to say "files claimed" and never say which
  files, and it showed nothing at all about the case a reader most needs —
  another card is holding a file this one is waiting on — while the Inbox,
  on another screen, knew all of it. One read now feeds both: the claim
  room (`lib/scope-claim-room.mjs`) names in one pass what a scope holds
  and what it cannot have, so the card can never show a scope holding a
  file it is also waiting on, and `lib/lock-blocked.mjs` derives the
  Inbox row, the card's wait, and the scope line from that same record
  rather than each writing its own sentence. A card blocked by contention
  says so in the hero — it is paused on another card, not stalled — with
  the holder named, and the scope line marks the wait in amber instead of
  the muted grey that "files claimed" and "no live file claim" once shared,
  which made a defect read as a footnote. A scope with no state dir has an
  unknown claim, and unknown is never a fault.
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
  submit answers everything — one worker resume, one inbox resolution. The
  final submit action appears only on the last step and remains unavailable
  until every question has a decision (answer or explicit Skip); timed-out
  batches follow the same all-or-nothing rule, so recovery never resumes work
  from partial context.
  Workers batch independent questions into one `bb stelow ask` call
  (repeat `--question` groups; `--multiple` also accepts the unambiguous
  mode-first form used after a tag); dependent questions stay sequential.
  Timed-out asks stay answerable on the card, batched the same way.
  **Answering is also programmatic**: `bb stelow answer --card <card_id>
  --question <question_id> --answer <text>` (repeat pairs; one
  `--question` may take several `--answer` values for a multi-select)
  applies the card form's exact rules — atomic per door, contract consumed,
  outcome written to the trail, worker resumed — so a scripted run or a test
  can clear a wait without a browser. A recovery question is addressed as
  `expired:<id>`; live and recovery questions are answered in separate calls
  because each door answers its own set atomically. An unknown flag refuses
  rather than being ignored, so a typo cannot answer the wrong question.
  A group may declare its question contract (`--contract <id>`, validated
  against the stage checklist, recorded raw when unreadable); answers
  matching a declaration name it in the trail, undeclared flows behave
  exactly as before.
  A short preview renders INLINE with no click: on a real card the previews were 27-104 characters and every one sat behind a disclosure, so clicking revealed two lines that said no more than the label beside it — two clicks for less information. A preview exists so a reader can judge an option without opening anything, and a long brief still collapses. The staleness notice leads with what it MEANS ("a document this relies on was revised — check it before answering") and collapses the touched file paths behind a "N files touched" summary, so a seven-path list no longer pushes the question off the screen. Options carry descriptions plus optional detail: `preview` (inline
  glance, expandable) and `artifact` (workspace-relative path opening in
  the viewer on cards, plain filename in threads). Workers attach them
  per option (`--desc/--preview/--artifact`); unresolvable paths degrade
  to no affordance and never block answering. Within one question, an
  option that carries no artifact inherits the first one attached to a
  sibling, so the approval option is never the only one blind to the
  document under decision (`inheritAskArtifact`, unit-tested); options
  with their own documents — competing proposals — keep them. An inherited
  document is LABELLED as such: the control reads "Shared brief: <file>"
  rather than "Open document", because a filename hidden in a hover-only
  tooltip is not a label, and the same brief on four rows reads as four
  pieces of evidence about four different options. Options that brought their
  own document say so instead. The same marking covers BOTH ways a document
  reaches an option it was never attached to — the sibling inheritance and
  the stage-manifest recovery that fires when an ask carries nothing at all.
  Marking only the first fixed nothing: on a real card the worker attached no
  document, the host injected the stage's own `interfaces.md` into all four
  options, and every row claimed it as its own evidence.
- **An option opens at its own section.** A combined brief holds every
  proposal in one file, so opening it from an option landed on the first line
  — which is precisely not that option. On a real card a reader opened the
  brief from "Hybrid A+C" and found proposals A and B: the hybrid is the last
  section in the file, below three options they did not pick. The viewer now
  scrolls to that option's own heading, so the brief still reads as one
  document instead of a quotation above a copy of it. The rendered headings
  carry no ids, but the host did render them as heading elements inside the
  document's own scroll container, so one scroll finds them. Matching is on
  words with three routes — the heading carries the label, the label carries
  the heading (a brief that only wrote "## Proposal A"), or both name the same
  option letter — and no section at all means nothing is shown, never another
  option's words under this option's name. The same matcher decides both the
  text scan and the comparison against the rendered heading, so the scroll
  cannot disagree with the anchor it follows. When the heading is absent from
  the rendered DOM — a non-markdown file, a renderer that flattens headings, a
  partial load — the option's section is lifted and shown above the document
  instead, so the reader gets their option by either route.
  Option
  shapes mirror the
  Option schema in upstream `ask-patterns.md` — one concept, two repos.
  Path validity has one pure definition (`normalizeAskArtifactPath`,
  unit-tested) shared by parser, server, and thread renderer.
- **Gate approvals** (`approveGate`). Product/interface/plan/diff gates
  with receipt files; review entry surfaces the artifact under decision. The
  check walks the workflow's whole state dir, so the spec the layout wrote to
  `plans/spec-product_<v>.md` is found: “the gate artifact does not exist
  yet” now means the document really is missing.
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
  `Completed`. A parked Bucket card claims no checkpoint it never reached and
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
- **Workflow progress** (`ScopeProgress`, `ScopesList`, `StageTimeline`) sits beside the
  **Workflow map** as two sibling sections that never pretend to be each
  other: progress is where this card is, the map is what each stage does.
  Before scopes exist the live checkpoint pill rides the subtitle line
  (`where this card is · ● Plan gate`), never a detached floating hint —
  element hints render without truncation so the pill ring is never clipped.
  A progress hero shows scope/task bars with counts (never percentages), what is doing
  now, and what is blocked — above the per-scope detail.
  Scopes in dependency order with task counts, blockers, 17-stage timeline with
  position/next stages, manual advance/return behind a preview dialog
  (what the target stage produces). Entering execution with zero synced
  scopes while spec-tech carries scope blocks refuses loud instead of
  running untracked (`executionScopeRefusal`, `doneScopeSyncRefusal` in
  `lib/spec-scope-reader.mjs` + `lib/completion.mjs`): a spec written with
  human headings (`### SCOPE-N:`) instead of machine blocks (`[SCOPE-N]`)
  is refused with the rewrite + `bb stelow sync-scopes` redirect, and
  `blockedBy` cycles refuse naming the loop instead of stalling. Scopes
  order contractually (`trackable-relations`): start needs finished
  dependencies, close needs no open tasks — `done` refuses otherwise with
  the marking redirect. Planned
  tasks from the spec's Task/Done Criterion tables enrich synced scopes at
  read time (`mergePlannedTasks`, tracked tasks win, nothing invented), so
  acceptance criteria surface as task notes; the card detail also reports
  scope-sync health (`scopeSync`: spec file, machine/human block counts,
  synced count) and the panel names an unsynced card instead of rendering
  it empty. **A card with no scopes is only a fault when a spec said there
  should be some** (`scopeSyncNotice`, from `diagnoseScopeSync`): a card
  whose spec is missing (`no-spec`) or carries no scope blocks yet
  (`no-blocks`) is silent, and only `unsynced` and `human-dialect` name a
  fault and the way out of it. Emptiness is not evidence — an
  investigation that reached audit without ever planning has no tech spec,
  and telling its reader their planning used headings instead of machine
  blocks accuses them of a spec that never existed. That is what the panel
  used to say, from a rule that read the current stage and nothing else.
  One fact, one representation: the classification is the decision, decided
  once in `lib/scope-sync-notice.mjs`, and the panel reads it.
  Workers mark scopes through `bb stelow scope <start|done>`
  (single writer: terminality, containment, and dependency order validated
  before commit; writes refresh the card and trail the decision).
  Every scope projects its machine evidence beside the plan:
  acceptance criteria from `scopes/{scope-id}.json` (expandable per scope),
  the Record mirror (verified verdict, file/command counts), live file-claim
  state, and k8s-style conditions (`UnverifiedClose`, `NoRecord`,
  `ContractMissing`, `OpenChildrenOnClose`, `BlockedByOpen`,
  `DanglingDependency`, `UnclaimedExecution`, `ClaimLapsed`) derived generically per kind
  (`trackable-evidence` over a flattened id registry, sidecar paths resolved
  from the contracts table) — a scope done with an unverified Record blocks `done`
  with the checklist redirect. All derived paths (plans, scopes, context)
  resolve through one layout rule (state-dir areas), so `state.md`,
  `stelow.json`, and every other artifact share the same naming strategy
  instead of per-callsite joins. The timeline never paints everything
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
  produced artifact cannot be invisible. That search walks the state dir
  through the one `listNestedFiles` walk the board also uses, so a document
  one level down — `plans/`, `reviews/`, `critiques/` — is found the same way
  the board finds it, instead of a top-level-only listing that left the card
  and the board disagreeing about the same directory. The workflow's own
  `state.md`, its
  backups, logs, and JSON bookkeeping are never artifacts. Machine receipts
  (`audit-trail.md`, `recon-receipt.json`) group apart under **Evidence —
  machine receipts**: they stay in the run bundle, manifest, and commit
  trailer for audit, but never inflate the deliverable file count, never
  serve as the review document, and carry the `evidence` role
  (`artifactRole`, `splitArtifactsByRole` in `lib/artifact-roles.mjs`) —
  the host's `audit.md` stays a deliverable beside them.
- **Diff review** (`cardDiff`, host `experimental_Diff`). The working
  tree vs HEAD, per file, inside the card — on active cards at the
  diff-gate and audit stages, plus completed cards whose tree went dirty
  again (pending changes stay reviewable while the commit action lives
  in Git changes). Otherwise Git changes alone owns Done. Untracked
  files open in the viewer; non-repos and
  clean trees state so explicitly. Read-only: never stages, never
  mutates the index.
- **Diff test and quality signals** (`formatAffectedTests`,
  `formatTestGate`, `formatQualityGate`). Below the entity and symbol
  lines, the Diff panel names the affected tests to run first (`sem`),
  the pending test obligations, and the quality gate verdict (`ripwire`)
  — each as one fail-soft line that stays hidden when its tool is
  absent, so a tree with no signal never reads as an error.
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
  also offers one-click install (explicit consent, SHA-256 verified versioned installers,
  pinned npm/Go versions, an isolated installer environment, ~/.local/bin, verified by re-probe) with per-row error + log, plus
  one-click reinstall-as-update for installed tools. A separate "Ready via
  npx" group discloses the on-demand dependencies (skills hub, ctx7,
  agent-reach, last30days, thermo-nuclear) with usage and consent rules — info only,
  no commands shown, no buttons. When `sem` is installed on the host, a one-line
  entity summary (added/modified/deleted/renamed, cosmetic-only flag)
  heads the file list — absent otherwise, never an error. When `cymbal`
  is installed, a second line lists changed symbols with caller impact
  (blast radius at a glance) under the same fail-soft rule.
- **Portable reconnaissance receipts** (`recon.sh`, `RECON_PROTOCOL`,
  `reconReceiptStatus`). Stelow preflights optional analysis tools from the
  target Git workspace and writes `context/recon-receipt.json`; BB injects the
  portable contract at workflow handoff and shows a non-blocking audit warning
  when a completed Build card lacks a valid receipt. The warning names
  itself advisory (the audit still verified the tree), says what to do
  (run the recon preflight before the next audit), and pre-receipt cards
  always read that way — a missing snapshot is never presented as a failure.
- **Worker section** (`WorkerSection`, always visible right under the
  hero in both tracks): preset pill + provider/model + inline note
  (applies to the next worker — Resume keeps the current one); completed
  cards instead show the preset recorded for their completed worker, real
  "Change preset…" outline button, stale-preset warning with restart
  action, then a divider with recovery/danger actions — restart fresh,
  archive, delete archived cards behind confirms — all real outline
  buttons, archive/delete in destructive tone. Worker history collapses
  inside the same section; GitHub import/completion lives here too
  (build only). Every card names its checkout in one stored word
  (`environment_label`: isolated worktree, shared checkout, BB-managed,
  exploratory) plus the live branch on build cards — no guessing from
  paths. Branch choice at creation stays BB's composer (project,
  environment, branch forwarded unchanged); Stelow never re-picks it.
- **Conversation.** Card/agent comment thread + composer that routes to
  the worker.
- **Thread embeds.** Card drawer inside threads
  (`stelow-card-detail`), "Open Stelow" header action,
  `stelow-artifact` and `stelow-quality` message chips, blocking question
  form. Chips validate untrusted paths, show the original directive when
  malformed, and mark host-refused file links unavailable instead of
  pretending they opened. The command palette offers Stelow: open card for
  this thread from any worker thread — the drawer resolves the thread to its
  owning card, and says plainly when the thread is not a Stelow worker.

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
  manual Retry/Restart reseeds the budget. With the Auto-continue router
  in Decision API mode, a confident "no real progress" judgment vetoes the
  resume (the card pauses instead); every other outcome keeps the
  heuristic standing — the veto saves turns, never spends them.
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
  comments kept. Resolves the reliable-tier preset like any fresh start
  (card pin, reliable override, band, default). A reseed restarts the
  workflow, not the human's review choices: the card's current appetite
  and gate set carry over.
- **Worker ledger + lineage** (`worker-ledger`, `workflow-lineage`).
  Every worker thread recorded; mirrored into the workflow's own
  `stelow.json` so history survives plugin DB loss.
- **Provider token usage.** Each worker-history row shows BB's latest
  provider-reported token total when available. Missing provider data stays
  hidden rather than presenting a misleading zero or an estimate. The
  history summary adds one card total across all workers and children
  (`totalTokenUsage`, unknowns skipped, all-unknown hidden). Each entry
  also carries its provider split (input, output, cached, reasoning via
  `tokenBreakdownFromEvents`, summed per card with `sumTokenBreakdowns`);
  the history shows reported legs labeled (`in · out · cached ·
  reasoning`), omitting unreported legs instead of zeroing them.
- **Child threads.** Workers that fan work out to fresh BB child threads
  (same contract as subagents: fresh context, no sibling communication,
  one owned output file each) show each child under its worker row with
  title, status, provider, per-child token total, and an Open link — the parent still owns
  synthesis. Threads without children render exactly as before.
- **Preset-staleness detection.** Cards whose worker predates a preset
  change offer Restart instead of Resume.
- **Archive card** (`cancelCard`). Stops + archives the worker; history
  preserved. Behind a confirm dialog. Drag-to-archived stops the worker
  identically (shared shutdown) — parking never orphans a running
  worker. Archived is terminal: settling worker threads can never flip
  the card back (single `updateCard` rule, re-checked at write time), and
  every worker-touching RPC (move, advance, answers, comments, strategies)
  refuses archived cards with the named exit. Archived cards offer Delete
  instead of a redundant Archive. Delete removes the rows plus the card's
  `.stelow` run files (no orphaned artifacts on disk); Git checkouts are
  never touched, so code changes survive the delete — the confirm dialog
  states exactly that.
- **Delete all archived, scoped to the filter**
  (`deleteArchivedCards`, `lib/board-filter-label.mjs`,
  `lib/bulk-delete-outcome.mjs`). The Archived column of every board carries a
  small ghost button beside its count, hidden when the column is empty, behind
  a confirm dialog. The blast radius is the column **as filtered** — the same
  cards on screen — and the dialog names that filter, so an intentional narrow
  delete never reads as a wide one. The client sends the exact ids it was
  showing, so the set cannot widen between the dialog and the click, and each
  card still goes through the single-card delete, so a stale panel cannot
  destroy a live card. Every id comes back accounted for: a card whose native
  run refuses to stop is reported **with its reason** while the rest still
  delete, because a bulk action that reported only "done" would leave the
  reader looking at a non-empty column and believing it was empty. There is no
  undo, and a card's trail comment dies with the card exactly as it does for a
  single delete — the report is the record, and it carries the counts. The RPC's
  200-id cap is a request-size guard, not a product limit, so the client
  **batches** and stays accountable across batches: a batch that fails at the
  transport level is reported as unaccounted rather than dropped. The confirm
  dialog stays open while the work runs, so "Working…" shows and the button
  cannot be fired twice over a stale id list — a column of hundreds takes long
  enough that silence reads as a hang.
- **Discard work** (`discardPreview`, `discardCardChanges`,
  `lib/discard-policy.mjs`). Archive parks with the work intact; discard
  destroys unpushed work, then archives. Manage offers it on live and
  archived cards (never completed/blocked); a preview first proves what
  would happen — worktree drop, branch reset to the parent of the first
  card-era commit, or exploratory folder delete — with file and commit
  counts, and refuses honestly otherwise (pushed history, shared branch
  line, detached HEAD, clean checkout). The confirm dialog states the
  exact blast radius in English before anything runs; execution stops the
  worker, re-validates the checkout, verifies the result, and leaves an
  agent comment as the trail.
- **Delete archived card** (`deleteCard`). Hard delete offered only on
  archived cards from Manage, behind an English confirm dialog. Removes
  the card row plus comments, presets, questions, inbox events, and
  ledger rows; stops + archives the worker thread.
- **Restore archived card** (`restoreCard`,
  `lib/card-restore-pending.mjs`). The only door out of Archived, and
  only a person can open it: a confirmed Manage menu entry (never
  prominent, never a drag — dragging an archived card still refuses).
  The card returns to the exact stage it was archived from with a fresh
  worker; the previous thread stays in Worker history. Pending items
  return per kind — errors return carrying the stored `last_error`
  verbatim, pauses re-derive from live state, completed deliveries stay
  read — while **questions are withheld, and counted as
  `questionsWithheld`**. A question belongs to the worker that asked it:
  its identity is a thread interaction, and restore starts a fresh worker
  on purpose. That worker's first question sync resolves the row as
  `superseded` regardless, so reopening it bought a badge that appeared
  and vanished a second later and an answer aimed at a thread with none
  of the context the question was asked in. The withheld count is
  trailed on the card with its exit ("the worker re-asks anything it
  still needs a decision on"), so nothing disappears without a stated
  reason. This is the one deliberate narrowing of the never-a-partial-
  restore rule, and the test names it. If the fresh spawn fails, the
  status rolls back instead of leaving a phantom wait.

  *Proven against the live database, 2026-09-28* (`card_19ny9eq3`, the
  accidental test archive, reproduced by `tests/fixtures/restore-dogfood.mjs`
  on a `.backup` snapshot of `~/.bb/plugins/stelow/data.db`, inside a
  transaction that is rolled back; the second, real-RPC run and the invariant
  that could not hold are in [`docs/restore-dogfood.md`](docs/restore-dogfood.md)).
  Before: `status=archived`,
  `stage=triage`, 13 events — 11 errors and 2 questions, all resolved,
  reasons `{superseded ×12, archived ×1}`; globals 66 cards / 65 archived /
  341 events / 9 unresolved. `restoreTargetStatus("triage")` → `draft`, and
  the archive-resolved rows are exactly one question. Result under the
  current contract: `questionsReopened: 0, questionsWithheld: 1,
  errorsReopened: 0, pausedReopened: 0, completedReopened: 0` —
  `evt_yclvhua2` stays resolved as `archived` (see below), the 12 rows
  resolved before the archive stay resolved, no event is created or
  deleted, globals unchanged, and the live database is left
  byte-for-byte as found. The same run originally returned
  `questionsReopened: 1` with the question reopened, which the dogfood
  in [`docs/restore-dogfood.md`](docs/restore-dogfood.md) then showed
  being superseded a second later by the fresh worker; the question is
  now withheld instead.

  What this fixture does **not** prove: the host half. The status flip and
  the fresh worker spawn both need a running bb host, so "a new worker" is
  still unverified against a real host. And because no error on this card
  was resolved *by the archive*, the verbatim-`last_error` revival path is
  untested here — the unit tests cover it, this card cannot.
- **Failure cause** (`workerFailureCause`, `lib/worker-failure.mjs`).
  A worker that dies before producing output (e.g. a provider 400 on the
  first inference call) arrives with no error text; the latest
  `provider/error` detail is resolved once and stored as the card's
  `last_error`, so the Failed pill, the detail hero, and the inbox event
  name the cause instead of going blank.
- **Self-healing** (`syncThreadState`, 45s reconcile sweep, thread
  idle/active/failed events). Suspicious idle and stalls surface as
  paused with exactly one inbox event per idle period. A pause open past
  3 days gets its event reworded with the age (`Stalled Nd`, same row —
  cards never move columns for going quiet). No-op polls
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
  scrolls instead of overflowing the viewport. Creation sits with the
  list — count + New preset in one header row, the form directly below,
  auto-scrolled into view on open — so authoring never strands below
  the routing disclosures.
- **Per-phase presets** (`listBandPresets`, `setBandPreset`).
  Analysis/planning/execution/review bands auto-swap workers at
  boundaries; unset bands inherit the card preset. Research and Explore
  have their own band defaults, configured from each board's Agent
  Presets entry (fall back to the board default when unset).
- **Per-card override** (`assignPreset`). Pinned preset for one card;
  takes effect on (re)start, with a stale-worker warning until then.
- **Reliable-tier override** (`getReliablePreset`, `assignReliablePreset`,
  `reliable_preset` table). One optional board-level preset for reliable-tier
  spawns (worker starts, restarts, band swaps, research fan-out, automation
  drafts): card pins still win, a set override replaces the band preset,
  empty means the band preset. Same singleton discipline as the generation
  and reviewer designations; the draft-burst band fallback stays pure band.
- **Board defaults** (`boardWorkflowDefaults`). Planning depth and
  your review gates remembered across cards. Legacy ladder rungs migrate
  to their gate sets explicitly — a saved default never degrades to Auto.
- **Decision API** (`getDecisionApiConfig`, `setDecisionApiConfig`,
  `testDecisionApi`, `decision_api_config` table). One decision endpoint
  for every decision router, configured once in Manage agent presets.
  Two providers: `jev` (state + questions schema, key required) and
  `classifier` (classifier.dev labels schema, keyless, Choice only).
  Reads report key presence and source, never
  the key; `DECISION_API_KEY` (or `TYPESAFE_API_KEY`) overrides the stored
  value. A key saved here is the key every decision router uses unless the
  router pins its own. Test connection sends one fixed probe with latency.
  Unconfigured means built-in rules everywhere. `STELOW_DECISION_API=0` on the host
  blocks every outbound call: reads degrade, api writes and probes refuse
  naming the variable. A stored key also means a stored key is spent: a host
  whose endpoint has gone stale pays one real outbound call per auto-continue
  veto and per inbox-severity tick, each failing soft to the built-in rules.
  Set the kill switch to stop the calls as well as the writes.
- **Decision routers** (`getDecisionPoint`, `setDecisionPoint`,
  `listDecisionPoints`, `decision_points` table, `lib/decision-points.mjs`).
  Per-judgment modes — Built-in rules (no extra calls, default), Decision
  API with a confidence floor, or Preset judge — plus the shared typed client
  (`lib/decision-api.mjs`, fail-soft result objects, never throws). The
  endpoint, key, and model live once in the Decision API section above;
  routers only pick a mode, a confidence floor, or a judge preset — any
  provider preset, including one no stage uses — via one hidden thread with
  a strict-JSON verdict contract (`lib/preset-judge.mjs`); failures fall
  back to built-in rules. Preset judging is offered only on low-frequency
  points (triage intent, artifact criteria); hot paths stay on rules/api
  so judgments never burn worker turns. Mode selection stages locally and
  saves explicitly; saves refresh only the routers section, never the
  board. Triage intent seeds a build card's intent before triage when
  confident; the worker always re-settles it, so the seed is advisory.
  Unknown modes degrade to rules; refusals name the valid set.
- **One disclosure affordance** (`DisclosureSection`, `DisclosureChevron`).
  Every collapsible shares one bordered disclosure (right chevron when
  closed, rotates down when open); native details/summary keeps the
  accessible state, the chevron mirrors it visually. `SettingsSection`
  visibly groups any revealed configuration controls with their heading.

## 7. Command and embed
*When I am an agent, CLI, or another surface, I want the same power.*

- **`bb stelow` CLI.** status, ask, seed, advance, doctor, preset management,
  fan-out, verify, review. `help [command]` prints one command's contract
  from the same table that registers it, and an unknown command suggests
  the nearest name instead of a bare usage dump. Advance mechanics delegate to the upstream `stelow`
  helper and skills pinned together at plugin release (no fork and no runtime
  mutation); transitions always resolve from
  the vendored copy. `seed` refuses card workers (`lib/card-seed-guard.mjs`):
  their workflow is pre-seeded at spawn with the card id as owner, and a
  second seed would orphan a name-derived workflow at the project root —
  the refusal redirects to the card's own state dir.
- **Board document read** (`findArtifacts`, `bb stelow status --json`). A
  workflow's documents come from a walk of its whole state dir, not of the
  top level: the layout puts the machine artifacts one level down
  (`plans/spec-product_<v>.md`, `plans/spec-tech_<v>.md`, `context/`,
  `reviews/`, a nested card dir), so a flat listing hid every one of them and
  published the bookkeeping sitting beside them. The deliverable bar is the
  manifest's own (`isDeliverableArtifactPath`): `state.md` and its backups,
  `drafts/`, and non-Markdown receipts stay out, judged on the
  state-dir-relative path, so the board and the card name the same documents.
  A nested area the host cannot list contributes nothing rather than failing
  the read — a half-written workspace still reads as a board.
- **Worker self-check** (`bb stelow verify [--card] [--tests] [--json]`). The same
  predicates the sync gate enforces, runnable by the worker before
  finishing: per-round PASS/FAIL for research, artifact check for
  explore, machine-readable JSON on request. Build `--tests` runs only the
  checkout's conventional test command (no shell text from the card) and
  records command, exit, output digest, Git root, and HEAD in a host ledger
  (`lib/audit-verification.mjs`); `done` accepts only a passing run at the
  audited HEAD. Prompts require it; the
  sync stays the backstop — prompt, CLI, and gate share one definition
  of PASS (`lib/research-artifacts.mjs`). Table-column checks
  (`table-columns`, `lib/artifact-validation.mjs`): the tech plan must
  carry a task table with a Done Criterion column — a passing prose
  mention no longer satisfies per-scope acceptance.
- **Live scope refresh** (`bb stelow sync-scopes`). Tracking edits are file
  writes the host cannot watch, so the sync doubles as the refresh signal:
  the executor runs it after appending discovered tasks or flipping task
  status, and the host publishes `card-state`/`board-changed` — progress,
  list, and counts reload instead of waiting for the next lifecycle event.
  Re-syncs preserve host/worker overlay (audit-gap scopes, discovered
  tasks) instead of replacing it.
- **Commit trailer manifest** (`bb stelow manifest [--json] [--card]`, `lib/artifact-manifest.mjs`).
  Commits cannot carry file attachments, so the durable audit link is a
  paste-ready `Stelow-Artifacts:` trailer block (card id, registered
  artifact paths, gap counts). The worker protocol requires pasting it
  below the commit subject.
- **Run-bundle export** (`bb stelow export [--json] [--check] [--card] [--dir]`, `lib/run-bundle.mjs`).
  Copies the registered artifacts into flat `docs/runs/<card>/` plus a
  `manifest.md` (SHA-8 per file, gap counts, embedded trailer, missing
  entries listed). Idempotent, path-confined to the workspace, stable
  basenames (a repeated name gets a stage prefix, never an overwrite). The
  host refreshes the bundle automatically on every `done` and prints the
  trailer in the completion output — a reopened card that completes again
  refreshes it again — so the directory converges instead of rotting. The
  worker commits the directory with the work — git log versions it, no
  per-commit subdirectories; the protocol is commit → trailer on every
  commit. Nothing registered means nothing written: an empty bundle is
  skipped with "nothing to bundle" instead of an empty commit. Between
  completions, `export --check` reports changed, unreadable, newly
  registered, and uncommitted sources without writing anything (read-only
  `git status` on the bundle dir; no repo means "workspace only").
- **Delegated draft bursts** (`bb stelow draft --prompt`, `lib/draft-burst.mjs`).
  Tier G: disposable text-in/text-out on the generation preset (board
  default, cascade board → band with a reserved card pin), judged 100%
  by the card worker before use. Hidden thread, 3-minute budget,
  full→accept-edits coercion,
  stopped afterwards, record in `drafts/`. Anything needing tools, exact
  shapes, or multi-step work stays Tier R (band preset) — the draft
  prompt forbids files, commands, questions, and advances. Same command
  on research, explore, and build cards. Draft records live under
  `drafts/` — disposable scratch, exempt from the unregistered list and
  the strict audit gate, so a burst never blocks `done`.
- **Delegation registry** (`lib/delegation-map.mjs`). Every LLM/thread
  contact point registered once (site, tier, preset source, spawn path,
  writes, judge): draft bursts and card titles on Generation, reviews on
  the reviewer preset, preset judges direct, worker spawns documented on
  their own cascade. Disposable spawns validate before any SDK call
  (known site, hidden, never full permission); a new spawn site without
  a `delegation-site` marker fails the topology pin.
- **Automatic card titles + inline rename** (`renameCard`). Creation keeps
  the instant prompt-derived heuristic, then a Generation burst proposes
  a ≤60-char title fire-and-forget — silent on failure, never overwriting
  a human rename that landed mid-flight. The open-card breadcrumb edits
  inline with explicit Save/Cancel; blank restores the heuristic.
- **Fresh-context spawn contract** (`tests/spawn-freshness.test.mjs`).
  Six spawn sites pinned; no fork/history inheritance in any spawn block
  (`previousThreadId` travels only as a reference string beside an
  explicit `bb thread output` retrieval, never as spawn identity);
  disposable spawns build prompts through the leashed lib builders and
  stay hidden; `CARD_OWNER_RULES` teaches fresh delegation (full task in
  the call, never a fork, never sibling chatter).
- **Runtime dir stays out of git** (`withRuntimeIgnoreEntry`, `lib/card-seed-guard.mjs`).
  Seeding a git checkout appends `.stelow/` to its `.gitignore` (best-effort,
  never blocks): live per-card runs must never be swept in by a worker
  `git add -A` — the committed record is the exported bundle.
- **Explicit completion** (`bb stelow done [--card]`, `lib/completion.mjs`).
  Done-ness was inferred from `audit` + idle, so narrate-and-stop looked
  identical to stuck. The worker commits; the host verifies in code —
  build only at `audit`, with every scope done, completed, or explicitly
  skipped (open scopes refuse, naming each one — done certifies finished
  work, not walked-past work), research/explore only with a passing `verify`
  and no pending question. The same reading governs the audit-gap rework
  gate: a rework scope the audit deliberately set aside is `skipped`, which
  is resolved, so it never appears in the "still open" refusal — a card
  whose whole finding was "obsolete as a rework scope here" is finishable
  without anyone lying about it. Every refusal names the fix. The old
  audit-idle auto-complete is gone: an audit-idle worker is resumed with
  the done instruction (budgeted), then pauses with the instruction on
  the card — completed cards read "Done — ready to review", never a lit
  audit with no next step.
- **A park at audit says which park it is** (`auditPauseReason`,
  `server/runtime/build-thread-terminal.ts`). The done nudge is budgeted at
  `MAX_DONE_NUDGES`, and the pause notice used to read "resume continues the
  worker with that instruction" whether or not there was any instruction left
  to give. On a card whose budget was already spent and whose done gate
  refused for a reason no resume could touch, that sentence taught a reader to
  press Resume again. The pause now names the spent budget and says the
  refusal on the card is the thing to change; a card waiting on an open
  question says so; everything else keeps the plain sentence. The nudge itself
  closes the two dead ends it kept producing: when `done` refuses, do not mark
  the blocking work done to get past it, and do not end the turn with a
  question in prose — a prose question is invisible to the host, so the card
  parks with nothing answerable. Name the blocker in a card comment, or open
  `bb stelow ask` so the card carries a question someone can answer.
- **`bb stelow review` (opt-in, `lib/review-verdict.mjs`).** Independent
  artifact review on explicit invocation only — no band default, no
  silent fallback: without a designated reviewer preset the command
  refuses with setup instructions (never borrows the worker preset, which
  would recreate self-review). Refuses when deterministic `verify` fails,
  so review budget is never spent on thin files (shift-left). Spawns a
  hidden read-only reviewer thread on the designated preset, polls
  bounded (10 min), validates the verdict shape, drops findings with
  unverifiable quotes, persists `reviews/review-<stamp>.md`, and leaves
  a card comment with the summary. v1 covers research + explore; build
  document review is refused as unsupported. Workers may only offer
  review via `bb stelow ask` (`REVIEW_PROTOCOL`), never auto-run it.
- **Gate pre-reviews** (`requestGatePreReview`, `preReviewArtifactKind`).
  Advancing a build card into gate/int-gate/plan-gate with a reviewer
  designated fires one hidden review of the gate's registered artifact,
  posted as a card comment for the human (and worker) before approval.
  Advisory and fire-and-forget — advance never waits; every miss (no
  designation, no workflow, no artifact, thin file) stays silent.
  diff-gate stays out (no single file). Eligibility resolves through the
  lib map, never inline.
- **`bb stelow criteria` (opt-in, `lib/skill-criteria.mjs`).** Advisory
  semantic check: scores an artifact against its skill's structured
  `criteria:` block (one atomic Score per semantic criterion,
  presence/count left to deterministic validators). Read-only — no card
  writes, comments, or realtime events; exit 0 with a met/unmet/
  unverifiable report, never blocking. Runs only with the Artifact
  criteria router in Decision API mode and a configured provider;
  everything else refuses with the fix named.
- **`bb stelow verify-tasks` (advisory, `lib/task-evidence.mjs`).** Completed
  statuses are worker assertions — the command asks a judge per completed
  task whether the working diff shows evidence, through the artifact-criteria
  point (rules reports everything unverifiable without calling out). One
  atomic Score per task, resolved against the point floor; findings guide
  the worker (DONE_PROTOCOL points here before `done`), `done` decides
  separately. Read-only, never a gate. Tasks carrying their own `verify`
  command run deterministically first (exit 0 reads met) and skip the
  judge entirely; scopes roll up deterministically from task verdicts at
  zero extra cost (met iff every task met). Scopes roll up deterministically from
  task verdicts at zero extra cost (met iff every task met); taskless done
  scopes read unverifiable, pending scopes read open.
- **`bb stelow verify-delegation` (advisory, `lib/delegation-evidence.mjs`).**
  Freshness of worker-spawned subagents is unobservable — but whether any
  delegation happened is: the command counts structural delegation items
  in the worker thread timeline (prose matches never count). Zero reads
  as inconclusive ("may be self-review"), never as certain. Read-only,
  never a gate.
- **`bb stelow gap-triage` (advisory, `lib/gap-registry.mjs`).** The
  critique's escalated gaps are the worker's own classification; the
  command asks a judge, per escalated gap, whether it is genuine,  through
  the artifact-criteria point. One atomic Score per gap (ids and questions
  synthesized once by `gapsToTriageBatch`, evidence assembled once by
  `buildGapTriageState`, reused through the shared Score-batch judge).
  The judge reads the critique that claimed the gaps plus the working
  diff — never the gap wording alone — and a missing diff is named in the
  report instead of silently weakening the verdict. The impact×effort
  matrix and gap→scope conversion stay deterministic; `DONE_PROTOCOL`
  points the worker here before `done`. Read-only, never a gate.
- **Reviewer preset designation** (`getReviewPreset`,
  `assignReviewPreset`, `review_preset` table). One singleton preset
  marked as artifact reviewer (different model family, low reasoning,
  restrictive permission — full coerced to accept-edits); deleting the
  preset clears the designation by cascade. The Delegated work section
  carries its row below the tiers (independent review, never a fallback);
  each tier row now explains itself with examples in place, so the section
  needs no preamble paragraph.
- **Review enforcement policy** (`getReviewPolicy`,
  `setReviewPolicy`, `review_policy` table, default off). When required,
  research/explore `done` refuses without a passing review stamped with
  the current fingerprint (`reviewCoversFingerprint`). Mechanism only:
  enable solely with a reviewer you trust on adversarial spot-checks —
  the refusal says so.
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
- **Machine receipts are counted apart, and say so** (`artifactRoleCounts`,
  `ArtifactGroups`, `EvidenceDisclosure`). Stelow's own `audit-trail.md` and
  `recon-receipt.json` are real audit value and are not deliverables, so they
  never inflate the number of files a card produced and never sit unlabeled
  beside the specs. They render in their own **Machine receipts** disclosure —
  closed by default, because a receipt is reference material rather than a
  decision waiting on the reader — naming itself as Stelow's record and not as
  output.

  The classification was already made, transported on every artifact by the card
  detail contract, and then dropped where it became visible: Build re-implemented
  the filter inline (twice, in one file) and drew a hand-made section around it,
  while Explore passed every artifact straight through and counted receipts as
  produced files — a card with two deliverables and one receipt said "3 files".
  The rule now lives in `lib/artifact-roles.mjs` alone, `ArtifactGroups` applies
  it once for every track, and the count each section states comes from the same
  function, so the two surfaces cannot drift. The same row renders both places,
  so a file cannot look like two different things depending on which section it
  landed in.
- **Checks rollup** (`CardChecksSection`, `lib/card-checks.mjs`). Every
  pending thing grouped by type — questions (live + expired asks),
  scopes, tasks, gaps, review — with done/pending counts from the same
  sources the heroes read, never a second truth. A pending-only filter
  defaults on; all clear reads as one line. Groups with nothing
  applicable resolve absent instead of rendering empty.
  The run bundle also commits token evidence: provider-reported totals
  across the card's worker threads (bounded, fail-open) with per-leg
  splits, or an explicit unknown line when nothing reported.
- **Flow metrics** (`flowMetrics`, `lib/card-metrics.mjs`). Lead (idea to
  done) and cycle (first movement to done) per finished card, with p50/p90
  over a project and done-window filter — one batched pass, no per-card
  round trips, same math as the gap summary. Active cards carry no times
  (age is not lead). Each card shows its own Lead/Cycle line in the detail
  progress block; the Build board carries one glanceable Flow strip naming
  itself (finished count with a measured trail, typical/median and slow/p90
  lead/cycle with the jargon glossed inline, expanding to Tempo and Atenção
  tabs and a per-card table that opens
  cards) fed by the board project filter. Tempo holds windows, legend, and
  the lead/cycle table; Atenção holds right-now stuck (blocked status or
  errored worker) and review-awaiting dones with an all-clear empty state —
  signal chips for both ride the closed header only when nonzero, so a calm
  board shows no amber. Empty boards render no strip.
- **Stelow identity prefix** (`sw-`). Per-workflow state dirs, cardless
  workflow ids, and both generators (owner-derived here, random upstream)
  share one prefix.
- **State ownership is a verdict, not a failed read**
  (`resolveWorkflowStateDir`, `server/runtime/workflow-state.ts`). Resolving a
  card's state dir needs two records to agree — the `stelow.json` entry naming
  the workflow, and the `state.md` naming the same owner back. That answer
  comes in three shapes now, because the caller acts differently on each:
  `resolved` (with the blob the ownership check already read, so nobody asks
  the host twice about a file that can change between reads), `unowned` (the
  records disagree — a verdict, and the card gets the reseed refusal), and
  `unreadable` (the host did not answer — not a verdict about the card). The
  periodic card sync skips an unreadable tick entirely instead of freezing the
  card on its last projection with an error the host caused, and a verified
  projection clears `last_error`, so a failure the host recovered from stops
  being displayed days later next to a worker that never needed reseeding.
  Measured case: 26 daemon event-loop stalls on 2026-09-30 09:36–09:41 (max
  delay 29.6s) turned three live cards into the ownership refusal in the same
  second; all three recovered on their own 71s later.
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
  panels, badges, and open cards live (debounced). The reconcile tick also
  watches a scope-progress fingerprint per live card and publishes on
  movement, so silent worker edits surface within one tick (`lib/scope-fingerprint.mjs`).
- **Background services.** Upstream skills sync from `calionauta/stelow`
  (every stelow-* skill, content-hash verified, retired names pruned;
  state in the stable data dir, one fail-soft pass at boot),
  scheduled reconcile, build stamp.

## 8. Research track
*When I need to understand before building, I want a lightweight
investigation that feeds the build board.*

- **A published RPC contract says what the handler can do.** `listCards`
  answers "every project" when `projectId` is absent — `queryCards` omits the
  project filter. The contract declared `projectId: z.string().nullable()`,
  which reads as "may be null" but not "may be absent", and a non-optional
  property is what the host's schema derivation reports as REQUIRED. So the
  host's own plugin probe, which omits it, was refused at validation for a call
  the handler supports, and the refusal showed on the plugin's status line — the
  one place a user looks to see whether a plugin is healthy. `projectId` is now
  genuinely optional, and the contract stays strict about everything else.
- **A published RPC contract admits the call its handler answers.** All three
  card creators resolve the worker environment with
  `selectCardEnvironment(input.environment, <the workspace's own environment>)`
  — an absent or unrecognised request falls back rather than failing, so every
  creator genuinely answers "the project default". The contract said
  `environment: z.unknown()`, which reads as "any value" and is not the same
  claim as "may be absent", and a non-optional property is what the host's
  schema derivation reports as REQUIRED. The host's own plugin probe omits it, so
  all three were refused at validation for a call the handler supports, and the
  refusal showed as `rpc createCard failed` on the plugin's status line — the one
  place a person looks to see whether a plugin is healthy. Now genuinely
  optional, and still strict: an unexpected field, a missing `projectId` and a
  missing prompt are all still refused, while a real environment request is
  still honoured. The same shape as the `listCards` contract, fixed earlier the
  same day.
- **One stuck card is one open paused event, escalated in place.** The paused
  event used to be keyed by idle timestamp, so every new idle period minted a new
  row. A card blinking between idle and briefly-active therefore produced a
  stream of byte-identical notifications for a single problem — one real card
  carried eight open rows all reading "Idle with unfinished work" — and the
  `Stalled Nd` escalation the inbox already has for exactly this never fired once
  in the whole database, because its rows were buried under their own
  look-alikes. The badge counts unresolved *action items*, and one stuck card is
  one of them. A repeat idle now refreshes the open row: the timestamp moves so
  the item sorts as current, and the summary gains the stall age once it passes
  the escalation window, measured from the FIRST idle so a card idle for a week
  says `Stalled 7d` rather than resetting every time it blinks. Resolution is
  what re-opens the count — once the user acts, the next stall is a new item,
  and two stuck cards are still two items.
- **Registration is not a licence on a research substep.** A composite
  research strategy declares its substeps, and each has a depth contract. The
  gate used to run on whatever the worker chose to register in `state.md`, so
  writing every declared substep as a stub and registering only the umbrella
  round file made the round read as ready. A real card's index says it in the
  present tense: the per-step files are "deliberately NOT registered in
  `state.md`, so they do not gate `verify`/`done`" — accurate about the code and
  wrong about the method, because the skill defines a simulated hypothesis as a
  first-class output ("a plausible invented example used to make a candidate
  concrete"), so the fix is richer labelled content rather than ten thin files.
  A declared substep present in the round directory is now gated whether or not
  it was registered, and the round listing is the same nested walk the board
  uses, so a substep one level down is found here as it is there. A declared
  substep that was never written is still not reported: nothing exists to gate,
  and a legitimately partial run must be able to finish.

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
- **Quality seals in the thread** (`::stelow-quality`,
  `app.slots.messageDirective`, `qualitySeal` RPC). Workers emit one seal
  per produced file; the chip revalidates live and renders verified /
  hypothesis / needs-work / unverified with failure details on hover and
  click-to-open with a 44px touch target. Seals state checked provenance,
  never truth; unknown shapes and unreadable files read as unverified. A
  failed live revalidation reports `quality unavailable` instead of waiting
  forever.
- **Shared machinery.** Hero, questions, artifacts viewer, presets,
  retry/restart/reseed, worker history, inbox, and realtime are the same
  components as build. Stage advance and intent editing refuse on
  research cards with the valid exit named.
- **Artifact guarantee** (`lib/research-artifacts.mjs`,
  `researchRoundIntegrity`). Round validity (non-empty, substantive,
  never a mirror of the index) is enforced in code, not in prompt text:
  the plugin pre-creates every round file at spawn, and readiness
  requires a reviewable index AND every round valid AND every registered
  composite substep valid. Each substep file is checked individually
  (`findInvalidSubsteps` over the history–manifest join); an index with an
  invalid round or substep is not Done — each invalid item surfaces as an
  inbox error and a `verify` FAIL line naming the file, the slug, and the
  reason (missing, thin, mirrors the index, or needs-depth with
  expected-vs-found counts). Depth minima live in owned
  `lib/artifact-contracts.mjs` — ten JTBD substep entries plus one
  primary-file entry per research strategy (market-analysis and paywall
  pass when ANY selected variant validates) — mirroring each upstream
  prompt's Completeness contract, and run through
  `lib/artifact-validation.mjs` — a short file with the right filename
  no longer passes, on primaries or substeps. Inbox errors name the
  slug and reason with per-substep dedupe keys, so ten failures surface
  as ten events. The worker prompt states
  the contract; the sync is what makes it true. Broad Full Mapping requests
  scope first (Targeted vs Full vs Recommend via `bb stelow ask`); workers
  write the playbook's full result verbatim, never a condensed summary.
- **Completed research** (`isResearchReadyForReview`,
  `lib/research-ready.mjs`). An idle worker with an index that parses to
  ≥1 opportunity is complete — never a `paused` stall. The sync moves the
  card directly to Done, resolves paused signals, and emits one `completed`
  event per index fingerprint (a grown index earns a fresh one). The board
  column is the sole status; a user comment on a completed research card
  returns it to Doing and resumes the worker.
  Evidence honesty (`lib/research-evidence.mjs`): when the index declares
  web research unavailable, `verify`, `done`, and the completion event
  carry hypothesis-only — the card completes structurally but is never
  announced as complete research.

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
  idle as unfinished, never as Done. Present files must also meet
  their stage contract (`EXPLORE_CONTRACTS`: Shape Up frontmatter +
  four sections, interface 8 sections, tech-plan scopes + task table,
  critiques five sections, testing-strategy tables + gates, execution
  critique registry + decision) — failures surface as `verify` FAIL
  lines and inbox errors naming the missing depth. The critique's
  `gaps:` frontmatter is machine-checked (`lib/gap-registry.mjs`):
  every row needs a known impact + resolution, high/critical impact
  must resolve as escalate, and a stated moderate-or-heavier effort on
  a medium gap must not resolve as an inline fix (`gap-underfixed`) —
  effort checks are fail-open when absent so legacy registries never
  retro-fail. A misclassified gap fails
  deterministically instead of passing silently.
- **Gap-to-scope loop** (`bb stelow gap-scopes`, `critiqueGapState`).
  Escalated gaps become `audit-gap` rework scopes in the card's own
  `stelow.json` entry — created by code (idempotent, trail comment),
  never by prose, never as new cards: a card with open gaps is not
  done, it loops back with `bb stelow advance execution` (the
  methodology's audit-rejects-to-execution transition), executes the
  rework, re-runs the critique, and only then returns to audit for
  `done`. `done` refuses while escalations lack scopes or linked
  scopes stay open. The mother card shows the loop in Gaps &
  rework (counts, per-gap disposition and scope status, lead/cycle
  time via `gapSummary`); rework scopes carry a rework pill naming
  their gap. The section lists every gap the registry named, not
  only the escalated ones: a critique of two documented gaps used to
  render a header reading "2 gaps" above an empty section, because
  the tally counted findings while the body listed rework. A fixed
  or documented gap shows its own disposition; an escalation shows
  its rework scope, and "no scope yet" while it waits for one. The
  Checks rollup counts only escalations that still need work — a
  documented gap and an escalation whose rework scope finished are
  both settled, and listing them as open told the reader a card was
  waiting on findings nobody has to act on.
  `bb stelow metrics [--json]` reports lead/cycle time per stage plus
  gap counts and escalated rate, read-only — without `--card` it
  aggregates the whole Build fleet (avg lead/cycle, totals, per-card
  breakdown). Done means every gap has
  a disposition and every escalation is executed — documented gaps
  are accepted debt for next cycle by definition, fixed gaps are
  auditable through the Decision section and trail. `verify --tests`
  warns the loop state early (UNSCOPED / OPEN lines) so it never
  ambushes at `done`; advancing audit → execution names the open
  rework it picks up. Re-critique overwrites the same file: every
  matched critique is validated (a lingering superseded file still
  claims), and every refusal names file + expected-vs-found.
- **Worktree storage** (`bb stelow storage [--json]`,
  `lib/worktree-storage.mjs`). Worktree disk usage attributed to cards
  (heaviest first, unattributed rows listed instead of hidden), read-only
  with per-path timeouts. Completed cards anchor checkout dirt to their
  verified test HEAD instead of implying leftovers.
- **Build document depth** (`buildDocDepths`, `contractForBuildArtifact`).
  At `done`, recognized workflow documents registered in `state.md`
  (spec-product, spec-tech, interfaces, testing-strategy, critique
  reports) are validated against the same stage contracts; audit.md,
  receipts, and unknown files never block. Only a matched document
  that fails depth refuses `done`, with file + expected-vs-found.
- **Shared machinery.** Board column components, list view, status
  pill, hero, questions, presets, retry/restart/reseed, worker
  history, inbox, and realtime reuse the Research definitions
  (`LightweightTrackCard`, `LightweightTrackList`,
  `markThreadRunning`, `noteAgentOutput`) — Explore adds only its
  catalog, prompt, and artifact path, never a forked copy.
- **Quality panel (Research + Explore).** Research cards show per-substep
  status (ready / missing / thin / needs-depth) from the same predicates
  `verify` enforces; explore cards resolve their file live through
  `qualitySeal`. Each panel carries one Repair action: post the failure
  list as a comment and resume the worker on existing rails.

## BB 0.43 adoption notes (deliberate scope)

Adopted where it pays: shared CLI help/suggestion table (`lib/cli-suggest.mjs`),
ask timeline labels + submission descriptions (`presentation`/`describeSubmission`),
dependent-thread ownership (`lifecycleOwnerThreadId` with strict-schema retry
fallback), `experimental_description` on all RPCs, palette command via
`app.commands.register` with `commandPaletteAction` fallback, and local squash
merge in the card shell (`lib/squash-merge.mjs`) — BB exposes no local squash
action. Dev types come from `@get-bb/plugin-sdk` 0.4.106.

Deliberately NOT adopted: preview core unchanged (native open-in-tab + iframe
already cover the Browser-control overlap; detect/spawn/port/log/share stays),
no project env vars for doctor (singleton design + audit trail), no full
`defineCli` migration (order-dependent grouping breaks with repeatable arrays).

Engines policy: the runtime floor stays `bbPluginSdk >=0.4.6` because the host
bundle (0.4.84) must accept the plugin — every new API use is feature-detected
with a fallback, so 0.4.106 is build-time types only.

Host-version note: the 0.43.3 APIs above went live with host 0.43.3 and plugin 0.35.2, verified live: all 96 RPC methods are discoverable via bb plugin rpc list, and dependent-thread ownership, persistent requestInput presentation, and app.commands registration are served by the host. No plugin-side CLI substitute was built (YAGNI).

## Canonical stages and host-native execution

- **Shared stage catalog.** The board, state template, artifact ordering, playbooks, question contracts, and route projections read the generated upstream `stage-catalog.json`; the plugin no longer keeps a hand-maintained list of the 17 Build stages. A pinned sync preserves the last good catalog when an older upstream pin does not contain it.
- **Capability-negotiated execution.** Host-neutral execution adapters normalize run state and negotiate required capabilities before starting a recipe. Missing capabilities produce a named refusal or an explicit coordinator-owned sequential route; permission requirements are never silently weakened. The coordinator route is not presented as a native run and has no fabricated run ID, resume handle, or cancel semantics. The optional BB Workflows binding reports its real capability limits, including no per-call permission control, while the card remains the owner of human input and resume.
- **Durable native runs.** BB Workflows starts through the server-side `bb workflows run` bridge with inline, size-checked source and explicit project/thread context; each card run persists native identity, recipe, source hash, workspace, project, status, resume lineage, stop, completion dedupe, boundary identity, and artifact-validation state. Canonical stage entry performs preflight gates before mutating state, then dispatches the stage recipe. Outputs are staged per run and become successful only after the coordinator registers a receipt. The card detail exposes run status, a local-run deep-open action, and Stop, while native workers never own the card. A run that deliberately STOPS to name a decision is `needs_input`, not `failed`: the card shows "Waiting for you" and quotes the run's own question, so a wait is never a spinner with nothing behind it. Artifact rejections name the fields that failed, not just the file — "malformed: contrast.json" costs a run and tells the worker nothing it can act on. The host also reads the recipe script's OWN return value: a workflow finishing successfully only means the script ran, and a script that produced no task outputs is a failure rather than a pass — otherwise a recipe that did nothing surfaced three layers down as a missing file. Scope-map approval is a host decision, not agent prose: `bb stelow scope-approve` (or the `approveScopeMap` RPC) stamps `status: approved` with a host-minted receipt and an approver, refusing a map that violates its contract, one already approved, or an approval nobody can attribute — and it is the only writer of an approved map, so the X-ray is reachable from the real workflow instead of a hand-edited artifact. The approved map's Shape version is mirrored into `state.md` so X-ray freshness is a live signal instead of a permanent `unknown`. Every `bb stelow answer` refusal names its exit: which id space a recovery question lives in, and exactly which questions are still open in an incomplete batch. The deep-open route uses only the ledger's local `exec_…` identity: queued and running runs focus the run row, `needs_input` focuses the real card question when it is present (and falls back to the run row during the question-sync race), and succeeded, failed, and cancelled runs focus run history. Native Workflows run IDs and preview directives remain evidence in the row, never in-app navigation; unknown states or identities get no invented route. `needs_input` becomes a real, marker-bound card question, and only that answer resumes the child run. `scope-batch` remains coordinator-sequential except for the approved native pilot: disjoint scopes with satisfied claims fan out only when file-claims and isolated-workspace capabilities both report true, the batch fits the concurrency bound, every child returns a per-scope receipt (claim verification, files touched, artifact manifest), and the parent merge passes post-merge verification — any gate failure falls back sequentially with no partial fan-out, overlapping scopes never fan out, and `native_pilot_allowed=false` rolls everything back (see [docs/native-workflows.md](./docs/native-workflows.md)).

## Cross-cutting rules (apply to every feature above)

From `AGENTS.md` (State honesty): no phantom waits, per-kind inbox
resolution, one primary action per card state, destructives behind
confirms in Manage, `min-h-11` touch targets with `cursor-pointer`.
