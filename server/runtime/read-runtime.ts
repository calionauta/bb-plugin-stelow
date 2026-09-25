/**
 * The reads every surface shares.
 *
 * Checkout, stage, ask evidence, open questions, claims, git, staleness,
 * preview, and the research artifacts: each is a read, and each is read the
 * same way on purpose. Card preview must resolve the same checkout the diff
 * RPC diffs and publication publishes, an ask must resolve the same stage
 * the done gates check, and a claim wait must be released by the same writer
 * that took it — so these are constructed once and reached for by name.
 */
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { createQuestionStaleness } from "./question-staleness.js";
import { createWorkers } from "../workers.js";
import { createCardPreview } from "./card-preview.js";
import { createResearchArtifactRuntime } from "./research-artifacts.js";
import { createGitEvidence } from "./git-evidence.js";
import { createQuestionInbox } from "./question-inbox.js";
import { createClaimCoordination } from "./claim-coordination.js";
import { createCardSeams } from "./card-seams.js";
import { createAskArtifacts } from "./ask-artifacts.js";
import { createPreviewHost } from "./preview-host.js";
import { createTrackProjection, strategyRounds } from "./track-projection.js";
import { workspaceRelative } from "./card-files.js";
import { join } from "./root-paths.js";
import { workflowStateDir } from "./workflow-state.js";
import { ERRORS } from "./card-errors.js";
import type { RuntimeServices } from "./runtime-services.js";
import type { CardLedger } from "./card-ledger.js";
import type { GitEvidence } from "./git-evidence.js";
import type { QuestionInbox } from "./question-inbox.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type ReadRuntimeDeps = {
  bb: BbPluginApi;
  db: Db;
  now: () => number;
  services: RuntimeServices;
  ledger: CardLedger;
  workerEnvironmentOf: ReturnType<typeof createWorkers>["workerEnvironmentOf"];
};

export function createReadRuntime(deps: ReadRuntimeDeps) {
  const workspace = createWorkspaceReads(deps);
  return { ...workspace, ...createCardReads(deps, workspace) };
}

/** The host-only reads: git, the card's open questions, and claim waits. */
export function createWorkspaceReads(deps: ReadRuntimeDeps) {
  const { bb, db, now, services } = deps;
  const git = createGitEvidence({ bb, db, cardWorkspace: services.cardWorkspace });
  const questions = createQuestionInbox({
    bb,
    db,
    syncPendingQuestionInbox: services.syncPendingQuestionInbox,
  });
  const claims = createClaimCoordination({
    bb,
    db,
    getCard: services.getCard,
    notifyClaimWaiters: services.notifyClaimWaiters,
    now,
  });
  return { git, questions, claims };
}

export type WorkspaceReads = ReturnType<typeof createWorkspaceReads>;

/** The card-facing reads built on the workspace ones, plus their projections. */
function createCardReads(
  deps: ReadRuntimeDeps,
  workspace: WorkspaceReads,
) {
  const { bb, db, now, services, ledger } = deps;
  const { git, questions } = workspace;
  const seams = createCardSeams({
    bb,
    db,
    getCard: services.getCard,
    cardWorkspace: services.cardWorkspace,
    workerEnvironmentOf: deps.workerEnvironmentOf,
  });
  const asks = createAskArtifacts({
    bb,
    db,
    now,
    getCard: services.getCard,
    cardWorkspace: services.cardWorkspace,
    cardStageSlug: seams.cardStageSlug,
    gitEvidence: git.recoveryGitEvidence,
    sha256OfHostFile: git.sha256OfHostFile,
  });
  const previewHost = createPreviewHost({ bb, now });
  return {
    seams,
    asks,
    previewHost,
    stalenessForQuestions: createQuestionStaleness({
      db,
      recoveryGitEvidence: git.recoveryGitEvidence,
      sha256OfHostFile: git.sha256OfHostFile,
      gitTouchedSince: git.gitTouchedSince,
    }),
    cardPreview: createCardPreview({
      getCard: services.getCard,
      cardCheckout: seams.cardCheckout,
      runtime: previewHost.preview,
      cardNotFoundError: ERRORS.cardNotFound,
    }),
    trackProjection: createTrackProjection({
      bb,
      db,
      now,
      updateCard: services.updateCard,
      logCardComment: ledger.logCardComment,
      cardWorkspace: services.cardWorkspace,
      syncOpenQuestionInbox: questions.syncOpenQuestionInbox,
    }),
    researchArtifacts: createResearchArtifactRuntime({
      bb,
      cardWorkspace: services.cardWorkspace,
      workflowStateDir: (rootPath, workflowId, dirHash) =>
        workflowStateDir(bb, rootPath, workflowId, dirHash),
      strategyRounds,
      joinPath: join,
      workspaceRelative,
      errors: { workspaceUnavailable: ERRORS.workspaceUnavailable },
    }),
  };
}

export type ReadRuntime = ReturnType<typeof createReadRuntime>;
