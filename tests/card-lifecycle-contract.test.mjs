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

const menu = appFunction("CardActionsMenu", "function CardDetailHeader");
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
assert.match(server, /hasWorker: card\.worker_thread_id !== null/, "the split flag knows whether a worker exists to propose from");
assert.match(server, /if \(!card\.worker_thread_id\) return \{ ok: false, error: "This card has no worker thread\." \}/, "the split trigger refuses threadless cards even if the UI ever offers it");
assert.match(server, /CREATE TABLE IF NOT EXISTS question_evidence/, "asked documents keep an ask-time baseline for staleness notices");
assert.match(server, /void snapshotQuestionEvidence\(cardRow\.id, groups\.flatMap/, "asking snapshots its documents before the blocking wait, never blocking the ask");
assert.match(server, /stalenessForQuestions\(cardId, \[\.\.\.pending, \.\.\.expiredQuestions\]\)/, "card reads compare every open question against its baseline");
assert.match(app, /<StalenessNotice staleness=\{current\.staleness\} \/>/, "each open question carries its own notice");
assert.match(server, /auditReceiptReadiness\(receiptContent, stateBlob \? parseArtifactManifest\(stateBlob\) : \[\], checkout\?\.path \?\? null, gitEvidence, verificationRun\)/, "Build completion passes host-sampled Git and test evidence into receipt validation");

// The single updateCard choke point strips resuscitations twice: against the
// read-time snapshot and, for async callers whose write lands after Archive,
// against a fresh write-time read.
assert.match(server, /stripArchivedResuscitation\(latest\?\.status, write\)/, "mid-flight archives cannot resuscitate at write time");
// The sync entry skips archived cards before any thread read, and the ask
// CLI names archived threads instead of misreporting ownership.
assert.match(server, /if \(!card\?\.worker_thread_id \|\| isArchivedCard\(card\) \|\| card\.status === "completed" \|\| card\.status === "blocked"\) return;/, "sync polls never touch archived cards");
assert.match(server, /if \(cardRow\.status === "archived"\) return \{ exitCode: 2, stderr: "This card is archived\." \}/, "ask on an archived thread names the state");
// Stage truth is state.md: every sync converges the DB cache once, upfront,
// so question-wait and idle polls never render the last manually-advanced
// checkpoint while the timeline, preset band, split eligibility, and hero
// read the DB value. The convergence write carries stage only — status and
// column movement stay with the explicit advance/move paths, and question
// waits keep their activity-only contract.
assert.match(server, /if \(currentStage && currentStage !== card\.stage\) \{\s+updateCard\(cardId, \{ stage: currentStage \}\);/, "sync converges the DB stage to the state.md slug on every poll");
assert.match(server, /updateCard\(cardId, questionWaitUpdates\(lastOutput\)\)/, "question waits still write activity only");

// List-view groups collapse with archived collapsed by default and stored
// choices surviving reloads; completed build cards read as one state.
assert.match(app, /\{ archived: true, \.\.\.parsed \}/, "stored choices win over the archived-collapsed default");
assert.match(app, /card\?\.status === "completed" \? "where this card is" : <>where this card is/, "completed cards carry no stale stage hint");
assert.match(app, /isTerminalCheckpoint/, "the terminal Audit checkpoint cannot be selected as a reopen target");
assert.match(app, /disabled=\{!clickable \|\| isCurrent\}/, "every current workflow checkpoint is inert, not Audit alone");
assert.match(server, /cardStatus: card\.status/, "the audit watchdog refuses an already-completed card");

// Explore headers never regress to stage/skill wording.
assert.doesNotMatch(app, /Choose a single stage from|Choose one specialized skill and an AI agent runs it/, "stage/skill wording is gone from explore headers");

// Promotion is a true ownership handoff: a new project worker takes over only
// after it starts, and a failed handoff restores the exploratory card.
const promote = rpcMethod("promoteCard", "researchStrategies");
assert.match(promote, /respawnWorkerForBand\(cardId, preset\.id, "project-promotion", \{ previousProjectId: card\.project_id \}\)/, "promotion starts a worker in the new project");
assert.match(promote, /workspace_kind = 'exploratory'/, "failed handoff restores the exploratory workspace");
assert.match(promote, /The card remains exploratory; its existing worker is still active/, "failed handoff explains the safe state");

// One list row for all tracks: Build geometry standard, context per meta.
assert.match(app, /function TrackListRow\(\{ card, meta, summary, onOpen \}/, "all three list views share one row");
assert.match(app, /<TrackListRow key=\{card\.id\} card=\{card\} meta=\{metaFor\(card\)\}/, "lightweight lists render the shared row");

// Attention chip parity: tiles and rows share one component, and the chip
// renders only when the activity pill doesn't already say it — "Waiting
// for you" plus "Answer required" read as the same state twice.
assert.match(buildStatusPills, /export function AttentionChip\(\{ label \}/, "one attention chip serves tiles and rows");
assert.match(app, /<AttentionChip label=\{attentionLabel\(card\)\} \/>/, "both surfaces render the shared chip");
const metaRows = appFunction("CardMetaRows", "function BoardCard(");
assert.match(metaRows, /attention && card\.activity !== "error" && card\.activity !== "awaiting-answer"/, "tiles chip only what the pill doesn't already state");

// Focused-card keyboard: Enter/Space opens the card, W opens its worker
// thread. Guarded to the card surface so typing elsewhere never navigates.
const boardCard = appFunction("BoardCard", "function LightweightTrackCard(");
assert.match(boardCard, /event\.target !== event\.currentTarget/, "card keys ignore events from nested controls");
assert.match(boardCard, /event\.key === "w" \|\| event\.key === "W"/, "W opens the worker thread from a focused build card");
assert.match(boardCard, /navigate\.toThread\(card\.workerThreadId\)/, "W navigates to the card's own worker thread");
const lightweightCard = appFunction("LightweightTrackCard", "function ResearchCard(");
assert.match(lightweightCard, /event\.key === "w" \|\| event\.key === "W"/, "W opens the worker thread from a focused research/explore card");
const listRow = appFunction("TrackListRow", "function BoardColumn(");
assert.match(listRow, /card\.needsAttention && card\.activity !== "awaiting-answer" && card\.activity !== "error" \? <AttentionChip/, "rows follow the same rule — no duplicate state pair");
assert.match(listRow, /event\.key === "w" \|\| event\.key === "W"/, "W opens the worker thread from list-view rows too");
// Esc/Back returns to the board with the card focused: opening remembers the
// card, each card surface restores focus to it on return.
assert.match(app, /stelowReturnFocusCardId = cardId/, "opening a card remembers it for focus return");
assert.match(boardCard, /useReturnFocus<HTMLDivElement>\(card\.id\)/, "build board cards restore focus on return");
assert.match(listRow, /useReturnFocus<HTMLButtonElement>\(card\.id\)/, "list-view rows restore focus on return");
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
assert.match(boardCard, /liveBorderClass\(card\)/, "a Build card needing attention uses its shared live attention border");
assert.match(buildStatusPills, /const started = card\.workerThreadId !== null/, "a parked card names no checkpoint it never reached");
assert.match(buildStatusPills, />Not started<\/Pill>/, "unstarted cards read Not started on tiles and open cards alike");
assert.match(app, /if \(card\.workerThreadId == null\) \{\s*return \{\s*kind: "calm",\s*title: "Not started",/, "the parked hero claims no checkpoint either");
assert.match(buildStatusPills, /export const CURRENT_STAGE_PILL_CLASS/, "the live checkpoint treatment has one definition");
assert.match(app, /\? CURRENT_STAGE_PILL_CLASS/, "the timeline cursor and the progress header share one pulsing shape");
assert.match(app, /<CurrentStagePill stage=\{card\.stage\} \/>/, "the progress header names the checkpoint with the pulsing pill, never detached plain text");
// Research/Explore share one presentation: track icon for position, content
// icon for the playbook tag, statusTone for state, muted for the tag. Tiles
// show identity (tag) while open cards add position (column) — the board
// already gives tiles their position, so only open cards need it.
assert.match(app, /<LightweightStatusPills card=\{card\} statusTone=\{statusTone\} columnLabel=\{null\}/, "tiles show identity only — position comes from the board section");
assert.match(app, /<LightweightStatusPills card=\{card\} statusTone=\{statusTone\} columnLabel=\{RESEARCH_COLUMN_LABELS\[researchColumnOf\(card\)\]/, "open cards add the position pill the board cannot show them");
assert.doesNotMatch(app, /tone="bg-primary\/15 text-primary" title="Research strategy/, "the open research tag no longer out-colors its tile twin");
assert.doesNotMatch(app, /tone="bg-primary\/15 text-primary" title="Technique/, "the open explore tag no longer out-colors its tile twin");
assert.match(app, /stelow-live-surface stelow-detail-surface flex h-full flex-col.*liveBorderClass\(card\)/, "every open track pulses its live border while working");
assert.doesNotMatch(boardCard, /flex-1 truncate text-sm/, "build card titles are no longer truncated beside pills");
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
assert.match(server, /errorNeedsAttention\(row\.status, row\.last_error, activity\)/, "board attention shares the terminal-error predicate");
assert.match(server, /errorNeedsAttention\(card\.status, card\.last_error, effectiveActivity\)/, "detail attention shares the same predicate — badge and card cannot disagree");
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
assert.doesNotMatch(app, /agent's own automatic check/, "the review picker no longer carries the distracting board-column explanation");
assert.doesNotMatch(app, /function WorkflowChoiceSelect</, "the cramped select is gone, not duplicated");
assert.match(server, /Questions are English-only/, "the worker cannot opt a structured card question into another locale");
assert.match(server, /englishQuestionContentError\(group\.question, group\.options\)/, "the CLI rejects Portuguese structured question content before it can create a mismatched card form");
assert.match(server, /presentation: \{ label: askTimelineLabels\(\{ batched, count: groups\.length \}\) \}/, "the blocking ask names its wait on BB's timeline row instead of a generic label");
assert.match(server, /describeSubmission: \(value: unknown\) => describeAskSubmission\(value\)/, "the settled row keeps decisions only — BB never stores the payload or raw value");
assert.match(app, /id: "open-card-for-thread"/, "the palette opens the current thread's card without leaving BB");
assert.match(app, /params: \{ threadId: context\.threadId \}/, "the palette command hands the drawer a thread, never a guessed card");
assert.match(app, /cardByWorkerThread/, "the card drawer resolves palette threads through the owning card");
assert.match(app, /This thread is not a Stelow worker thread/, "a palette open from a foreign thread says so instead of an empty card");
assert.match(answerExpired, /formatBatchContinuation\(decisions\)/, "recovered answers use the same neutral continuation as live answers");
assert.doesNotMatch(answerExpired, /question that timed out/, "recovered answer delivery does not leak timeout jargon into the worker thread");
assert.doesNotMatch(app, />Show<\/span><button/, "no detached Show label explains the read filter");
assert.match(server, /splitQuestionText\(groups\[0\]!\.question\)/, "the split question is host-enriched in English before it reaches the user");
assert.match(server, /kind TEXT NOT NULL DEFAULT 'standard'/, "recovered questions persist an explicit semantic kind");
assert.match(answerExpired, /cleanAnswerList\(item\.answers\)/, "timed-out answers are cleaned through the shared helper before completeness validation");
assert.match(answerExpired, /recordSplitAnswer\(db, cardId, decisions\)/, "a timed-out split answer records through the same shared helper as a live answer");
assert.match(answerExpired, /if \(rows\.size !== openIds\.size\) return \{ ok: false as const, answered: 0, error: "Answer every pending question before submitting\." \}/, "timed-out batches refuse a partial answer at the RPC boundary");
assert.match(app, /\{isLastQuestion \? <Button size="sm" disabled=\{!complete \|\| busy\}/, "the batch action only renders on the last step and waits for every decision");

const threadAction = app.slice(app.indexOf("function OpenStelowAction"), app.indexOf("function StelowArtifactDirective"));
assert.doesNotMatch(threadAction, /min-h-11/, "the thread-header button never forces bar height in a stretching host slot");
assert.match(server, /hasRecoveryCheckout[\s\S]*fileEnvironmentId = !hasRecoveryCheckout/, "recovered exploratory cards use a host file target instead of a stale worker environment");
// One progress section, one artifact home, one reference. The doc buttons that
// duplicated Artifacts are gone, counts are counts, and the reference map is a
// sibling of the progress section rather than nested inside card state.
assert.match(app, /function DisclosureSection\(\{ title, subtitle, hint/, "a section can name its job on its own line");
assert.doesNotMatch(app, /onShowArtifacts/, "the per-stage document buttons are gone; files and navigation never share one shape");
assert.doesNotMatch(app, /workflow\.progressTitle/, "the progress block no longer repeats the disclosure title it sits under");
assert.doesNotMatch(app, /Agent advances alone/, "the override coaching stops being permanent chrome");
const progressSection = app.slice(app.indexOf("DISCLOSURE 1"), app.indexOf("<div ref={artifactsRef}>"));
assert.ok(progressSection.length > 0 && progressSection.indexOf("</CardDisclosure>") < progressSection.indexOf("<WorkflowMap"), "the workflow map is a sibling of progress, never nested inside it");
assert.doesNotMatch(app, /Fresh card — still in triage/, "no Draft pill duplicates the triage column");

// Finished work is not blocked work. The review signal is its own quieter
// treatment, derived from ONE predicate, and it is the completion's read state
// — never the amber attention flag the Inbox badge and attention filter count.
assert.match(app, /card\.status === "completed" && card\.hasPendingReview/, "only an unopened, completed card asks for review");
assert.match(server, /hasPendingReview\(db, row\.id\)/, "list rows carry the review signal from the shared Inbox helper");
assert.match(server, /hasPendingReview\(db, cardId\)/, "card detail carries the same review signal");
assert.match(server, /current\.kind === "build" && !opts\?\.suppressCompletionEvent/, "exactly one completion notification per finished Build card");

// Two receipts, one word apart. Only their freshness tells them apart, so the
// card asks the owning helper for that verdict and labels both where they list.
assert.match(app, /rpc\.call\("auditTrailStatus", \{ cardId \}\)/, "freshness comes from the host, never guessed in the UI");
assert.match(app, /card\.status === "completed" \? <AuditTrailStatusRow cardId=\{card\.id\} \/> : null/, "the freshness row appears only where a receipt can exist");
assert.match(app, /if \(card\?\.status === "completed"\) setArtifactsOpen\(true\)/, "a completed card opens its evidence instead of hiding it");
assert.match(server, /const isTrail = basename\(absolute\) === AUDIT_TRAIL_FILE;/, "the host recognizes the portable receipt by the name Stelow owns");
assert.match(server, /stage: isTrail \? "audit" : "unregistered"/, "the portable receipt is attributed to the stage that produced it");
assert.match(server, /note: auditReceiptNote\(/, "both receipts are labelled where they are listed");
assert.match(server, /auditTrailGate\(\{ build: trail, check: trailCheck, verifiedGit: gitEvidence \}\)/, "the trail is bound to the Git identity the audit receipt was verified at");
assert.match(server, /sameGitEvidence\(gitEvidence, postTrailGitEvidence\)/, "Done re-samples Git after the portable receipt validates");
assert.match(server, /\["audit-trail", "check", "--strict", "--json"\]/, "the post-completion status uses the same strict receipt contract as Done");
assert.match(server, /recon: reconReceiptStatus\(/, "the host derives reconnaissance evidence from the portable receipt, never UI state");
assert.match(server, /RECON_RECEIPT_FILE/, "the reconnaissance receipt path is one shared contract");

console.log("card lifecycle contract test ok: UI and RPC keep card lifecycle semantics aligned");
