import assert from "node:assert/strict";
import {
  root,
  server,
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

// One list row for all tracks: Build geometry standard, context per meta.
assert.match(
  trackLists,
  /function TrackListRow\(\{ card, meta, onOpen, onOpenThread \}/,
  "all three list views share one row",
);
assert.match(
  trackLists,
  /<TrackListRow[\s\S]*meta=\{metaFor\(card\)\}/,
  "every list adapter renders the shared row",
);

// Attention chip parity: tiles and rows share one component, and the chip
// renders only when the activity pill doesn't already say it — "Waiting
// for you" plus "Answer required" read as the same state twice.
assert.match(
  buildStatusPills,
  /export function AttentionChip\(\{ label \}/,
  "one attention chip serves tiles and rows",
);
assert.match(
  boardCards,
  /<AttentionChip label=\{attentionLabel\(card\.activity\)\} \/>/,
  "tiles render the shared chip",
);
const metaRows = boardCards.slice(
  boardCards.indexOf("export function CardMetaRows"),
  boardCards.indexOf("export function CardHeading"),
);
assert.match(
  metaRows,
  /cardShowsAttention\(card\)/,
  "tiles chip only what the pill doesn't already state",
);

// Focused-card keyboard: Enter/Space opens the card, W opens its worker
// thread. Guarded to the card surface so typing elsewhere never navigates.
const boardCard = boardCards.slice(
  boardCards.indexOf("export function BoardCard"),
  boardCards.indexOf("export function LightweightTrackCard"),
);
assert.match(
  boardCard,
  /event\.target !== event\.currentTarget/,
  "card keys ignore events from nested controls",
);
assert.match(
  boardCard,
  /event\.key === "w" \|\| event\.key === "W"/,
  "W opens the worker thread from a focused build card",
);
assert.match(
  boardCard,
  /navigate\.toThread\(card\.workerThreadId\)/,
  "W navigates to the card's own worker thread",
);
const lightweightCard = boardCards.slice(
  boardCards.indexOf("export function LightweightTrackCard"),
  boardCards.indexOf("export function ResearchCard"),
);
assert.match(
  lightweightCard,
  /event\.key === "w" \|\| event\.key === "W"/,
  "W opens the worker thread from a focused research/explore card",
);
const listRow = trackLists.slice(
  trackLists.indexOf("function TrackListRow"),
  trackLists.indexOf("function rowTone"),
);
assert.match(
  listRow,
  /showAttention\(card\) \? <AttentionChip label=\{attentionLabel\(card\.activity\)\}/,
  "rows follow the same rule — no duplicate state pair",
);
assert.match(
  trackLists,
  /!\[(?:"|')awaiting-answer(?:"|'), (?:"|')error(?:"|')\]\.includes\(card\.activity\)/,
  "row attention suppression covers both terminal wait and error states",
);
assert.match(
  trackLists,
  /event\.key !== "w" && event\.key !== "W"/,
  "W opens the worker thread from list-view rows too",
);
// Esc/Back returns to the board with the card focused: opening remembers the
// card, each card surface restores focus to it on return.
assert.match(
  navigation,
  /rememberStelowReturnFocusCardId\(cardId\)/,
  "opening a card remembers it for focus return",
);
assert.match(
  boardCard,
  /useReturnFocus<HTMLDivElement>\(card\.id\)/,
  "build board cards restore focus on return",
);
assert.match(
  listRow,
  /useReturnFocus<HTMLButtonElement>\(card\.id\)/,
  "list-view rows restore focus on return",
);
assert.doesNotMatch(
  app,
  /<span className="font-medium text-muted-foreground\/80">Status<\/span>/,
  "a generic Status label does not duplicate the self-describing state pills",
);
assert.match(
  buildStatusPills,
  /Workflow stage[\s\S]*stageLabel\(card\.stage\)[\s\S]*Workflow type/,
  "Build cards identify their specific workflow stage before their workflow type",
);
assert.match(
  buildStatusPills,
  /card\.activity === "awaiting-answer"[\s\S]*ActivityPill/,
  "Build summaries surface human waiting consistently",
);
assert.doesNotMatch(
  buildStatusPills,
  /Board location|Lifecycle state/,
  "Build summaries do not duplicate column or lifecycle labels",
);
assert.match(
  boardCard,
  /BuildStatusPills card=\{card\}/,
  "Kanban tiles use the shared Build state presentation",
);
assert.match(
  manageHeader,
  /<BuildStatusPills card=\{card\} statusTone=\{statusTone\} intentLabel=\{intentLabel\} \/>/,
  "open Build cards use the same state presentation as Kanban tiles",
);
assert.match(
  boardCard,
  /cardCanResume\(card\) && card\.activity !== "error"/,
  "build tiles offer heading recovery for idle stalls only, never for failures",
);
assert.match(
  lightweightCard,
  /cardCanResume\(card\) && card\.activity !== "error"/,
  "research/explore tiles match: heading recovery is idle-only",
);
assert.doesNotMatch(
  boardCard,
  /bg-destructive\/10/,
  "build tiles render no failure body — the open card explains",
);
assert.doesNotMatch(
  lightweightCard,
  /bg-destructive\/10/,
  "research/explore tiles render no failure body either",
);
assert.match(
  boardCard,
  /liveBorderClass\(card\)/,
  "a Build card needing attention uses its shared live attention border",
);
assert.match(
  buildStatusPills,
  /const started = card\.workerThreadId !== null/,
  "a parked card names no checkpoint it never reached",
);
assert.match(
  buildStatusPills,
  />Not started<\/Pill>/,
  "unstarted cards read Not started on tiles and open cards alike",
);
assert.match(
  buildStatusPills,
  /const terminal = card\.status === "completed" \|\| card\.status === "archived"/,
  "terminal cards are defined once, not per pill",
);
assert.match(
  buildStatusPills,
  /\{!terminal \? \(started/,
  "completed and archived cards show no stage pill — every checkpoint already traversed",
);
assert.match(
  detailHero,
  /if \(card\.workerThreadId == null\) \{\s*return \{\s*kind: "calm",\s*title: "Not started",/,
  "the parked hero claims no checkpoint either",
);
assert.match(
  buildStatusPills,
  /export const CURRENT_STAGE_PILL_CLASS/,
  "the live checkpoint treatment has one definition",
);
assert.match(
  detailTimeline,
  /if \(isCurrent\) return CURRENT_STAGE_PILL_CLASS/,
  "the timeline cursor and the progress header share one pulsing shape",
);
assert.match(
  buildProgress,
  /<CurrentStagePill stage=\{card\.stage\} \/>/,
  "the progress header names the checkpoint with the pulsing pill, never detached plain text",
);
