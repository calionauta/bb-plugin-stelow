import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const buildStatusPills = readFileSync(join(root, "components/dashboard/build-status-pills.tsx"), "utf8");

function rpcMethod(name, nextName) {
  const start = server.indexOf(`    async ${name}(`);
  const end = server.indexOf(`    async ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} RPC exists`);
  assert.notEqual(end, -1, `${nextName} RPC marks the end of ${name}`);
  return server.slice(start, end);
}

function appFunction(name, nextMarker) {
  const start = app.indexOf(`function ${name}(`);
  const end = app.indexOf(nextMarker, start + 1);
  assert.notEqual(start, -1, `${name} UI function exists`);
  assert.notEqual(end, -1, `${nextMarker} marks the end of ${name}`);
  return app.slice(start, end);
}

const updateIntent = rpcMethod("updateCardIntent", "addCardComment");
assert.match(updateIntent, /if \(!canEditWorkflowIntent\(card\)\)/, "only triage Build cards can edit their workflow type");
assert.doesNotMatch(updateIntent, /threads\.send\(/, "editing type never silently redirects an existing worker");

const byThread = rpcMethod("cardByWorkerThread", "getNotification");
assert.doesNotMatch(byThread, /row\.status === "archived"/, "an archived card's thread still links back to its card");

const reseed = rpcMethod("reseedCard", "moveCard");
assert.match(reseed, /resolveReseedIntent\(card, requestedIntent\)/, "fresh restarts are the only route reclassification path");
assert.match(reseed, /freshStatusForReseed\(card, reclassified\)/, "reclassification reopens the card at a coherent status");
assert.match(reseed, /publish\("card-state", \{ cardId \}\)/, "reclassification refreshes open card surfaces");

const archive = rpcMethod("cancelCard", "deleteCard");
assert.match(archive, /publish\("card-state", \{ cardId \}\)/, "archive refreshes open card surfaces");
assert.match(archive, /publish\("board-changed", \{ cardId \}\)/, "archive refreshes board surfaces");

const remove = rpcMethod("deleteCard", "retryWorker");
assert.match(remove, /publish\("card-state", \{ cardId \}\)/, "delete refreshes open card surfaces");
assert.match(remove, /publish\("board-changed", \{ cardId \}\)/, "delete refreshes board surfaces");

assert.match(app, /workerSectionPolicy\(card, Boolean\(detail\?\.card\.needsAttention\), \{ hasGithubLink, historyCount: detail\?\.workerHistory\.length \?\? 0 \}\)/, "Worker visibility comes from the shared policy");
assert.match(app, /archivedCardDetailPresentation\(card, stageLabel\)/, "archived hero and workflow copy come from one presentation policy");

const header = appFunction("CardDetailHeader", "// Status rank");
assert.match(header, /canEditWorkflowIntent\(card\)/, "the header delegates type editability to the shared policy");
assert.match(header, /<CardActionsMenu/, "card lifecycle affordances live in the header");

const menu = appFunction("CardActionsMenu", "function CardDetailHeader");
assert.match(menu, /Archive card…/, "archive remains its own explicit action");
assert.match(menu, /Delete permanently…/, "permanent deletion remains its own explicit action");
assert.doesNotMatch(menu, /Stop & archive/, "two distinct lifecycle actions are never conflated");

const worker = appFunction("WorkerSection", "// Research-track card detail");
assert.doesNotMatch(worker, /Archive card|Delete permanently|Restart fresh/, "Worker contains worker context only, never card lifecycle actions");

// Archived is terminal: the single updateCard choke point strips
// resuscitations, worker-thread events never reach archived cards, and the
// Archive button honors a refused archive instead of celebrating it.
assert.match(server, /stripArchivedResuscitation\(previous\?\.status, fields/, "every status write passes the archived-terminal rule");
const idleHandler = server.slice(server.indexOf('bb.events.on("thread.idle"'), server.indexOf('bb.events.on("thread.active"'));
const activeHandler = server.slice(server.indexOf('bb.events.on("thread.active"'), server.indexOf('bb.events.on("thread.failed"'));
const failedHandler = server.slice(server.indexOf('bb.events.on("thread.failed"'), server.indexOf("// Reconcile card states"));
for (const [name, handler] of [["idle", idleHandler], ["active", activeHandler], ["failed", failedHandler]]) {
  assert.match(handler, /status != 'archived'/, `thread.${name} events never sync archived cards`);
}
const doArchive = appFunction("doArchive", "async function doDelete");
assert.match(doArchive, /if \(!result\.archived\)/, "a refused archive surfaces an error instead of a false success");

// Archived terminality binds every worker-touching or state-moving RPC, not
// just the poll path: each refuses upfront with the named exit.
const move = rpcMethod("moveCard", "promoteCard");
assert.match(move, /if \(isArchivedCard\(card\)\) return \{ ok: false, error: ERR_CARD_ARCHIVED \}/, "archived cards refuse board moves");
const advance = rpcMethod("advanceCard", "advance");
assert.match(advance, /if \(isArchivedCard\(card\)\) return \{ ok: false, stdout: "", error: ERR_CARD_ARCHIVED \}/, "archived cards refuse stage advances");
assert.match(advance, /Only `bb stelow done` may/, "manually advancing to Audit cannot mark a Build card done");
assert.doesNotMatch(advance, /stage === "audit" \? "completed"/, "Audit is not an implicit completion path");
const answer = rpcMethod("answerQuestions", "startWorkflow");
assert.match(answer, /if \(isArchivedCard\(card\)\) return \{ ok: false as const, answered: 0, error: ERR_CARD_ARCHIVED \}/, "archived cards refuse batch answers");
const answerExpired = rpcMethod("answerExpiredQuestions", "advanceCard");
assert.match(answerExpired, /if \(isArchivedCard\(card\)\) return \{ ok: false as const, answered: 0, error: ERR_CARD_ARCHIVED \}/, "archived cards refuse expired answers");
const comment = rpcMethod("addCardComment", "cancelCard");
assert.match(comment, /if \(isArchivedCard\(card\)\) return \{ commentId: "", error: ERR_CARD_ARCHIVED \}/, "archived cards refuse new comments");
assert.match(server, /statusForNewCardWork\(\{ kind: card\.kind, status: card\.status, stage: card\.stage \}\)/, "a card comment reopens completed work through the shared lifecycle helper");
assert.match(server, /statusForNewCardWork\(\{ kind: card\.kind, status: card\.status, stage: currentStage \}\)/, "a direct thread message reopens completed work through the same helper");
assert.match(server, /async function recoveredCheckoutIntegrity\(/, "recovered checkouts have a dedicated integrity check before diffing");
assert.match(server, /const recoveryError = await recoveredCheckoutIntegrity\(card, workspace\.path\)/, "recovered diffs fail closed when their attached Git root changes");
assert.match(server, /verificationReadiness\(verificationRun, gitEvidence\)/, "Build completion requires a host-recorded test result at the current Git identity");
assert.match(server, /auditReceiptReadiness\(receiptContent, stateBlob \? parseArtifactManifest\(stateBlob\) : \[\], checkout\?\.path \?\? null, gitEvidence, verificationRun\)/, "Build completion passes host-sampled Git and test evidence into receipt validation");

// The single updateCard choke point strips resuscitations twice: against the
// read-time snapshot and, for async callers whose write lands after Archive,
// against a fresh write-time read.
assert.match(server, /stripArchivedResuscitation\(previous\?\.status, fields/, "every status write passes the archived-terminal rule");
assert.match(server, /stripArchivedResuscitation\(latest\?\.status, write\)/, "mid-flight archives cannot resuscitate at write time");
// The sync entry skips archived cards before any thread read, and the ask
// CLI names archived threads instead of misreporting ownership.
assert.match(server, /if \(!card\?\.worker_thread_id \|\| isArchivedCard\(card\) \|\| card\.status === "completed" \|\| card\.status === "blocked"\) return;/, "sync polls never touch archived cards");
assert.match(server, /if \(cardRow\.status === "archived"\) return \{ exitCode: 2, stderr: "This card is archived\." \}/, "ask on an archived thread names the state");

// List-view groups collapse with archived collapsed by default and stored
// choices surviving reloads; completed build cards read as one state.
assert.match(app, /buildListGroups: "stelow-build-list-groups-collapsed-v1"/, "build list collapse persists");
assert.match(app, /researchListGroups: "stelow-research-list-groups-collapsed-v1"/, "research list collapse persists");
assert.match(app, /exploreListGroups: "stelow-explore-list-groups-collapsed-v1"/, "explore list collapse persists");
assert.match(app, /\{ archived: true, \.\.\.parsed \}/, "stored choices win over the archived-collapsed default");
assert.match(app, /aria-expanded=\{!isCollapsed\}/, "list group toggles expose expansion state");
assert.match(app, /card\?\.status === "completed" \? "Completed without scoped execution\."/, "completed cards never claim shaping is in progress");
assert.match(app, /card\?\.status === "completed" \? undefined : stageLabel\(card\.stage\)/, "completed cards carry no stale stage hint");
assert.match(app, /Completed · \{completedWorkerPreset\}/, "completed cards show the recorded worker preset instead of a future phase");
assert.match(app, /Preset recorded for the completed worker\./, "completed cards do not claim a preset applies to another worker");
assert.match(app, /card\.status === "completed" \? "Completed" : stageLabel\(card\.stage\)/, "completed list rows do not present Audit as active work");
assert.match(app, /passed its final audit verification/, "completed hero explains Audit as completed verification, not the current phase");
assert.match(app, /isTerminalCheckpoint/, "the terminal Audit checkpoint cannot be selected as a reopen target");
assert.match(app, /disabled=\{!clickable \|\| isCurrent\}/, "every current workflow checkpoint is inert, not Audit alone");
assert.match(app, /Workflow complete — choose an earlier stage to reopen it/, "completed workflow guidance excludes the current terminal checkpoint");
assert.match(app, /Done is the completed outcome after Audit, not a stage/, "the workflow map distinguishes stages from the Done outcome");
assert.match(server, /cardStatus: card\.status/, "the audit watchdog refuses an already-completed card");

// Track headers describe the agent outcome, not internal filenames.
assert.match(app, /applies specialized research strategy to surface prioritized opportunities/, "research header names the strategy outcome");
assert.match(app, /Choose a single technique from the \{trackTitle\("build"\)\} workflow/, "explore header names one build technique, not a stage");
assert.match(app, /carries each card through a structured workflow/, "build header names its full workflow, not a one-off technique");
assert.match(app, /wherever your review mode requires it/, "gated pauses read as conditional, never promised");
assert.doesNotMatch(app, /Choose a single stage from|Choose one specialized skill and an AI agent runs it/, "stage/skill wording is gone from explore headers");

// Promotion is a true ownership handoff: a new project worker takes over only
// after it starts, and a failed handoff restores the exploratory card.
const promote = rpcMethod("promoteCard", "researchStrategies");
assert.match(promote, /respawnWorkerForBand\(cardId, preset\.id, "project-promotion", \{ previousProjectId: card\.project_id \}\)/, "promotion starts a worker in the new project");
assert.match(promote, /workspace_kind = 'exploratory'/, "failed handoff restores the exploratory workspace");
assert.match(promote, /The card remains exploratory; its existing worker is still active/, "failed handoff explains the safe state");
assert.match(app, /Open thread then opens that project worker; the earlier thread stays in Worker history\./, "the promotion dialog explains thread continuity before committing");

// One list row for all tracks: Build geometry standard, context per meta.
assert.match(app, /function TrackListRow\(\{ card, meta, onOpen \}/, "all three list views share one row");
assert.match(app, /<TrackListRow key=\{card\.id\} card=\{card\} meta=\{metaFor\(card\)\}/, "lightweight lists render the shared row");

// Focused-card keyboard: Enter/Space opens the card, W opens its worker
// thread. Guarded to the card surface so typing elsewhere never navigates.
const boardCard = appFunction("BoardCard", "function LightweightTrackCard(");
assert.match(boardCard, /event\.target !== event\.currentTarget/, "card keys ignore events from nested controls");
assert.match(boardCard, /event\.key === "w" \|\| event\.key === "W"/, "W opens the worker thread from a focused build card");
assert.match(boardCard, /navigate\.toThread\(card\.workerThreadId\)/, "W navigates to the card's own worker thread");
const lightweightCard = appFunction("LightweightTrackCard", "function ResearchCard(");
assert.match(lightweightCard, /event\.key === "w" \|\| event\.key === "W"/, "W opens the worker thread from a focused research/explore card");
const listRow = appFunction("TrackListRow", "function BoardColumn(");
assert.match(listRow, /event\.key === "w" \|\| event\.key === "W"/, "W opens the worker thread from list-view rows too");
// Esc/Back returns to the board with the card focused: opening remembers the
// card, each card surface restores focus to it on return.
assert.match(app, /stelowReturnFocusCardId = cardId/, "opening a card remembers it for focus return");
assert.match(boardCard, /useReturnFocus<HTMLDivElement>\(card\.id\)/, "build board cards restore focus on return");
assert.match(listRow, /useReturnFocus<HTMLButtonElement>\(card\.id\)/, "list-view rows restore focus on return");
assert.match(app, /function CardHeading\(/, "board tiles share a title-first card header");
assert.match(app, /<h3 className="min-w-0 break-all text-sm font-semibold/, "card titles always use the whole available width and break rather than truncate");
assert.doesNotMatch(app, /<span className="font-medium text-muted-foreground\/80">Status<\/span>/, "a generic Status label does not duplicate the self-describing state pills");
assert.match(buildStatusPills, /Workflow stage[\s\S]*stageLabel\(card\.stage\)[\s\S]*Workflow type/, "Build cards identify their specific workflow stage before their workflow type");
assert.match(buildStatusPills, /card\.activity === "awaiting-answer"[\s\S]*ActivityPill/, "Build summaries surface human waiting consistently");
assert.doesNotMatch(buildStatusPills, /Board location|Lifecycle state/, "Build summaries do not duplicate column or lifecycle labels");
assert.match(boardCard, /BuildStatusPills \{\.\.\.buildStatusPillProps\(card\)\}/, "Kanban tiles use the shared Build state presentation");
assert.match(header, /BuildStatusPills \{\.\.\.buildStatusPillProps\(card\)\}/, "open Build cards use the same state presentation as Kanban tiles");
assert.match(boardCard, /action=\{stuck && card\.activity !== "error" \? <CardRetryButton cardId=\{card\.id\} label="Resume work"/, "build tiles offer heading recovery for idle stalls only, never for failures");
assert.match(lightweightCard, /action=\{stuck && card\.activity !== "error" \? <CardRetryButton cardId=\{card\.id\} label="Resume work"/, "research/explore tiles match: heading recovery is idle-only");
assert.doesNotMatch(boardCard, /bg-destructive\/10/, "build tiles render no failure body — the open card explains");
assert.doesNotMatch(lightweightCard, /bg-destructive\/10/, "research/explore tiles render no failure body either");
assert.match(app, /card\.activity === "running"\) return "stelow-border-running"/, "a running Build card uses its live border instead of a redundant In progress tag");
assert.match(boardCard, /liveBorderClass\(card\)/, "a Build card needing attention uses its shared live attention border");
assert.match(app, /min-h-11 disabled:cursor-not-allowed cursor-pointer rounded-md/, "the recovery action has an accessible touch target");
assert.match(buildStatusPills, /Worker failed: \$\{detail\}/, "a failed tile still names its reason one hover away");
assert.match(app, /function HeroErrorNote\(/, "a decision hero names a concurrent failure instead of hiding it");
assert.match(app, /Answering below resumes the worker\./, "the concurrent-error note points at the open question as the recovery path");
assert.match(app, /Retry the failed worker in place instead of answering/, "the open card offers retry beside the question when both are live");
assert.doesNotMatch(boardCard, /flex-1 truncate text-sm/, "build card titles are no longer truncated beside pills");
assert.match(listRow, /break-words text-sm leading-5/, "list cards keep long requested outcomes readable");
assert.doesNotMatch(app, /hsl\(280 80% 60%/, "running cards no longer cycle through distracting rainbow colors");

// Done is terminal for attention, not just for archive: background sync
// never re-errors a completed card, a stale last_error never flags
// attention on one, and Retry is never offered there.
assert.match(server, /if \(!card\?\.worker_thread_id \|\| isArchivedCard\(card\) \|\| card\.status === "completed" \|\| card\.status === "blocked"\) return;/, "sync polls never touch completed/blocked cards");
const researchSync = server.slice(server.indexOf("async function syncResearchThreadState"), server.indexOf("async function syncExploreThreadState"));
assert.match(researchSync, /card\.status === "completed" \|\| card\.status === "archived" \|\| card\.status === "blocked"/, "research sync never writes terminal cards");
const exploreSync = server.slice(server.indexOf("async function syncExploreThreadState"), server.indexOf("async function exploreArtifact"));
assert.match(exploreSync, /card\.status === "completed" \|\| card\.status === "archived" \|\| card\.status === "blocked"/, "explore sync never writes terminal cards");
const failedWriter = server.slice(server.indexOf("async function applyWorkerFailed"), server.indexOf("async function markThreadRunning"));
assert.match(failedWriter, /current\.status === "completed" \|\| current\.status === "archived" \|\| current\.status === "blocked"/, "a dead thread after Done never stains the card");
assert.match(server, /const errorPending = !termStatus && \(Boolean\(row\.last_error\) \|\| activity === "error"\);/, "board attention ignores stale errors on terminal cards");
assert.match(server, /: !termStatus && \(Boolean\(card\.last_error\) \|\| effectiveActivity === "error"\) \? "error"/, "detail attention ignores stale errors on terminal cards");
const retry = rpcMethod("retryWorker", "restartWorker");
assert.match(retry, /card\.status === "completed" \|\| card\.status === "blocked"/, "completed cards refuse Retry instead of nudging a finished worker");
assert.match(server, /status: "in-progress", last_error: null \}\);/, "answering a question clears the interrupted turn's failure");
assert.match(server, /supersede it at birth/, "an error arriving with an open question counts once, in history");
assert.match(boardCard, /const terminal = card\.status === "completed" \|\| card\.status === "archived" \|\| card\.status === "blocked";/, "build board cards never offer Retry on terminal cards");
assert.match(lightweightCard, /const terminal = card\.status === "completed" \|\| card\.status === "archived" \|\| card\.status === "blocked";/, "research/explore cards never offer Retry on terminal cards");

// Creation settings stay visible under the composer: collapsing them hid
// consequential choices users never discovered. A fixed-height dialog with
// inner scroll keeps the frame stable, and a bordered settings boundary
// keeps the controls attached. Radio cards stay accessible and vertical.
assert.doesNotMatch(app, /createOptionsOpen/, "new-card Settings is never collapsed, so planning depth and review gates are always discoverable");
assert.match(app, /start from the board defaults — keep them or adjust, then submit/, "the creation dialog frames preferences as defaults, not hidden settings");
assert.match(app, /function CollapsibleChoiceCards</, "each preference category is a compact row, so Pause for my review is never pushed below the fold");
assert.match(app, /<ChoiceCards label=\{label\} labelHidden/, "expanded rows reuse the same radio cards instead of a second option renderer");
assert.match(app, /aria-expanded=\{open\}/, "preference rows expose their expand state to assistive tech");
assert.match(app, /function ChoiceCards</, "planning and review options render as visible radio cards");
assert.match(app, /label="Pause for my review"/, "human review gates never read as the automatic Review column");
assert.doesNotMatch(app, /agent's own automatic check/, "the review picker no longer carries the distracting board-column explanation");
assert.match(app, /function SettingsSection\(/, "settings controls use a reusable visual container");
assert.match(app, /function WorkflowSettings\(/, "workflow preferences are reused between creation and board defaults");
assert.match(app, /function DisclosureSection\(/, "Settings and card content share one generic disclosure pattern");
assert.match(app, /function DisclosureChevron/, "every collapsible shares one open/close affordance");
assert.match(app, /group-open:rotate-90/, "the chevron mirrors open state instead of decorating");
assert.doesNotMatch(app, /function WorkflowChoiceSelect</, "the cramped select is gone, not duplicated");
assert.match(app, /const isSplitProposal = isSplitQuestion\(current\)/, "split questions get their own safe, explicit guidance");
assert.match(app, /Choose deliveries or/, "split UI makes Keep as one card an explicit alternative without repeating the split instructions");
assert.match(app, /splitOptionDescription\(/, "a still-open legacy split form does not repeat generated consequences");
assert.match(app, /splitQuestionText\(current\.prompt\)/, "a still-open legacy split prompt upgrades without changing its stored answer identity");
assert.match(app, /splitSelectionNotice\(current\.options, selected\[current\.id\] \?\? \[\]\)/, "split feedback reacts to the current selection before submission");
assert.match(app, /border-primary\/40 bg-primary\/10 p-2 text-xs leading-5 text-foreground/, "a planned parent archive is informative, not a destructive red warning");
assert.match(server, /Questions are English-only/, "the worker cannot opt a structured card question into another locale");
assert.match(server, /englishQuestionContentError\(group\.question, group\.options\)/, "the CLI rejects Portuguese structured question content before it can create a mismatched card form");
assert.match(answerExpired, /formatBatchContinuation\(decisions\)/, "recovered answers use the same neutral continuation as live answers");
assert.doesNotMatch(answerExpired, /question that timed out/, "recovered answer delivery does not leak timeout jargon into the worker thread");
assert.match(app, /All updates/, "Inbox exposes read state without replacing its lifecycle tabs");
assert.match(app, /Unread only/, "Inbox can narrow every selected tab to unread entries");
assert.match(app, /size-5 shrink-0 items-center justify-center border-2/, "question choices use visible, high-contrast selection controls");
assert.match(server, /splitQuestionText\(groups\[0\]!\.question\)/, "the split question is host-enriched in English before it reaches the user");
assert.match(server, /kind TEXT NOT NULL DEFAULT 'standard'/, "recovered questions persist an explicit semantic kind");
assert.match(app, /recoveryHeading/, "recovered questions explain the state without leaking timeout jargon");
assert.match(answerExpired, /answers: item\.answers/, "timed-out multi-choice answers retain every selected value");
assert.match(answerExpired, /recordSplitAnswer\(db, cardId, decisions\)/, "a timed-out split answer records through the same shared helper as a live answer");
assert.match(app, /These needed you once, then cleared on their own/, "the Resolved filter explains why it exists");
assert.match(app, /presentation\.label\}<\/span>/, "each resolved row names how it cleared");

const threadAction = app.slice(app.indexOf("function OpenStelowAction"), app.indexOf("function StelowArtifactDirective"));
assert.match(threadAction, /<Button size="sm" variant="outline"/, "the thread-header card button shares the in-panel small-button pattern");
assert.doesNotMatch(threadAction, /min-h-11/, "the thread-header button never forces bar height in a stretching host slot");
assert.match(buildStatusPills, /Workflow stage — the specific checkpoint this card is at\./, "the first Build pill names the workflow checkpoint consistently");
assert.match(server, /hasRecoveryCheckout[\s\S]*fileEnvironmentId = !hasRecoveryCheckout/, "recovered exploratory cards use a host file target instead of a stale worker environment");
// One progress section, one artifact home, one reference. The doc buttons that
// duplicated Artifacts are gone, counts are counts, and the reference map is a
// sibling of the progress section rather than nested inside card state.
assert.match(app, /function DisclosureSection\(\{ title, subtitle, hint/, "a section can name its job on its own line");
assert.match(app, /title=\{archivedPresentation\?\.workflow\.title \?\? "Workflow progress"\}/, "the live progress section is named for the workflow, matching the map's family");
assert.match(app, /subtitle=\{archivedPresentation \? undefined : "where this card is"\}/, "the progress subtitle is the counterpart to the map's What each stage does");
assert.doesNotMatch(app, /onShowArtifacts/, "the per-stage document buttons are gone; files and navigation never share one shape");
assert.doesNotMatch(app, /workflow\.progressTitle/, "the progress block no longer repeats the disclosure title it sits under");
assert.doesNotMatch(app, /Agent advances alone/, "the override coaching stops being permanent chrome");
assert.match(app, /produced\.length > 0 \? <span className="text-muted-foreground">· \{produced\.length\} file/, "a stage that produced documents carries a count-only badge");
assert.match(app, /\{artifactTotal\} file\{artifactTotal === 1 \? "" : "s"\} ↓/, "the summary action carries the artifact count and the one route to the files");
const progressSection = app.slice(app.indexOf("DISCLOSURE 1"), app.indexOf("<div ref={artifactsRef}>"));
assert.ok(progressSection.length > 0 && progressSection.indexOf("</CardDisclosure>") < progressSection.indexOf("<WorkflowMap"), "the workflow map is a sibling of progress, never nested inside it");
assert.match(app, /<WorkflowMap open=\{mapOpen\} onToggle=\{setMapOpen\} \/>/, "the workflow map tracks its own open state");
assert.match(app, /function WorkflowMap\([\s\S]*?<DisclosureChevron open=\{open\} className="text-base text-foreground" \/>/, "the workflow map uses the shared, state-explicit chevron at the readable standard size");
assert.match(app, /WORKFLOW_PHASES\.map\(\(phase\) =>/, "the workflow map groups stages into their four readable workflow phases");
assert.match(app, /inline-flex size-5 shrink-0 items-center justify-center text-sm/, "all shared disclosure chevrons reserve one readable minimum size");
assert.doesNotMatch(app, /Fresh card — still in triage/, "no Draft pill duplicates the triage column");

console.log("card lifecycle contract test ok: UI and RPC keep card lifecycle semantics aligned");
