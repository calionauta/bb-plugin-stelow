import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const trackLists = readFileSync(join(root, "components/board/track-lists.tsx"), "utf8");
const openStelowAction = readFileSync(join(root, "components/thread/open-stelow-action.tsx"), "utf8");
const routeAdapters = readFileSync(join(root, "components/detail/card-detail-route.tsx"), "utf8");
const researchDetail = readFileSync(join(root, "components/detail/research-detail-body.tsx"), "utf8");
const researchContent = readFileSync(join(root, "components/detail/research-detail-content.tsx"), "utf8");
const researchState = readFileSync(join(root, "components/detail/use-research-detail-state.ts"), "utf8");
const exploreDetail = readFileSync(join(root, "components/detail/explore-detail-body.tsx"), "utf8");
const exploreContent = readFileSync(join(root, "components/detail/explore-detail-content.tsx"), "utf8");
const exploreState = readFileSync(join(root, "components/detail/use-explore-detail-state.ts"), "utf8");
const exploreQuality = readFileSync(join(root, "components/detail/explore-quality-section.tsx"), "utf8");
const buildLifecycleState = readFileSync(join(root, "components/detail/use-build-detail-lifecycle.ts"), "utf8");
const buildLifecycleDialogs = readFileSync(join(root, "components/detail/build-lifecycle-dialogs.tsx"), "utf8");
const buildDetail = readFileSync(join(root, "components/detail/build-detail-body.tsx"), "utf8");
const buildContent = readFileSync(join(root, "components/detail/build-detail-content.tsx"), "utf8");
const buildHero = readFileSync(join(root, "components/detail/build-detail-hero.tsx"), "utf8");
const buildProgressView = readFileSync(join(root, "components/detail/build-detail-progress.tsx"), "utf8");
const buildReviewTools = readFileSync(join(root, "components/detail/build-detail-review-tools.tsx"), "utf8");
const buildWorkspace = readFileSync(join(root, "components/detail/build-detail-workspace.tsx"), "utf8");
const detailQuestions = readFileSync(join(root, "components/detail/detail-question-sections.tsx"), "utf8");
const buildProgress = readFileSync(join(root, "components/detail/build-progress.tsx"), "utf8");
const detailSource = [
  app,
  buildContent,
  buildDetail,
  buildHero,
  buildProgressView,
  buildReviewTools,
  buildWorkspace,
  detailQuestions,
  researchDetail,
  researchContent,
  researchState,
  exploreDetail,
  exploreContent,
  exploreState,
  exploreQuality,
  buildLifecycleDialogs,
  buildProgress,
].join("\n");
const buildStatusPills = readFileSync(join(root, "components/dashboard/build-status-pills.tsx"), "utf8");
const conversation = readFileSync(join(root, "components", "conversation", "question-batch.tsx"), "utf8");
const cardConversation = readFileSync(join(root, "components", "conversation", "card-conversation.tsx"), "utf8");
const workerHistory = readFileSync(join(root, "components", "worker-history", "worker-history.tsx"), "utf8");
const disclosureModule = readFileSync(join(root, "components", "disclosure.tsx"), "utf8");
const artifactModule = readFileSync(join(root, "components", "artifacts", "artifact-inventory.tsx"), "utf8");
const creationModule = readFileSync(join(root, "components", "creation", "creation-settings.tsx"), "utf8");
const strategyPickerModule = readFileSync(join(root, "components", "creation", "strategy-picker.tsx"), "utf8");
const manageMenu = readFileSync(join(root, "components", "manage", "card-actions-menu.tsx"), "utf8");
const manageRecovery = readFileSync(join(root, "components", "manage", "detail-recovery-actions.ts"), "utf8");
const detailBanner = readFileSync(join(root, "components", "detail", "inbox-event-banner.tsx"), "utf8");
const detailPresentation = readFileSync(join(root, "lib", "detail-presentation.mjs"), "utf8");
const detailInputFiles = readFileSync(join(root, "components", "detail", "input-files.tsx"), "utf8");
const detailHero = readFileSync(join(root, "components", "detail", "detail-hero.tsx"), "utf8");
const detailHeroActions = readFileSync(join(root, "components", "detail", "detail-hero-actions.tsx"), "utf8");
const detailComment = readFileSync(join(root, "components", "conversation", "use-detail-comment.ts"), "utf8");
const detailTimeline = readFileSync(join(root, "components", "detail", "stage-timeline.tsx"), "utf8");
const researchQuality = readFileSync(join(root, "components", "detail", "research-quality-section.tsx"), "utf8");
const researchDialogs = readFileSync(join(root, "components", "detail", "research-detail-dialogs.tsx"), "utf8");
const detailScopes = readFileSync(join(root, "components", "detail", "scopes-list.tsx"), "utf8");
const detailViewer = readFileSync(join(root, "components", "detail", "artifact-viewer-dialog.tsx"), "utf8");
const manageHeader = readFileSync(join(root, "components", "manage", "card-detail-header.tsx"), "utf8");

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

