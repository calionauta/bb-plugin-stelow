import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  root,
  server,
  serverOperations,
  threadProjection,
  cliDone,
  cliAsk,
  cliAskRun,
  cardDiff,
  cardState,
  cardPromotion,
  serverRecovery,
  serverInbox,
  serverWorkerRetry,
  cardsPersist,
  app,
  navigation,
  trackLists,
  boardCards,
  openStelowAction,
  routeAdapters,
  assignDialog,
  researchDetail,
  researchContent,
  researchState,
  exploreDetail,
  exploreContent,
  exploreState,
  exploreQuality,
  buildLifecycleState,
  buildLifecycleDialogs,
  buildDetail,
  buildContent,
  buildHero,
  buildProgressView,
  buildReviewTools,
  buildWorkspace,
  detailQuestions,
  buildProgress,
  detailSource,
  buildStatusPills,
  conversation,
  cardConversation,
  workerHistory,
  drafting,
  disclosureModule,
  artifactModule,
  creationModule,
  strategyPickerModule,
  manageMenu,
  manageRecovery,
  detailBanner,
  detailPresentation,
  detailInputFiles,
  detailHero,
  detailHeroActions,
  detailComment,
  detailTimeline,
  researchQuality,
  researchDialogs,
  detailScopes,
  detailViewer,
  manageHeader,
  rpcMethod,
} from "./card-lifecycle-contract.fixtures.mjs";

