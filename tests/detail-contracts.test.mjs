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

// Detail leaves: one banner definition for every body; event text, time,
// and the relative clock live in lib (tested), never pasted per surface.
assert.match(
  detailBanner,
  /export function InboxEventBanner\(\{ visible, event, sectionRef/,
  "the banner lives in the detail module",
);
assert.match(
  detailSource,
  /InboxEventBanner,[\s\S]*shouldShowInboxEventBanner,[\s\S]*useInboxEventFocus/,
  "all detail routes read the shared banner and visibility policy",
);
assert.doesNotMatch(
  app,
  /function InboxEventBanner\(/,
  "no local banner copy survives in the panel",
);
assert.doesNotMatch(
  app,
  /function inboxEventDescription\(/,
  "descriptions come from lib, never a local copy",
);
assert.doesNotMatch(
  app,
  /function inboxEventTime\(/,
  "event times come from lib, never a local copy",
);
assert.doesNotMatch(
  app,
  /function relativeTime\(/,
  "the relative clock lives in lib, never pasted",
);
assert.match(
  researchContent,
  /import \{ joinStrategyLabels, statusTone \} from "\.\.\/\.\.\/lib\/detail-presentation\.mjs"/,
  "research reads shared strategy and status presentation from one tested lib",
);
assert.match(
  researchDetail,
  /import \{ liveBorderClass \} from "\.\.\/\.\.\/lib\/detail-presentation\.mjs"/,
  "research reads the shared live border from the same tested lib",
);
assert.doesNotMatch(
  app,
  /function (joinStrategyLabels|liveBorderClass|statusTone)\(/,
  "no shared detail presentation copy remains in the panel",
);
assert.match(
  detailPresentation,
  /export function (joinStrategyLabels|liveBorderClass|statusTone)/,
  "the lib owns strategy labels, live borders, and status tones",
);
assert.match(
  detailBanner,
  /export function shouldShowInboxEventBanner/,
  "banner visibility belongs to the banner feature",
);
assert.doesNotMatch(
  app,
  /function shouldShowInboxEventBanner\(/,
  "no banner visibility copy remains in the panel",
);
assert.match(
  artifactModule,
  /export function openAskArtifact\(/,
  "ask artifacts open through the artifact target convention",
);
assert.match(
  researchContent,
  /import \{ ArtifactInventory, type ArtifactInventoryGroup \}/,
  "research composes the shared artifact inventory",
);
assert.match(
  researchContent,
  /<DetailQuestionSections/,
  "research delegates question artifacts to the shared detail section",
);
assert.doesNotMatch(
  app,
  /function openAskArtifact\(/,
  "no ask-artifact opener copy remains in the panel",
);
assert.match(
  workerHistory,
  /export function checkoutNoteFor\(/,
  "checkout wording belongs to worker presentation",
);
assert.match(
  researchContent,
  /import \{ checkoutNoteFor, WorkerSection \} from "\.\.\/worker-history\/worker-history"/,
  "research composes shared worker and checkout presentation",
);
// Input files: one shared renderer; openable files open in the viewer,
// the rest render as plain rows — never a dead button.
assert.match(
  detailInputFiles,
  /export function InputFiles\(\{ card, detail, onView/,
  "input files live in the detail module",
);
assert.match(
  detailSource,
  /import \{ InputFiles \} from/,
  "all detail routes read the shared input files",
);
assert.doesNotMatch(
  app,
  /function InputFiles\(/,
  "no local input-files copy survives in the panel",
);
assert.match(
  detailInputFiles,
  /: <div key={`/,
  "unopenable files render plain, never a dead button",
);
// Detail hero: one prioritized reading — archived history, then open
// questions, then worker states, then calm. Shared by the three bodies.
assert.match(
  detailHero,
  /export function heroFor\(card: HeroCardState, detail: HeroDetailState\)/,
  "the hero lives in the detail module",
);
assert.match(
  detailSource,
  /import \{ HERO_STYLE, heroFor \} from/,
  "all detail routes read the shared hero",
);
assert.doesNotMatch(
  app,
  /function heroFor\(/,
  "no local hero copy survives in the panel",
);
assert.match(
  detailHero,
  /return attentionHero\(card, detail\) \?\? workerHero\(card, detail\) \?\? calmHero\(card\)/,
  "priority reads attention, then worker, then calm",
);
assert.match(
  detailHero,
  /if \(archived\) return archived\.hero/,
  "archived history wins over every live state",
);
assert.match(
  detailSource,
  /<DetailHeroActions/g,
  "all three detail bodies use the shared hero action rail",
);
assert.equal(
  (detailSource.match(/<DetailHeroActions/g) ?? []).length,
  3,
  "Build, Research, and Explore must not drift into separate action policies",
);
assert.doesNotMatch(
  detailSource,
  /hero\.kind === "error" && card\.workerThreadId/,
  "recovery branches are no longer pasted per detail body",
);
assert.match(
  detailHeroActions,
  /heroKind === "paused" && card\.lastError \? "Retry" : "Resume"/,
  "paused failures retry while routine idles resume",
);
assert.match(
  detailHeroActions,
  /card\.activity === "error" && card\.lastError && !preset\.stale/,
  "a decision can retry a concurrent failure only when the preset is current",
);
assert.match(
  detailHeroActions,
  /<HeroErrorNote card=\{card\} \/>/,
  "a decision hero keeps the worker error beside the question",
);
assert.match(
  detailHeroActions,
  /heroKind === "calm" && card\.activity === "idle"/,
  "only a live calm idle offers resume",
);
assert.equal(
  (detailSource.match(/useDetailComment\(/g) ?? []).length,
  3,
  "all three conversations share one comment submission seam",
);
assert.doesNotMatch(
  detailSource,
  /async function submitComment\(/,
  "no detail body keeps a private comment sender",
);
assert.match(
  detailComment,
  /rpc\.call\("addCardComment", \{ cardId, target: "card", targetId: cardId, body \}\)/,
  "trimmed comments route to the card worker",
);
assert.match(
  detailComment,
  /if \(result\.error\)[\s\S]*?setComment\(""\);[\s\S]*?await onChanged\(\);/,
  "failed comments stay drafted while success clears and refreshes",
);
// Stage timeline: one shared renderer; advance hits the next legal stage,
// archived never regresses, finished parks past the end.
assert.match(
  detailTimeline,
  /export function StageTimeline\(\{ currentStage, nextStages, artifacts, onPick, skips, offRouteReason, terminal/,
  "the timeline lives in the detail module",
);
assert.match(
  buildProgress,
  /import \{ StageTimeline \} from "\.\/stage-timeline"/,
  "the extracted build progress body reads the shared timeline",
);
assert.match(
  buildWorkspace,
  /import \{ BAND_LABEL \} from "\.\/stage-timeline"/,
  "build worker presentation reads the shared band vocabulary",
);
assert.doesNotMatch(
  detailSource,
  /function StageTimeline\(/,
  "no local timeline copy survives in the detail slice",
);
assert.match(
  detailTimeline,
  /const canAdvance = idx === current \+ 1 && legal\.has\(stage\)/,
  "advance hits the next legal stage only",
);
assert.match(
  detailTimeline,
  /terminal !== "archived" && passed/,
  "archived stages never regress",
);
assert.match(
  detailTimeline,
  /terminal \? STAGE_SEQUENCE\.length/,
  "finished parks the cursor past the end",
);
// Scope list: dependency-ordered with waiting markers; ordering and rank
// math live in lib (tested); status presentation arrives as functions.
assert.match(
  detailScopes,
  /export function ScopesList\(\{ scopes, statusTone, statusGlyph, statusLabel/,
  "the scope list lives in the detail module",
);
assert.match(
  buildProgress,
  /import \{ ScopesList \} from "\.\/scopes-list"/,
  "the extracted build progress body reads the shared scope list",
);
assert.doesNotMatch(
  detailSource,
  /function ScopesList\(/,
  "no local scope-list copy survives in the detail slice",
);
assert.doesNotMatch(
  detailSource,
  /function orderScopes\(/,
  "ordering lives in lib, never pasted in the detail slice",
);
assert.match(
  detailScopes,
  /\{ordered\.map\(\(scope\) => \(/,
  "scopes render in dependency order",
);
assert.match(
  detailScopes,
  /waiting on \{wait\.length\}/,
  "blocked scopes name their wait",
);
