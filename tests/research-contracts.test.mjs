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

// Research follow-up dialogs own their RPC and transient state as one slice.
// Background index refreshes must not disturb an open selection, and the panel
// must not accumulate a second implementation of either dialog.
assert.match(
  researchDetail,
  /import \{ FanOutDialog, StrategyRunDialog \} from "\.\/research-detail-dialogs"/,
  "research details read the extracted dialog slice",
);
assert.match(
  researchDialogs,
  /export type ResearchIndexState =/,
  "the research index shape belongs to the dialog slice",
);
assert.match(
  researchDialogs,
  /export function FanOutDialog\(props: FanOutDialogProps\)/,
  "fan-out owns its component boundary",
);
assert.match(
  researchDialogs,
  /export function StrategyRunDialog\(props: StrategyRunDialogProps\)/,
  "strategy rounds own their component boundary",
);
assert.doesNotMatch(
  app,
  /^type ResearchIndexState =|^function (?:FanOutDialog|StrategyRunDialog)\(/m,
  "no local research dialog or index-state copy remains in the panel",
);
assert.match(
  buildContent,
  /import \{ ResearchDetailBody \} from "\.\/research-detail-body"/,
  "the detail content mounts the extracted research body",
);
assert.match(
  researchDetail,
  /export function ResearchDetailBody\(/,
  "the research detail body owns its route-facing boundary",
);
assert.doesNotMatch(
  app,
  /function ResearchDetailBody\(/,
  "the research detail body has no local app copy",
);
assert.equal(
  (researchState.match(/rpc\.call\("researchIndex"/g) ?? []).length,
  1,
  "the research body has one index read seam",
);
assert.equal(
  (researchState.match(/rpc\.call\("researchStrategies"/g) ?? []).length,
  1,
  "the research body has one strategy catalog read seam",
);
assert.match(
  researchState,
  /if \(cardStatus === "completed"\) void rpc\.call\("markCardNotificationsRead", \{ cardId, kind: "completed" \}\)/,
  "viewing completed research marks completion read without resolving it",
);
assert.match(
  researchContent,
  /<DetailQuestionSections[\s\S]*onAnswered=\{onQuestionsChanged\}/,
  "research questions share the index refresh callback",
);
assert.match(
  detailQuestions,
  /<QuestionBatch[\s\S]*onAnswered=\{onAnswered\}/,
  "pending questions refresh the index after an answer",
);
assert.match(
  detailQuestions,
  /<ExpiredQuestionsSection[\s\S]*onAnswered=\{onAnswered\}/,
  "expired questions refresh the index after an answer",
);
assert.match(
  researchContent,
  new RegExp(
    "<InboxEventBanner[\\s\\S]*<ResearchStatus[\\s\\S]*<InputFiles[\\s\\S]*"
      + "<ResearchSummary[\\s\\S]*<PreviewSection[\\s\\S]*"
      + "<ResearchQualitySection[\\s\\S]*<ResearchArtifacts[\\s\\S]*"
      + "<CardConversation",
  ),
  "research detail keeps its original shared-leaf composition order",
);
assert.match(
  researchDetail,
  /<ConfirmActionDialog[\s\S]*<PresetAssignDialog[\s\S]*<ArtifactViewerDialog[\s\S]*<FanOutDialog[\s\S]*<StrategyRunDialog/,
  "research composes its confirm, preset, viewer, fan-out, and strategy leaves in order",
);
assert.match(
  researchDetail,
  /<PresetAssignDialog[\s\S]*cardId=\{cardId\}[\s\S]*onChanged=\{state\.onQuestionsChanged\}/,
  "research preset changes refresh the index-backed question state",
);
assert.doesNotMatch(
  researchDetail,
  /renderPresetDialog/,
  "research no longer receives a preset renderer from the Build shell",
);
assert.match(
  exploreDetail,
  /<PresetAssignDialog[\s\S]*cardId=\{cardId\}[\s\S]*onChanged=\{onChanged\}/,
  "explore preset changes refresh its detail state",
);
assert.doesNotMatch(
  exploreDetail,
  /renderPresetDialog/,
  "explore no longer receives a preset renderer from the Build shell",
);
assert.doesNotMatch(
  buildContent,
  /renderPresetDialog=/,
  "the Build content shell no longer forwards preset rendering into lightweight cards",
);
assert.equal(
  (researchDetail.match(/<PresetAssignDialog/g) ?? []).length,
  1,
  "research mounts exactly one assign dialog",
);
assert.equal(
  (exploreDetail.match(/<PresetAssignDialog/g) ?? []).length,
  1,
  "explore mounts exactly one assign dialog",
);
assert.match(
  buildDetail,
  /<PresetDialogs cardId=\{cardId\} view=\{view\}/,
  "Build keeps its card-bound preset dialog seam",
);
assert.match(
  buildDetail,
  /ownsPresetDialog = view\.card\?\.kind === "build"/,
  "the Build shell identifies which card kinds own preset assignment",
);
assert.match(
  buildDetail,
  /ownsPresetDialog \? view\.renderPresetDialog\(\{[\s\S]*onChanged: \(\) => void load\(\)[\s\S]*\) : null/,
  "the Build shell renders its injected preset dialog only for Build cards",
);
assert.match(
  routeAdapters,
  /<BuildDetailBody[\s\S]*renderPresetDialog=\{\(props\) => renderPresetDialog\(cardId, props\)\}/,
  "panel and drawer adapters bind Build preset assignment to the current card",
);
assert.equal(
  (assignDialog.match(/export function PresetAssignDialog/g) ?? []).length,
  1,
  "the assign dialog has one focused implementation",
);
assert.doesNotMatch(
  app,
  /function PresetAssignDialog/,
  "the app shell no longer owns assign dialog behavior",
);
assert.match(
  researchDetail,
  /onFanned=\{\(\) => \{ onChanged\(\); state\.refreshIndex\(\); \}\}/,
  "fan-out refreshes card detail and the research index",
);
assert.match(
  researchDetail,
  /onStarted=\{\(\) => \{ onChanged\(\); state\.refreshIndex\(\); \}\}/,
  "a strategy round refreshes card detail and the research index",
);
assert.match(
  researchDialogs,
  /rpc\.call\("fanOutResearch", \{ cardId: props\.cardId, opportunityIds: chosen\.map\(\(item\) => item\.id\) \}\)/,
  "fan-out reaches the host through its single owned RPC seam",
);
assert.match(
  researchDialogs,
  /rpc\.call\("runResearchStrategy", \{ cardId: props\.cardId, strategy: active\.id \}\)/,
  "strategy rounds reach the host through their single owned RPC seam",
);
assert.match(
  researchDialogs,
  /if \(!open\) return;\s*setSelected\(\{\}\);\s*setBusy\(false\);[\s\S]*?\}, \[open\]\);/,
  "opening fan-out clears selection and busy state without watching refreshed opportunity arrays",
);
assert.match(
  researchDialogs,
  new RegExp(
    "if \\(!props\\.open\\) return;\\s*setBusy\\(false\\);\\s*"
      + "setPicked\\(\\(current\\) => openedStrategy\\(current, "
      + "props\\.strategies, props\\.runIds\\)\\);"
      + "[\\s\\S]*?\\}, \\[props\\.open\\]\\);",
  ),
  "opening a strategy round resets busy state and defaults the pick once per open",
);
assert.doesNotMatch(
  researchDialogs,
  /\[(?:open|props\.open), (?:opportunities|props\.opportunities|strategies|props\.strategies)\]/,
  "realtime data changes never become dialog reset dependencies",
);
assert.match(
  researchDialogs,
  /<StrategyPicker strategies=\{props\.strategies\} value=\{picked\}[\s\S]*runIds=\{props\.runIds\}/,
  "strategy rounds reuse the established picker",
);
assert.match(
  manageRecovery,
  /Worker retried — continuing the \$\{trackNoun\}\./,
  "the retry toast names its track",
);
assert.match(
  manageRecovery,
  /const retried = await rpc\.call\("retryWorker", \{ cardId \}\)/,
  "repair resumes through the retry rail, never a second path",
);