// Archived terminality binds every worker-touching or state-moving RPC, not
// just the poll path: each refuses upfront with the named exit.
const move = serverOperations;
assert.match(
  move,
  /if \(isArchivedCard\(card\)\)\s*return \{ ok: false, error: deps\.errors\.cardArchived \}/,
  "archived cards refuse board moves",
);
const cardDetailRuntime = readFileSync(
  join(root, "server", "runtime", "card-detail.ts"),
  "utf8",
);
const advance = readFileSync(
  join(root, "server", "execution-advance.ts"),
  "utf8",
);
assert.match(
  advance,
  /deps\.isArchivedCard\(card\)/,
  "stage advances check archived state",
);
assert.match(
  advance,
  /error: deps\.errors\.cardArchived/,
  "archived stage advances name the terminal refusal",
);
assert.match(
  advance,
  /if \(card\.kind !== "build"\)/,
  "the execution advance route stays Build-only",
);
assert.doesNotMatch(
  advance,
  /stage === "audit" \? "completed"/,
  "Audit is not an implicit completion path",
);
const comment = rpcMethod("addCardComment", "cancelCard");
assert.match(
  comment,
  /if \(isArchivedCard\(card\)\)\s*return \{ commentId: "", error: ERR_CARD_ARCHIVED \}/,
  "archived cards refuse new comments",
);
assert.match(
  server,
  /statusForNewCardWork\(\{[\s\S]*?kind: card\.kind,[\s\S]*?status: card\.status,[\s\S]*?stage: card\.stage[\s\S]*?\}\)/,
  "a card comment reopens completed work through the shared lifecycle helper",
);
assert.match(
  threadProjection,
  /status: statusForNewCardWork\(\{\s*kind: card\.kind,\s*status: card\.status,\s*stage,\s*\}\)\.status,/,
  "a direct thread message reopens completed work through the same helper, on the projected stage",
);
assert.equal(
  (server.match(/statusForNewCardWork\(\{/g) ?? []).length,
  2,
  "the reopen helper has exactly two call sites: the card comment and the thread projection",
);
assert.match(
  serverRecovery,
  /async function recoveredCheckoutIntegrity\(/,
  "recovered checkouts have a dedicated integrity check before diffing",
);
assert.match(
  cardDiff,
  /const recoveryError = await deps\.recoveredIntegrity\(card, checkout\.path\)/,
  "recovered diffs fail closed when their attached Git root changes",
);
assert.match(
  cliDone,
  /verificationReadiness\(verificationRun, evidence\.git\)/,
  "Build completion requires a host-recorded test result at the current Git identity",
);
assert.match(
  server,
  /hasWorker: card\.worker_thread_id !== null/,
  "the split flag knows whether a worker exists to propose from",
);
assert.match(
  server,
  /if \(!card\.worker_thread_id\)\s*return \{ ok: false, error: "This card has no worker thread\." \}/,
  "the split trigger refuses threadless cards even if the UI ever offers it",
);
assert.match(
  server,
  /CREATE TABLE IF NOT EXISTS question_evidence/,
  "asked documents keep an ask-time baseline for staleness notices",
);
assert.match(
  cliAskRun,
  /void deps\.snapshotQuestionEvidence\(\s*cardId,\s*groups\.flatMap/,
  "asking snapshots its documents before the blocking wait, never blocking the ask",
);
assert.match(
  server,
  /const stalenessForQuestions = createQuestionStaleness\(/,
  "the composition root wires the question-staleness evidence reader",
);
assert.match(
  cardDetailRuntime,
  /deps\.stalenessForQuestions\(cardId, \[\.\.\.pending, \.\.\.expiredQuestions\]\)/,
  "card reads compare every open question against its baseline",
);
assert.match(
  conversation,
  /<StalenessNotice staleness=\{current\.staleness\} \/>/,
  "each open question carries its own notice",
);
const receiptArgs = new RegExp([
  String.raw`auditReceiptReadiness\(`,
  String.raw`\s*await receiptContent\(deps, stateDir\),`,
  String.raw`\s*stateBlob \? parseArtifactManifest\(stateBlob\) : \[\],`,
  String.raw`\s*evidence\.checkoutPath,\s*evidence\.git,\s*verificationRun,`,
].join(""));
assert.match(
  cliDone,
  receiptArgs,
  "Build completion passes host-sampled Git and test evidence into receipt validation",
);

// The single updateCard choke point strips resuscitations twice: against the
// read-time snapshot and, for async callers whose write lands after Archive,
// against a fresh write-time read.
assert.match(
  cardState,
  /stripArchivedResuscitation\([\s\S]*?deps\.getCard\(cardId\)\?\.status,[\s\S]*?write[\s\S]*?\)/,
  "mid-flight archives cannot resuscitate at write time",
);
// The sync entry skips archived cards before any thread read, and the ask
// CLI names archived threads instead of misreporting ownership.
assert.match(
  server,
  /card\.status === "completed" \|\| card\.status === "blocked"/,
  "sync polls never touch archived cards",
);
assert.match(
  cliAsk,
  /if \(cardRow\.status === "archived"\)\s*return refuse\(\{ exitCode: 2, stderr: "This card is archived\." \}\);/,
  "ask on an archived thread names the state",
);
// Stage truth is state.md: every sync converges the DB cache once, upfront,
// so question-wait and idle polls never render the last manually-advanced
// checkpoint while the timeline, preset band, split eligibility, and hero
// read the DB value. The convergence write carries stage only — status and
// column movement stay with the explicit advance/move paths, and question
// waits keep their activity-only contract.
assert.match(
  server,
  /if \(snapshot\.stage && snapshot\.stage !== snapshot\.card\.stage\) \{\s+deps\.updateCard\(snapshot\.card\.id, \{ stage: snapshot\.stage \}\);/,
  "sync converges the DB stage to the state.md slug on every poll",
);
assert.match(
  server,
  /updateCard\(snapshot\.card\.id, questionWaitUpdates\(snapshot\.lastOutput\)\)/,
  "question waits still write activity only",
);

// Completed build cards read as one state.
assert.match(
  buildProgress,
  /const positioned = progress\.scopes\.total > 0 \|\| card\.status === "completed"/,
  "completed cards carry no stale stage hint",
);
assert.match(
  buildProgress,
  /positioned \? "where this card is" : <>where this card is · <CurrentStagePill/,
  "only cards without a terminal or scoped position show the live checkpoint pill",
);
assert.match(
  detailTimeline,
  /isTerminalCheckpoint/,
  "the terminal Audit checkpoint cannot be selected as a reopen target",
);
assert.match(
  detailTimeline,
  /disabled=\{!clickable \|\| isCurrent\}/,
  "every current workflow checkpoint is inert, not Audit alone",
);
assert.match(
  server,
  /cardStatus: snapshot\.card\.status/,
  "the audit watchdog refuses an already-completed card",
);

// Explore headers never regress to stage/skill wording.
assert.doesNotMatch(
  app,
  /Choose a single stage from|Choose one specialized skill and an AI agent runs it/,
  "stage/skill wording is gone from explore headers",
);

// Promotion is a true ownership handoff: a new project worker takes over only
// after it starts, and a failed handoff restores the exploratory card.
const promote = cardPromotion;
const promotionRespawn =
  /deps\.respawn\(card\.id, preset\.id, "project-promotion", [\s\S]*?previousProjectId: card\.project_id[\s\S]*?\)/;
assert.match(
  promote,
  promotionRespawn,
  "promotion starts a worker in the new project",
);
assert.match(
  promote,
  /workspace_kind = 'exploratory'/,
  "failed handoff restores the exploratory workspace",
);
assert.match(
  promote,
  /The card remains exploratory; its existing worker is still active/,
  "failed handoff explains the safe state",
);
