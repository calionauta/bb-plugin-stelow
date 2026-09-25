import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  root,
  server,
  serverOperations,
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
  answerExpired,
  detailComment,
  detailTimeline,
  researchQuality,
  researchDialogs,
  detailScopes,
  detailViewer,
  manageHeader,
  rpcMethod,
} from "./card-lifecycle-contract.fixtures.mjs";

const boardCard = boardCards.slice(
  boardCards.indexOf("export function BoardCard"),
  boardCards.indexOf("export function LightweightTrackCard"),
);
const lightweightCard = boardCards.slice(
  boardCards.indexOf("export function LightweightTrackCard"),
  boardCards.indexOf("export function ResearchCard"),
);


// icon for the playbook tag, statusTone for state, muted for the tag. Tiles
// show identity (tag) while open cards add position (column) — the board
// already gives tiles their position, so only open cards need it.
assert.match(
  boardCards,
  /<LightweightStatusPills card=\{card\} statusTone=\{statusTone\} columnLabel=\{null\}/,
  "tiles show identity only — position comes from the board section",
);
assert.match(
  detailSource,
  /<LightweightStatusPills card=\{card\} statusTone=\{statusTone\} columnLabel=\{LIGHTWEIGHT_COLUMN_LABELS\[researchColumnForStatus\(card\.status\)\]/,
  "open lightweight cards add the position pill the board cannot show them",
);
assert.doesNotMatch(
  app,
  /tone="bg-primary\/15 text-primary" title="Research strategy/,
  "the open research tag no longer out-colors its tile twin",
);
assert.doesNotMatch(
  app,
  /tone="bg-primary\/15 text-primary" title="Technique/,
  "the open explore tag no longer out-colors its tile twin",
);
assert.match(
  detailSource,
  /stelow-live-surface stelow-detail-surface flex h-full flex-col.*liveBorderClass\(card\)/,
  "every open track pulses its live border while working",
);
assert.doesNotMatch(
  boardCard,
  /flex-1 truncate text-sm/,
  "build card titles are no longer truncated beside pills",
);
assert.doesNotMatch(
  app,
  /hsl\(280 80% 60%/,
  "running cards no longer cycle through distracting rainbow colors",
);

// Done is terminal for attention, not just for archive: background sync
// never re-errors a completed card, a stale last_error never flags
// attention on one, and Retry is never offered there.
assert.match(
  server,
  /card\.status === "completed" \|\| card\.status === "blocked"/,
  "sync polls never touch completed/blocked cards",
);
// Research and explore now share one sweep, so the terminal guard is a single
// predicate instead of two pasted conditions. The executable coverage lives in
// tests/runtime-research-track-sync.test.mjs; this pin only constrains the
// topology that makes the sharing safe — both tracks must enter through the
// one sweep that consults the one predicate, so a new track handler that
// polls a thread directly (and forgets the guard) fails here.
const trackSyncSource = readFileSync(
  join(root, "server", "runtime", "research-track-sync.ts"),
  "utf8",
);
assert.equal(
  (trackSyncSource.match(/isTerminalTrackStatus\(/g) ?? []).length,
  1,
  "the terminal guard is consulted in exactly one place, the shared sweep",
);
assert.match(
  trackSyncSource,
  /async function sweepTrack\([\s\S]*?if \(isTerminalTrackStatus\(card\.status\)\) return;/,
  "the shared sweep refuses terminal cards before it reads the thread",
);
assert.equal(
  (trackSyncSource.match(/sdk\.threads\.get\(/g) ?? []).length,
  1,
  "only the shared sweep reads a worker thread for these tracks",
);
assert.equal(
  (trackSyncSource.match(/return \{[\s\S]*?syncResearch[\s\S]*?syncExplore/gi) ?? []).length,
  1,
  "research and explore are exported from the one module entry",
);
const failedWriter = serverWorkerRetry.slice(
  serverWorkerRetry.indexOf("async function applyFailed"),
  serverWorkerRetry.indexOf("function dispose"),
);
assert.match(
  failedWriter,
  /current && \(terminal\(current\.status\)/,
  "a dead thread after Done never stains the card",
);
assert.match(
  server,
  /errorNeedsAttention\(row\.status, row\.last_error, activity\)/,
  "board attention shares the terminal-error predicate",
);
assert.match(
  server,
  /errorNeedsAttention\(\s*card\.status,\s*card\.last_error,\s*effectiveActivity,?\s*\)/,
  "detail attention shares the same predicate — badge and card cannot disagree",
);
const retryStart = serverOperations.indexOf("async function retryWorker(");
const retry = serverOperations.slice(
  retryStart,
  serverOperations.indexOf("function startWorker(", retryStart),
);
assert.match(
  retry,
  /card\.status === "completed" \|\| card\.status === "blocked"/,
  "completed cards refuse Retry instead of nudging a finished worker",
);
assert.match(
  server,
  /status: "in-progress",?\s*last_error: null,?\s*\}\);/,
  "answering a question clears the interrupted turn's failure",
);
assert.match(
  server,
  /supersede it at birth/,
  "an error arriving with an open question counts once, in history",
);
assert.match(
  boardCard,
  /cardCanResume\(card\)/,
  "build board cards use the shared terminal retry guard",
);
assert.match(
  lightweightCard,
  /cardCanResume\(card\)/,
  "research/explore cards use the shared terminal retry guard",
);

// Creation settings stay visible under the composer: collapsing them hid
// consequential choices users never discovered. A fixed-height dialog with
// inner scroll keeps the frame stable, and a bordered settings boundary
// keeps the controls attached. Radio cards stay accessible and vertical.
assert.doesNotMatch(
  app,
  /createOptionsOpen/,
  "new-card Settings is never collapsed, so planning depth and review gates are always discoverable",
);
assert.doesNotMatch(
  app,
  /agent's own automatic check/,
  "the review picker no longer carries the distracting board-column explanation",
);
assert.doesNotMatch(
  app,
  /function WorkflowChoiceSelect</,
  "the cramped select is gone, not duplicated",
);
assert.match(
  server,
  /Questions are English-only/,
  "the worker cannot opt a structured card question into another locale",
);
assert.match(
  server,
  /englishQuestionContentError\(\s*group\.question,\s*group\.options,?\s*\)/,
  "the CLI rejects Portuguese structured question content before it can create a mismatched card form",
);
assert.match(
  server,
  /presentation:\s*\{\s*label:\s*askTimelineLabels\(\{\s*batched,\s*count:\s*groups\.length,?\s*\}\),?\s*\},?/,
  "the blocking ask names its wait on BB's timeline row instead of a generic label",
);
assert.match(
  server,
  /describeSubmission: \(value: unknown\) => describeAskSubmission\(value\)/,
  "the settled row keeps decisions only — BB never stores the payload or raw value",
);
assert.match(
  app,
  /id: "open-card-for-thread"/,
  "the palette opens the current thread's card without leaving BB",
);
assert.match(
  app,
  /params: \{ threadId: context\.threadId \}/,
  "the palette command hands the drawer a thread, never a guessed card",
);
assert.match(
  routeAdapters,
  /cardByWorkerThread/,
  "the card drawer resolves palette threads through the owning card",
);
assert.match(
  routeAdapters,
  /This thread is not a Stelow worker thread/,
  "a palette open from a foreign thread says so instead of an empty card",
);
assert.match(
  answerExpired,
  /formatBatchContinuation\(decisions\)/,
  "recovered answers use the same neutral continuation as live answers",
);
assert.doesNotMatch(
  answerExpired,
  /question that timed out/,
  "recovered answer delivery does not leak timeout jargon into the worker thread",
);
assert.doesNotMatch(
  app,
  />Show<\/span><button/,
  "no detached Show label explains the read filter",
);
assert.match(
  server,
  /splitQuestionText\(groups\[0\]!\.question\)/,
  "the split question is host-enriched in English before it reaches the user",
);
assert.match(
  server,
  /ensureColumns\(db, "expired_questions", \[[\s\S]*?\["kind", "TEXT NOT NULL DEFAULT 'standard'"\]/,
  "recovered questions persist an explicit semantic kind",
);
assert.match(
  answerExpired,
  /cleanAnswerList\(item\.answers\)/,
  "timed-out answers are cleaned through the shared helper before completeness validation",
);
assert.match(
  answerExpired,
  /recordSplitAnswer\(db, cardId, decisions\)/,
  "a timed-out split answer records through the same shared helper as a live answer",
);
assert.match(
  answerExpired,
  new RegExp(
    [
      String.raw`if\s*\(rows\.size !== openIds\.size\)\s*return\s*\{\s*ok: false as const,\s*`,
      String.raw`answered: 0,\s*error: "Answer every pending question before submitting\.",?\s*\};`,
    ].join(""),
  ),
  "timed-out batches refuse a partial answer at the RPC boundary",
);
assert.match(
  conversation,
  /\{sel\.isLastQuestion \? <Button size="sm" disabled=\{!sel\.complete \|\| busy\}/,
  "the batch action only renders on the last step and waits for every decision",
);