// Inline rename: any card renames to 1-120 chars through one RPC; blank
// restores the prompt-derived heuristic instead of refusing or blanking,
// and every surface refreshes through the shared card-state publish.
assert.match(server, /renameCard: \{\s*\n\s*experimental_description: "Rename a card's display title/, "rename is a contracted RPC");
const rename = rpcMethod("renameCard", "addCardComment");
assert.match(rename, /heuristicDisplayName\(card\.prompt, card\.name\)/, "blank restores the heuristic, never a blank title");
assert.match(rename, /UPDATE cards SET display_name = \?, updated_at = \? WHERE id = \?/, "rename writes display_name, nothing else");
assert.match(rename, /publish\("card-state", \{ cardId \}\)/, "rename refreshes open card surfaces");
assert.match(server, /void suggestCardName\(cardId\)\.catch\(\(\) => undefined\);/, "creation triggers titling without waiting");
assert.match(manageHeader, /aria-label="Rename card"/, "the header offers inline rename beside the title");
assert.match(manageHeader, /aria-label="Card title"/, "the rename input is labelled");
assert.match(manageHeader, /rpc\.call\("renameCard", \{ cardId, name: draftName \}\)/, "save rides the rename RPC, cancel just closes");

// Fire-and-forget titling: creation keeps the instant heuristic and the
// Generation burst upgrades it when it lands — never blocking, never
// overwriting a human rename that landed mid-flight.
assert.match(server, /void suggestCardName\(cardId\)\.catch\(\(\) => undefined\);/, "creation triggers titling without waiting");
assert.match(server, /spawnDisposable\(\{[\s\S]*?\}, "card-title"\)/, "titling rides the disposable path as a registered site");

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

assert.match(workerHistory, /workerSectionPolicy\(card, Boolean\(detail\?\.card\.needsAttention\), \{ hasGithubLink, historyCount: detail\?\.workerHistory\.length \?\? 0 \}\)/, "Worker visibility comes from the shared policy");
assert.match(buildProgressView, /archivedCardDetailPresentation\(card, stageLabel\)/, "archived hero and workflow copy come from one presentation policy");

assert.match(manageHeader, /canEditWorkflowIntent\(card\)/, "the header delegates type editability to the shared policy");

assert.doesNotMatch(manageMenu, /Stop & archive/, "two distinct lifecycle actions are never conflated");
// Failure recovery: one hook serves the lightweight bodies — retry in
// place, repair posts-then-resumes through the same retry rail — with
// the track noun flavoring the toast.
assert.match(manageRecovery, /export function useDetailRecoveryActions\(\{ cardId, trackNoun, onChanged/, "retry and repair live in one shared hook");
assert.match(researchState, /useDetailRecoveryActions\(\{\s*cardId,\s*trackNoun: "research",\s*onChanged,/, "the research body delegates recovery");
assert.match(exploreState, /useDetailRecoveryActions\(\{ cardId, trackNoun: "exploration", onChanged \}\)/, "the explore body delegates recovery");
assert.match(researchContent, /import \{ ResearchQualitySection \} from "\.\/research-quality-section"/, "the research body reads the extracted quality section");
assert.doesNotMatch(app, /function ResearchQualitySection\(/, "no research quality copy remains in the panel");
assert.match(exploreDetail, /export function ExploreDetailBody\(/, "the explore detail body owns its route-facing boundary");
assert.match(buildContent, /import \{ ExploreDetailBody \} from "\.\/explore-detail-body"/, "the detail content mounts the extracted explore body");
assert.doesNotMatch(app, /function ExploreDetailBody\(/, "the explore detail body has no local app copy");
assert.equal((exploreState.match(/rpc\.call\("stageCatalog"/g) ?? []).length, 1, "the explore body has one technique catalog read seam");
assert.match(exploreState, /if \(cardStatus === "completed"\) void rpc\.call\("markCardNotificationsRead", \{ cardId, kind: "completed" \}\)/, "viewing completed exploration marks completion read without resolving it");
assert.match(exploreQuality, /rpc\.call\("qualitySeal", \{ cardId, path: filePath \}\)/, "explore quality reads the current stage seal from the host");
assert.doesNotMatch(app, /function ExploreQualitySection\(/, "no explore quality copy remains in the panel");
assert.match(
  detailQuestions,
  /function ExpiredQuestionSection[\s\S]*questions\.length === 0[\s\S]*<ExpiredQuestionsSection[\s\S]*onOpenArtifact=\{onOpenArtifact\}/,
  "expired questions stay answerable through the shared detail section",
);
assert.match(
  detailQuestions,
  /openAskArtifact\([\s\S]*detail\.fileEnvironmentId,[\s\S]*setViewerFile/,
  "question artifacts open through the shared viewer target",
);
assert.match(
  exploreContent,
  /<DetailQuestionSections[\s\S]*openLiveArtifact=\{false\}/,
  "explore keeps live questions answerable without adding artifact opening",
);
assert.match(researchQuality, /sub\.status !== "ready"/, "only failed composite substeps enter repair");
assert.match(researchQuality, /rewrite per the playbook completeness contract, then run verify again\./, "repair lines name the exact fix and verification step");
// Research follow-up dialogs own their RPC and transient state as one slice.
// Background index refreshes must not disturb an open selection, and the panel
// must not accumulate a second implementation of either dialog.
assert.match(researchDetail, /import \{ FanOutDialog, StrategyRunDialog \} from "\.\/research-detail-dialogs"/, "research details read the extracted dialog slice");
assert.match(researchDialogs, /export type ResearchIndexState =/, "the research index shape belongs to the dialog slice");
assert.match(researchDialogs, /export function FanOutDialog\(props: FanOutDialogProps\)/, "fan-out owns its component boundary");
assert.match(researchDialogs, /export function StrategyRunDialog\(props: StrategyRunDialogProps\)/, "strategy rounds own their component boundary");
assert.doesNotMatch(app, /^type ResearchIndexState =|^function (?:FanOutDialog|StrategyRunDialog)\(/m, "no local research dialog or index-state copy remains in the panel");
assert.match(buildContent, /import \{ ResearchDetailBody \} from "\.\/research-detail-body"/, "the detail content mounts the extracted research body");
assert.match(researchDetail, /export function ResearchDetailBody\(/, "the research detail body owns its route-facing boundary");
assert.doesNotMatch(app, /function ResearchDetailBody\(/, "the research detail body has no local app copy");
assert.equal((researchState.match(/rpc\.call\("researchIndex"/g) ?? []).length, 1, "the research body has one index read seam");
assert.equal((researchState.match(/rpc\.call\("researchStrategies"/g) ?? []).length, 1, "the research body has one strategy catalog read seam");
assert.match(researchState, /if \(cardStatus === "completed"\) void rpc\.call\("markCardNotificationsRead", \{ cardId, kind: "completed" \}\)/, "viewing completed research marks completion read without resolving it");
assert.match(researchContent, /<DetailQuestionSections[\s\S]*onAnswered=\{onQuestionsChanged\}/, "research questions share the index refresh callback");
assert.match(detailQuestions, /<QuestionBatch[\s\S]*onAnswered=\{onAnswered\}/, "pending questions refresh the index after an answer");
assert.match(detailQuestions, /<ExpiredQuestionsSection[\s\S]*onAnswered=\{onAnswered\}/, "expired questions refresh the index after an answer");
assert.match(researchContent, /<InboxEventBanner[\s\S]*<ResearchStatus[\s\S]*<InputFiles[\s\S]*<ResearchSummary[\s\S]*<PreviewSection[\s\S]*<ResearchQualitySection[\s\S]*<ResearchArtifacts[\s\S]*<CardConversation/, "research detail keeps its original shared-leaf composition order");
assert.match(researchDetail, /<ConfirmActionDialog[\s\S]*renderPresetDialog[\s\S]*<ArtifactViewerDialog[\s\S]*<FanOutDialog[\s\S]*<StrategyRunDialog/, "research detail composes its confirm, preset, viewer, fan-out, and strategy leaves in order");
assert.match(researchDetail, /onFanned=\{\(\) => \{ onChanged\(\); state\.refreshIndex\(\); \}\}/, "fan-out refreshes card detail and the research index");
assert.match(researchDetail, /onStarted=\{\(\) => \{ onChanged\(\); state\.refreshIndex\(\); \}\}/, "a strategy round refreshes card detail and the research index");
assert.match(researchDialogs, /rpc\.call\("fanOutResearch", \{ cardId: props\.cardId, opportunityIds: chosen\.map\(\(item\) => item\.id\) \}\)/, "fan-out reaches the host through its single owned RPC seam");
assert.match(researchDialogs, /rpc\.call\("runResearchStrategy", \{ cardId: props\.cardId, strategy: active\.id \}\)/, "strategy rounds reach the host through their single owned RPC seam");
assert.match(researchDialogs, /if \(!open\) return;\s*setSelected\(\{\}\);\s*setBusy\(false\);[\s\S]*?\}, \[open\]\);/, "opening fan-out clears selection and busy state without watching refreshed opportunity arrays");
assert.match(researchDialogs, /if \(!props\.open\) return;\s*setBusy\(false\);\s*setPicked\(\(current\) => openedStrategy\(current, props\.strategies, props\.runIds\)\);[\s\S]*?\}, \[props\.open\]\);/, "opening a strategy round resets busy state and defaults the pick once per open");
assert.doesNotMatch(researchDialogs, /\[(?:open|props\.open), (?:opportunities|props\.opportunities|strategies|props\.strategies)\]/, "realtime data changes never become dialog reset dependencies");
assert.match(researchDialogs, /<StrategyPicker strategies=\{props\.strategies\} value=\{picked\}[\s\S]*runIds=\{props\.runIds\}/, "strategy rounds reuse the established picker");
assert.match(manageRecovery, /Worker retried — continuing the \$\{trackNoun\}\./, "the retry toast names its track");
assert.match(manageRecovery, /const retried = await rpc\.call\("retryWorker", \{ cardId \}\)/, "repair resumes through the retry rail, never a second path");
// Detail leaves: one banner definition for every body; event text, time,
// and the relative clock live in lib (tested), never pasted per surface.
assert.match(detailBanner, /export function InboxEventBanner\(\{ visible, event, sectionRef/, "the banner lives in the detail module");
assert.match(detailSource, /InboxEventBanner,[\s\S]*shouldShowInboxEventBanner,[\s\S]*useInboxEventFocus/, "all detail routes read the shared banner and visibility policy");
assert.doesNotMatch(app, /function InboxEventBanner\(/, "no local banner copy survives in the panel");
assert.doesNotMatch(app, /function inboxEventDescription\(/, "descriptions come from lib, never a local copy");
assert.doesNotMatch(app, /function inboxEventTime\(/, "event times come from lib, never a local copy");
assert.doesNotMatch(app, /function relativeTime\(/, "the relative clock lives in lib, never pasted");
assert.match(researchContent, /import \{ joinStrategyLabels, statusTone \} from "\.\.\/\.\.\/lib\/detail-presentation\.mjs"/, "research reads shared strategy and status presentation from one tested lib");
assert.match(researchDetail, /import \{ liveBorderClass \} from "\.\.\/\.\.\/lib\/detail-presentation\.mjs"/, "research reads the shared live border from the same tested lib");
assert.doesNotMatch(app, /function (joinStrategyLabels|liveBorderClass|statusTone)\(/, "no shared detail presentation copy remains in the panel");
assert.match(detailPresentation, /export function (joinStrategyLabels|liveBorderClass|statusTone)/, "the lib owns strategy labels, live borders, and status tones");
assert.match(detailBanner, /export function shouldShowInboxEventBanner/, "banner visibility belongs to the banner feature");
assert.doesNotMatch(app, /function shouldShowInboxEventBanner\(/, "no banner visibility copy remains in the panel");
assert.match(artifactModule, /export function openAskArtifact\(/, "ask artifacts open through the artifact target convention");
assert.match(researchContent, /import \{ ArtifactInventory, type ArtifactInventoryGroup \}/, "research composes the shared artifact inventory");
assert.match(researchContent, /<DetailQuestionSections/, "research delegates question artifacts to the shared detail section");
assert.doesNotMatch(app, /function openAskArtifact\(/, "no ask-artifact opener copy remains in the panel");
assert.match(workerHistory, /export function checkoutNoteFor\(/, "checkout wording belongs to worker presentation");
assert.match(researchContent, /import \{ checkoutNoteFor, WorkerSection \} from "\.\.\/worker-history\/worker-history"/, "research composes shared worker and checkout presentation");
// Input files: one shared renderer; openable files open in the viewer,
// the rest render as plain rows — never a dead button.
assert.match(detailInputFiles, /export function InputFiles\(\{ card, detail, onView/, "input files live in the detail module");
assert.match(detailSource, /import \{ InputFiles \} from/, "all detail routes read the shared input files");
assert.doesNotMatch(app, /function InputFiles\(/, "no local input-files copy survives in the panel");
assert.match(detailInputFiles, /: <div key={`/, "unopenable files render plain, never a dead button");
// Detail hero: one prioritized reading — archived history, then open
// questions, then worker states, then calm. Shared by the three bodies.
assert.match(detailHero, /export function heroFor\(card: HeroCardState, detail: HeroDetailState\)/, "the hero lives in the detail module");
assert.match(detailSource, /import \{ HERO_STYLE, heroFor \} from/, "all detail routes read the shared hero");
assert.doesNotMatch(app, /function heroFor\(/, "no local hero copy survives in the panel");
assert.match(detailHero, /return attentionHero\(card, detail\) \?\? workerHero\(card, detail\) \?\? calmHero\(card\)/, "priority reads attention, then worker, then calm");
assert.match(detailHero, /if \(archived\) return archived\.hero/, "archived history wins over every live state");
assert.match(detailSource, /<DetailHeroActions/g, "all three detail bodies use the shared hero action rail");
assert.equal((detailSource.match(/<DetailHeroActions/g) ?? []).length, 3, "Build, Research, and Explore must not drift into separate action policies");
assert.doesNotMatch(detailSource, /hero\.kind === "error" && card\.workerThreadId/, "recovery branches are no longer pasted per detail body");
assert.match(detailHeroActions, /heroKind === "paused" && card\.lastError \? "Retry" : "Resume"/, "paused failures retry while routine idles resume");
assert.match(detailHeroActions, /card\.activity === "error" && card\.lastError && !preset\.stale/, "a decision can retry a concurrent failure only when the preset is current");
assert.match(detailHeroActions, /<HeroErrorNote card=\{card\} \/>/, "a decision hero keeps the worker error beside the question");
assert.match(detailHeroActions, /heroKind === "calm" && card\.activity === "idle"/, "only a live calm idle offers resume");
assert.equal((detailSource.match(/useDetailComment\(/g) ?? []).length, 3, "all three conversations share one comment submission seam");
assert.doesNotMatch(detailSource, /async function submitComment\(/, "no detail body keeps a private comment sender");
assert.match(detailComment, /rpc\.call\("addCardComment", \{ cardId, target: "card", targetId: cardId, body \}\)/, "trimmed comments route to the card worker");
assert.match(detailComment, /if \(result\.error\)[\s\S]*?setComment\(""\);[\s\S]*?await onChanged\(\);/, "failed comments stay drafted while success clears and refreshes");
// Stage timeline: one shared renderer; advance hits the next legal stage,
// archived never regresses, finished parks past the end.
assert.match(detailTimeline, /export function StageTimeline\(\{ currentStage, nextStages, artifacts, onPick, skips, offRouteReason, terminal/, "the timeline lives in the detail module");
assert.match(buildProgress, /import \{ StageTimeline \} from "\.\/stage-timeline"/, "the extracted build progress body reads the shared timeline");
assert.match(buildWorkspace, /import \{ BAND_LABEL \} from "\.\/stage-timeline"/, "build worker presentation reads the shared band vocabulary");
assert.doesNotMatch(detailSource, /function StageTimeline\(/, "no local timeline copy survives in the detail slice");
assert.match(detailTimeline, /const canAdvance = idx === current \+ 1 && legal\.has\(stage\)/, "advance hits the next legal stage only");
assert.match(detailTimeline, /terminal !== "archived" && passed/, "archived stages never regress");
assert.match(detailTimeline, /terminal \? STAGE_SEQUENCE\.length/, "finished parks the cursor past the end");
// Scope list: dependency-ordered with waiting markers; ordering and rank
// math live in lib (tested); status presentation arrives as functions.
assert.match(detailScopes, /export function ScopesList\(\{ scopes, statusTone, statusGlyph, statusLabel/, "the scope list lives in the detail module");
assert.match(buildProgress, /import \{ ScopesList \} from "\.\/scopes-list"/, "the extracted build progress body reads the shared scope list");
assert.doesNotMatch(detailSource, /function ScopesList\(/, "no local scope-list copy survives in the detail slice");
assert.doesNotMatch(detailSource, /function orderScopes\(/, "ordering lives in lib, never pasted in the detail slice");
assert.match(detailScopes, /\{ordered\.map\(\(scope\) => \(/, "scopes render in dependency order");
assert.match(detailScopes, /waiting on \{wait\.length\}/, "blocked scopes name their wait");
// Manage surfaces: menu, header, and confirm live in one home; the panel
// reads them, never pastes them. Picking a menu entry closes the menu
// before the action runs.
assert.match(manageMenu, /export function CardActionsMenu\(\{ card, onRestartFresh, onArchive, onDiscard, onDelete, onReclassify/, "the menu lives in the manage module");
assert.match(manageHeader, /export function CardDetailHeader\(\{ card, onBack, onRestartFresh, onArchive, onDiscard, onDelete, onReclassify, statusTone, intentLabel/, "the header lives in the manage module");
assert.match(buildDetail, /import \{ CardDetailHeader \} from "\.\.\/manage\/card-detail-header"/, "Build detail reads the shared header");
assert.match(detailSource, /import \{ ConfirmActionDialog \} from "\.\.\/manage\/confirm-action-dialog"|import \{ ConfirmActionDialog \} from "\.\/components\/manage\/confirm-action-dialog"/, "detail bodies read the shared confirm");
assert.doesNotMatch(detailSource, /function CardActionsMenu\(/, "no local menu copy survives in the detail slice");
assert.doesNotMatch(detailSource, /function CardDetailHeader\(/, "no local header copy survives in the detail slice");
assert.doesNotMatch(detailSource, /function ConfirmActionDialog\(/, "no local confirm copy survives in the detail slice");
assert.match(manageMenu, /onPick=\{\(action\) => \{ setOpen\(false\); action\(\); \}\}/, "picking closes the menu before running");

assert.doesNotMatch(workerHistory, /Archive card|Delete permanently|Restart fresh/, "Worker contains worker context only, never card lifecycle actions");

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
// Build lifecycle state is cohesive and has one owned RPC seam per action.
// The tested policy module decides outcomes; the hook owns React state and
// the dialog component owns only confirmations. Copying any path back into
// app.tsx would let its toast/close/refresh semantics drift independently.
assert.match(buildDetail, /import \{ useBuildDetailLifecycle \} from "\.\/use-build-detail-lifecycle"/, "Build detail mounts the extracted lifecycle state");
assert.match(buildDetail, /import \{ BuildLifecycleDialogs \} from "\.\/build-lifecycle-dialogs"/, "Build detail mounts the extracted lifecycle dialogs");
const lifecycleDialogCall = /<BuildLifecycleDialogs[\s\S]*state=\{lifecycle\}[\s\S]*cardDisplayName=\{card\?\.displayName \?\? null\}/;
assert.match(
  buildDetail,
  lifecycleDialogCall,
  "the extracted dialog leaf receives the complete lifecycle state",
);
const privateLifecycleAction = new RegExp(
  "async function (?:doArchive|doDelete|openDiscard|doDiscard|doPromote|" +
  "doAttachRecoveryCheckout|doCreateRecoveryAudit|doRepair|doRetry|" +
  "doRestartWorker|doStart|doRequestSplit)\\(",
);
assert.doesNotMatch(
  detailSource,
  privateLifecycleAction,
  "no Build lifecycle action remains private to the detail slice",
);
assert.match(routeAdapters, /import \{ BuildDetailBody \} from "\.\/build-detail-body"/, "the routes mount the extracted Build detail shell");
assert.equal((routeAdapters.match(/<BuildDetailBody/g) ?? []).length, 2, "panel and drawer routes share one Build detail shell");
assert.doesNotMatch(app, /function CardDetailBody\(/, "the old Build detail implementation is completely removed from app.tsx");
const detailRealtime = /useDebouncedRealtime\(\["card-state", "inbox-changed"\], \(\) => void load\(\)\)/;
assert.match(
  buildDetail,
  detailRealtime,
  "the extracted shell keeps debounced card and inbox refreshes",
);
const closesAdvancePreview = /const confirm = \(\) => \{\s*if \(!pendingAdvance\) return;\s*onOpenChange\(false\);\s*void onAdvance\(pendingAdvance\);/;
assert.match(
  buildDetail,
  closesAdvancePreview,
  "confirming an advance closes the preview before the async transition starts",
);
const buildOrder = buildContent.slice(
  buildContent.indexOf("<BuildReviewHero"),
  buildContent.indexOf("<CardConversation"),
);
assert.ok(
  buildOrder.indexOf("<BuildProgressSection") < buildOrder.indexOf("<WorkflowMap") &&
    buildOrder.indexOf("<WorkflowMap") < buildOrder.indexOf("<BuildArtifacts"),
  "progress, workflow map, and artifacts keep their established detail order",
);
for (const rpc of ["cancelCard", "deleteCard", "discardPreview", "discardCardChanges", "promoteCard", "attachRecoveryCheckout", "createRecoveryAudit", "reseedCard", "retryWorker", "restartWorker", "startWorker", "requestSplitProposal"]) {
  assert.equal((buildLifecycleState.match(new RegExp(`rpc\\.call\\("${rpc}"`, "g")) ?? []).length, 1, `Build lifecycle has one ${rpc} seam`);
}
assert.equal((buildLifecycleDialogs.match(/<ConfirmActionDialog/g) ?? []).length, 6, "the lifecycle dialog leaf owns repair, restart, archive, delete, discard, and recovery confirmation");
assert.match(buildLifecycleDialogs, /<Dialog open=\{state\.promoteOpen\}/, "promotion keeps its named-project dialog in the lifecycle leaf");

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
assert.match(conversation, /<StalenessNotice staleness=\{current\.staleness\} \/>/, "each open question carries its own notice");
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
assert.match(buildProgress, /const positioned = progress\.scopes\.total > 0 \|\| card\.status === "completed"/, "completed cards carry no stale stage hint");
assert.match(buildProgress, /positioned \? "where this card is" : <>where this card is · <CurrentStagePill/, "only cards without a terminal or scoped position show the live checkpoint pill");
assert.match(detailTimeline, /isTerminalCheckpoint/, "the terminal Audit checkpoint cannot be selected as a reopen target");
assert.match(detailTimeline, /disabled=\{!clickable \|\| isCurrent\}/, "every current workflow checkpoint is inert, not Audit alone");
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
assert.match(trackLists, /function TrackListRow\(\{ card, meta, onOpen, onOpenThread \}/, "all three list views share one row");
assert.match(trackLists, /<TrackListRow[\s\S]*meta=\{metaFor\(card\)\}/, "every list adapter renders the shared row");

// Attention chip parity: tiles and rows share one component, and the chip
// renders only when the activity pill doesn't already say it — "Waiting
// for you" plus "Answer required" read as the same state twice.
assert.match(buildStatusPills, /export function AttentionChip\(\{ label \}/, "one attention chip serves tiles and rows");
assert.match(app, /<AttentionChip label=\{attentionLabel\(card\.activity\)\} \/>/, "tiles render the shared chip");
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
const listRow = trackLists.slice(trackLists.indexOf("function TrackListRow"), trackLists.indexOf("function rowTone"));
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
assert.match(trackLists, /event\.key !== "w" && event\.key !== "W"/, "W opens the worker thread from list-view rows too");
// Esc/Back returns to the board with the card focused: opening remembers the
// card, each card surface restores focus to it on return.
assert.match(app, /rememberStelowReturnFocusCardId\(cardId\)/, "opening a card remembers it for focus return");
assert.match(boardCard, /useReturnFocus<HTMLDivElement>\(card\.id\)/, "build board cards restore focus on return");
assert.match(listRow, /useReturnFocus<HTMLButtonElement>\(card\.id\)/, "list-view rows restore focus on return");
assert.doesNotMatch(app, /<span className="font-medium text-muted-foreground\/80">Status<\/span>/, "a generic Status label does not duplicate the self-describing state pills");
assert.match(buildStatusPills, /Workflow stage[\s\S]*stageLabel\(card\.stage\)[\s\S]*Workflow type/, "Build cards identify their specific workflow stage before their workflow type");
assert.match(buildStatusPills, /card\.activity === "awaiting-answer"[\s\S]*ActivityPill/, "Build summaries surface human waiting consistently");
assert.doesNotMatch(buildStatusPills, /Board location|Lifecycle state/, "Build summaries do not duplicate column or lifecycle labels");
assert.match(boardCard, /BuildStatusPills \{\.\.\.buildStatusPillProps\(card\)\}/, "Kanban tiles use the shared Build state presentation");
assert.match(manageHeader, /<BuildStatusPills card=\{card\} statusTone=\{statusTone\} intentLabel=\{intentLabel\} \/>/, "open Build cards use the same state presentation as Kanban tiles");
assert.match(boardCard, /action=\{stuck && card\.activity !== "error" \? <CardRetryButton cardId=\{card\.id\} label="Resume work"/, "build tiles offer heading recovery for idle stalls only, never for failures");
assert.match(lightweightCard, /action=\{stuck && card\.activity !== "error" \? <CardRetryButton cardId=\{card\.id\} label="Resume work"/, "research/explore tiles match: heading recovery is idle-only");
assert.doesNotMatch(boardCard, /bg-destructive\/10/, "build tiles render no failure body — the open card explains");
assert.doesNotMatch(lightweightCard, /bg-destructive\/10/, "research/explore tiles render no failure body either");
assert.match(boardCard, /liveBorderClass\(card\)/, "a Build card needing attention uses its shared live attention border");
assert.match(buildStatusPills, /const started = card\.workerThreadId !== null/, "a parked card names no checkpoint it never reached");
assert.match(buildStatusPills, />Not started<\/Pill>/, "unstarted cards read Not started on tiles and open cards alike");
assert.match(buildStatusPills, /const terminal = card\.status === "completed" \|\| card\.status === "archived"/, "terminal cards are defined once, not per pill");
assert.match(buildStatusPills, /\{!terminal \? \(started/, "completed and archived cards show no stage pill — every checkpoint already traversed");
assert.match(detailHero, /if \(card\.workerThreadId == null\) \{\s*return \{\s*kind: "calm",\s*title: "Not started",/, "the parked hero claims no checkpoint either");
assert.match(buildStatusPills, /export const CURRENT_STAGE_PILL_CLASS/, "the live checkpoint treatment has one definition");
assert.match(detailTimeline, /if \(isCurrent\) return CURRENT_STAGE_PILL_CLASS/, "the timeline cursor and the progress header share one pulsing shape");
assert.match(buildProgress, /<CurrentStagePill stage=\{card\.stage\} \/>/, "the progress header names the checkpoint with the pulsing pill, never detached plain text");
// Research/Explore share one presentation: track icon for position, content
// icon for the playbook tag, statusTone for state, muted for the tag. Tiles
// show identity (tag) while open cards add position (column) — the board
// already gives tiles their position, so only open cards need it.
assert.match(app, /<LightweightStatusPills card=\{card\} statusTone=\{statusTone\} columnLabel=\{null\}/, "tiles show identity only — position comes from the board section");
assert.match(detailSource, /<LightweightStatusPills card=\{card\} statusTone=\{statusTone\} columnLabel=\{LIGHTWEIGHT_COLUMN_LABELS\[researchColumnForStatus\(card\.status\)\]/, "open lightweight cards add the position pill the board cannot show them");
assert.doesNotMatch(app, /tone="bg-primary\/15 text-primary" title="Research strategy/, "the open research tag no longer out-colors its tile twin");
assert.doesNotMatch(app, /tone="bg-primary\/15 text-primary" title="Technique/, "the open explore tag no longer out-colors its tile twin");
assert.match(detailSource, /stelow-live-surface stelow-detail-surface flex h-full flex-col.*liveBorderClass\(card\)/, "every open track pulses its live border while working");
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
assert.match(routeAdapters, /cardByWorkerThread/, "the card drawer resolves palette threads through the owning card");
assert.match(routeAdapters, /This thread is not a Stelow worker thread/, "a palette open from a foreign thread says so instead of an empty card");
assert.match(answerExpired, /formatBatchContinuation\(decisions\)/, "recovered answers use the same neutral continuation as live answers");
assert.doesNotMatch(answerExpired, /question that timed out/, "recovered answer delivery does not leak timeout jargon into the worker thread");
assert.doesNotMatch(app, />Show<\/span><button/, "no detached Show label explains the read filter");
assert.match(server, /splitQuestionText\(groups\[0\]!\.question\)/, "the split question is host-enriched in English before it reaches the user");
assert.match(server, /kind TEXT NOT NULL DEFAULT 'standard'/, "recovered questions persist an explicit semantic kind");
assert.match(answerExpired, /cleanAnswerList\(item\.answers\)/, "timed-out answers are cleaned through the shared helper before completeness validation");
assert.match(answerExpired, /recordSplitAnswer\(db, cardId, decisions\)/, "a timed-out split answer records through the same shared helper as a live answer");
assert.match(answerExpired, /if \(rows\.size !== openIds\.size\) return \{ ok: false as const, answered: 0, error: "Answer every pending question before submitting\." \}/, "timed-out batches refuse a partial answer at the RPC boundary");
assert.match(conversation, /\{sel\.isLastQuestion \? <Button size="sm" disabled=\{!sel\.complete \|\| busy\}/, "the batch action only renders on the last step and waits for every decision");
// Stepper composition: one selection hook drives dots, options, and
// submit; heading and option list render through dedicated units.
assert.match(conversation, /const sel = useBatchSelection\(questions\)/, "dots, options, and submit read one selection state");
assert.match(conversation, /<BatchQuestionHeading questions=\{questions\}/, "the heading renders through one unit");
assert.match(conversation, /<BatchOptionList current=\{current\}/, "options render through one list");
assert.match(conversation, /if \(!has\) setCustom\(\(c\) => \(\{\s*\.\.\.c, \[question\.id\]: ""\s*\}\)\)/, "single-select keeps option and custom text mutually exclusive");
// Agent thread: one shared conversation component across detail bodies —
// history plus compose box — never a per-track copy.
assert.match(cardConversation, /export function CardConversation\(\{ comments, draft, onDraftChange, onSend/, "the agent thread lives in the conversation module");
assert.match(detailSource, /import \{ CardConversation \} from/, "detail bodies read the shared thread");
assert.doesNotMatch(detailSource, /function CardConversation\(/, "no local thread copy survives in the detail slice");
assert.match(cardConversation, /disabled=\{!draft\.trim\(\)\} onClick=\{\(\) => onSend\(\)\}>Send to agent/, "empty drafts cannot send");
assert.match(cardConversation, /event\.metaKey \|\| event\.ctrlKey/, "keyboard send rides Cmd/Ctrl+Enter");

assert.doesNotMatch(openStelowAction, /min-h-11/, "the thread-header button never forces bar height in a stretching host slot");
assert.match(server, /hasRecoveryCheckout[\s\S]*fileEnvironmentId = !hasRecoveryCheckout/, "recovered exploratory cards use a host file target instead of a stale worker environment");
// One progress section, one artifact home, one reference. The doc buttons that
// duplicated Artifacts are gone, counts are counts, and the reference map is a
// sibling of the progress section rather than nested inside card state.
assert.match(disclosureModule, /function DisclosureSection\(\{ title, subtitle, hint/, "a section can name its job on its own line");
assert.doesNotMatch(detailSource, /onShowArtifacts/, "the per-stage document buttons are gone; files and navigation never share one shape");
assert.doesNotMatch(detailSource, /workflow\.progressTitle/, "the progress block no longer repeats the disclosure title it sits under");
assert.doesNotMatch(detailSource, /Agent advances alone/, "the override coaching stops being permanent chrome");
const progressSection = buildContent.slice(
  buildContent.indexOf("<BuildProgressSection"),
  buildContent.indexOf("<BuildArtifacts"),
);
assert.ok(
  progressSection.length > 0 &&
    progressSection.indexOf("<BuildProgressSection") < progressSection.indexOf("<WorkflowMap"),
  "the workflow map is a sibling of extracted progress, never nested inside it",
);
assert.match(readFileSync(join(root, "components", "detail", "workflow-map.tsx"), "utf8"), /export function WorkflowMap\(\{ open, onToggle/, "the map lives in the detail module");
assert.doesNotMatch(detailSource, /function WorkflowMap\(/, "no local map copy survives in the detail slice");
assert.doesNotMatch(app, /Fresh card — still in triage/, "no Draft pill duplicates the triage column");

// Finished work is not blocked work. The review signal is its own quieter
// treatment, derived from ONE predicate, and it is the completion's read state
// — never the amber attention flag the Inbox badge and attention filter count.
assert.match(app, /import \{ pendingReview \} from "\.\/lib\/board-list-presentation\.mjs"/, "board surfaces share the tested review predicate");
assert.match(trackLists, /pendingReview\(card\) \? <ReviewChip/, "list rows only ask for review through the shared completion predicate");
assert.match(server, /hasPendingReview\(db, row\.id\)/, "list rows carry the review signal from the shared Inbox helper");
assert.match(server, /hasPendingReview\(db, cardId\)/, "card detail carries the same review signal");
assert.match(server, /current\.kind === "build" && !opts\?\.suppressCompletionEvent/, "exactly one completion notification per finished Build card");

// Two receipts, one word apart. Only their freshness tells them apart, so the
// card asks the owning helper for that verdict and labels both where they list.
assert.match(artifactModule, /rpc\.call\("auditTrailStatus", \{ cardId \}\)/, "freshness comes from the host, never guessed in the UI");
assert.match(
  buildProgressView,
  /card\.status === "completed" \? <AuditTrailStatusRow cardId=\{card\.id\} \/> : null/,
  "the freshness row appears only where a receipt can exist",
);
// Artifact surfaces: one shared inventory renderer plus the audit-trail
// freshness row — grouping sums through lib, the row re-checks on demand.
assert.match(artifactModule, /export function ArtifactInventory\(\{ groups, workspaceKind, fileEnvironmentId, onView/, "the inventory lives in the artifacts module");
assert.match(artifactModule, /export function AuditTrailStatusRow\(\{ cardId \}/, "the freshness row lives in the artifacts module");
assert.match(
  buildProgressView,
  /import \{\s*ArtifactGroups,\s*AuditTrailStatusRow,\s*artifactGroupTitle,/s,
  "Build progress and artifacts read the shared artifact surfaces",
);
assert.match(
  buildHero,
  /import \{ DetailQuestionSections \} from/,
  "Build review questions delegate artifact opening to the shared detail section",
);
assert.match(
  researchContent,
  /import \{ ArtifactInventory, type ArtifactInventoryGroup \} from "\.\.\/artifacts\/artifact-inventory"/,
  "Research reads the shared artifact inventory",
);
assert.doesNotMatch(detailSource, /function ArtifactInventory\(/, "no local inventory copy survives in the detail slice");
assert.doesNotMatch(detailSource, /function AuditTrailStatusRow\(/, "no local freshness-row copy survives in the detail slice");
assert.match(artifactModule, /groupArtifactsByStage\(artifacts\)/, "stage grouping sums through the lib, never inline math");
// The viewer is shared by every detail track. It owns both live file reads and
// the quote-to-card-comment flow; a local copy would strand draft resets or RPC
// routing even when TypeScript still accepted the three call sites.
assert.match(detailSource, /import \{ ArtifactViewerDialog \} from/, "detail bodies share one artifact viewer");
assert.equal((detailSource.match(/<ArtifactViewerDialog/g) ?? []).length, 3, "Build, Research, and Explore mount the same viewer");
assert.doesNotMatch(detailSource, /function ArtifactViewerDialog\(/, "no local viewer copy survives in the detail slice");
assert.match(detailViewer, /rpc\.call\("readCardFile", \{ cardId, path: file\.path \}\)/, "the viewer reads the selected card file through the host");
assert.match(detailViewer, /rpc\.call\("addCardComment", \{ cardId, target: "card", targetId: cardId, body: commentBody\(file, drafts\) \}\)/, "quoted excerpts post to the card worker as one comment");
assert.match(detailViewer, /if \(open && file\) setDrafts\(\[\]\)/, "opening or changing the file clears excerpts from the previous file");
assert.match(detailViewer, /\(no note — for context\)/, "an excerpt without a note still sends honest context");
// Review checkpoints: bulk actions and one-click templates write into the
// same multi-select state as the checkboxes — shortcuts, never a second
// model; rows render through one shared row.
assert.match(creationModule, /<ReviewGateBulkActions onChange=\{onChange\} \/>/, "select-all and clear share the picker state");
assert.match(creationModule, /<ReviewGateTemplates onPick=\{onChange\} \/>/, "templates write into the picker state");
assert.match(creationModule, /onClick=\{\(\) => onPick\(\[\.\.\.preset\.gates\]\)\}/, "a template replaces the selection, never appends");
assert.match(creationModule, /<ReviewGateOptionRow key=\{option\.value\} option=\{option\} selected=\{value\.includes\(option\.value\)\} groupName=\{groupName\} onToggle=\{toggle\} \/>/, "options render through one shared row");
// Strategy picker: search narrows across identity, label, blurb, and
// keywords; results delegate rows; the attention signal drives the flash.
assert.match(strategyPickerModule, /strategies\.filter\(\(entry\) => \[entry\.id, entry\.label, entry\.blurb, \.\.\.entry\.keywords\]/, "search narrows the list, never just filters it");
assert.match(strategyPickerModule, /<StrategyOptionRow key=\{entry\.id\} entry=\{entry\} selected=\{value === entry\.id\}/, "options render through one shared row");
assert.match(strategyPickerModule, /<StrategyResults visible=\{visible\}/, "the shell composes search, count, and results");
assert.match(strategyPickerModule, /const flash = useAttentionFlash\(attentionSignal, searchRef\)/, "the attention signal drives search focus and flash");
assert.match(buildDetail, /if \(card\?\.status === "completed"\) setArtifactsOpen\(true\)/, "a completed card opens its evidence instead of hiding it");
assert.match(server, /const isTrail = basename\(absolute\) === AUDIT_TRAIL_FILE;/, "the host recognizes the portable receipt by the name Stelow owns");
assert.match(server, /stage: isTrail \? "audit" : "unregistered"/, "the portable receipt is attributed to the stage that produced it");
assert.match(server, /note: auditReceiptNote\(/, "both receipts are labelled where they are listed");
assert.match(server, /auditTrailGate\(\{ build: trail, check: trailCheck, verifiedGit: gitEvidence \}\)/, "the trail is bound to the Git identity the audit receipt was verified at");
assert.match(server, /sameGitEvidence\(gitEvidence, postTrailGitEvidence\)/, "Done re-samples Git after the portable receipt validates");
assert.match(server, /\["audit-trail", "check", "--strict", "--json"\]/, "the post-completion status uses the same strict receipt contract as Done");
assert.match(server, /recon: reconReceiptStatus\(/, "the host derives reconnaissance evidence from the portable receipt, never UI state");
assert.match(server, /RECON_RECEIPT_FILE/, "the reconnaissance receipt path is one shared contract");

// Every path into completed records the done trail event: the explicit
// done command, both quiet auto-complete sweeps, and manual moves into
// Done. A Done-column card without one is invisible to flow metrics —
// that was the whole "N finished vs N in Done" confusion.
assert.equal((server.match(/recordStageEvent\(card\.id, "done"\)/g) ?? []).length, 2, "both quiet auto-completions record the done event");
assert.match(server, /if \(decision\.move\.status === "completed"\) recordStageEvent\(cardId, "done"\)/, "manual moves into Done record the done event");

console.log("card lifecycle contract test ok: UI and RPC keep card lifecycle semantics aligned");
