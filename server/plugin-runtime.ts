import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, isAbsolute, join as nodeJoin } from "node:path";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  isPublishableArtifactContent,
  parseArtifactManifest,
  resolveArtifactPath,
} from "../lib/artifact-manifest.mjs";
import { PHASE_ENTRY_STAGES } from "../lib/workflow-vocabulary.mjs";
import {
  refreshEventSeverity,
  refreshStalledPaused,
} from "../lib/inbox-events.mjs";
import { releaseAllCardClaims } from "../lib/card-claims.mjs";
import { questionWaitUpdates } from "../lib/card-question-state.mjs";
import {
  inheritAskArtifact,
  normalizeAskArtifactPath,
} from "../lib/question-batch.mjs";
import { consumeAskContract } from "../lib/ask-contracts.mjs";
import {
  discardConfirm,
  discardEligibility,
  discardTrail,
} from "../lib/discard-policy.mjs";
import { workflowIdForName } from "../lib/workflow-state-identity.mjs";
import { parseStrategyList } from "../lib/research-strategies.mjs";
import {
  normalizeHistory,
  roundTimestamp,
  roundFileName,
  ROUNDS_DIR,
} from "../lib/research-rounds.mjs";
import { buildDocDepths } from "../lib/artifact-validation.mjs";
import { reviewCoversFingerprint } from "../lib/review-verdict.mjs";
import { assertDisposableSpawn } from "../lib/delegation-map.mjs";

import { normalizeKind } from "../lib/tracks.mjs";
import { isArchivedCard } from "../lib/worker-action-policy.mjs";
import { resetAutoContinue } from "../lib/auto-continue.mjs";
import { buildContinueInput } from "../lib/worker-continuation.mjs";
import { recordSplitAnswer } from "../lib/split-proposal.mjs";
import { isDoneStatus } from "../lib/trackables.mjs";
import { recordTrackableEvent } from "../lib/trackable-events.mjs";
import { parseWorkflowConfig } from "../lib/workflow-config.mjs";
import {
  legacyLabelForGates,
  normalizeReviewGates,
} from "../lib/review-gates.mjs";
import { requiredForStage } from "../lib/question-contracts.mjs";
import { createPreviewRuntime } from "../lib/preview-runtime.mjs";
import { publicationSource } from "../lib/vcs-publication.mjs";
import { detectedTestCommand } from "../lib/audit-verification.mjs";
import { summarizeTimeline } from "../lib/card-metrics.mjs";
import {
  createWorkspacesRecovery,
  recoveredCheckoutIntegrity,
} from "./workspaces-recovery.js";
import { createDecisionApi } from "./decision-api.js";
import { createPresetJudgeRunner } from "./decisions/preset-judge-runner.js";
import { createArtifactCriteriaJudge } from "./decisions/artifact-criteria-judge.js";
import { createScoredBatchJudge } from "./decisions/scored-batch-judge.js";
import { createGatePreReview } from "./review-preflight.js";
import {
  createGithubAutomation,
  githubIssuesEnabled,
} from "./github-issues.js";
import { createDraftingServer } from "./drafting.js";
import { createCardsServer } from "./cards.js";
import type { PresetRow } from "./presets.js";
import { createArtifactsPublication } from "./artifacts-publication.js";
import {
  createWorkers,
  workerEnvironment,
  type WorkerCard,
} from "./workers.js";
import {
  loadCardScopes,
  normalizeStatus,
  runScopeCommand,
} from "./scopes.js";
import { createPlatformHandlers } from "./runtime/platform.js";
import { createCardPreview } from "./runtime/card-preview.js";
import { createInspectionCommand } from "./runtime/cli-inspection.js";
import { createStelowCliRun } from "./runtime/cli/cli-dispatcher.js";
import { cardAttachments, workspaceRelative } from "./runtime/card-files.js";
import { array, record, text } from "./runtime/values.js";
import { createResearchArtifactRuntime } from "./runtime/research-artifacts.js";
import { createResearchTrackSync } from "./runtime/research-track-sync.js";
import {
  createTrackPrompts,
  type ExploreWorkerPromptInput,
  type ResearchWorkerPromptInput,
} from "./runtime/track-prompts.js";
import { createTrackCapabilities } from "./runtime/track-capabilities.js";
import { registerMentionProviders } from "./runtime/mentions.js";
import {
  CARD_ERRORS,
  createCoreDependencies,
  registerAutomationSchedule,
  registerPreviewDisposal,
  registerRpcHandlers,
  registerRuntimeLifecycle,
  registerStelowCli,
  registerWorkerSkills,
} from "./runtime/composition.js";
import { startRuntimeServices } from "./runtime/lifecycle-startup.js";
import { createExecutionNative } from "./execution-native.js";
import { createExecutionLifecycle } from "./execution-lifecycle.js";
import { createExecutionReconcile } from "./execution-reconcile.js";
import { createExecutionAdvance } from "./execution-advance.js";
import { createWorktreeCleanup } from "./worktree-cleanup.js";
import { flowMetrics } from "./runtime/flow-metrics.js";
import { createPendingQuestions } from "./runtime/pending-questions.js";
import { createCardDetailHandler } from "./runtime/card-detail.js";
import { createCardMutationHandlers } from "./runtime/card-mutations.js";
import { createCardLifecycleHandlers } from "./runtime/card-lifecycle.js";
import { createCardOperationsHandlers } from "./runtime/card-operations.js";
import { createResearchTrackHandlers } from "./runtime/research-track-handlers.js";
import { createBuildThreadSync } from "./runtime/build-thread-sync.js";
import { createWorkerRespawnPreparation } from "./runtime/worker-respawn-preparation.js";
import { createQuestionStaleness } from "./runtime/question-staleness.js";
import { createDiscardEvidence } from "./runtime/discard-evidence.js";
import { createQuestionContractsGate } from "./runtime/question-contracts-gate.js";
import { createCritiqueGapState } from "./runtime/critique-gap-state.js";
import { createGapSummary } from "./runtime/gap-summary.js";
import { createQualitySeal } from "./runtime/quality-seal.js";
import { createQuestionAnswers } from "./runtime/question-answers.js";
import {
  createCardUpdater,
  createClaimWaiterNotifier,
} from "./runtime/card-state.js";
import { createCardAdvance, createGateHandlers } from "./runtime/card-gates.js";
import { createAuditTrailStatus } from "./runtime/card-audit-trail.js";
import { createCardDiff } from "./runtime/card-diff.js";
import { createCardReseed } from "./runtime/card-reseed.js";
import { createCardPromotion } from "./runtime/card-promotion.js";

