import assert from "node:assert/strict";
import {
  app,
  researchDetail,
  researchContent,
  buildWorkspace,
  buildProgress,
  detailSource,
  workerHistory,
  artifactModule,
  detailBanner,
  detailPresentation,
  detailInputFiles,
  detailHero,
  detailHeroActions,
  lifecycleDialogs,
  buildDetailBody,
  detailComment,
  detailTimeline,
  detailScopes,
  stageSection,
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
// "Answering below resumes the worker" is a claim that a conversation exists.
// On an unowned card it does not — the conversation is refused until the
// records agree — so the sentence has to name the action that does work. Both
// arms are pinned because the fix is a gate, and a gate that closes on one
// case and forgets the other is a regression that reads as an improvement.
assert.match(
  detailHero,
  /isOwnershipRefusal\(card\.lastError\)/,
  "the error note distinguishes an unowned card from an ordinary failure",
);
assert.match(
  detailHero,
  /Restart fresh… in the card actions menu is what clears this/,
  "and names the door that does work",
);
assert.doesNotMatch(
  lifecycleDialogs,
  /Try Retry first/,
  "the repair dialog reads its advice instead of re-spelling it, so it cannot drift",
);
assert.match(
  lifecycleDialogs,
  /description=\{repairDescription\(cardLastError\)\}/,
  "and the dialog picks its advice from the card's own error",
);
assert.match(
  buildDetailBody,
  /cardLastError=\{card\?\.lastError \?\? null\}/,
  "the detail body hands the dialog the error the choice depends on",
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
// Stage timeline: one shared renderer, and it is INERT — no `onPick`, because the
// workflow is the agent's to drive. The chip used to be a button that moved the card, and
// a person who wants a different stage asks the agent in the conversation instead. Pinned
// as the absence of the prop, because re-adding a click target is the regression: the
// board would look like a drag-and-drop tool again.
assert.match(
  detailTimeline,
  /export function StageTimeline\(\{ currentStage, nextStages, artifacts, skips, offRouteReason, terminal/,
  "the timeline lives in the detail module and takes no pick handler",
);
assert.doesNotMatch(
  detailTimeline,
  /onPick/,
  "and nothing in it accepts a stage pick — the chips are indicators, not controls",
);
assert.doesNotMatch(
  detailSource,
  /AdvanceDialog|pendingAdvance/,
  "the advance dialog is gone with its only trigger: a stage is changed by asking the agent, not by clicking a chip",
);
assert.match(
  stageSection,
  /import \{ StageTimeline \} from "\.\/stage-timeline"/,
  "the stage section reads the shared timeline — it took over from build-progress when the timeline, "
    + "run history and stage reference merged into one section. The shared renderer is the point: one "
    + "timeline, not two, and this pin fails if a second reader appears",
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
// The advance/regress rules are gone with the click target they governed. `canAdvance`
// still decides how a chip is TONED (an upcoming legal stage reads as reachable), which is
// information; what it no longer decides is whether a click does anything, because no
// click does. The regression to guard is a re-added handler, not a lost legality rule.
assert.match(
  detailTimeline,
  /const canAdvance = idx === current \+ 1 && legal\.has\(stage\)/,
  "an upcoming legal stage is still distinguished, so the reader can see where the card can go",
);
assert.doesNotMatch(
  detailTimeline,
  /canRegress/,
  "and no regress rule survives: it existed only to enable a click, and the chips are inert",
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
  /waiting on \{waitCount\}/,
  "blocked scopes name their wait — the count moved from `wait.length` to a `waitCount` prop when the "
    + "summary row was split out, and the rule is unchanged: a blocked scope says how many it waits on",
);
