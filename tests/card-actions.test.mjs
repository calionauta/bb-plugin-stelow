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

const updateIntent = rpcMethod("updateCardIntent", "addCardComment");
assert.match(
  updateIntent,
  /if \(!canEditWorkflowIntent\(card\)\)/,
  "only triage Build cards can edit their workflow type",
);
assert.doesNotMatch(
  updateIntent,
  /threads\.send\(/,
  "editing type never silently redirects an existing worker",
);

// Inline rename: any card renames to 1-120 chars through one RPC; blank
// restores the prompt-derived heuristic instead of refusing or blanking,
// and every surface refreshes through the shared card-state publish.
assert.match(
  server,
  /renameCard: \{\s*\n\s*experimental_description: "Rename a card's display title/,
  "rename is a contracted RPC",
);
const rename = rpcMethod("renameCard", "addCardComment");
assert.match(
  rename,
  /heuristicDisplayName\(card\.prompt, card\.name\)/,
  "blank restores the heuristic, never a blank title",
);
assert.match(
  rename,
  /UPDATE cards SET display_name = \?, updated_at = \? WHERE id = \?/,
  "rename writes display_name, nothing else",
);
assert.match(
  rename,
  /publish\("card-state", \{ cardId \}\)/,
  "rename refreshes open card surfaces",
);
assert.match(
  cardsPersist,
  /void deps\.suggestCardName\(cardId\)\.catch\(\(\) => undefined\);/,
  "creation triggers titling without waiting",
);
assert.match(
  manageHeader,
  /aria-label="Rename card"/,
  "the header offers inline rename beside the title",
);
assert.match(
  manageHeader,
  /aria-label="Card title"/,
  "the rename input is labelled",
);
assert.match(
  manageHeader,
  /rpc\.call\("renameCard", \{ cardId, name: draftName \}\)/,
  "save rides the rename RPC, cancel just closes",
);

// Fire-and-forget titling: creation keeps the instant heuristic and the
// Generation burst upgrades it when it lands — never blocking, never
// overwriting a human rename that landed mid-flight.
assert.match(
  cardsPersist,
  /void deps\.suggestCardName\(cardId\)\.catch\(\(\) => undefined\);/,
  "creation triggers titling without waiting",
);
assert.match(
  drafting,
  /spawnDisposable\(\{[\s\S]*?\}, "card-title"\)/,
  "titling rides the disposable path as a registered site",
);

const byThread = rpcMethod("cardByWorkerThread", "gapSummary");
assert.doesNotMatch(
  byThread,
  /row\.status === "archived"/,
  "an archived card's thread still links back to its card",
);
assert.match(
  serverInbox,
  /function createGetHandler\(/,
  "notification detail lives with the extracted inbox feature",
);

const reseed = rpcMethod("reseedCard", "moveCard");
assert.match(
  reseed,
  /resolveReseedIntent\(card, requestedIntent\)/,
  "fresh restarts are the only route reclassification path",
);
assert.match(
  reseed,
  /freshStatusForReseed\(card, reclassified\)/,
  "reclassification reopens the card at a coherent status",
);
assert.match(
  reseed,
  /publish\("card-state", \{ cardId \}\)/,
  "reclassification refreshes open card surfaces",
);

const archive = rpcMethod("cancelCard", "deleteCard");
assert.match(
  archive,
  /publish\("card-state", \{ cardId \}\)/,
  "archive refreshes open card surfaces",
);
assert.match(
  archive,
  /publish\("board-changed", \{ cardId \}\)/,
  "archive refreshes board surfaces",
);

const remove = rpcMethod("deleteCard", "retryWorker");
assert.match(
  remove,
  /publish\("card-state", \{ cardId \}\)/,
  "delete refreshes open card surfaces",
);
assert.match(
  remove,
  /publish\("board-changed", \{ cardId \}\)/,
  "delete refreshes board surfaces",
);

assert.match(
  workerHistory,
  /workerSectionPolicy\(card, Boolean\(detail\?\.card\.needsAttention\), \{ hasGithubLink, historyCount: detail\?\.workerHistory\.length \?\? 0 \}\)/,
  "Worker visibility comes from the shared policy",
);
assert.match(
  buildProgressView,
  /archivedCardDetailPresentation\(card, stageLabel\)/,
  "archived hero and workflow copy come from one presentation policy",
);

assert.match(
  manageHeader,
  /canEditWorkflowIntent\(card\)/,
  "the header delegates type editability to the shared policy",
);

assert.doesNotMatch(
  manageMenu,
  /Stop & archive/,
  "two distinct lifecycle actions are never conflated",
);
// Failure recovery: one hook serves the lightweight bodies — retry in
// place, repair posts-then-resumes through the same retry rail — with
// the track noun flavoring the toast.
assert.match(
  manageRecovery,
  /export function useDetailRecoveryActions\(\{ cardId, trackNoun, onChanged/,
  "retry and repair live in one shared hook",
);
assert.match(
  researchState,
  /useDetailRecoveryActions\(\{\s*cardId,\s*trackNoun: "research",\s*onChanged,/,
  "the research body delegates recovery",
);
assert.match(
  exploreState,
  /useDetailRecoveryActions\(\{ cardId, trackNoun: "exploration", onChanged \}\)/,
  "the explore body delegates recovery",
);
assert.match(
  researchContent,
  /import \{ ResearchQualitySection \} from "\.\/research-quality-section"/,
  "the research body reads the extracted quality section",
);
assert.doesNotMatch(
  app,
  /function ResearchQualitySection\(/,
  "no research quality copy remains in the panel",
);
assert.match(
  exploreDetail,
  /export function ExploreDetailBody\(/,
  "the explore detail body owns its route-facing boundary",
);
assert.match(
  buildContent,
  /import \{ ExploreDetailBody \} from "\.\/explore-detail-body"/,
  "the detail content mounts the extracted explore body",
);
assert.doesNotMatch(
  app,
  /function ExploreDetailBody\(/,
  "the explore detail body has no local app copy",
);
assert.equal(
  (exploreState.match(/rpc\.call\("stageCatalog"/g) ?? []).length,
  1,
  "the explore body has one technique catalog read seam",
);
assert.match(
  exploreState,
  /if \(cardStatus === "completed"\) void rpc\.call\("markCardNotificationsRead", \{ cardId, kind: "completed" \}\)/,
  "viewing completed exploration marks completion read without resolving it",
);
assert.match(
  exploreQuality,
  /rpc\.call\("qualitySeal", \{ cardId, path: filePath \}\)/,
  "explore quality reads the current stage seal from the host",
);
assert.doesNotMatch(
  app,
  /function ExploreQualitySection\(/,
  "no explore quality copy remains in the panel",
);
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
assert.match(
  researchQuality,
  /sub\.status !== "ready"/,
  "only failed composite substeps enter repair",
);
assert.match(
  researchQuality,
  /rewrite per the playbook completeness contract, then run verify again\./,
  "repair lines name the exact fix and verification step",
);
