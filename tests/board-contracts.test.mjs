import assert from "node:assert/strict";
import {
  app,
  navigation,
  trackLists,
  boardCards,
  buildProgress,
  buildStatusPills,
  detailHero,
  detailTimeline,
  manageHeader,
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

// One chip per state, on both surfaces.
//
// A stalled card used to wear TWO chips — `Paused` from pausedActivityLabel and
// `Paused. Resume it.` from the amber AttentionChip — because both were fed by
// the same predicate and neither knew the other had already spoken. The board
// said one state twice, on the narrowest row in the product. What this pins is
// the REFUSAL: the amber attention chip is gone, so it cannot come back as a
// "harmless" second call site, and each surface renders the pause chip at
// exactly one place.
assert.doesNotMatch(
  buildStatusPills,
  /export function AttentionChip/,
  "the attention chip that duplicated the pause chip is deleted, not merely unused — an exported "
  + "component with no caller is how it got reintroduced the first time",
);
assert.doesNotMatch(
  `${boardCards}\n${trackLists}`,
  /<AttentionChip/,
  "a tile or row rendering a second chip for the same stall is the regression this pins",
);
// The slice is the tile's CHIP component, not `CardMetaRows`: the chips were
// extracted when the list outgrew a 50-line function, and pinning the render
// function would have read zero pause chips while the tile rendered one.
const tileChips = boardCards.slice(
  boardCards.indexOf("function CardAlertChips"),
  boardCards.indexOf("function CardContextRow"),
);
const pauseSites = (source) => (source.match(/<PausedChip /g) ?? []).length;
assert.equal(
  pauseSites(tileChips),
  1,
  "one pause chip per tile: two is the same fact told twice, zero is a stall the reader cannot see",
);
// The lightweight list row swaps `ActivityPill` for the pause chip rather than
// stacking them, because the pill already says `Paused` for every idle card.
assert.match(
  boardCards,
  /pausedActivityLabel\(card\)/,
  "the tile's pause chip is fed by the shared label, not by a locally rebuilt condition",
);

// Focused-card keyboard: Enter/Space opens the card, W opens its worker
// thread. Guarded to the card surface so typing elsewhere never navigates.
// Both tiles share one shell, so the pins read the shell — not each tile.
const cardShell = boardCards.slice(
  boardCards.indexOf("function CardShell"),
  boardCards.indexOf("function CardResumeFooter"),
);
const boardCard = boardCards.slice(
  boardCards.indexOf("export function BoardCard"),
  boardCards.indexOf("export function LightweightTrackCard"),
);
assert.match(
  cardShell,
  /event\.target !== event\.currentTarget/,
  "card keys ignore events from nested controls",
);
assert.match(
  cardShell,
  /event\.key === "w" \|\| event\.key === "W"/,
  "W opens the worker thread from a focused build card",
);
assert.match(
  cardShell,
  /navigate\.toThread\(card\.workerThreadId\)/,
  "W navigates to the card's own worker thread",
);
const lightweightCard = boardCards.slice(
  boardCards.indexOf("export function LightweightTrackCard"),
  boardCards.indexOf("export function ResearchCard"),
);
assert.match(
  cardShell,
  /event\.key === "w" \|\| event\.key === "W"/,
  "W opens the worker thread from a focused research/explore card",
);
// The row's chips moved into their own component when the integration chip
// joined them; the rule it guards is the same one, so the pin follows the
// code that carries it rather than the row that renders it.
const listRow = trackLists.slice(
  trackLists.indexOf("function TrackListRow"),
  trackLists.indexOf("function rowTone"),
);
const listRowStatus = trackLists.slice(
  trackLists.indexOf("function ListRowStatus"),
  trackLists.indexOf("function TrackListRow"),
);
assert.equal(
  pauseSites(listRowStatus),
  1,
  "one pause chip per list row, for the same reason as the tile",
);
assert.match(
  listRowStatus,
  /\{paused \? null : <ActivityPill activity=\{card\.activity\} \/>\}/,
  "a paused row suppresses the generic `Paused` pill instead of printing the state twice — the pair "
  + "that made one stall read as two chips",
);
assert.doesNotMatch(
  trackLists,
  /showAttention\(/,
  "the row's attention predicate is deleted with the chip it fed; a leftover predicate is a door with no room",
);
// The pair of predicates that used to disagree about what a stall is lives in
// one module now (`lib/card-stall.mjs`), so a row cannot suppress the generic
// pill on a condition the chip was not fed by. Asserted here as the wiring, and
// in tests/card-attention.test.mjs as the behaviour.
assert.match(
  trackLists,
  /pausedActivityLabel\(card\)/,
  "the row's chip and its suppression come from one label, so they cannot disagree",
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
  cardShell,
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
const resumeFooter = boardCards.slice(
  boardCards.indexOf("function CardResumeFooter"),
  boardCards.indexOf("export function BoardCard"),
);
assert.match(
  resumeFooter,
  /cardCanResume\(card\) && card\.activity !== "error"/,
  "build tiles offer heading recovery for idle stalls only, never for failures",
);
assert.match(
  resumeFooter,
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
  cardShell,
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
