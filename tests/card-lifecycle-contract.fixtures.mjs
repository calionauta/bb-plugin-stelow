import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const server = [
  readFileSync(join(root, "server.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "thread-lifecycle.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "thread-state-projection.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "build-thread-sync.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "card-detail.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "card-detail-presentation.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "card-detail-artifacts.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "card-mutations.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "card-state.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "card-audit-trail.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "card-lifecycle.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "card-operations.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "research-track-sync.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "track-sync-core.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "track-prompts.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "track-capabilities.ts"), "utf8"),
  readFileSync(join(root, "server", "plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "wiring", "rpc-surfaces.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "wiring", "gate-surfaces.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "wiring", "card-surfaces.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "wiring", "card-creator.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "wiring", "execution-surfaces.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "wiring", "host-surfaces.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "wiring", "cli-surfaces.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "wiring", "deferred.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "start-workflow-prompt.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "pending-questions.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "read-runtime.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "card-seams.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "track-projection.ts"), "utf8"),
  readFileSync(join(root, "server", "card-rpc-contract.ts"), "utf8"),
  readFileSync(join(root, "server", "core-migrations.ts"), "utf8"),
  readFileSync(join(root, "server/cards.ts"), "utf8"),
].join("\n");
export const cliAsk = readFileSync(
  join(root, "server", "runtime", "cli", "cli-ask-gate.ts"),
  "utf8",
);
export const cliAskRun = readFileSync(
  join(root, "server", "runtime", "cli", "cli-ask.ts"),
  "utf8",
);
export const cliDone = [
  readFileSync(join(root, "server", "runtime", "cli", "cli-done.ts"), "utf8"),
  readFileSync(join(root, "server", "runtime", "cli", "cli-done-build.ts"), "utf8"),
].join("\n");
export const threadProjection = readFileSync(
  join(root, "server", "runtime", "thread-state-projection.ts"),
  "utf8",
);
export const serverOperations = readFileSync(
  join(root, "server", "runtime", "card-operations.ts"),
  "utf8",
);
export const cardReseed = readFileSync(
  join(root, "server", "runtime", "card-reseed.ts"),
  "utf8",
);
export const cardDiff = readFileSync(
  join(root, "server", "runtime", "card-diff.ts"),
  "utf8",
);
export const cardState = readFileSync(
  join(root, "server", "runtime", "card-state.ts"),
  "utf8",
);
export const cardPromotion = readFileSync(
  join(root, "server", "runtime", "card-promotion.ts"),
  "utf8",
);
export const serverRecovery = readFileSync(
  join(root, "server/workspaces-recovery.ts"),
  "utf8",
);
export const serverInbox = readFileSync(join(root, "server/inbox.ts"), "utf8");
export const answerExpired = readFileSync(
  join(root, "server/runtime/question-answers.ts"),
  "utf8",
);

export const serverWorkerRetry = readFileSync(
  join(root, "server/workers-retry.ts"),
  "utf8",
);
export const cardsPersist = readFileSync(
  join(root, "server/cards-create-persist.ts"),
  "utf8",
);
export const app = readFileSync(join(root, "app.tsx"), "utf8");
export const navigation = readFileSync(
  join(root, "components/app-support/navigation.ts"),
  "utf8",
);
export const trackLists = readFileSync(
  join(root, "components/board/track-lists.tsx"),
  "utf8",
);
export const boardCards = readFileSync(
  join(root, "components/board/board-cards.tsx"),
  "utf8",
);
export const openStelowAction = readFileSync(
  join(root, "components/thread/open-stelow-action.tsx"),
  "utf8",
);
export const routeAdapters = readFileSync(
  join(root, "components/detail/card-detail-route.tsx"),
  "utf8",
);
export const assignDialog = readFileSync(
  join(root, "components/settings/preset-assign-dialog.tsx"),
  "utf8",
);
export const researchDetail = readFileSync(
  join(root, "components/detail/research-detail-body.tsx"),
  "utf8",
);
export const researchContent = readFileSync(
  join(root, "components/detail/research-detail-content.tsx"),
  "utf8",
);
export const researchState = readFileSync(
  join(root, "components/detail/use-research-detail-state.ts"),
  "utf8",
);
export const exploreDetail = readFileSync(
  join(root, "components/detail/explore-detail-body.tsx"),
  "utf8",
);
export const exploreContent = readFileSync(
  join(root, "components/detail/explore-detail-content.tsx"),
  "utf8",
);
export const exploreState = readFileSync(
  join(root, "components/detail/use-explore-detail-state.ts"),
  "utf8",
);
export const exploreQuality = readFileSync(
  join(root, "components/detail/explore-quality-section.tsx"),
  "utf8",
);
export const buildLifecycleState = readFileSync(
  join(root, "components/detail/use-build-detail-lifecycle.ts"),
  "utf8",
);
export const buildLifecycleDialogs = readFileSync(
  join(root, "components/detail/build-lifecycle-dialogs.tsx"),
  "utf8",
);
export const buildDetail = readFileSync(
  join(root, "components/detail/build-detail-body.tsx"),
  "utf8",
);
export const buildContent = readFileSync(
  join(root, "components/detail/build-detail-content.tsx"),
  "utf8",
);
export const buildHero = readFileSync(
  join(root, "components/detail/build-detail-hero.tsx"),
  "utf8",
);
export const buildProgressView = readFileSync(
  join(root, "components/detail/build-detail-progress.tsx"),
  "utf8",
);
export const buildReviewTools = readFileSync(
  join(root, "components/detail/build-detail-review-tools.tsx"),
  "utf8",
);
export const buildWorkspace = readFileSync(
  join(root, "components/detail/build-detail-workspace.tsx"),
  "utf8",
);
export const detailQuestions = readFileSync(
  join(root, "components/detail/detail-question-sections.tsx"),
  "utf8",
);
export const buildProgress = readFileSync(
  join(root, "components/detail/build-progress.tsx"),
  "utf8",
);
export const detailSource = [
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
export const buildStatusPills = readFileSync(
  join(root, "components/dashboard/build-status-pills.tsx"),
  "utf8",
);
export const conversation = readFileSync(
  join(root, "components", "conversation", "question-batch.tsx"),
  "utf8",
);
export const cardConversation = readFileSync(
  join(root, "components", "conversation", "card-conversation.tsx"),
  "utf8",
);
export const workerHistory = readFileSync(
  join(root, "components", "worker-history", "worker-history.tsx"),
  "utf8",
);
export const drafting = readFileSync(join(root, "server", "drafting.ts"), "utf8");
export const disclosureModule = readFileSync(
  join(root, "components", "disclosure.tsx"),
  "utf8",
);
export const artifactModule = readFileSync(
  join(root, "components", "artifacts", "artifact-inventory.tsx"),
  "utf8",
);
export const creationModule = readFileSync(
  join(root, "components", "creation", "creation-settings.tsx"),
  "utf8",
);
export const strategyPickerModule = readFileSync(
  join(root, "components", "creation", "strategy-picker.tsx"),
  "utf8",
);
export const manageMenu = readFileSync(
  join(root, "components", "manage", "card-actions-menu.tsx"),
  "utf8",
);
export const manageRecovery = readFileSync(
  join(root, "components", "manage", "detail-recovery-actions.ts"),
  "utf8",
);
export const detailBanner = readFileSync(
  join(root, "components", "detail", "inbox-event-banner.tsx"),
  "utf8",
);
export const detailPresentation = readFileSync(
  join(root, "lib", "detail-presentation.mjs"),
  "utf8",
);
export const detailInputFiles = readFileSync(
  join(root, "components", "detail", "input-files.tsx"),
  "utf8",
);
export const detailHero = readFileSync(
  join(root, "components", "detail", "detail-hero.tsx"),
  "utf8",
);
export const detailHeroActions = readFileSync(
  join(root, "components", "detail", "detail-hero-actions.tsx"),
  "utf8",
);
export const detailComment = readFileSync(
  join(root, "components", "conversation", "use-detail-comment.ts"),
  "utf8",
);
export const detailTimeline = readFileSync(
  join(root, "components", "detail", "stage-timeline.tsx"),
  "utf8",
);
export const researchQuality = readFileSync(
  join(root, "components", "detail", "research-quality-section.tsx"),
  "utf8",
);
export const researchDialogs = readFileSync(
  join(root, "components", "detail", "research-detail-dialogs.tsx"),
  "utf8",
);
export const detailScopes = readFileSync(
  join(root, "components", "detail", "scopes-list.tsx"),
  "utf8",
);
export const detailViewer = readFileSync(
  join(root, "components", "detail", "artifact-viewer-dialog.tsx"),
  "utf8",
);
export const manageHeader = readFileSync(
  join(root, "components", "manage", "card-detail-header.tsx"),
  "utf8",
);

/**
 * The RPC registry. Handlers that live in their own module are pinned against
 * that module; only the ones still declared inline in a table are sliced out
 * of the registry by name.
 */
export const rpcRegistry = readFileSync(
  join(root, "server", "runtime", "wiring", "rpc-surfaces.ts"),
  "utf8",
);

/** The gate wiring: the layers between the runtime core and the registry. */
export const gateWiring = readFileSync(
  join(root, "server", "runtime", "wiring", "gate-surfaces.ts"),
  "utf8",
);
export const cardWiring = readFileSync(
  join(root, "server", "runtime", "wiring", "card-surfaces.ts"),
  "utf8",
);
export const hostWiring = readFileSync(
  join(root, "server", "runtime", "wiring", "host-surfaces.ts"),
  "utf8",
);
export const cliWiring = readFileSync(
  join(root, "server", "runtime", "wiring", "cli-surfaces.ts"),
  "utf8",
);

export function rpcMethod(name, nextName) {
  const start = methodStart(name);
  const end = methodStart(nextName, start + 1);
  assert.notEqual(start, -1, `${name} RPC exists`);
  assert.notEqual(end, -1, `${nextName} RPC marks the end of ${name}`);
  return server.slice(start, end);
}

function methodStart(name, from = 0) {
  const method = server.indexOf(`    async ${name}(`, from);
  const factory = server.indexOf(`const ${name} = async`, from);
  const functionFactory = server.indexOf(`async function ${name}(`, from);
  const candidates = [method, factory, functionFactory].filter((index) => index >= 0);
  return candidates.length > 0 ? Math.min(...candidates) : -1;
}