// The composition root wires slices; every path, board read, and state
// projection it consumes is owned by the module imported here.
import { boardWorkflowDefaultsSchema } from "./contracts.js";
import { rpcContract } from "./rpc-contract.js";
import { isManagedWorktreeEnvironment } from "../lib/card-environment.mjs";
import {
  BUILD_INFO,
  PLUGIN_SKILLS_DIR,
  pluginDir,
  readPinnedStelowVersion,
} from "./plugin-paths.js";
import { fileTimestamp, join, projectRoot } from "./runtime/root-paths.js";
import {
  ensureProjectArtifacts,
  parseNextStages,
  workflowStateDir,
} from "./runtime/workflow-state.js";
import { seedWorkflow } from "./runtime/workflow-seeding.js";
import { boardFromRoot, loadBoard } from "./runtime/board-read.js";
import { runHelper } from "./runtime/helper-script.js";
import { auditReceiptNote } from "./runtime/audit-receipts.js";
import { detectMentionedFiles } from "./runtime/mentioned-files.js";
import { recoveryNudge, statusLabelForSummary } from "./runtime/card-copy.js";
import {
  CARD_OWNER_RULES,
  CLI_EQUIVALENTS,
  COMMIT_STYLE,
  DONE_PROTOCOL,
  DRAFT_PROTOCOL,
  INTERFACE_PICK,
  NEVER_SEED,
  RECON_PROTOCOL,
  REVIEW_PROTOCOL,
  SPLIT_PROTOCOL,
  SPLIT_REQUEST_NUDGE,
  TURN_DISCIPLINE,
} from "./runtime/plugin-protocols.js";
import {
  AUDIT_DONE_NUDGE,
  IDLE_ATTENTION_MS,
} from "./runtime/attention-window.js";

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  const { updates: pluginUpdates } = startRuntimeServices({
    bb,
    db,
    now,
    installedVersion: BUILD_INFO.version,
  });

  function now(): number {
    return Date.now();
  }

  // Append-only stage-entry ledger (lead/cycle-time source). Best-effort:
  // metrics degrade to created_at/updated_at when rows are missing, so a
  // failed write never blocks the card transition it annotates.
  function recordStageEvent(cardId: string, stage: string): void {
    try {
      db.prepare(
        "INSERT INTO card_stage_events (card_id, stage, entered_at) VALUES (?, ?, ?)",
      ).run(cardId, stage, now());
    } catch {
      /* metrics-only; never block */
    }
  }

  function stageEvents(
    cardId: string,
  ): Array<{ stage: string; entered_at: number }> {
    try {
      return db
        .prepare(
          "SELECT stage, entered_at FROM card_stage_events WHERE card_id = ? ORDER BY entered_at ASC, id ASC",
        )
        .all(cardId) as Array<{ stage: string; entered_at: number }>;
    } catch {
      return [];
    }
  }

  // Lead/cycle times for one card, from the metrics-only trail: the done
  // stage event ends both clocks; the first worker spawn starts cycle.
  // Lead/cycle times for one card, mirroring the gap-summary convention:
  // the done stage event ends both clocks (unfinished cards have age, not
  // lead — the flow RPC only lists finished ones). One helper so every
  // surface reports the same numbers.
  function flowTimesForCard(card: { id: string; created_at: number }): {
    leadMs: number | null;
    cycleMs: number | null;
    doneAt: number | null;
  } {
    const events = stageEvents(card.id);
    const doneEvent =
      [...events].reverse().find((event) => event.stage === "done") ?? null;
    if (!doneEvent) return { leadMs: null, cycleMs: null, doneAt: null };
    const timeline = summarizeTimeline(events, {
      createdAt: card.created_at,
      endAt: doneEvent.entered_at,
    });
    return {
      leadMs: timeline.leadMs,
      cycleMs: timeline.cycleMs,
      doneAt: doneEvent.entered_at,
    };
  }
  // Anchor a completed card to the tree it was verified at: Done cards
  // keep evolving checkouts honest by naming their own HEAD instead of
  // implying current dirt is card leftover.
  function verifiedHeadShaForCard(cardId: string): string | null {
    try {
      const row = db
        .prepare(
          "SELECT head_sha FROM verification_runs WHERE card_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(cardId) as { head_sha: string } | undefined;
      return typeof row?.head_sha === "string" && row.head_sha
        ? row.head_sha
        : null;
    } catch {
      return null;
    }
  }
  function randomId(prefix: string): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }

  const { researchWorkerPrompt, exploreWorkerPrompt } = createTrackPrompts({
    cardOwnerRules: CARD_OWNER_RULES,
    doneProtocol: DONE_PROTOCOL,
    reviewProtocol: REVIEW_PROTOCOL,
    draftProtocol: DRAFT_PROTOCOL,
  });

  // Working-tree patch text for the advisory verify-* judges: raw evidence
  // to judge against, capped by the caller's own budget. Fail-soft — a
  // non-Git workspace or a git error reads as no evidence, never as an
  // error, because these judges report and never block. The cardDiff RPC
  // owns the rich version; this needs only patch text.
  const workingDiffFor = async (
    workspacePath: string,
    cap: number,
  ): Promise<string> =>
    new Promise<string>((resolveDiff) => {
      execFile(
        "git",
        ["diff", "HEAD", "--no-color", "--unified=1", "--", "."],
        { cwd: workspacePath, timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => {
          resolveDiff(
            !error && typeof stdout === "string" ? stdout.slice(0, cap) : "",
          );
        },
      );
    });

  // Decision API execution seams live in the server/decision-api-* modules. These thin
  // adapters keep call sites explicit while the feature owns its behavior.
  function seedBuildIntentFromRouter(
    promptText: string,
    projectId: string | null,
  ): Promise<string> {
    return decisionApi.seedBuildIntent(promptText, projectId);
  }

  function vetAutoContinueNudge(stateText: string | null): Promise<boolean> {
    return decisionApi.vetAutoContinue(stateText);
  }

  type CardRow = WorkerCard;

  const { cardStore, presetServer, inbox } = createCoreDependencies({
    bb,
    db,
    now,
    randomId,
  });
  const getCard = cardStore.getCard;
  const cardWorkspace = cardStore.cardWorkspace;

  // Shared refusal copy: identical wording everywhere so the same failure
  // reads the same on every surface, fixed in one place.
  const ERR_CARD_NOT_FOUND = CARD_ERRORS.cardNotFound;
  const ERR_CARD_ARCHIVED = "This card is archived.";
  const ERR_WORKSPACE_UNAVAILABLE = "Workspace is unavailable.";
  const ERR_PRESET_NOT_FOUND = CARD_ERRORS.presetNotFound;

  const getDefaultPreset = presetServer.getDefaultPreset;
  const getPresetById = presetServer.getPresetById;
  const getPresetForCard = presetServer.getPresetForCard;
  const getPresetForBand = presetServer.getPresetForBand;
  const getReliablePresetForBand = presetServer.getReliablePresetForBand;
  const presetAttachmentParams = presetServer.presetAttachmentParams;
  const getReviewPresetId = presetServer.getReviewPresetId;
  const judgeViaPreset = createPresetJudgeRunner({ bb, getPresetById });
  const judgePresetCriteria = createArtifactCriteriaJudge(judgeViaPreset);
  const judgeScoredBatch = createScoredBatchJudge(judgeViaPreset);
  const pinCardPreset = presetServer.pinCardPreset;
  const removeCardPreset = presetServer.removeCardPreset;
  const recordInboxEvent = inbox.record;
  const resolveInboxEvents = inbox.resolve;
  const syncPendingQuestionInbox = (
    card: CardRow,
    interactionIds: string[],
    occurredAt = now(),
  ) => inbox.syncPendingQuestion(card.id, interactionIds, occurredAt);
  const markInboxQuestionsAnswered = (
    cardId: string,
    interactionIds: string[],
  ) => inbox.markAnswered(cardId, interactionIds);
  const updateCard = createCardUpdater({
    db,
    bb,
    now,
    getCard,
    recordInbox: recordInboxEvent,
    resolveInbox: resolveInboxEvents,
  });
  const notifyClaimWaiters = createClaimWaiterNotifier({
    db,
    bb,
    now,
    getCard,
    resolveInbox: resolveInboxEvents,
  });

  const prepareWorkerRespawn = createWorkerRespawnPreparation({
    bb,
    presetParams: (preset) => presetAttachmentParams(preset as PresetRow),
    cardWorkspace,
    workflowStateDir,
    strategyList,
    strategyRounds,
    researchWorkerPrompt,
    exploreWorkerPrompt,
    roundRelPath,
    text,
    protocols: {
      cardOwnerRules: CARD_OWNER_RULES,
      neverSeed: NEVER_SEED,
      cliEquivalents: CLI_EQUIVALENTS,
      reconProtocol: RECON_PROTOCOL,
      draftProtocol: DRAFT_PROTOCOL,
      turnDiscipline: TURN_DISCIPLINE,
      commitStyle: COMMIT_STYLE,
      interfacePick: INTERFACE_PICK,
      doneProtocol: DONE_PROTOCOL,
      splitProtocol: SPLIT_PROTOCOL,
    },
  });

  const workers = createWorkers({
    db,
    bb,
    now,
    getCard,
    updateCard,
    comment: (cardId, body) => {
      logCardComment(cardId, "card", cardId, "agent", body);
    },
    getPreset: (presetId) => getPresetById(presetId),
    getReliablePreset: (band, cardId) => getReliablePresetForBand(band, cardId),
    presetParams: (preset) => presetAttachmentParams(preset as PresetRow),
    prepareRespawn: prepareWorkerRespawn,
    resetAutoContinue,
    errors: {
      cardNotFound: "Card not found.",
      cardArchived: "This card is archived.",
      presetNotFound: "Preset not found.",
    },
  });
  const requestGatePreReview = createGatePreReview({
    bb,
    getCard,
    getReviewPresetId,
    getPresetById,
    presetAttachmentParams,
    cardWorkspace,
    boardFromRoot,
    spawnDisposable,
    stopThread: (threadId) => workers.stop(threadId),
    logCardComment,
  });
  const drafting = createDraftingServer({
    db,
    bb,
    now,
    timestamp: roundTimestamp,
    getCard,
    getCardByWorkerThread,
    isArchivedCard,
    cardWorkspace,
    continuingEnvironment: workers.continuingEnvironment,
    getPreset: (presetId) => getPresetById(presetId),
    getPresetForBand,
    getGenerationPresetId: presetServer.getGenerationPresetId,
    presetParams: (preset) => presetAttachmentParams(preset as PresetRow),
    spawnDisposable,
    stopThread: (threadId) => workers.stop(threadId),
    comment: (cardId, body) => {
      logCardComment(cardId, "card", cardId, "agent", body);
    },
    publish: (event, payload) => bb.realtime.publish(event, payload),
    stateDir: (card, workspace) =>
      workflowStateDir(bb, workspace.path, card.id, card.dir_hash!),
    workspaceRelative,
  });

  type RecoveryGitEvidence = {
    isGit: boolean;
    gitRoot: string | null;
    branch: string | null;
    headSha: string | null;
    changedFiles: number;
  };
  const stalenessForQuestions = createQuestionStaleness({
    db,
    recoveryGitEvidence,
    sha256OfHostFile,
    gitTouchedSince,
  });

  function runGitIn(
    cwd: string,
    args: string[],
    maxBuffer = 1024 * 1024,
  ): Promise<{ ok: boolean; stdout: string }> {
    return new Promise((done) => {
      execFile(
        "git",
        args,
        { cwd, timeout: 15_000, maxBuffer },
        (error, stdout) => {
          done({
            ok: !error,
            stdout: typeof stdout === "string" ? stdout : "",
          });
        },
      );
    });
  }
  async function dropLinkedWorktree(
    checkoutPath: string,
    branch: string,
  ): Promise<void> {
    const common = await runGitIn(checkoutPath, [
      "rev-parse",
      "--git-common-dir",
    ]);
    const mainDir = common.ok ? common.stdout.trim() : "";
    const mainPath = mainDir
      ? isAbsolute(mainDir)
        ? mainDir
        : nodeJoin(checkoutPath, mainDir)
      : "";
    if (!mainPath) throw new Error("Cannot locate the main checkout.");
    await runGitIn(mainPath, ["worktree", "unlock", checkoutPath]);
    const removed = await runGitIn(mainPath, [
      "worktree",
      "remove",
      "--force",
      checkoutPath,
    ]);
    if (!removed.ok) throw new Error("Could not remove the worktree.");
    const pruned = await runGitIn(mainPath, ["branch", "-D", branch]);
    if (!pruned.ok)
      throw new Error("Worktree removed, but the branch survived.");
    if (existsSync(checkoutPath))
      throw new Error("The worktree folder survived removal.");
  }
  const EXPLORATORY_SCOPE = nodeJoin(
    process.env.HOME ?? "/tmp",
    ".bb",
    "stelow",
    "exploratory",
  );
  const discardEvidence = createDiscardEvidence({
    db,
    cardWorkspace,
    runGitIn,
  });

  async function recoveryGitEvidence(
    path: string,
  ): Promise<RecoveryGitEvidence> {
    const root = await runGitIn(path, ["rev-parse", "--show-toplevel"]);
    if (!root.ok || !root.stdout.trim())
      return {
        isGit: false,
        gitRoot: null,
        branch: null,
        headSha: null,
        changedFiles: 0,
      };
    const [branch, head, status] = await Promise.all([
      runGitIn(path, ["branch", "--show-current"]),
      runGitIn(path, ["rev-parse", "HEAD"]),
      runGitIn(path, ["status", "--porcelain=v1", "--untracked-files=all"]),
    ]);
    return {
      isGit: true,
      gitRoot: root.stdout.trim(),
      branch: branch.ok ? branch.stdout.trim() || null : null,
      headSha: head.ok ? head.stdout.trim() || null : null,
      changedFiles: status.ok
        ? status.stdout.split("\n").filter(Boolean).length
        : 0,
    };
  }

  // Stelow's own machinery never makes a plan stale: filter it from the
  // touched-paths a staleness notice names.
  const STALENESS_NOISE_PREFIXES = [
    "skills/",
    "data/",
    ".stelow/",
    "stelow.json",
  ];
  // Files a checkout gained since an ask-time HEAD: what the human needs to
  // judge whether a waiting question's plan still matches the code.
  // Fail-soft — staleness is advisory, and an unreadable history must never
  // break cardDetail.
  async function gitTouchedSince(
    gitRoot: string,
    fromHead: string,
  ): Promise<{ commitCount: number; paths: string[] }> {
    const empty = { commitCount: 0, paths: [] as string[] };
    try {
      const [count, log] = await Promise.all([
        runGitIn(gitRoot, ["rev-list", "--count", `${fromHead}..HEAD`]),
        runGitIn(
          gitRoot,
          ["log", "--name-only", "--pretty=format:", `${fromHead}..HEAD`, "--"],
          4 * 1024 * 1024,
        ),
      ]);
      if (!count.ok || !log.ok) return empty;
      const seen = new Set<string>();
      for (const line of log.stdout.split("\n")) {
        const path = line.trim();
        if (
          !path ||
          seen.has(path) ||
          STALENESS_NOISE_PREFIXES.some(
            (prefix) => path === prefix || path.startsWith(prefix),
          )
        )
          continue;
        seen.add(path);
      }
      return {
        commitCount: Number(count.stdout.trim()) || 0,
        paths: [...seen].slice(0, 6),
      };
    } catch {
      return empty;
    }
  }

  async function sha256OfHostFile(path: string): Promise<string | null> {
    try {
      const file = (await bb.sdk.files.read({ path }).catch(() => null)) as {
        content?: unknown;
      } | null;
      if (!file || typeof file.content !== "string") return null;
      return createHash("sha256").update(file.content, "utf8").digest("hex");
    } catch {
      return null;
    }
  }

  // Ask-time evidence baseline for staleness notices. Advisory and fail-soft:
  // a question must never fail because its baseline could not be recorded.
  // Keyed by (card, artifact path), latest wins — re-asking about a revised
  // document re-baselines it.
  async function snapshotQuestionEvidence(
    cardId: string,
    optionArtifacts: Array<{ artifact: { path: string } | null }>,
  ): Promise<void> {
    try {
      const card = getCard(cardId);
      if (!card) return;
      const resolved = await resolveAskOptions(
        card,
        optionArtifacts.map((entry) => ({
          label: "",
          description: "",
          preview: null as string | null,
          artifact: entry.artifact,
        })),
      );
      const seen = new Set<string>();
      const workspace = await cardWorkspace(card).catch(() => null);
      const git = workspace?.path
        ? await recoveryGitEvidence(workspace.path).catch(() => null)
        : null;
      const askedAt = now();
      for (const option of resolved) {
        const absolute = option.artifact?.absolutePath;
        if (!absolute || seen.has(absolute)) continue;
        seen.add(absolute);
        const sha = await sha256OfHostFile(absolute);
        if (!sha) continue;
        db.prepare(
          "INSERT OR REPLACE INTO question_evidence (card_id, artifact_path, artifact_sha256, git_root, head_sha, asked_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(
          cardId,
          absolute,
          sha,
          git?.gitRoot ?? null,
          git?.headSha ?? null,
          askedAt,
        );
      }
    } catch {
      /* advisory only */
    }
  }

  function testCommandForCheckout(path: string) {
    try {
      const entries = readdirSync(path);
      const packageJson = entries.includes("package.json")
        ? JSON.parse(readFileSync(nodeJoin(path, "package.json"), "utf8"))
        : null;
      return detectedTestCommand(entries, packageJson);
    } catch {
      return null;
    }
  }

  async function runHostTests(
    path: string,
    command: { command: string; args: string[]; display: string },
  ) {
    return new Promise<{ exitCode: number; output: string }>((done) => {
      execFile(
        command.command,
        command.args,
        { cwd: path, timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const code =
            error && typeof (error as { code?: unknown }).code === "number"
              ? (error as { code: number }).code
              : error
                ? 1
                : 0;
          const output =
            `${typeof stdout === "string" ? stdout : ""}${typeof stderr === "string" ? `\n${stderr}` : ""}`.trim();
          done({ exitCode: code, output });
        },
      );
    });
  }

  // --- Preview: one dev server per checkout. --------------------------------
  //
  // The lifecycle — which checkout owns a server, when it is ready, what to
  // clean up — lives in lib/preview-runtime with a node test, per AGENTS.md
  // (`lib/` owns state logic; never inline-only in server.ts handlers). What
  // stays here is only what the host must provide: reading files, listing a
  // directory, spawning the process, and asking Connect.

  function runCommand(
    command: string,
    args: string[],
    options: { cwd?: string } = {},
  ): Promise<{ code: number | null; out: string }> {
    return new Promise((resolveRun) => {
      execFile(
        command,
        args,
        {
          cwd: options.cwd,
          env: { ...(process.env as Record<string, string>) },
          maxBuffer: 4 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const code =
            error && typeof (error as { code?: unknown }).code === "number"
              ? (error as { code: number }).code
              : error
                ? 1
                : 0;
          resolveRun({ code, out: `${stdout ?? ""}${stderr ?? ""}` });
        },
      );
    });
  }

  /**
   * `bb connect <args> --json`, parsed. Connect is the sanctioned surface for
   * exposing a port (`share-server-links`), so this is the whole client: null
   * means unpaired, unsupported, or unparseable, and every caller falls back to
   * the next rung rather than guessing at a shape it does not recognize.
   */
  async function runConnect(
    args: string[],
  ): Promise<Record<string, unknown> | null> {
    const result = await runCommand(resolveLocalBin("bb"), [
      "connect",
      ...args,
      "--json",
    ]).catch(() => null);
    if (!result || result.code !== 0) return null;
    const match = result.out.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  const preview = createPreviewRuntime({
    readFile: (path) =>
      bb.sdk.files
        .read({ path })
        .then((file) => file.content)
        .catch(() => null),
    listDirs: (dir) => {
      try {
        return readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        return [];
      }
    },
    joinPath: nodeJoin,
    spawnProcess: (command, options) =>
      spawn("bash", ["-lc", command], {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    runConnect,
    now,
    baseEnv: process.env as Record<string, string>,
  });

  // A reload or disable must not leave a dev server running behind the user's
  // back: the processes are ours, so shutting them down is ours too.
  registerPreviewDisposal(bb, () => preview.dispose());

  type PreviewEnvironment = {
    id?: string | null;
    path?: string | null;
    hostId?: string | null;
    isWorktree?: boolean;
    workspaceProvisionType?: string | null;
    branchName?: string | null;
  } | null;

  type CardCheckout = {
    path: string;
    hostId: string | null;
    environmentId: string | null;
    environment: PreviewEnvironment;
    source: string;
  };

  /**
   * The exact checkout a worker changed. This is deliberately shared by
   * preview, diff, and publication so a managed worktree never falls back to
   * the project's source checkout by accident.
   */
  async function cardCheckout(card: CardRow): Promise<CardCheckout | null> {
    // A legacy exploratory card may have a user-confirmed, evidence-backed
    // external checkout. Prefer that audited target for read-only diff and
    // preview surfaces; publication still requires a live BB environment.
    if (card.workspace_kind === "exploratory") {
      const recovery = db
        .prepare(
          "SELECT source_path FROM workspace_recoveries WHERE card_id = ?",
        )
        .get(card.id) as { source_path: string } | undefined;
      if (recovery?.source_path)
        return {
          path: recovery.source_path,
          hostId: card.workspace_host_id,
          environmentId: null,
          environment: null,
          source: "Recovered project checkout",
        };
    }
    const environment = await workers.workerEnvironmentOf(card);
    if (environment?.path) {
      return {
        path: environment.path,
        hostId: environment.hostId ?? null,
        environmentId: environment.id ?? null,
        environment,
        source: publicationSource(environment),
      };
    }
    const workspace = await cardWorkspace(card);
    return workspace?.path
      ? {
          path: workspace.path,
          hostId: workspace.hostId,
          environmentId: null,
          environment: null,
          source: "Project source",
        }
      : null;
  }

  /**
   * Current workflow stage for a card, preferring state.md (the machine's
   * own record, written by `advance`) over the DB mirror. Falls back to the
   * DB stage when state cannot be verified — callers gate on known stages,
   * so an unverifiable read only ever narrows, never widens.
   */
  async function cardStageSlug(card: CardRow): Promise<string | null> {
    try {
      const workspace = await cardWorkspace(card).catch(() => null);
      const rootPath = workspace?.path ?? null;
      if (!rootPath || !card.dir_hash) return card.stage ?? null;
      const dir = await workflowStateDir(
        bb,
        rootPath,
        card.id,
        card.dir_hash,
      ).catch(() => null);
      const blob = dir
        ? await bb.sdk.files
            .read({ path: join(dir, "state.md") })
            .then((file) => file.content)
            .catch(() => null)
        : null;
      const stage = blob
        ? text(blob.match(/current_stage:\s*(\S+)/m)?.[1])
        : "";
      return stage || (card.stage ?? null);
    } catch {
      return card.stage ?? null;
    }
  }

  // Stage checklist for --contract validation. Mirrors the advance
  // guard's read (state.md slug truth + strict config, fail-open nulls);
  // kept separate so guard refactors never shift ask-time validation
  // silently. Returns null when unreadable — declarations then record raw.
  async function askContractChecklist(
    cardId: string,
  ): Promise<Array<{ id: string; kind: string }> | null> {
    try {
      const card = getCard(cardId);
      if (!card) return null;
      const workspace = await cardWorkspace(card);
      if (!workspace?.path) return null;
      const stateDir = card.dir_hash
        ? await workflowStateDir(bb, workspace.path, card.id, card.dir_hash)
        : null;
      if (!stateDir) return null;
      const stateFile = await bb.sdk.files
        .read({ path: join(stateDir, "state.md") })
        .catch(() => null);
      const state =
        typeof stateFile?.content === "string" ? stateFile.content : null;
      if (!state) return null;
      const { appetite, reviewMode, reviewGates } = parseWorkflowConfig(state, {
        strict: true,
      });
      if (!appetite || (!reviewMode && !reviewGates)) return null;
      const stage = text(state.match(/^current_stage:\s*(\S+)/m)?.[1]);
      if (!stage) return null;
      return requiredForStage({
        stage,
        appetite,
        reviewMode: reviewGates ?? reviewMode ?? [],
      });
    } catch {
      return null;
    }
  }

  const cardPreview = createCardPreview({
    getCard,
    cardCheckout,
    runtime: preview,
    cardNotFoundError: ERR_CARD_NOT_FOUND,
  });
  const {
    view: previewView,
    start: previewStart,
    stop: previewStop,
    share: previewShare,
  } = cardPreview;

  // Resolve a host binary: server-wide install at ~/.local/bin first
  // (non-interactive PATH lacks it), PATH fallback otherwise.
  const homeDir = typeof process.env.HOME === "string" ? process.env.HOME : "";
  const localBinDir = homeDir ? nodeJoin(homeDir, ".local", "bin") : "";
  function resolveLocalBin(name: string): string {
    const absolute = localBinDir ? nodeJoin(localBinDir, name) : "";
    return absolute && existsSync(absolute) ? absolute : name;
  }

  const platform = createPlatformHandlers({
    bb,
    pluginDir,
    pluginSkillsDir: PLUGIN_SKILLS_DIR,
    buildInfo: BUILD_INFO,
    readPinnedStelowVersion,
    refreshPluginUpdate: pluginUpdates.refresh,
    getPluginUpdate: pluginUpdates.getState,
    getGithubRelease: pluginUpdates.getRelease,
    resolveLocalBin,
    homeDir,
    localBinDir,
    preview: {
      view: previewView,
      start: previewStart,
      stop: previewStop,
      share: previewShare,
    },
  });

  const trackCapabilities = createTrackCapabilities();
  const researchArtifacts = createResearchArtifactRuntime({
    bb,
    cardWorkspace,
    workflowStateDir: (rootPath, workflowId, dirHash) =>
      workflowStateDir(bb, rootPath, workflowId, dirHash),
    strategyRounds,
    joinPath: join,
    workspaceRelative,
    errors: { workspaceUnavailable: ERR_WORKSPACE_UNAVAILABLE },
  });
  const {
    researchRoundFiles,
    readResearchIndex,
    researchReadiness,
    exploreArtifact,
  } = researchArtifacts;

  // Create only the destination directory. Artifact files themselves are
  // published by workers with content, never reserved as blank placeholders.
  async function ensureArtifactParent(
    workspacePath: string,
    relPath: string,
  ): Promise<void> {
    try {
      const full = resolveArtifactPath(workspacePath, relPath);
      if (!full) return;
      await bb.sdk.files.mkdir({
        path: dirname(full),
        rootPath: workspacePath,
        recursive: true,
      });
    } catch {
      /* workers can still create parents with their native writer */
    }
  }

  // Recognized Build documents registered in state.md, validated against
  // their stage contracts (unknown files, audit.md, and receipts never
  // match). Shared by done (blocking) and verify --tests (warnings).
  async function buildDocDepthsForCard(
    card: CardRow,
  ): Promise<Array<{ path: string; label: string; failures: string[] }>> {
    const workspace = await cardWorkspace(card).catch(() => null);
    if (!workspace?.path || !card.dir_hash) return [];
    const stateDir = await workflowStateDir(
      bb,
      workspace.path,
      card.id,
      card.dir_hash,
    ).catch(() => null);
    if (!stateDir) return [];
    const stateBlob = await bb.sdk.files
      .read({ path: join(stateDir, "state.md") })
      .then((f) => f.content)
      .catch(() => null);
    if (!stateBlob) return [];
    const contents = new Map<string, string | null>();
    for (const fields of parseArtifactManifest(stateBlob)) {
      if (typeof fields.path !== "string" || !fields.path.endsWith(".md"))
        continue;
      const full = resolveArtifactPath(workspace.path, fields.path);
      contents.set(
        fields.path,
        full
          ? await bb.sdk.files
              .read({ path: full })
              .then((f) => f.content)
              .catch(() => null)
          : null,
      );
    }
    return buildDocDepths(stateBlob, (path) => contents.get(path) ?? null);
  }

  // Passing review covering this fingerprint (policy gate). Lists the
  // card's reviews/ dir newest-first; only a Status: pass file stamped
  // with the current fingerprint satisfies. Fail-soft: unreadable state
  // reads as uncovered, and done names the fix.
  async function passingReviewCovers(
    card: CardRow,
    fingerprint: string | null,
  ): Promise<boolean> {
    if (!fingerprint) return false;
    const workspace = await cardWorkspace(card).catch(() => null);
    if (!workspace?.path || !card.dir_hash) return false;
    const stateDir = await workflowStateDir(
      bb,
      workspace.path,
      card.id,
      card.dir_hash,
    ).catch(() => null);
    if (!stateDir) return false;
    try {
      const listed = await bb.sdk.files.listPaths({
        path: join(stateDir, "reviews"),
        includeFiles: true,
        includeDirectories: false,
      });
      const paths = array(record(listed).paths)
        .map((entry) => text(record(entry).path))
        .filter((path) => path.endsWith(".md"))
        .sort()
        .reverse();
      const files: Array<{ name: string; content: string | null }> = [];
      for (const path of paths) {
        const content = await bb.sdk.files
          .read({ path })
          .then((f) => f.content)
          .catch(() => null);
        files.push({ name: path.split("/").pop() ?? path, content });
      }
      return reviewCoversFingerprint(files, fingerprint);
    } catch {
      return false;
    }
  }

  // Workspace-relative round path inside the state dir's rounds/.
  function roundRelPath(
    stateDirAbs: string,
    workspacePath: string,
    base: string,
  ): string {
    return (
      workspaceRelative(
        workspacePath,
        join(stateDirAbs, `${ROUNDS_DIR}/${base}`),
      ) ?? `${ROUNDS_DIR}/${base}`
    );
  }

  // Research readiness in one place (convention over configuration): the
  // index ## Opportunities checkboxes the fan-out dialog already parses via
  // parseResearchIndex. The sync writer and both read-path attention flags
  // share this predicate so they cannot diverge into "paused" vs "ready"
  // again. Build keeps its own terminal convention (state.md audit stage)
  // — each track reuses its canonical artifact, never a second definition.
  // Shared lightweight-track poll pieces (Research + Explore syncs both use
  // them — convention over configuration, one definition of each rule):
  // waiting is activity (never board position), and every agent output lands
  // as a card comment.
  async function markThreadRunning(
    card: CardRow,
    lastOutput: string | null,
  ): Promise<void> {
    const questionIds = await syncOpenQuestionInbox(card);
    if (questionIds === null) return;
    if (questionIds.length > 0) {
      // Waiting is activity, never board position: the card stays in its
      // column (Doing) while the question waits. See lib/card-question-state.
      updateCard(card.id, questionWaitUpdates(lastOutput));
    } else {
      const updates: Record<string, unknown> = {
        activity: "running" as const,
        last_assistant_text: lastOutput,
      };
      if (card.status === "pending") updates.status = "in-progress";
      updateCard(card.id, updates);
    }
  }

  function noteAgentOutput(card: CardRow, lastOutput: string | null): void {
    if (lastOutput && lastOutput !== card.last_assistant_text) {
      logCardComment(
        card.id,
        "card",
        card.id,
        "agent",
        stripMessageDirectives(lastOutput),
      );
    }
  }

  // Single writer for card conversation rows (agent trail, user notes,
  // worker transitions). Returns the comment id for callers that reference it.
  function logCardComment(
    cardId: string,
    target: string,
    targetId: string,
    author: "user" | "agent",
    body: string,
  ): string {
    const commentId = randomId("cmt");
    db.prepare(
      "INSERT INTO comments (id, card_id, target, target_id, author, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(commentId, cardId, target, targetId, author, body, now());
    return commentId;
  }

  let fetchPendingQuestions: (
    threadId: string | null,
  ) => Promise<
    Awaited<
      ReturnType<typeof rpcContract.cardDetail.output.parse>
    >["pendingQuestions"]
  > = async () => [];
  const cards = createCardsServer({
    db,
    bb,
    now,
    store: cardStore,
    errors: {
      cardNotFound: "Card not found.",
      workspaceUnavailable: "Workspace is unavailable.",
    },
    idleAttentionMs: 90_000,
    loadBoard: (projectId) => loadBoard(bb, projectId),
    githubStatus: () => github.githubStatus(),
    githubAutomationEnabled: githubIssuesEnabled,
    strategyList,
    getReliablePreset: (band, cardId) => getReliablePresetForBand(band, cardId),
    fetchPendingQuestions,
    openExpiredQuestionIds,
    create: {
      db,
      bb,
      now,
      randomId,
      roundTimestamp,
      seedBuildIntent: seedBuildIntentFromRouter,
      seedWorkflow: (
        plugin,
        rootPath,
        cardId,
        slug,
        intent,
        appetite,
        reviewGates,
      ) =>
        seedWorkflow(
          plugin,
          rootPath,
          cardId,
          slug,
          intent,
          appetite,
          reviewGates,
        ),
      researchStrategy: trackCapabilities.researchStrategy,
      exploreStage: trackCapabilities.exploreStage,
      researchIds: trackCapabilities.researchIds,
      exploreIds: trackCapabilities.exploreIds,
      defaultPreset: getDefaultPreset,
      getPreset: getPresetById,
      getBandPresetId: presetServer.getBandPresetId,
      getReliablePresetId: presetServer.getReliablePresetId,
      createCardOverride: (cardId, base, override) =>
        presetServer.createCardOverride(cardId, base as PresetRow, override),
      pinCardPreset,
      removeCardPreset,
      presetParams: (preset) => presetAttachmentParams(preset as PresetRow),
      spawnInitial: (args) => workers.spawnInitial(args),
      recordThread: (cardId, threadId, presetId, reason) =>
        workers.recordThread(cardId, threadId, presetId, reason),
      lineage: (rootPath, dirHash, threadId, presetId, reason) =>
        workers.lineage(rootPath, dirHash, threadId, presetId, reason),
      roundPath: roundRelPath,
      roundFile: roundFileName,
      ensureParent: ensureArtifactParent,
      researchPrompt: (input) =>
        researchWorkerPrompt(input as unknown as ResearchWorkerPromptInput),
      explorePrompt: (input) =>
        exploreWorkerPrompt(input as unknown as ExploreWorkerPromptInput),
      rules: {
        cardOwnerRules: CARD_OWNER_RULES,
        neverSeed: NEVER_SEED,
        cliEquivalents: CLI_EQUIVALENTS,
        reconProtocol: RECON_PROTOCOL,
        draftProtocol: DRAFT_PROTOCOL,
        turnDiscipline: TURN_DISCIPLINE,
        commitStyle: COMMIT_STYLE,
        interfacePick: INTERFACE_PICK,
        doneProtocol: DONE_PROTOCOL,
        splitProtocol: SPLIT_PROTOCOL,
      },
      describeManagedWorktree: isManagedWorktreeEnvironment,
      recordStageEvent,
      comment: (cardId, body) => {
        logCardComment(cardId, "card", cardId, "agent", body);
      },
      suggestCardName: (cardId) => drafting.suggestCardName(cardId),
    },
  });
  const createCardInternal = cards.createInternal;

  const workspacesRecovery = createWorkspacesRecovery({
    db,
    now,
    publish: (event, payload) => bb.realtime.publish(event, payload),
    cardNotFound: ERR_CARD_NOT_FOUND,
    cardArchived: ERR_CARD_ARCHIVED,
    cards: {
      get: (cardId) => getCard(cardId),
      create: (args) => createCardInternal(args),
      comment: (cardId, target, targetId, author, body) =>
        logCardComment(cardId, target, targetId, author, body),
    },
    gitEvidence: recoveryGitEvidence,
    listProjects: () => bb.sdk.projects.list(),
    getProject: (projectId) => bb.sdk.projects.get({ projectId }),
    getThreadOutput: async (threadId) => {
      const result = await bb.sdk.threads.output({ threadId });
      return result.output ?? "";
    },
  });
  const recoverySnapshot = workspacesRecovery.snapshot;
  const recoveryIntegrityDeps = { db, gitEvidence: recoveryGitEvidence };

  // ::name{...} directives are bb's thread renderer syntax (the worker emits
  // ::stelow-artifact chips per produced file). Card comments are rendered as
  // plain Markdown, so strip the directive syntax there — the file names it
  // carried are already present as natural text in the same message.
  function stripMessageDirectives(text: string | null): string {
    return String(text ?? "")
      .replace(/::[a-zA-Z0-9_-]+\{[^}]*\}/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  // Ordered strategy history for a research card (first = primary).
  function strategyList(
    row: Pick<CardRow, "research_strategies" | "research_strategy">,
  ): string[] {
    return parseStrategyList(row.research_strategies);
  }

  // Round history with timestamps (newest bookkeeping, oldest first).
  function strategyRounds(
    row: Pick<CardRow, "research_strategies" | "research_strategy">,
  ): Array<{ id: string; at: string; file: string }> {
    return normalizeHistory(row.research_strategies);
  }

  async function readReseedConfig(
    card: CardRow,
    rootPath: string,
  ): Promise<ReturnType<typeof parseWorkflowConfig> | null> {
    if (!card.dir_hash) return null;
    try {
      const stateDir = await workflowStateDir(
        bb,
        rootPath,
        card.id,
        card.dir_hash,
      );
      if (!stateDir) return null;
      const content = await bb.sdk.files
        .read({ path: join(stateDir, "state.md") })
        .then((file) => file.content)
        .catch(() => null);
      return typeof content === "string" ? parseWorkflowConfig(content) : null;
    } catch {
      return null;
    }
  }

  function getCardByWorkerThread(threadId: string): CardRow | undefined {
    return db
      .prepare("SELECT * FROM cards WHERE worker_thread_id = ?")
      .get(threadId) as CardRow | undefined;
  }
  // Workspace claim coordination (lib/card-claims). A card that hits a file
  // held by another live card parks that scope, not the thread: the worker
  // gets a BB-LOCK-BLOCKED stderr, the user gets a paused inbox event naming
  // the holder and the automatic unlock condition (release or TTL expiry),
  // and the waiter row lets the host resume exactly the blocked cards when
  // the files free up. Advisory-plus-apology: a stale claim is stolen, and
  // the steal is trailed on the card instead of blocking work.
  function lockBlockedSummary(
    file: string,
    holderName: string,
    expiresAt: number,
  ): string {
    const when = new Date(expiresAt).toLocaleString();
    const resumeNotice = "no action needed; the host resumes this card on release.";
    return `Waiting on ${file} (held by card "${holderName}"). Releases automatically when that card finishes the file or by ${when} — ${resumeNotice}`;
  }
  async function releaseCardClaimsAndNotify(cardId: string): Promise<void> {
    let released: Array<{ workspacePath: string; file: string }>;
    try {
      released = releaseAllCardClaims(db, cardId);
    } catch {
      return;
    }
    if (released.length === 0) return;
    const byWorkspace = new Map<string, string[]>();
    for (const row of released) {
      const list = byWorkspace.get(row.workspacePath) ?? [];
      list.push(row.file);
      byWorkspace.set(row.workspacePath, list);
    }
    for (const [workspacePath, files] of byWorkspace) {
      await notifyClaimWaiters(workspacePath, files);
    }
  }

  // Stalled cards keep their column; their open paused event carries the
  // age instead. Shared by all three track syncs so paused means paused
  // everywhere. Guarded to idle cards and wrapped: escalation is advisory
  // and must never break a sync (e.g. dispose closing the DB mid-poll).
  function escalateIfStalled(cardId: string): void {
    const fresh = getCard(cardId);
    if (!fresh || fresh.activity !== "idle") return;
    try {
      const touched =
        refreshStalledPaused(db, { cardId, nowMs: now() }) +
        refreshEventSeverity(db, { cardId, nowMs: now() });
      if (touched > 0) bb.realtime.publish("inbox-changed", { cardId });
    } catch {
      /* advisory only */
    }
  }

  // Disposable spawns (draft bursts, independent reviews) die with their
  // worker through lifecycleOwnerThreadId (BB 0.43 dependent threads).
  // Hosts predating the field strip unknown keys and honor the spawn; a host
  // that rejects it instead gets one retry without the field, so drafts and
  // reviews never break on older daemons.
  type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];
  async function spawnDisposable(
    args: SpawnArgs,
    site: string,
  ): Promise<{ id: string }> {
    // Fail fast through the registry before any SDK call: unknown sites,
    // visible spawns, and full permission refuse here, not mid-flight.
    assertDisposableSpawn({ site, args });
    try {
      return await bb.sdk.threads.spawn(args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        "lifecycleOwnerThreadId" in args &&
        /lifecycleOwnerThreadId|unrecognized key/i.test(message)
      ) {
        const { lifecycleOwnerThreadId: _dropped, ...rest } =
          args as SpawnArgs & Record<string, unknown>;
        return await bb.sdk.threads.spawn(rest as SpawnArgs);
      }
      throw error;
    }
  }

  function openExpiredQuestionIds(cardId: string): string[] {
    return (
      db
        .prepare(
          "SELECT id FROM expired_questions WHERE card_id = ? AND answered = 0 ORDER BY expired_at ASC",
        )
        .all(cardId) as Array<{ id: string }>
    ).map((row) => `expired:${row.id}`);
  }

  // Pending plugin interactions (stelow asks), narrowed so payload/title read.
  type PendingAsk = Extract<
    Awaited<
      ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["list"]>
    >[number],
    { origin: { kind: "plugin" } }
  >;
  function pendingAsks(
    list: Awaited<
      ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["list"]>
    >,
  ): PendingAsk[] {
    return list.filter(
      (entry): entry is PendingAsk =>
        entry.origin?.kind === "plugin" && entry.status === "pending",
    );
  }

  async function fetchPendingAsks(
    threadId: string | null,
  ): Promise<PendingAsk[] | null> {
    if (!threadId) return [];
    try {
      return pendingAsks(await bb.sdk.threads.interactions.list({ threadId }));
    } catch {
      // A failed read is unknown, not proof that a question disappeared.
      // Callers must preserve the existing question state in this case.
      return null;
    }
  }

  async function syncOpenQuestionInbox(
    card: CardRow,
  ): Promise<string[] | null> {
    const active = await fetchPendingAsks(card.worker_thread_id);
    if (active === null) return null;
    const questionIds = [
      ...active.map((entry) => entry.id),
      ...openExpiredQuestionIds(card.id),
    ];
    syncPendingQuestionInbox(card, questionIds);
    return questionIds;
  }

  function hasOpenQuestions(
    cardId: string,
    questionIds: string[] | null,
  ): boolean {
    return questionIds !== null
      ? questionIds.length > 0
      : openExpiredQuestionIds(cardId).length > 0;
  }

  const questionContractsGate = createQuestionContractsGate({
    bb,
    db,
    syncOpenQuestionInbox,
  });
  const critiqueGapState = createCritiqueGapState({
    bb,
    cardWorkspace,
    workflowStateDir: (card, rootPath) =>
      workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    loadCardScopes,
  });
  const { answerQuestions, answerExpiredQuestions } = createQuestionAnswers({
    bb,
    db,
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      cardArchived: ERR_CARD_ARCHIVED,
    },
    getCard,
    isArchivedCard,
    pendingAsks: async (threadId) =>
      pendingAsks(await bb.sdk.threads.interactions.list({ threadId })),
    openExpiredQuestionIds,
    syncPendingQuestionInbox,
    syncOpenQuestionInbox,
    markInboxQuestionsAnswered,
    recordSplitAnswer,
    consumeAskContract,
    logCardComment,
    updateCard,
    hasOpenQuestions,
  });
  const gapSummary = createGapSummary({
    getCard,
    stageEvents,
    summarizeTimeline,
    critiqueGapState,
    isDoneStatus,
    now,
  });
  const qualitySeal = createQualitySeal({
    bb,
    getCard,
    getCardByWorkerThread,
    cardWorkspace,
    strategyRounds,
    readResearchIndex,
  });
  const gateHandlers = createGateHandlers({
    db,
    bb,
    getCard,
    cardWorkspace,
    boardFromRoot,
    loadBoard,
  });
  const advanceCard = createCardAdvance({
    getCard,
    cardWorkspace,
    workflowStateDir: (rootPath, card) =>
      workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    ensureArtifacts: (rootPath, stateDir, requireOwnedState) =>
      ensureProjectArtifacts(bb, rootPath, stateDir, requireOwnedState),
    questionGate: questionContractsGate,
    runHelper,
    getReliablePreset: getReliablePresetForBand,
    getCardPreset: getPresetForCard,
    respawn: (cardId, presetId) => workers.respawn(cardId, presetId),
    updateCard: (cardId, fields) =>
      updateCard(cardId, fields as Parameters<typeof updateCard>[1]),
    publishCard: (cardId) => bb.realtime.publish("card-state", { cardId }),
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      cardArchived: ERR_CARD_ARCHIVED,
      workspaceUnavailable: ERR_WORKSPACE_UNAVAILABLE,
    },
  });
  const auditTrailStatus = createAuditTrailStatus({
    bb,
    getCard,
    cardWorkspace,
    workflowStateDir: (rootPath, card) =>
      workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    runHelper,
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      workspaceUnavailable: ERR_WORKSPACE_UNAVAILABLE,
    },
  });
  const cardDiff = createCardDiff({
    execFile,
    getCard,
    cardCheckout,
    recoveredIntegrity: (card, path) =>
      recoveredCheckoutIntegrity(recoveryIntegrityDeps, card, path),
    resolveLocalBin,
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      workspaceUnavailable: ERR_WORKSPACE_UNAVAILABLE,
    },
  });
  const reseedCard = createCardReseed({
    db,
    bb,
    now,
    getCard,
    cardWorkspace,
    workflowStateDir: (rootPath, card) =>
      workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    readStateConfig: async (rootPath, card) => readReseedConfig(card, rootPath),
    seedWorkflow: ({ rootPath, card, intent, appetite, reviewGates }) =>
      seedWorkflow(
        bb,
        rootPath,
        card.id,
        card.name,
        intent,
        appetite,
        reviewGates,
        true,
      ),
    getPresetById,
    pinCardPreset,
    getReliablePreset: getReliablePresetForBand,
    presetParams: presetAttachmentParams,
    strategyList,
    strategyRounds,
    roundFile: (strategyId, roundNo, stamp) =>
      roundFileName(strategyId, roundNo, stamp),
    roundStamp: roundTimestamp,
    roundRelativePath: roundRelPath,
    ensureArtifactParent,
    researchPrompt: researchWorkerPrompt,
    explorePrompt: exploreWorkerPrompt,
    attachments: cardAttachments,
    continuingEnvironment: workers.continuingEnvironment,
    workerEnvironment,
    replacePrepared: workers.replacePrepared,
    resetAutoContinue,
    updateCard: (cardId, fields) =>
      updateCard(cardId, fields as Parameters<typeof updateCard>[1]),
    recordThread: workers.recordThread,
    lineage: workers.lineage,
    publishCard: (cardId) => bb.realtime.publish("card-state", { cardId }),
    protocols: {
      cardOwnerRules: CARD_OWNER_RULES,
      neverSeed: NEVER_SEED,
      cliEquivalents: CLI_EQUIVALENTS,
      reconProtocol: RECON_PROTOCOL,
      draftProtocol: DRAFT_PROTOCOL,
      turnDiscipline: TURN_DISCIPLINE,
      commitStyle: COMMIT_STYLE,
      interfacePick: INTERFACE_PICK,
      doneProtocol: DONE_PROTOCOL,
      splitProtocol: SPLIT_PROTOCOL,
    },
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      cardArchived: ERR_CARD_ARCHIVED,
      workspaceUnavailable: ERR_WORKSPACE_UNAVAILABLE,
      presetNotFound: ERR_PRESET_NOT_FOUND,
    },
  });
  const promoteCard = createCardPromotion({
    db,
    bb,
    now,
    getCard,
    cardWorkspace,
    recoverySnapshot,
    getReliablePreset: getReliablePresetForBand,
    getCardPreset: getPresetForCard,
    respawn: workers.respawn,
    logComment: (cardId, body) => logCardComment(cardId, "card", cardId, "agent", body),
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      cardArchived: ERR_CARD_ARCHIVED,
      workspaceUnavailable: ERR_WORKSPACE_UNAVAILABLE,
    },
  });

  // Resolve a worker-authored artifact path (workspace-relative) into the
  // viewer-ready shape. Fail-soft by design: an unresolvable path yields
  // null and the option stays fully answerable — a bad path never blocks
  // the question, it just offers no open affordance.
  async function resolveAskArtifact(
    card: CardRow,
    rawPath: unknown,
  ): Promise<{
    path: string;
    display: string;
    absolutePath: string | null;
    hostId: string | null;
  } | null> {
    const normalized = normalizeAskArtifactPath(rawPath);
    if (!normalized) return null;
    const workspace = await cardWorkspace(card).catch(() => null);
    const full = workspace?.path
      ? resolveArtifactPath(workspace.path, normalized.path)
      : null;
    if (!full || !workspace?.hostId) return null;
    const artifact = await bb.sdk.files.read({ path: full }).catch(() => null);
    if (!artifact || !isPublishableArtifactContent(artifact.content))
      return null;
    return { ...normalized, absolutePath: full, hostId: workspace.hostId };
  }

  // Per-option artifacts for one rendered ask. A worker that attached
  // `--artifact` to a single option used to leave every other option —
  // including the approval — with nothing to open, because the evidence gate
  // only requires one option to carry evidence and the old manifest fallback
  // fired only when NO option had any. Every option now inherits the ask's
  // document (lib/question-batch inheritAskArtifact), and the manifest
  // recovery still covers asks that attached nothing at all.
  async function resolveAskOptions(
    card: CardRow | null,
    options: Array<{
      label: string;
      description: string;
      preview: string | null;
      artifact: { path: string } | null;
    }>,
  ) {
    const inherited = inheritAskArtifact(options);
    const noOptionCarriesDocument = inherited.every((artifact) => !artifact);
    const manifestArtifact =
      card && noOptionCarriesDocument
        ? await fallbackGateAskArtifact(card).catch(() => null)
        : null;
    const resolved = new Map<
      string,
      {
        path: string;
        display: string;
        absolutePath: string | null;
        hostId: string | null;
      } | null
    >();
    const out = [];
    for (const [index, option] of options.entries()) {
      const source = inherited[index];
      if (!source || !card) {
        out.push({ ...option, artifact: manifestArtifact });
        continue;
      }
      if (!resolved.has(source.path)) {
        resolved.set(
          source.path,
          await resolveAskArtifact(card, source.path).catch(() => null),
        );
      }
      out.push({ ...option, artifact: resolved.get(source.path) ?? null });
    }
    return out;
  }

  // Version 0.18.29 started refusing gate asks that had no document or
  // preview. Existing cards can still hold older, label-only interactions.
  // Recover their evidence from the card's own manifest so Approve plan and
  // Request changes receive the same per-option document affordance without
  // mutating the historical interaction payload.
  const GATE_ARTIFACT_STAGE: Record<string, string> = {
    gate: "shape",
    "int-gate": "interface",
    selection: "interface",
    "plan-gate": "planning",
  };
  async function fallbackGateAskArtifact(
    card: CardRow,
  ): Promise<{
    path: string;
    display: string;
    absolutePath: string | null;
    hostId: string | null;
  } | null> {
    const stage = await cardStageSlug(card);
    const artifactStage = stage ? GATE_ARTIFACT_STAGE[stage] : null;
    if (!artifactStage || !card.dir_hash) return null;
    const workspace = await cardWorkspace(card).catch(() => null);
    if (!workspace?.path) return null;
    const stateDir = await workflowStateDir(
      bb,
      workspace.path,
      card.id,
      card.dir_hash,
    ).catch(() => null);
    const stateBlob = stateDir
      ? await bb.sdk.files
          .read({ path: join(stateDir, "state.md") })
          .then((file) => file.content)
          .catch(() => null)
      : null;
    const manifestEntry = stateBlob
      ? parseArtifactManifest(stateBlob).find(
          (entry) => entry.stage === artifactStage && entry.path,
        )
      : null;
    return manifestEntry ? resolveAskArtifact(card, manifestEntry.path) : null;
  }

  fetchPendingQuestions = createPendingQuestions({
    fetchPendingAsks,
    getCardByWorkerThread,
    resolveAskOptions,
  });

  const executionNative = createExecutionNative({
    db,
    bb,
    randomId,
    cardWorkspace,
    stateDir: (card, rootPath) =>
      workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    logComment: (cardId, targetId, body) =>
      logCardComment(cardId, "card", targetId, "agent", body),
  });
  const executionLifecycle = createExecutionLifecycle({
    db,
    bb,
    randomId,
    getCard,
    logComment: (cardId, targetId, body) =>
      logCardComment(cardId, "card", targetId, "agent", body),
    native: executionNative,
  });
  const executionReconcile = createExecutionReconcile({
    db,
    bb,
    now,
    randomId,
    getCard,
    cardWorkspace,
    fetchPendingQuestions,
    logComment: (cardId, targetId, body) =>
      logCardComment(cardId, "card", targetId, "agent", body),
    publishCard: (cardId) => bb.realtime.publish("card-state", { cardId }),
    native: executionNative,
    lifecycle: executionLifecycle,
  });
  const executionAdvance = createExecutionAdvance({
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      cardArchived: ERR_CARD_ARCHIVED,
      workspaceUnavailable: ERR_WORKSPACE_UNAVAILABLE,
    },
    getCard,
    getCardByWorkerThread,
    cardWorkspace,
    projectRoot: (projectId) => projectRoot(bb, projectId),
    stateDir: (card, rootPath) =>
      workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
    ensureArtifacts: (rootPath, stateDir, requireOwnedState) =>
      ensureProjectArtifacts(bb, rootPath, stateDir, requireOwnedState),
    questionGate: (card, stateDir) => questionContractsGate(card, stateDir),
    runHelper,
    native: executionNative,
    reworkNote: async (card) => {
      if (card.stage !== "audit") return "";
      const gaps = await critiqueGapState(card).catch(() => null);
      if (!gaps?.matched) return "";
      const open = gaps.auditGapScopes.filter(
        (scope) => !isDoneStatus(scope.status),
      );
      return open.length > 0
        ? `\n(rework loop: back to execution from audit — picking up ${open.length} open audit-gap scope(s): ${open.map((scope) => scope.id).join(", ")})`
        : "\n(rework loop: back to execution from audit — no open audit-gap scopes)";
    },
    updateCard: (cardId, fields) =>
      updateCard(cardId, fields as Parameters<typeof updateCard>[1]),
    recordStageEvent,
    recordExecutionEntry: (cardId, evidence, transition) =>
      recordTrackableEvent(db, {
        cardId,
        kind: "scope",
        trackableId: "all",
        transition,
        actor: "host",
        evidence,
      }),
    getReliablePreset: (band, cardId) => getReliablePresetForBand(band, cardId),
    getCardPresetId: (cardId) => getPresetForCard(cardId).id,
    respawn: (cardId, presetId) => workers.respawn(cardId, presetId),
    scheduleRespawn: (cardId, presetId) =>
      workers.scheduleRespawn(cardId, presetId),
    requestGatePreReview,
    publishCard: (cardId) => bb.realtime.publish("card-state", { cardId }),
    isArchivedCard,
  });

  const worktreeCleanup = createWorktreeCleanup({
    getCard: (cardId) => getCard(cardId),
    evidence: (card) =>
      discardEvidence(card as Parameters<typeof discardEvidence>[0]),
    dropWorktree: dropLinkedWorktree,
    stopWorker: (threadId) => workers.stop(threadId),
    log: (cardId, body) =>
      logCardComment(cardId, "card", cardId, "agent", body),
    publish: (event, payload) => bb.realtime.publish(event, payload),
  });

  // completion contract differs (valid index vs valid stage artifact).
  const trackSync = createResearchTrackSync({
    bb,
    db,
    now,
    getCard,
    updateCard,
    recordInboxEvent,
    resolvePausedEvents: (cardId, at) =>
      resolveInboxEvents(cardId, at, ["paused"], "completed"),
    recordStageEvent,
    markThreadRunning,
    syncQuestions: syncOpenQuestionInbox,
    noteAgentOutput,
    applyFailed: (cardId, threadId, error) =>
      workers.applyFailed(cardId, threadId, error),
    escalateIfStalled,
    researchReadiness,
    exploreArtifact,
    idleAttentionMs: IDLE_ATTENTION_MS,
  });

  const syncThreadState = createBuildThreadSync({
    bb,
    db,
    now,
    getCard,
    cardWorkspace,
    workflowStateDir,
    updateCard,
    syncResearch: trackSync.syncResearch,
    syncExplore: trackSync.syncExplore,
    syncQuestions: syncOpenQuestionInbox,
    applyFailed: (cardId, threadId, error) => workers.applyFailed(cardId, threadId, error),
    logComment: (cardId, body) =>
      logCardComment(cardId, "card", cardId, "agent", body),
    recordInbox: recordInboxEvent,
    vetContinuation: vetAutoContinueNudge,
    escalateIfStalled,
    stripMessageDirectives,
    interfacePick: INTERFACE_PICK,
    auditDoneNudge: AUDIT_DONE_NUDGE,
    idleAttentionMs: IDLE_ATTENTION_MS,
  });

  function maybeBumpSeverity(): Promise<void> {
    return decisionApi.maybeBumpSeverity();
  }

  registerRuntimeLifecycle({
    bb,
    db,
    syncThreadState,
    applyFailed: (cardId, threadId, error) =>
      workers.applyFailed(cardId, threadId, error),
    executionReconcile,
    getCard,
    cardWorkspace,
    maybeBumpSeverity,
    notifyClaimWaiters,
    disposeWorkers: () => workers.dispose(),
  });

  // Workflow mechanics are private to workers created by the Build panel.
  // Manifest skills are static registrations in BB, so configure() is the
  // boundary that keeps them out of every other thread/session.
  registerWorkerSkills(bb);

  // The helper and skills are pinned to one upstream commit at plugin release
  // time. Do not mutate them at boot: a running plugin must remain able to
  // explain exactly which Stelow behavior produced an audit receipt.

  // NOTE: v0.6.0–v0.6.2 shipped a one-pass pw- → sw- boot migration. It ran,
  // production converged (zero pw- hashes and dirs), and the code was
  // removed: early alpha, no compat shims for dead prefixes.

  // NOTE: a previous revision stopped every live worker thread here. Removed:
  // dispose fires on every hot-reload (dev + build:reload), so it massacred
  // in-flight work with a "Stopped manually" on each update. Workers now
  // survive reloads; boot reconcile re-syncs their state, and a truly dead
  // plugin surfaces as an honest worker error on the next bb stelow call.

  // Shared continue copy: the manual Retry action and the auto-continue
  // watchdog send the same nudge, so a worker cannot tell (or behave
  // differently for) a human resume from an automatic one.
  // The audit-stage variant: reaching audit is not completing. The worker
  // commits with `bb stelow done`; the host verifies in code. Narrating
  // completion ("Workflow concluído") without running done leaves the card
  // waiting — this nudge is the only thing an audit-idle resume says.
  // Decision API, review policy, migrations, handlers, and execution seams
  // live behind one factory. Preset judging remains host-owned and injected.
  const decisionApi = createDecisionApi({
    db,
    bb,
    now,
    judgeViaPreset,
    presetExists: (id) => getPresetById(id) !== null,
  });

  // GitHub issues live decoupled in server/github-issues.ts: tables,
  // backfills, matcher wiring, scheduler, and RPCs. One seam in, one out.
  const github = createGithubAutomation({
    db,
    bb,
    now,
    randomId,
    presets: {
      getWorktreePresetId: presetServer.getWorktreePresetId,
      getEffectiveBuildEnvironmentKind:
        presetServer.getEffectiveBuildEnvironmentKind,
      pinCardPreset,
    },
    cards: {
      get: (cardId) => getCard(cardId),
      create: (args) => createCardInternal(args),
      comment: (cardId, target, targetId, author, body) =>
        logCardComment(cardId, target, targetId, author, body),
      workspace: (card) => cardWorkspace(card as CardRow),
      scopes: (card, rootPath) =>
        rootPath ? loadCardScopes(rootPath, card.id) : [],
      normalizeStatus: (value) => normalizeStatus(value),
      statusLabel: (status) => statusLabelForSummary(status),
    },
  });

  // The scheduler lives with the feature it drives: disabling the module
  // (STELOW_GITHUB_ISSUES=0) stops the ticks along with the RPCs.
  registerAutomationSchedule(bb, () => github.runAutomationRules());

  const artifactsPublication = createArtifactsPublication({
    db,
    bb,
    now,
    randomId,
    cardNotFound: ERR_CARD_NOT_FOUND,
    cards: {
      get: (cardId) => getCard(cardId),
      checkout: (card) => cardCheckout(card as CardRow),
    },
    normalizeStatus,
  });

  const cardDetail = createCardDetailHandler({
    db,
    bb,
    now,
    idleAttentionMs: IDLE_ATTENTION_MS,
    getCard,
    cardWorkspace,
    syncThreadState,
    fetchPendingQuestions,
    resolveAskOptions,
    cardAttachments,
    detectMentionedFiles,
    workspaceRelative,
    parseNextStages,
    getReliablePreset: getReliablePresetForBand,
    strategyList,
    flowTimes: flowTimesForCard,
    verifiedHeadSha: verifiedHeadShaForCard,
    workers,
    executionLifecycle,
    stalenessForQuestions,
    stateDir: (sourcePath, card) =>
      card.dir_hash
        ? workflowStateDir(bb, sourcePath, card.id, card.dir_hash)
        : Promise.resolve(null),
    fileTimestamp,
    auditReceiptNote,
    cardNotFound: ERR_CARD_NOT_FOUND,
  });
  const cardMutations = createCardMutationHandlers({
    db,
    bb,
    now,
    getCard,
    cardWorkspace,
    workflowStateDir,
    logCardComment,
    updateCard,
    errors: {
      cardNotFound: ERR_CARD_NOT_FOUND,
      cardArchived: ERR_CARD_ARCHIVED,
    },
  });
  const cardLifecycle = createCardLifecycleHandlers({
    db,
    bb,
    getCard,
    cardWorkspace,
    workflowStateDir,
    workers,
    updateCard,
    releaseClaims: releaseCardClaimsAndNotify,
    removeCardPreset,
    logCardComment,
    runGitIn,
    exploratoryScope: EXPLORATORY_SCOPE,
    discardEvidence,
    discardEligibility,
    discardConfirm,
    discardTrail,
    errors: { cardNotFound: ERR_CARD_NOT_FOUND },
  });
  const cardOperations = createCardOperationsHandlers({
    db,
    bb,
    getCard,
    workers,
    updateCard,
    releaseClaims: releaseCardClaimsAndNotify,
    recordStageEvent,
    cardStageSlug,
    fetchPendingAsks,
    openExpiredQuestionIds,
    logCardComment,
    resetAutoContinue,
    buildNudge: (card) => recoveryNudge(card, INTERFACE_PICK),
    buildContinueInput,
    splitRequestNudge: SPLIT_REQUEST_NUDGE,
    phaseEntryStages: PHASE_ENTRY_STAGES,
    errors: { cardNotFound: ERR_CARD_NOT_FOUND, cardArchived: ERR_CARD_ARCHIVED },
  });

  const researchTrack = createResearchTrackHandlers({
    db,
    bb,
    now,
    getCard,
    cardWorkspace,
    createCard: createCardInternal,
    readResearchIndex,
    researchRoundFiles,
    strategyRounds,
    strategyList,
    workflowStateDir: (rootPath, workflowId, dirHash) =>
      workflowStateDir(bb, rootPath, workflowId, dirHash),
    roundRelPath,
    ensureParent: ensureArtifactParent,
    logCardComment,
    reliablePreset: (band, cardId) => getReliablePresetForBand(band, cardId),
    presetName: (presetId) => getPresetById(presetId)?.name,
    respawn: (cardId, presetId, reason, options) =>
      workers.respawn(cardId, presetId, reason, options),
    errors: { cardNotFound: ERR_CARD_NOT_FOUND, cardArchived: ERR_CARD_ARCHIVED },
  });

  registerRpcHandlers(
    bb,
    rpcContract,
    {
      ...decisionApi.handlers,
      ...github.handlers,
      ...inbox.handlers,
      ...workspacesRecovery.handlers,
      ...artifactsPublication.handlers,
      ...executionLifecycle.handlers,
      ...executionReconcile.handlers,
      ...executionAdvance.handlers,
      ...worktreeCleanup.handlers,
      ...cardMutations,
      ...cardLifecycle,
      ...cardOperations,
      cardDetail: cardDetail as never,
      draftDoneComment: ({ cardId }: { cardId: string }) =>
        drafting.draftDoneComment(cardId),
      board: cards.handlers.board as never,
      projects: async () => {
        const list = await bb.sdk.projects.list();
        return {
          projects: list.map((project) => ({
            id: project.id,
            name: project.name,
          })),
        };
      },
      flowMetrics: (input) => flowMetrics(db, input),
      async boardWorkflowDefaults() {
        const stored = await bb.storage.kv.get<unknown>(
          "board-workflow-defaults",
        );
        const parsed = boardWorkflowDefaultsSchema.safeParse(stored);
        if (!parsed.success)
          return {
            appetite: "Lean" as const,
            reviewMode: "Auto" as const,
            reviewGates: [] as Array<
              "spec" | "interface" | "scope" | "tech" | "diff"
            >,
          };
        // Explicit migration, never a silent safeParse fallback: a stored
        // ladder string maps to its set, so a saved "Tech Review" default
        // survives instead of degrading to Auto.
        const record = stored as {
          reviewMode?: unknown;
          reviewGates?: unknown;
        };
        const reviewGates = normalizeReviewGates(
          record.reviewGates ?? record.reviewMode ?? [],
        ) as Array<"spec" | "interface" | "scope" | "tech" | "diff">;
        return {
          appetite: parsed.data.appetite,
          reviewMode: legacyLabelForGates(reviewGates) ?? "Auto",
          reviewGates,
        };
      },

      ...gateHandlers,

      cardDiff,
      auditTrailStatus,
      reseedCard,
      promoteCard,
      advanceCard,
      answerQuestions,

      async startWorkflow({ projectId, prompt }) {
        const thread = await workers.spawnWorkflow({
          projectId,
          environment: { type: "project-default" },
          title: `Stelow: ${prompt.slice(0, 70)}`,
          prompt: `Use the stelow workflow to shape and execute this request. The Stelow workflow skills (stelow-workflow-entry, stelow-workflow-router, \
stelow-workflow-*) are provided by bb-plugin-stelow — load them first. The product strategy playbooks (stelow-product-*) are also provided by \
this plugin \u2014 check \`bb skill list\` first, and only fetch via \`npx skills add calionauta/stelow\` if one is missing. Use \`bb stelow \
advance <stage>\` to change stages; do NOT hand-write stage transitions. Preserve every gate \
(product, interface, tech plan, diff). ${CLI_EQUIVALENTS}\n\nRequest:\n${prompt}`,
        });
        return { threadId: thread.id };
      },

      async ensureWorkflow({ projectId, name, intent }) {
        const rootPath = await projectRoot(bb, projectId);
        if (!rootPath)
          return {
            rootPath: null,
            statePath: null,
            error: "Project workspace path is unavailable.",
          };
        const result = await seedWorkflow(
          bb,
          rootPath,
          workflowIdForName(name),
          name,
          intent,
        );
        if (result.error)
          return { rootPath, statePath: null, error: result.error };
        bb.realtime.publish("board-changed", { reason: "seeded" });
        return { rootPath, statePath: result.statePath, error: null };
      },

      listCards: cards.handlers.listCards,

      async cardByWorkerThread({ threadId }) {
        const row = getCardByWorkerThread(threadId);
        if (!row) return { cardId: null, kind: null };
        // The thread→card relation outlives archiving: a stopped thread on an
        // archived card still answers "which card was this", so the thread
        // header keeps its way back. Card detail renders archived cards.
        return { cardId: row.id, kind: normalizeKind(row.kind) };
      },

      readCardFile: cards.handlers.readCardFile,

      createCard: cards.handlers.createCard,

      gapSummary,
      qualitySeal,

      ...researchTrack,

      answerExpiredQuestions,

      async advance({ projectId, stage }) {
        const rootPath = await projectRoot(bb, projectId);
        if (!rootPath)
          return {
            stage: "",
            stdout: "",
            error: "Project workspace path is unavailable.",
          };
        const guard = await ensureProjectArtifacts(bb, rootPath);
        if (guard) return { stage, stdout: "", error: guard };
        const result = await runHelper(["advance", stage], rootPath);
        if (result.code !== 0)
          return {
            stage,
            stdout: result.stdout,
            error: result.stderr || "stelow advance failed",
          };
        bb.realtime.publish("board-changed", { stage });
        return { stage, stdout: result.stdout, error: null };
      },

      ...presetServer.handlers,

      ...platform,
    },
  );

  const runInspection = createInspectionCommand({
    skillsDir: PLUGIN_SKILLS_DIR,
    errors: {
      archived: ERR_CARD_ARCHIVED,
      workspace: ERR_WORKSPACE_UNAVAILABLE,
    },
    getCard,
    getCardForThread: getCardByWorkerThread,
    cardWorkspace,
    loadBoard: (projectId) => loadBoard(bb, projectId),
    boardFromRoot: (root, dirHash) => boardFromRoot(bb, root, dirHash),
    projectRoot: (projectId) => projectRoot(bb, projectId),
    workflowStateDir: (root, cardId, dirHash) =>
      workflowStateDir(bb, root, cardId, dirHash),
    ensureProjectArtifacts: (root, stateDir, hasOwnedState) =>
      ensureProjectArtifacts(bb, root, stateDir, hasOwnedState),
    runHelper: (args, root, stateDir) => runHelper(args, root, stateDir),
    readText: (path) =>
      bb.sdk.files
        .read({ path })
        .then((file) => file.content)
        .catch(() => null),
    researchStrategySkill: trackCapabilities.researchStrategySkill,
    exploreTechnique: trackCapabilities.exploreTechnique,
  });

  const runStelowCli = createStelowCliRun({
    db,
    bb,
    now,
    randomId,
    getCard,
    getCardByWorkerThread,
    cardWorkspace,
    updateCard,
    logCardComment,
    recordInboxEvent,
    recordStageEvent,
    stageEvents,
    projectRoot: (projectId) => projectRoot(bb, projectId),
    workflowStateDir: (rootPath, workflowId, dirHash) =>
      workflowStateDir(bb, rootPath, workflowId, dirHash),
    ensureProjectArtifacts: (rootPath, stateDir, requireOwnedState) =>
      ensureProjectArtifacts(bb, rootPath, stateDir, requireOwnedState),
    runHelper: (args, cwd, stateDir) => runHelper(args, cwd, stateDir),
    seedWorkflow: (rootPath, workflowId, name, intent) =>
      seedWorkflow(bb, rootPath, workflowId, name, intent),
    cardCheckout,
    gitEvidence: (path) => recoveryGitEvidence(path),
    runGitIn: (cwd, args) => runGitIn(cwd, args),
    workingDiffFor,
    testCommandForCheckout,
    runHostTests,
    spawnDisposable,
    cardStageSlug,
    docDepths: (card) => buildDocDepthsForCard(card),
    passingReviewCovers,
    pendingQuestions: (threadId) => fetchPendingQuestions(threadId),
    pendingAsks: (threadId) => fetchPendingAsks(threadId),
    openExpiredQuestionIds,
    askContractChecklist,
    snapshotQuestionEvidence,
    strategyRounds,
    readResearchIndex,
    researchArtifacts: { researchReadiness, exploreArtifact },
    gapState: (card) => critiqueGapState(card),
    createCard: (input) => createCardInternal(input),
    releaseCardClaims: (cardId) => releaseCardClaimsAndNotify(cardId),
    notifyClaimWaiters,
    lockBlockedSummary,
    workers,
    presets: presetServer,
    reviewPolicy: () => decisionApi.reviewPolicy(),
    decisionRoute: (point, config) => decisionApi.routeConfig(point, config),
    judgeCriteria: judgePresetCriteria,
    judgeScoredBatch,
    preview: { view: previewView, start: previewStart, stop: previewStop },
    draftingCommand: (argv, threadId) => drafting.command(argv, threadId),
    advanceCli: (argv, context) => executionAdvance.cli(argv, context),
    scopeCommand: (argv, context) =>
      runScopeCommand(argv, context, {
        bb,
        getCardByWorkerThread,
        cardWorkspace,
        projectRoot: (projectId) => projectRoot(bb, projectId),
        workflowStateDir: (rootPath, card) =>
          workflowStateDir(bb, rootPath, card.id, card.dir_hash!),
        ensureProjectArtifacts: (rootPath, stateDir, requireOwnedState) =>
          ensureProjectArtifacts(bb, rootPath, stateDir, requireOwnedState),
        runHelper,
        recordTrackableEvent: (event) => {
          recordTrackableEvent(db, event);
        },
      }),
    runInspection,
    skillsDir: PLUGIN_SKILLS_DIR,
  });

  registerStelowCli(bb, (argv, context) => runStelowCli(argv, context));

  registerMentionProviders(bb, {
    db,
    loadBoard: (projectId) => loadBoard(bb, projectId),
  });
}
