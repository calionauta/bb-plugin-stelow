import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join as nodeJoin,
  relative,
} from "node:path";
import { fileURLToPath } from "node:url";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  buildArtifactTrailer,
  isPublishableArtifactContent,
  parseArtifactManifest,
  renderBundleManifest,
  resolveArtifactPath,
} from "../lib/artifact-manifest.mjs";
import {
  assignBundleNames,
  parseBundleManifest,
  staleBundleEntries,
  unbundledSources,
} from "../lib/run-bundle.mjs";
import {
  PHASE_ENTRY_STAGES,
  STAGE_TO_BAND,
} from "../lib/workflow-vocabulary.mjs";
import { splitDiffByFile, MAX_DIFF_FILES } from "../lib/diff-split.mjs";
import { summarizeSemDiff } from "../lib/sem-summary.mjs";
import { summarizeCymbalChanged } from "../lib/cymbal-changed.mjs";
import {
  refreshEventSeverity,
  refreshStalledPaused,
} from "../lib/inbox-events.mjs";
import {
  acquireWorkspaceClaims,
  addClaimWaiters,
  CLAIM_TTL_MS,
  checkWorkspaceClaims,
  clearClaimWaiters,
  releaseAllCardClaims,
  releaseWorkspaceClaims,
  waitersForFiles,
} from "../lib/card-claims.mjs";
import { isClaimTerminal } from "../lib/card-terminal.mjs";
import { resolveClaimKey } from "../lib/card-claim-key.mjs";
import {
  classifyAskCancel,
  interruptionWhy,
  isRetryablePersistError,
} from "../lib/ask-cancel.mjs";
import {
  questionWaitUpdates,
  askFinishedUpdates,
} from "../lib/card-question-state.mjs";
import {
  expandInteractionQuestions,
  formatBatchContinuation,
  groupBatchAnswers,
  inheritAskArtifact,
  normalizeAskArtifactPath,
  parseAskGroups,
} from "../lib/question-batch.mjs";
import { decideAskGate } from "../lib/ask-gate.mjs";
import { cleanAnswerList } from "../lib/expired-question-answers.mjs";
import {
  consumeAskContract,
  recordAskContracts,
  validateAskContracts,
} from "../lib/ask-contracts.mjs";
import { resolvePluginRoot } from "../lib/plugin-paths.mjs";
import {
  discardConfirm,
  discardEligibility,
  discardTrail,
} from "../lib/discard-policy.mjs";
import {
  normalizePromoteName,
  findAdoptableProject,
} from "../lib/promote-card.mjs";
import { STATE_TEMPLATE } from "../lib/state-template.mjs";
import {
  ownsWorkflowState,
  upsertWorkflowEntry,
  workflowDirHash,
  workflowEntryForOwner,
  workflowIdForName,
  workflowStateRelativeDir,
} from "../lib/workflow-state-identity.mjs";
import {
  RESEARCH_STRATEGIES,
  researchStrategyById,
  parseStrategyList,
  mergeStrategyContracts,
} from "../lib/research-strategies.mjs";
import {
  normalizeHistory,
  roundTimestamp,
  roundFileName,
  parseRoundPath,
  ROUNDS_DIR,
} from "../lib/research-rounds.mjs";
import {
  isValidRoundContent,
  isValidExploreContent,
  exploreArtifactFile,
  researchVerifyReport,
  researchVerifyText,
  exploreVerifyReport,
  exploreVerifyText,
} from "../lib/research-artifacts.mjs";
import {
  validateArtifact,
  validateSubstep,
  validateVariant,
  validateExplore,
  buildDocDepths,
  sealStatus,
} from "../lib/artifact-validation.mjs";
import {
  buildReviewPrompt,
  parseReviewOutput,
  reviewSummary,
  reviewCoversFingerprint,
} from "../lib/review-verdict.mjs";
import { assertDisposableSpawn } from "../lib/delegation-map.mjs";
import {
  judgeArtifactCriteria,
  groupCriteriaByKind,
  parseCriteriaBlock,
} from "../lib/skill-criteria.mjs";
import { bandForCardKindStage } from "../lib/preset-staleness.mjs";
import {
  resolveDecisionApiKey,
  normalizeDecisionApiModel,
  evaluateDecisionCall,
  isDecisionApiDisabled,
  normalizeDecisionProvider,
  providerRequiresKey,
  defaultEndpointFor,
  defaultModelFor,
} from "../lib/decision-api.mjs";
import {
  DECISION_POINT_ARTIFACT_CRITERIA,
  normalizePointMode,
  defaultThresholdsFor,
  normalizeThresholds,
} from "../lib/decision-points.mjs";
import {
  buildPresetJudgePrompt,
  parsePresetJudgeOutput,
  PRESET_JUDGE_TIMEOUT_MS,
  PRESET_JUDGE_POLL_MS,
} from "../lib/preset-judge.mjs";
import {
  tasksToScoreQuestions,
  resolveScopeVerdicts,
  taskVerifyCommand,
  TASK_EVIDENCE_DIFF_CHARS,
} from "../lib/task-evidence.mjs";
import { resolveScoredVerdicts } from "../lib/score-verdicts.mjs";
import {
  countDelegations,
  summarizeDelegationEvidence,
} from "../lib/delegation-evidence.mjs";
import {
  contractForStrategy,
  contractForBuildArtifact,
} from "../lib/artifact-contracts.mjs";
import { normalizeKind } from "../lib/tracks.mjs";
import { TECHNIQUE_CATALOG, techniqueById } from "../lib/stage-catalog.mjs";
import { parseResearchIndex, checkIndexItems } from "../lib/research-index.mjs";
import { evidenceStatus } from "../lib/research-evidence.mjs";
import {
  isArchivedCard,
  stripArchivedResuscitation,
} from "../lib/worker-action-policy.mjs";
import {
  freshStatusForReseed,
  resolveReseedIntent,
} from "../lib/workflow-intent-policy.mjs";
import { previewText } from "../lib/preview-session.mjs";
import {
  cardWorkerSeedRefusal,
  withRuntimeIgnoreEntry,
} from "../lib/card-seed-guard.mjs";
import {
  lastTurnAdvancedStages,
  nextAutoContinue,
  resetAutoContinue,
  shouldAutoContinue,
  shouldDoneNudge,
} from "../lib/auto-continue.mjs";
import {
  autoContinueFields,
  buildContinueInput,
  buildContinueNudge,
} from "../lib/worker-continuation.mjs";
import {
  SPLIT_KEEP_LABEL,
  SPLIT_PROPOSAL_TTL_MS,
  recordSplitAnswer,
  splitEligibility,
  splitOutcome,
  splitRemainder,
  validateSplitSlices,
  withStandardSplitDisclosure,
} from "../lib/split-proposal.mjs";
import { splitQuestionText } from "../lib/split-question-presentation.mjs";
import {
  askTimelineLabels,
  describeAskSubmission,
  englishQuestionContentError,
} from "../lib/question-presentation.mjs";
import { doneEligibility } from "../lib/completion.mjs";
import {
  formatBytes,
  threadIdFromWorktreePath,
  isStaleEnvironment,
} from "../lib/worktree-storage.mjs";
import { isDoneStatus } from "../lib/trackables.mjs";
import { recordTrackableEvent } from "../lib/trackable-events.mjs";
import { countScopeDialects } from "../lib/spec-scope-reader.mjs";
import { doneBuildGates } from "../lib/build-gates.mjs";
import {
  AUDIT_RECEIPT_FILE,
  AUDIT_RECEIPT_NOTE,
  auditReceiptReadiness,
} from "../lib/audit-receipt.mjs";
import { statusForNewCardWork } from "../lib/card-work-resume.mjs";
import { parseWorkflowConfig } from "../lib/workflow-config.mjs";
import {
  formatReviewGates,
  legacyLabelForGates,
  normalizeReviewGates,
  preReviewArtifactKind,
} from "../lib/review-gates.mjs";
import { requiredForStage } from "../lib/question-contracts.mjs";
import { checkAdvanceContracts } from "../lib/advance-contracts.mjs";
import { createPreviewRuntime } from "../lib/preview-runtime.mjs";
import { publicationSource } from "../lib/vcs-publication.mjs";
import {
  detectedTestCommand,
  sameGitEvidence,
  verificationReadiness,
} from "../lib/audit-verification.mjs";
import {
  AUDIT_TRAIL_FILE,
  AUDIT_TRAIL_NOTE,
  auditTrailGate,
  auditTrailOutcome,
} from "../lib/audit-trail-contract.mjs";
import {
  RECON_RECEIPT_FILE,
  reconReceiptStatus,
} from "../lib/recon-receipt.mjs";
import { stalenessOf } from "../lib/question-staleness.mjs";
import {
  tokenBreakdownFromEvents,
  sumTokenBreakdowns,
} from "../lib/token-usage.mjs";
import {
  escalatedGaps,
  summarizeGaps,
  validateGapRegistry,
  gapsToTriageBatch,
  buildGapTriageState,
} from "../lib/gap-registry.mjs";
import { formatDuration, summarizeTimeline } from "../lib/card-metrics.mjs";
import {
  createWorkspacesRecovery,
  recoveredCheckoutIntegrity,
} from "./workspaces-recovery.js";
import { createDecisionApi } from "./decision-api.js";
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
  type RespawnOptions,
  type RespawnPreparation,
  type WorkerCard,
} from "./workers.js";
import {
  latestSpecTech,
  loadCardScopes,
  normalizeStatus,
  runScopeCommand,
  workflowScopes,
} from "./scopes.js";
import { createPlatformHandlers } from "./runtime/platform.js";
import { createCardPreview } from "./runtime/card-preview.js";
import { createInspectionCommand } from "./runtime/cli-inspection.js";
import { cliUnknownResult } from "./runtime/cli-registry.js";
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
import { createBuildThreadSync } from "./runtime/build-thread-sync.js";

const pluginDir = resolvePluginRoot(
  dirname(fileURLToPath(import.meta.url)),
  existsSync,
);
const HELPER_SCRIPT = (() => {
  const candidates = [
    nodeJoin(pluginDir, "data", "stelow"),
    nodeJoin(pluginDir, "..", "data", "stelow"),
  ];
  for (const candidate of candidates) {
    try {
      if (readFileSync(candidate, "utf8").length > 0) return candidate;
    } catch {
      /* try next */
    }
  }
  return candidates[0]!;
})();
const PLUGIN_SKILLS_DIR = nodeJoin(pluginDir, "skills");
const PLUGIN_ORCHESTRATOR_REF = nodeJoin(
  PLUGIN_SKILLS_DIR,
  "stelow-workflow-orchestrator",
  "references",
);

// Transitions contract: always the vendored upstream copy (kept fresh by
// the skills sync). No root-mirror fallbacks — a missing vendored copy is
// a broken install and must fail closed, not silently use a stale mirror.
const TRANSITIONS_REF = nodeJoin(PLUGIN_ORCHESTRATOR_REF, "transitions.md");

// Strategy contracts: neutral per-strategy data (skill, contract, substeps)
// comes from upstream `product-strategies.json` (synced to
// data/product-strategies.json); presentation (label, blurb, emoji,
// keywords) stays local. Merged in place so every existing consumer
// (researchStrategyById, expectedSubsteps, RPC payloads) sees one list.
// Missing/unparseable registry → embedded contracts stand (works against
// older stelow checkouts).
try {
  const registry = JSON.parse(
    readFileSync(
      nodeJoin(pluginDir, "data", "product-strategies.json"),
      "utf8",
    ),
  );
  const merged = mergeStrategyContracts(RESEARCH_STRATEGIES, registry);
  RESEARCH_STRATEGIES.splice(0, RESEARCH_STRATEGIES.length, ...merged);
} catch {
  // Embedded contracts stand; import-time has no bb.log yet. The sync
  // schedule keeps data/product-strategies.json fresh on a live daemon.
}

// Ground-truth freshness signal, written by scripts/postbuild.mjs. The panel
// bundle and bb's plugin row are both sticky caches; the About tab renders
// this so "did the reload take effect?" is checkable instead of vibes.
// stelowVersion is the UPSTREAM release (synced data/stelow-package.json),
// kept separate so the two versions can never be mistaken for each other.
// Note the candidates assume the UNIFIED root (see resolvePluginRoot):
// version.json only exists under dist/, package.json at the root.
const BUILD_INFO = (() => {
  const fallback = { version: "dev", builtAt: null as string | null };
  let version = fallback.version;
  let builtAt = fallback.builtAt;
  for (const candidate of [
    nodeJoin(pluginDir, "version.json"),
    nodeJoin(pluginDir, "dist", "version.json"),
    nodeJoin(pluginDir, "package.json"),
  ]) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
        version?: unknown;
        builtAt?: unknown;
      };
      if (typeof parsed.version === "string") {
        version = parsed.version;
        builtAt = typeof parsed.builtAt === "string" ? parsed.builtAt : null;
        break;
      }
    } catch {
      /* try next */
    }
  }
  return { version, builtAt };
})();

/** The upstream version shipped with this plugin release. */
function readPinnedStelowVersion(): string | null {
  for (const candidate of [
    nodeJoin(pluginDir, "data", "stelow-package.json"),
    nodeJoin(pluginDir, "..", "data", "stelow-package.json"),
  ]) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
        version?: unknown;
      };
      if (typeof parsed.version === "string") return parsed.version;
    } catch {
      /* try next */
    }
  }
  return null;
}

// Stage bands: groups of workflow stages that share a worker preset. A card's
// worker swaps presets only at band boundaries (analysis -> planning -> execution
// -> review), so context continuity is preserved within a band. Research and
// explore cards run single stages with their own band so lightweight tracks
// have an explicit preset default independent of the build analysis phase.
// Bands live in lib/workflow-vocabulary.mjs (single source shared with the panel).

import {
  attachmentSchema,
  boardWorkflowDefaultsSchema,
  workflowSchema,
} from "./contracts.js";
export { rpcContract } from "./rpc-contract.js";
import { rpcContract } from "./rpc-contract.js";

/**
 * The preview view the panel renders. Derived from the RPC contract itself, so
 * the frontend type cannot drift from what the server actually validates.
 */
export type PreviewInfo = z.infer<typeof rpcContract.previewState.output>;

type FilesApi = BbPluginApi["sdk"]["files"];
type Workflow = z.infer<typeof workflowSchema>;
type LooseRecord = Record<string, unknown>;

const GATES = {
  gate: { artifact: "product-spec", receipt: "gate-approved.md" },
  "int-gate": { artifact: "interfaces", receipt: "int-gate-approved.md" },
  "plan-gate": { artifact: "tech-plan", receipt: "plan-gate-approved.md" },
  "diff-gate": { artifact: "other", receipt: "diff-gate-approved.md" },
} as const;

function record(value: unknown): LooseRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as LooseRecord)
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function recoveryNudge(card: WorkerCard, interfacePick: string): string {
  if (card.kind === "research") {
    return `Continue the Stelow research now. Re-read your research-index.md first, then keep researching with the strategy playbook. If a \
question is already pending on the card, do NOT re-ask it — the answer arrives here on its own. But if you genuinely need NEW input from the \
user that was never asked, ask it now via bb stelow ask; silence is not progress. NEVER run \`bb stelow advance\` — research has no stages. When \
the index is complete with ranked opportunities, STOP and end your turn. If a \`bb stelow\` command fails, read its stderr once and continue \
— do NOT spend the turn debugging the CLI; report the exact error and move on.`;
  }
  if (card.kind === "explore") {
    return `Continue the Stelow explore task now. Re-read your explore artifact and the stage skill, then keep working on the stage deliverable. \
If a question \
is already pending on the card, do NOT re-ask it — the answer arrives here on its own. But if the stage genuinely needs NEW input from the user \
that was never asked, ask it now via bb stelow ask; silence is not progress. NEVER run \`bb stelow advance\` — explore has no stages. When the \
stage deliverable is complete, STOP and end your turn. If a \`bb stelow\` command fails, read its stderr once and continue — do NOT spend the \
turn debugging the CLI; report the exact error and move on.`;
  }
  return buildContinueNudge(interfacePick);
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// Short human status for the GitHub completion summary (English).
function statusLabelForSummary(status: string): string {
  if (status === "in-progress") return "in progress";
  if (status === "done" || status === "completed") return "done";
  return status;
}

async function projectRoot(
  bb: BbPluginApi,
  projectId: string | null,
): Promise<string | null> {
  if (!projectId) return null;
  try {
    const project = await bb.sdk.projects.get({ projectId });
    const source =
      project.sources.find((entry) => entry.isDefault) ?? project.sources[0];
    return source?.path ?? null;
  } catch {
    return null;
  }
}

// Resolve a card's state only when both persisted ownership records agree.
// A matching name or dirHash alone is deliberately insufficient: projects can
// contain repeated requests and converted exploratory workspaces.
async function workflowStateDir(
  bb: BbPluginApi,
  rootPath: string,
  workflowId: string,
  dirHash: string,
): Promise<string | null> {
  try {
    const tracking = await readJson(
      bb.sdk.files,
      join(rootPath, "stelow.json"),
    );
    const workflow = workflowEntryForOwner(
      array(tracking?.workflows),
      workflowId,
      dirHash,
    );
    const relativeDir = workflowStateRelativeDir(workflow);
    if (!relativeDir) return null;
    const stateDir = join(rootPath, relativeDir);
    const state = await bb.sdk.files
      .read({ path: join(stateDir, "state.md") })
      .then((file) => file.content)
      .catch(() => null);
    return ownsWorkflowState(state, workflowId) ? stateDir : null;
  } catch {
    return null;
  }
}

function join(root: string, relative: string): string {
  return `${root.replace(/\/$/, "")}/${relative.replace(/^\//, "")}`;
}

function fileTimestamp(
  file: { modifiedAtMs?: unknown } | null,
  fallback: string,
): string {
  const modifiedAtMs = file?.modifiedAtMs;
  return typeof modifiedAtMs === "number" &&
    Number.isFinite(modifiedAtMs) &&
    modifiedAtMs > 0
    ? new Date(modifiedAtMs).toISOString()
    : fallback;
}

function safeRelative(path: string): string {
  if (
    !path ||
    path.startsWith("/") ||
    path.split("/").some((part) => part === "..")
  ) {
    throw new Error("Path must stay inside the project workspace.");
  }
  return path;
}

async function seedWorkflow(
  bb: BbPluginApi,
  rootPath: string,
  workflowId: string,
  name: string,
  intent: string,
  appetite = "Core",
  reviewMode: string | string[] = "Auto",
  fresh = false,
): Promise<{
  statePath: string | null;
  stateDir: string | null;
  dirHash: string | null;
  error: string | null;
}> {
  const transitionsPath = join(
    rootPath,
    "skills/stelow-workflow-orchestrator/references/transitions.md",
  );
  const trackingPath = join(rootPath, "stelow.json");
  try {
    mkdirSync(join(rootPath, ".stelow/approvals"), { recursive: true });
    mkdirSync(
      join(rootPath, "skills/stelow-workflow-orchestrator/references"),
      { recursive: true },
    );
    // Live runs stay out of git: a worker `git add -A` must never sweep
    // `.stelow/` into the project history — the committed record is the
    // exported docs/runs/<card>/ bundle. Best-effort, git checkouts only,
    // never blocks seeding.
    try {
      if (existsSync(join(rootPath, ".git"))) {
        const ignorePath = join(rootPath, ".gitignore");
        let current = "";
        try {
          current = readFileSync(ignorePath, "utf8");
        } catch {
          /* created below */
        }
        const next = withRuntimeIgnoreEntry(current);
        if (next !== null) writeFileSync(ignorePath, next, "utf8");
      }
    } catch {
      /* hygiene never blocks seeding */
    }

    let trackingData: LooseRecord = {};
    try {
      trackingData = JSON.parse(
        readFileSync(trackingPath, "utf8"),
      ) as LooseRecord;
    } catch {
      /* create fresh */
    }
    if (!Array.isArray(trackingData.workflows)) trackingData.workflows = [];

    // A name is a label, not an identity. Reuse is reserved for this exact
    // immutable owner (a card id for panel work) and requires both the index
    // and the state file to agree. An entry that carries no owner id is never
    // adopted, and neither is a state file that names someone else.
    const workflows = trackingData.workflows as unknown[];
    const entry = workflowEntryForOwner(workflows, workflowId);
    const entryDir = workflowStateRelativeDir(entry);
    const reusable =
      !fresh &&
      entry &&
      entryDir &&
      (await bb.sdk.files
        .read({ path: join(rootPath, `${entryDir}/state.md`) })
        .then((file) => ownsWorkflowState(file.content, workflowId))
        .catch(() => false));
    // Seeding an owner that is already seeded is a no-op: it returns the
    // workflow's own paths and leaves its entry, stage, and progress alone.
    if (reusable && entryDir) {
      const existingDir = join(rootPath, entryDir);
      return {
        statePath: join(existingDir, "state.md"),
        stateDir: existingDir,
        dirHash: text(record(entry).dirHash),
        error: null,
      };
    }
    const dirHash = workflowDirHash(workflowId, fresh);
    // One function owns the path shape, so what is written here is exactly what
    // workflowStateDir() later resolves. `created` pins the path's date segment
    // to the workflow's first seed, so a re-seed never moves its directory.
    const created = text(record(entry).created) || new Date().toISOString();
    const relativeDir = workflowStateRelativeDir({ created, dirHash });
    if (!relativeDir)
      return {
        statePath: null,
        stateDir: null,
        dirHash: null,
        error: "Unable to derive the workflow state directory.",
      };
    const stateDir = join(rootPath, relativeDir);
    mkdirSync(stateDir, { recursive: true });
    const statePath = join(stateDir, "state.md");
    const stateBlob = await bb.sdk.files
      .read({ path: statePath })
      .then((f) => f.content)
      .catch(() => "");
    if (
      !stateBlob.includes("current_stage:") ||
      !ownsWorkflowState(stateBlob, workflowId)
    ) {
      // Canonical storage is the gate set (`review_gates: [spec, …]`, empty
      // ≡ Auto). The legacy `review_mode:` ladder label is kept for
      // upstream readers; novel sets have no rung, so they read back as
      // Auto there — the worker prompt names `review_gates` first.
      const gates = normalizeReviewGates(reviewMode);
      const rung = legacyLabelForGates(gates) ?? "Auto";
      const body = STATE_TEMPLATE.replace("<workflow-id>", workflowId)
        .replace("<workflow-name>", name)
        .replace(
          "<new-product|feature|bugfix|refactor|investigate|unknown>",
          intent,
        );
      writeFileSync(
        statePath,
        body
          .replace("appetite: Core", `appetite: ${appetite}`)
          .replace(
            "review_mode: Auto",
            `review_gates: ${formatReviewGates(gates)}\n  review_mode: ${rung}`,
          ),
        "utf8",
      );
    }

    if (!existsSync(transitionsPath)) {
      writeFileSync(
        transitionsPath,
        readFileSync(TRANSITIONS_REF, "utf8"),
        "utf8",
      );
    }

    trackingData.workflows = upsertWorkflowEntry(workflows, {
      workflowId,
      name,
      description: "",
      status: "in-progress",
      cwd: rootPath,
      dirHash,
      created,
      updated: new Date().toISOString(),
      stage: {
        current_stage: "triage",
        previous_stage: null,
        transitioned_at: new Date().toISOString(),
        history: [{ stage: "triage", entered_at: new Date().toISOString() }],
      },
      phases: [],
      config: {
        appetite,
        review_mode:
          legacyLabelForGates(normalizeReviewGates(reviewMode)) ?? "Auto",
        review_gates: normalizeReviewGates(reviewMode),
      },
    });
    writeFileSync(trackingPath, JSON.stringify(trackingData, null, 2), "utf8");
    return { statePath, stateDir, dirHash, error: null };
  } catch (error) {
    return {
      statePath: null,
      stateDir: null,
      dirHash: null,
      error:
        error instanceof Error ? error.message : "Unable to seed workflow.",
    };
  }
}

import { isManagedWorktreeEnvironment } from "../lib/card-environment.mjs";

function cardAttachments(
  raw: string | null,
): Array<z.infer<typeof attachmentSchema>> {
  try {
    return z.array(attachmentSchema).parse(JSON.parse(raw ?? "[]"));
  } catch {
    return [];
  }
}

function workspaceRelative(rootPath: string, path: string): string | null {
  const value = isAbsolute(path) ? relative(rootPath, path) : path;
  try {
    return safeRelative(value);
  } catch {
    return null;
  }
}

// Round-artifact validity lives in lib/research-artifacts (pure, unit-tested):
// researchRoundMirrorsIndex + isValidRoundContent + findInvalidRounds. The
// round listing, the readiness gate, and the completion check all share them,
// so the three can never diverge on what counts as a valid round artifact.

async function detectMentionedFiles(
  bb: BbPluginApi,
  rootPath: string | null,
  text: string,
): Promise<Array<{ path: string; display: string; absolutePath: string }>> {
  if (!rootPath) return [];
  const candidates = new Set<string>();
  // Match file-ish tokens: path/to/file.ext (no spaces, may include -_./)
  for (const match of text.matchAll(
    /\b(?:(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:md|markdown|txt|json|yaml|yml|toml|ts|tsx|js|jsx|py|go|rs|sh|css|html|env))(?:\b|(?=[\s,.;:)]))/g,
  )) {
    const token = match[0]!.replace(/[.,;:)]+$/, "");
    if (token.length >= 3 && token.length <= 120) candidates.add(token);
  }
  const found: Array<{ path: string; display: string; absolutePath: string }> =
    [];
  // Exact paths only. A basename "search" used to run when nothing matched,
  // which surfaced files the request never named (a split card's prompt names
  // the PARENT card's state.md, and the search matched its own). An unfaithful
  // suggestion is worse than none, so a miss simply lists nothing.
  for (const candidate of candidates) {
    try {
      await bb.sdk.files.read({ path: join(rootPath, candidate) });
      found.push({
        path: candidate,
        display: candidate,
        absolutePath: join(rootPath, candidate),
      });
    } catch {
      /* not found at that exact path — never guess */
    }
  }
  return found.slice(0, 6);
}

function parseNextStages(
  rootPath: string | null,
  currentStage: string,
): string[] {
  if (!rootPath) return [];
  const transitionsPath = join(
    rootPath,
    "skills/stelow-workflow-orchestrator/references/transitions.md",
  );
  if (!existsSync(transitionsPath)) return [];
  let content: string;
  try {
    content = readFileSync(transitionsPath, "utf8");
  } catch {
    return [];
  }
  // NOTE: do not use a `(?=^### |\Z)`-style regex here — `\Z` is an
  // end-of-string anchor in Python but a literal "Z" in JavaScript, which
  // silently broke parsing of the last stage block (`audit`). Splitting on
  // headers avoids the dialect trap and any regex injection via stage names.
  const sections = content.split(/^### /m);
  const section = sections.find(
    (entry) =>
      entry === currentStage ||
      entry.startsWith(`${currentStage}\n`) ||
      entry.startsWith(`${currentStage} `),
  );
  if (!section) return [];
  const stages = new Set<string>();
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    for (const key of ["next", "accept", "reject", "rework"] as const) {
      const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
      if (!match) continue;
      // Trailing "(...)" segments are human comments ("(none — stays at
      // triage)", "shape (shape rework — same stage)"), not stages. Without
      // stripping, a comment either leaks words (comma split keeps them) or
      // hides a real target (the whole token contains "(" and is dropped).
      const value = match[1].split("(")[0];
      for (const token of value.split(",")) {
        const stage = token.replace(/[[\]\s"']/g, "");
        if (stage && /^[a-z][a-z0-9-]*$/.test(stage)) stages.add(stage);
      }
    }
  }
  return Array.from(stages);
}

async function ensureProjectArtifacts(
  bb: BbPluginApi,
  rootPath: string,
  stateDir?: string | null,
  requireOwnedState = false,
): Promise<string | null> {
  const tracking = join(rootPath, "stelow.json");
  const transitions = join(
    rootPath,
    "skills/stelow-workflow-orchestrator/references/transitions.md",
  );
  if (requireOwnedState && !stateDir) {
    return "This card's workflow state cannot be verified. Reseed the card; Stelow will not use project-root state as a fallback.";
  }
  const state = stateDir
    ? join(stateDir, "state.md")
    : join(rootPath, "state.md");
  if (!existsSync(transitions)) {
    mkdirSync(dirname(transitions), { recursive: true });
    writeFileSync(transitions, readFileSync(TRANSITIONS_REF, "utf8"), "utf8");
  }
  if (
    !existsSync(state) ||
    !(await bb.sdk.files
      .read({ path: state })
      .then((file) => file.content.includes("current_stage:"))
      .catch(() => false))
  ) {
    return "state.md is missing for the Stelow workflow. Reseed the workflow.";
  }
  if (!existsSync(tracking)) {
    return "stelow.json is missing for the Stelow workflow. Reseed the workflow.";
  }
  return null;
}

function runHelper(
  args: string[],
  cwd: string,
  stateDir?: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      STELOW_TRANSITIONS: nodeJoin(
        cwd,
        "skills/stelow-workflow-orchestrator/references/transitions.md",
      ),
    };
    if (stateDir) {
      env.STELOW_STATEDIR = stateDir;
      env.STELOW_STATE = nodeJoin(stateDir, "state.md");
    } else {
      // Project-root mode: single state.md for workflows without a
      // per-workflow state dir.
      env.STELOW_STATE = nodeJoin(cwd, "state.md");
    }
    const child = spawn("bash", [HELPER_SCRIPT, ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) =>
      resolveRun({ code: null, stdout, stderr: error.message }),
    );
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

// A completed Build card carries two receipts and their names differ by one
// word, so neither is self-explaining. The host's `audit.md` is the record of
// what was verified, by which tests, at which checkout; Stelow's portable
// `audit-trail.md` is the deterministic lineage projection the CLI owns. The
// CLI never registers its own output (it would have to digest itself), so the
// host is the one that attributes the trail to Audit and labels both — instead
// of showing a receipt the audit produced as an unregistered document.
function auditReceiptNote(absolute: string): string | null {
  const name = basename(absolute);
  if (name === AUDIT_RECEIPT_FILE) return AUDIT_RECEIPT_NOTE;
  if (name === AUDIT_TRAIL_FILE) return AUDIT_TRAIL_NOTE;
  return null;
}

async function readJson(
  files: FilesApi,
  path: string,
): Promise<LooseRecord | null> {
  try {
    const file = await files.read({ path });
    return record(JSON.parse(file.content));
  } catch {
    return null;
  }
}

async function findArtifacts(
  files: FilesApi,
  root: string,
  workflow: LooseRecord,
): Promise<Workflow["artifacts"]> {
  const created = text(workflow.created).slice(0, 10);
  const dirHash = text(workflow.dirHash);
  if (!created || !dirHash) return [];
  const workflowRoot = join(root, `.stelow/${created}/${dirHash}`);
  let paths: string[] = [];
  try {
    const result = await files.listPaths({
      path: workflowRoot,
      includeFiles: true,
      includeDirectories: false,
    });
    paths = array(record(result).paths)
      .map((entry) =>
        typeof entry === "string" ? entry : text(record(entry).path),
      )
      .filter(Boolean);
  } catch {
    return [];
  }
  const receipts = new Set<string>();
  try {
    const receiptResult = await files.listPaths({
      path: join(root, `.stelow/approvals/${dirHash}`),
      includeFiles: true,
      includeDirectories: false,
    });
    for (const entry of array(record(receiptResult).paths))
      receipts.add(
        typeof entry === "string"
          ? entry.split("/").pop()!
          : text(record(entry).path).split("/").pop()!,
      );
  } catch {
    /* no approvals yet */
  }

  const candidates = await Promise.all(
    paths
      .filter((path) => path.endsWith(".md"))
      .map(async (path) => {
        const content = await files
          .read({ path })
          .then((file) => file.content)
          .catch(() => null);
        if (!isPublishableArtifactContent(content)) return null;
        const relative = path.startsWith(root)
          ? path.slice(root.length + 1)
          : `.stelow/${created}/${dirHash}/${path.replace(/^\//, "")}`;
        const filename = relative.split("/").pop() ?? relative;
        const kind: Workflow["artifacts"][number]["kind"] = filename.startsWith(
          "spec-product",
        )
          ? "product-spec"
          : filename.startsWith("interfaces")
            ? "interfaces"
            : filename.startsWith("spec-tech")
              ? "tech-plan"
              : filename.includes("critique")
                ? "critique"
                : "other";
        const receipt =
          kind === "product-spec"
            ? GATES.gate.receipt
            : kind === "interfaces"
              ? GATES["int-gate"].receipt
              : kind === "tech-plan"
                ? GATES["plan-gate"].receipt
                : "";
        return {
          kind,
          label: filename,
          path: relative,
          approved: receipt ? receipts.has(receipt) : false,
        };
      }),
  );
  return candidates
    .filter(
      (artifact): artifact is Workflow["artifacts"][number] =>
        artifact !== null,
    )
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function loadBoard(bb: BbPluginApi, projectId: string | null) {
  const rootPath = await projectRoot(bb, projectId);
  if (!rootPath)
    return {
      rootPath: null,
      workflows: [],
      error: projectId
        ? "Project workspace path is unavailable."
        : "Select a bb project to view its Stelow board.",
    };
  return boardFromRoot(bb, rootPath);
}

// Board scoped to an explicit workspace root (project source, or a single
// exploratory card dir). onlyDirHash restricts the listing to one workflow —
// used when a card worker asks for status: its project's source root holds no
// stelow.json (each exploratory card owns its own file), so resolving by
// project alone yields a misleading "not found".
async function boardFromRoot(
  bb: BbPluginApi,
  rootPath: string,
  onlyDirHash?: string | null,
) {
  const trackingPath = join(rootPath, "stelow.json");
  const tracking = await readJson(bb.sdk.files, trackingPath);
  if (!tracking)
    return {
      rootPath,
      workflows: [],
      error: `No stelow.json found (looked in ${trackingPath}). Start a Stelow workflow first — card workers: your file lives in your own state dir, not the \
project root.`,
    };
  const entries = array(tracking.workflows).filter(
    (value) => !onlyDirHash || text(record(value).dirHash) === onlyDirHash,
  );
  if (onlyDirHash && entries.length === 0)
    return {
      rootPath,
      workflows: [],
      error: `No workflow ${onlyDirHash} in ${trackingPath}. The card may have been reseeded — read the state dir from your spawn prompt.`,
    };

  const workflows: Workflow[] = [];
  for (const [index, value] of entries.entries()) {
    const raw = record(value);
    const config = record(raw.config);
    const stage = record(raw.stage);
    const phases = array(raw.phases).map((entry, phaseIndex) => {
      const phase = record(entry);
      return {
        id: text(phase.id, `phase-${phaseIndex + 1}`),
        name: text(phase.name, text(phase.id, `Phase ${phaseIndex + 1}`)),
        status: normalizeStatus(phase.status),
      };
    });
    // Each workflow owns its own state.md (per-card); read it for the real
    // stage instead of a single project-level stateStage.
    let workflowStage = "";
    const dirHash = text(raw.dirHash);
    if (dirHash) {
      const created = text(raw.created).slice(0, 10);
      if (created) {
        try {
          const stateBlob = await bb.sdk.files.read({
            path: join(rootPath, `.stelow/${created}/${dirHash}/state.md`),
          });
          workflowStage = text(
            stateBlob.content.match(/current_stage:\s*(\S+)/)?.[1],
          );
        } catch {
          /* no per-workflow state yet */
        }
      }
    }
    workflows.push({
      id: text(raw.dirHash, text(raw.name, `workflow-${index + 1}`)),
      name: text(raw.name, `Workflow ${index + 1}`),
      description: text(raw.description),
      status: normalizeStatus(raw.status),
      stage:
        workflowStage ||
        text(
          stage.current_stage,
          phases.find((phase) => phase.status === "in-progress")?.name ??
            "Not started",
        ),
      appetite: text(config.appetite, "Core"),
      reviewMode: text(config.review_mode, "Auto"),
      reviewGates: normalizeReviewGates(
        Array.isArray(config.review_gates)
          ? config.review_gates.filter(
              (entry): entry is string => typeof entry === "string",
            )
          : config.review_mode,
      ) as Array<"spec" | "interface" | "scope" | "tech" | "diff">,
      ...(typeof raw.dirHash === "string" ? { dirHash: raw.dirHash } : {}),
      ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}),
      phases,
      scopes: workflowScopes(raw),
      artifacts: await findArtifacts(bb.sdk.files, rootPath, raw),
    });
  }
  return { rootPath, workflows, error: null };
}

export default async function plugin(bb: BbPluginApi) {
  // Shared worker copy: the vendored skills show `scripts/stelow ...`
  // commands, but bb workspaces have no such binary — the plugin wraps the
  // same operations. One sentence everywhere so workers discover the
  // sync-scopes/lock/config equivalents instead of failing on the path.
  // Seed is a cardless/human operation: card workflows are pre-seeded at
  // spawn and the seed CLI refuses card workers, so the copy must never
  // invite a card worker to seed (that orphaned a project-root workflow).
  const CLI_EQUIVALENTS =
    "Run `bb stelow playbook` first: it prints your state.md, transitions.md, and stage playbook paths — never discover them with `bb skill list \
| awk` pipelines. Scope sync runs automatically when you advance into execution; where a skill shows a `scripts/stelow ...` command, use the \
`bb stelow` equivalent instead (`bb stelow sync-scopes`, `bb stelow lock acquire|release|check`, `bb stelow config get`) — same flags. Never \
run `bb stelow seed`: card workflows arrive pre-seeded and the command refuses card workers. File-claim discipline: `lock acquire` also registers \
a workspace-level claim so sibling cards on this checkout see your files. A `BB-LOCK-BLOCKED` stderr means another live card holds the file — \
do NOT spin or retry in a loop: park that scope (work an independent scope meanwhile), the host pages the user and resumes you with a nudge when \
the file frees. `lock release` the moment a scope no longer needs its files; terminal states release everything automatically.";
  // Prompt clauses that every build spawn path must carry. They are consts
  // (not pasted prose) so a new spawn site cannot silently drop one — the
  // prompt-contract test fails when a site stops referencing them. This is
  // what burned us before: spawn and reseed taught the seed ban and the
  // turn discipline while the band-swap restart prompt carried neither.
  const NEVER_SEED =
    "Your workflow is already seeded in your state dir above — never run `bb stelow seed` (it is refused for card workers; seeding again orphans \
a second workflow outside your card).";
  const TURN_DISCIPLINE =
    "Turn discipline: never end a turn with a bare progress report while current_stage is not `audit` and no question is pending — narrating \
progress is not finishing it. Progress narration belongs in <state-dir>/session.log, not as your final message. A turn ends only in a tool call, \
a structured `bb stelow ask`, or workflow completion. If you catch yourself writing a status summary with nothing left to run, run `bb stelow \
status` and take the next stage action instead. Question language: write every structured ask, option label, and option description in English. \
The card UI is English-only; never rely on it to translate your prose.";
  // Commit hygiene: workers commit to arbitrary checkouts, and some repos
  // release from commits (release-please, semantic-release). The worker
  // detects that itself from repo markers and only then writes conventional
  // messages — freeform everywhere else, never empty or wip.
  const COMMIT_STYLE =
    "When you commit to the checkout yourself, first check for release automation (a release-please config or manifest, .releaserc*, a semantic-release \
block, or CHANGELOG.md plus v* tags). If the repo releases from commits, write `type: subject` conventional messages (`feat`, `fix`, `docs`, \
`test`, `chore`); otherwise a plain one-line summary. Never commit empty or `wip` messages.";
  // Interface-pick discipline is shared by every spawn prompt plus the
  // continue nudge: one const so a wording fix lands everywhere (the
  // prompt-contracts test pins single definition + all references).
  const INTERFACE_PICK =
    "Interface-pick discipline: check review_gates in state.md first (review_mode is the legacy ladder label — normalize it to gates when review_gates \
is absent). For each selected gate the workflow waits for a human decision with a live structured ask; unselected gates never park: the LLM decides \
itself, writes the receipt (assumptions_resolved, selected_by: llm, approval receipts), and advances. Gate-tool fallback: if visual_review is \
unavailable in this host, do NOT park in chat waiting.";
  // Explicit completion: done-ness was inferred from `audit` + idle, so a
  // narrate-and-stop at audit looked identical to stuck-at-audit. The
  // worker commits with `bb stelow done`; the host verifies in code.
  const DONE_PROTOCOL =
    "Finish explicitly: run `bb stelow done` to mark the card complete — never just announce completion and stop. Build cards complete only at \
the `audit` stage; research/explore cards complete only after `bb stelow verify` passes. Before Build `done`, run `bb stelow verify --tests` \
from the final checkout; it executes the project’s safe conventional test command and records the result against the current Git root and HEAD. \
Run `bb stelow verify-tasks` and report any unmet findings honestly in audit.md — advisory only, it never blocks `done`. Run `bb stelow gap-triage` \
and, if it dismisses any escalated gap, say so honestly in audit.md (advisory only; the routing below never changes). If the execution critique \
escalates gaps, run `bb stelow gap-scopes` and loop back with `bb stelow advance execution` — a card with open gaps is not done, it is back in \
execution. Execute the new rework scopes, re-run the critique, and only then return to audit for `done`: `done` refuses while escalated gaps \
lack scopes or rework scopes stay open. Then write `<state-dir>/audit.md` and register it in state.md under `artifacts:` with `stage: audit`. \
It must contain headings for Acceptance criteria, Verification, Tests (the exact host-run command and result), Git evidence (branch/commit or \
explicit non-Git reason), and Execution context. Under Execution context, record the absolute path of the checkout you actually wrote to (confirm \
it with `pwd` / `git rev-parse --show-toplevel`) and state that you did not write outside it; the host refuses `done` when it does not match \
this card's own workspace, and its error names the exact path to record. `done` refuses otherwise and names the fix — read its stderr and keep \
working instead of stopping. When you commit this work to the checkout, the run bundle is already fresh: `done` refreshes `docs/runs/<card>/` \
plus `manifest.md` (SHA pins, gap counts) automatically on every completion and prints the paste-ready trailer in its output — a reopened card \
that completes again refreshes it again. Commit that directory with the work, then paste the trailer block below the commit subject: a commit \
cannot carry files, so the bundle plus the trailer is the durable audit link. Between completions, `bb stelow export --check` reports changed, \
unreadable, newly registered, and uncommitted sources without writing anything.";
  const RECON_PROTOCOL =
    "For any codebase reconnaissance, work from the target Git workspace root, never the card-state or skill directory. Run the bundled Stelow \
`recon.sh` preflight before using optional tools, passing this card's exact <state-dir> as its \
second argument; it writes `<state-dir>/context/recon-receipt.json`. \
Do not install tools inside the workflow. Cite that receipt and name missing optional tools in planning or audit output; a missing receipt is \
currently a warning, not a reason to fabricate or skip recon.";
  // Explicit split: one card is one workflow. This is deliberately a
  // high bar, not a "two bullets means two cards" rule: the default is one
  // focused card with scopes. The host creates cards only from a recorded,
  // human-approved proposal (`bb stelow split` takes no content args).
  const SPLIT_PROTOCOL =
    'Split is exceptional, not a checklist decomposition: DEFAULT to one focused card with scoped work. Propose ONE split only at triage — or, \
if it becomes clear only there, at Choose work (`select`) before committing its choice — when there are 2+ substantial, end-to-end deliverables \
that each have a distinct user outcome, acceptance criterion, and independently auditable workflow. Do NOT split merely because the request has \
bullets, files, UI/API pieces, sequential steps, or small fixes; keep shared implementation, one outcome, or tightly coupled changes together. \
Each proposed child must be worth its own normal workflow; if that is doubtful, keep one card. When the high bar is met, open `bb stelow ask \
--tag split --multiple --question <text> --option <card title> --desc <its outcome and done criterion>...` plus exactly one `--option "Keep as \
one card"` (exact label). Each option carries its slice in --desc (+ --artifact when the slice references files). Select one or more deliveries \
OR the Keep as one card option — never both. Then STOP and wait for the answer. A split-proposal record or an earlier chat message is NOT a pending \
question: only a visible structured form on the card is. If the ask failed before that form appeared, correct the command and submit the same \
ask once; never wait for an invisible question. Never split unilaterally, never invent cards, and do not advance from the current split point \
until answered. After the answer, run `bb stelow split` (no args — the host executes the recorded approval) and follow its stdout: an archived \
parent means stop. Never hedge with a standard question that merely validates a grouping (“looks good?”) — either the bar above is met (ask --tag \
split) or it isn\'t (keep one card and advance). A standard answer executes nothing and can never become a split later.';
  // One-shot trigger for the human "Propose split" action. A pointer, not a
  // second protocol copy: the full syntax lives once in SPLIT_PROTOCOL
  // above (prompt-contracts pins that), the nudge carries only the delta.
  const SPLIT_REQUEST_NUDGE =
    'Split requested: the user explicitly asked for a split proposal. Follow SPLIT_PROTOCOL in your system prompt: ask with --tag split --multiple \
(one --option per delivery plus exactly one --option \\"Keep as one card\\"), then STOP and wait; after the answer, execute the recorded approval \
with `bb stelow split`. Do not ask a standard question about splitting instead — only a --tag split proposal is executable.';
  // Optional paid review, always explicit: after `bb stelow verify` PASSes you
  // may OFFER `bb stelow review` through `bb stelow ask` — never run it
  // unasked. Review spends reviewer budget on a different-model reviewer and
  // only sees structurally valid artifacts; `review` refuses thin files and
  // cards without a designated reviewer preset.
  const REVIEW_PROTOCOL =
    "Optional paid review: after `bb stelow verify` passes, you may OFFER `bb stelow review` via `bb stelow ask` — never run it unasked, never \
auto-run it. Review spends reviewer budget and only accepts structurally valid artifacts.";
  const DRAFT_PROTOCOL =
    "Cheap drafts: for disposable prose bursts (alternative wordings, expansions, taglines — never protocol work, never anything needing tools \
or exact shapes), run `bb stelow draft --prompt <brief>` — a hidden thread on the generation preset returns text you must judge 100% before using. \
If no generation preset is set it runs on your band preset; an empty or failed draft means do it yourself, never retry in a loop.";
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

  // Shared card-creation path for both the UI "start card" handler and the
  // GitHub import. A Personal-project request gets an isolated persistent
  // exploratory workspace; project cards keep using their declared source.
  //
  // kind "research" runs a stelow-product-* strategy instead of the build
  // workflow: no stages, no gates, no advance. The worker writes research-index.md
  // (exact shape below) into its own state dir; the user marks Done and
  // fans opportunities out into build cards from the plugin UI.
  const CARD_OWNER_RULES =
    "You are the card owner: preserve context, ask the user, and publish the canonical result yourself. workflow_id is an immutable ownership \
marker: never edit it, copy another workflow's state, or use a project-root state.md as a substitute. Do not split this card's initial workflow \
into subagents. You may delegate only independent work with a distinct input and output file, then review and synthesize it yourself. Never delegate \
structured questions, card state changes, lifecycle commands, or the canonical result. Delegate fresh: package the full task in the call itself \
(brief plus every file path and fact the delegate needs) — never fork a thread, inherit history, or let siblings talk to each other.";

  const { researchWorkerPrompt, exploreWorkerPrompt } = createTrackPrompts({
    cardOwnerRules: CARD_OWNER_RULES,
    doneProtocol: DONE_PROTOCOL,
    reviewProtocol: REVIEW_PROTOCOL,
    draftProtocol: DRAFT_PROTOCOL,
  });

  // Preset judgment runner: one hidden thread on the pinned preset answers a
  // strict-JSON question. Always cleans up (stop + archive); every failure
  // returns ok:false so callers fall back to built-in rules or refuse with
  // the fix named. Burns a full provider turn — only wired to low-frequency
  // points (triage seed, explicit criteria calls).
  async function judgeViaPreset({
    presetId,
    projectId,
    title,
    prompt,
    timeoutMs = PRESET_JUDGE_TIMEOUT_MS,
  }: {
    presetId: string;
    projectId: string | null;
    title: string;
    prompt: string;
    timeoutMs?: number;
  }): Promise<{ ok: boolean; text: string | null; error: string | null }> {
    const fail = (error: string) => ({ ok: false as const, text: null, error });
    const preset = getPresetById(presetId);
    if (!preset) return fail(`Unknown preset "${presetId}".`);
    if (!projectId) return fail("Preset judging needs a project.");
    let threadId: string | null = null;
    try {
      // delegation-site: preset-judge
      const thread = await bb.sdk.threads.spawn({
        projectId,
        environment: { type: "project-default" },
        visibility: "hidden",
        title,
        providerId: preset.provider_id,
        model: preset.model_id,
        reasoningLevel: preset.reasoning_level as
          | "low"
          | "medium"
          | "high"
          | "xhigh"
          | "max"
          | "none"
          | "ultra"
          | "ultracode",
        permissionMode: preset.permission_mode as
          | "accept-edits"
          | "auto"
          | "full",
        input: [{ type: "text", mentions: [], text: prompt }],
      });
      threadId = thread.id;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const live = await bb.sdk.threads.get({ threadId }).catch(() => null);
        const status = (live as { status?: string } | null)?.status ?? null;
        if (status === "idle" || status === "error") break;
        if (Date.now() >= deadline) {
          // No explicit stop here: the finally below owns all cleanup, so a
          // timeout archives the runaway through the same path as every exit.
          return fail("Preset judge timed out.");
        }
        await new Promise((resolve) =>
          setTimeout(resolve, PRESET_JUDGE_POLL_MS),
        );
      }
      const text =
        (await bb.sdk.threads.output({ threadId }).catch(() => null))?.output ??
        null;
      if (typeof text !== "string" || text.length === 0)
        return fail("Preset judge returned no output.");
      return { ok: true, text, error: null };
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Preset judge failed.",
      );
    } finally {
      if (threadId) {
        await bb.sdk.threads.stop({ threadId }).catch(() => null);
        await bb.sdk.threads.archive({ threadId }).catch(() => null);
      }
    }
  }

  // Map preset criteria verdicts onto the findings shape the Jev path
  // returns, so criteria callers downstream never branch on the judge.
  // The confidence floor applies like the Jev routeAt: a missing or low
  // confidence degrades to unverifiable, never to a guessed verdict.
  function presetCriteriaFindings({
    verdicts,
    semantic,
    routeAt,
  }: {
    verdicts: Array<{ id: string; status: string; confidence: number | null }>;
    semantic: Array<{ id: string; text: string }>;
    routeAt: number;
  }) {
    const byId = new Map(
      semantic.map((criterion) => [criterion.id, criterion.text]),
    );
    return verdicts
      .filter((verdict) => byId.has(verdict.id))
      .map((verdict) => {
        const confident =
          typeof verdict.confidence === "number" &&
          verdict.confidence >= routeAt;
        return {
          id: verdict.id,
          kind: "semantic" as const,
          text: byId.get(verdict.id) ?? verdict.id,
          score: null as number | null,
          confidence: verdict.confidence,
          verdict:
            !confident || verdict.status === "unverifiable"
              ? ("unverifiable" as const)
              : (verdict.status as "met" | "unmet"),
          error: null as string | null,
        };
      });
  }

  // Preset variant of artifact-criteria judging for explicit calls
  // (criteria): one spawned judgment per artifact, mapped onto the Jev
  // findings shape so downstream never branches on the judge.
  // One findings shape for every judge path (Jev or preset): the verbose
  // literal lives here once, so the three early returns cannot drift apart.
  type PresetFinding = {
    id: string;
    kind: "semantic";
    text: string;
    score: number | null;
    confidence: number | null;
    verdict: "met" | "unmet" | "unverifiable";
    error: string | null;
  };
  async function judgePresetCriteria({
    presetId,
    projectId,
    skillText,
    artifactText,
    routeAt,
  }: {
    presetId: string;
    projectId: string | null;
    skillText: string;
    artifactText: string;
    routeAt: number;
  }) {
    const semantic = groupCriteriaByKind(
      parseCriteriaBlock(skillText),
    ).semantic;
    if (semantic.length === 0)
      return {
        ok: true as const,
        findings: [] as Array<PresetFinding>,
        evaluated: 0,
      };
    const prompt = buildPresetJudgePrompt({
      kind: "criteria",
      state: artifactText,
      questions: semantic.map((criterion) => ({
        id: criterion.id,
        text: criterion.text,
      })),
    });
    const judged = await judgeViaPreset({
      presetId,
      projectId,
      title: "Stelow judge: artifact criteria",
      prompt,
    });
    if (!judged.ok || !judged.text)
      return {
        ok: false as const,
        findings: [] as Array<PresetFinding>,
        evaluated: 0,
        error: judged.error ?? "judge failed",
      };
    const parsed = parsePresetJudgeOutput({
      kind: "criteria",
      text: judged.text,
    });
    if (
      !parsed.ok ||
      !("verdicts" in parsed) ||
      (parsed.verdicts.length === 0 && semantic.length > 0)
    )
      return {
        ok: false as const,
        findings: [] as Array<PresetFinding>,
        evaluated: 0,
        error: !parsed.ok
          ? parsed.error
          : "judge verdicts match no known criteria",
      };
    const findings = presetCriteriaFindings({
      verdicts: parsed.verdicts,
      semantic,
      routeAt,
    });
    return { ok: true as const, findings, evaluated: findings.length };
  }

  // Shared Score-batch judge for the advisory verify-* commands (tasks,
  // gap triage): one atomic question per item through the artifact-criteria
  // point — Jev API or preset judge — resolved onto the shared findings
  // shape. Both callers differ only in items, questions, and the diff/text
  // they judge against, so the plumbing lives here once.
  type ScoredBatchFinding = {
    id: string;
    name: string;
    score: number | null;
    confidence: number | null;
    verdict: string;
    error: string | null;
  };
  async function judgeScoredBatch({
    items,
    questions,
    keyPrefix,
    state,
    mode,
    presetId,
    projectId,
    title,
    provider,
    endpoint,
    apiKey,
    model,
    routeAt,
  }: {
    items: Array<{ id: string; text: string }>;
    questions: Record<string, unknown>;
    keyPrefix: string;
    state: string;
    mode: string;
    presetId: string | null;
    projectId: string | null;
    title: string;
    provider: string;
    endpoint: string;
    apiKey: string;
    model: string;
    routeAt: number;
  }): Promise<
    | { ok: true; findings: Array<ScoredBatchFinding> }
    | { ok: false; error: string }
  > {
    if (mode === "preset") {
      if (!presetId)
        return { ok: false, error: "preset mode needs a judge preset" };
      const judged = await judgeViaPreset({
        presetId,
        projectId,
        title,
        prompt: buildPresetJudgePrompt({
          kind: "criteria",
          state,
          questions: items.map((item) => ({ id: item.id, text: item.text })),
        }),
      });
      if (!judged.ok || !judged.text)
        return { ok: false, error: judged.error ?? "judge failed" };
      const parsed = parsePresetJudgeOutput({
        kind: "criteria",
        text: judged.text,
      });
      if (!parsed.ok || !("verdicts" in parsed))
        return {
          ok: false,
          error: parsed.ok ? "judge verdict shape mismatch" : parsed.error,
        };
      const byId: Record<
        string,
        { status: string; confidence: number | null }
      > = {};
      for (const verdict of parsed.verdicts)
        byId[verdict.id] = {
          status: verdict.status,
          confidence: verdict.confidence,
        };
      return {
        ok: true,
        findings: resolveScoredVerdicts({
          items,
          verdicts: byId,
          keyPrefix,
          routeAt,
        }),
      };
    }
    const judged = await Promise.all(
      items.map(async (item) => {
        const single: Record<string, unknown> = {};
        single[`${keyPrefix}:${item.id}`] =
          questions[`${keyPrefix}:${item.id}`];
        const result = await evaluateDecisionCall({
          provider,
          endpoint,
          apiKey,
          model,
          state,
          questions: single as never,
        });
        return { item, result };
      }),
    );
    const answers: Record<
      string,
      { type?: string; score?: number; confidence?: number } | null
    > = {};
    for (const { item, result } of judged)
      answers[`${keyPrefix}:${item.id}`] = (
        result.ok ? (result.answers?.[`${keyPrefix}:${item.id}`] ?? null) : null
      ) as { type?: string; score?: number; confidence?: number } | null;
    return {
      ok: true,
      findings: resolveScoredVerdicts({ items, answers, keyPrefix, routeAt }),
    };
  }

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

  // Independent pre-review on gate entry (see advance hook): same reviewer
  // machinery as the review command, but advisory-only — findings land as
  // a card comment, never a reviews/ file, and every miss is silent.
  async function requestGatePreReview(
    cardId: string,
    stage: string,
  ): Promise<void> {
    try {
      const kind = preReviewArtifactKind(stage);
      if (!kind) return;
      const card = getCard(cardId);
      if (!card || card.kind !== "build" || isArchivedCard(card)) return;
      const designated = getReviewPresetId();
      const reviewPreset = designated ? getPresetById(designated) : null;
      if (!reviewPreset) return;
      const workspace = await cardWorkspace(card).catch(() => null);
      if (!workspace?.path) return;
      const board = await boardFromRoot(
        bb,
        workspace.path,
        card.dir_hash,
      ).catch(() => null);
      const artifact =
        board?.workflows
          .find((item) => item.id === card.dir_hash)
          ?.artifacts.find((entry) => entry.kind === kind) ?? null;
      if (!artifact) return;
      const full = resolveArtifactPath(workspace.path, artifact.path);
      const content = full
        ? await bb.sdk.files
            .read({ path: full })
            .then((f) => f.content)
            .catch(() => null)
        : null;
      if (typeof content !== "string" || !content.trim()) return;
      const contract = contractForBuildArtifact(artifact.path, content);
      const depth = contract ? validateArtifact(content, contract) : null;
      if (!depth || !depth.pass) return;
      const params = presetAttachmentParams(reviewPreset);
      const prompt = buildReviewPrompt({
        cardName: card.display_name ?? card.name,
        request: card.prompt,
        contractLabel: `pre-review for ${stage}`,
        artifactContent: content,
        deterministicFailures: [],
        evidence: "verified",
      });
      let preThread: { id: string };
      try {
        preThread = await spawnDisposable(
          {
            projectId: card.project_id,
            environment: { type: "project-default" },
            visibility: "hidden",
            ...(card.worker_thread_id
              ? { lifecycleOwnerThreadId: card.worker_thread_id }
              : {}),
            title: `Stelow pre-review (${stage}): ${card.display_name ?? card.name}`,
            providerId: params.providerId,
            model: params.modelId,
            reasoningLevel: params.reasoningLevel as
              | "low"
              | "medium"
              | "high"
              | "xhigh"
              | "max"
              | "none"
              | "ultra"
              | "ultracode",
            permissionMode: (params.permissionMode === "full"
              ? "accept-edits"
              : params.permissionMode) as "accept-edits" | "auto" | "full",
            executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
            prompt,
          },
          "review",
        );
      } catch {
        return;
      }
      for (let poll = 0; poll < 60; poll++) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        const thread = await bb.sdk.threads
          .get({ threadId: preThread.id })
          .catch(() => null);
        const status = (thread as { status?: unknown } | null)?.status;
        if (
          status === "idle" ||
          status === "stopping" ||
          status === "archived" ||
          status === "deleted"
        )
          break;
        if (status === "failed" || status === "error" || poll === 59) {
          await workers.stop(preThread.id).catch(() => undefined);
          return;
        }
      }
      const output = await bb.sdk.threads
        .output({ threadId: preThread.id })
        .then((result) => result.output ?? "")
        .catch(() => "");
      await workers.stop(preThread.id).catch(() => undefined);
      const parsed = parseReviewOutput(output, content);
      if (
        !parsed ||
        !Array.isArray(parsed.findings) ||
        parsed.findings.length === 0
      )
        return;
      logCardComment(
        cardId,
        "card",
        cardId,
        "agent",
        `Independent pre-review (${stage}, ${reviewPreset.name}):\n\n${reviewSummary(parsed)}`,
      );
      bb.realtime.publish("card-state", { cardId });
    } catch {
      // Advisory path: silence is the status quo ante.
    }
  }

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

  // Prepare the exact worker continuation; server/workers.ts owns the spawn,
  // old-thread shutdown, ledger rotation, and lineage write.
  async function prepareWorkerRespawn(
    row: CardRow,
    preset: PresetRow,
    _reason: string,
    opts?: RespawnOptions,
  ): Promise<RespawnPreparation> {
    const params = presetAttachmentParams(preset);
    const workspace = await cardWorkspace(row);
    const projectPath = workspace?.path ?? "";
    // Resolve the real per-workflow state dir (stelow.json -> created date), so
    // the respawned worker is told the correct path — never a guessed date.
    let stateDir: string | null = null;
    if (row.dir_hash && projectPath) {
      stateDir = await workflowStateDir(
        bb,
        projectPath,
        row.id,
        row.dir_hash,
      ).catch(() => null);
    }
    if (row.dir_hash && !stateDir) {
      return {
        error:
          "This card's workflow state cannot be verified. Reseed it before restarting its worker.",
      };
    }
    const stateHint =
      stateDir ??
      (row.dir_hash
        ? ".stelow/<date>/" + row.dir_hash
        : "<project>/.stelow/<date>/<dirHash>");
    // Research cards restart with the strategy prompt, never the build
    // stage machine. The run strategy defaults to the latest round; a new
    // round passes its own. A research card without a known strategy cannot
    // restart honestly — refuse with the fix instead of spawning a confused
    // worker.
    const history = strategyList(row);
    const runStrategyId =
      row.kind === "research"
        ? (opts?.strategyId ??
          history[history.length - 1] ??
          row.research_strategy ??
          "")
        : null;
    const researchStrategy =
      row.kind === "research"
        ? researchStrategyById(runStrategyId ?? "")
        : null;
    if (row.kind === "research" && !researchStrategy)
      return {
        error:
          "This research has no known strategy. Archive it and start a new one.",
      };
    const exploreStage =
      row.kind === "explore" ? techniqueById(row.explore_stage ?? "") : null;
    if (row.kind === "explore" && !exploreStage)
      return {
        error:
          "This explore card has no known technique. Archive it and start a new one.",
      };
    // Restart reuses the round's own file (idempotent rewrite); a fresh
    // spawn passes its own. Fall back to a composed path only when history
    // carries none (shouldn't happen for spawned rounds).
    const respawnRoundNo = opts?.roundNo ?? Math.max(1, history.length);
    const respawnStamp = opts?.roundStamp ?? roundTimestamp();
    let respawnFile = opts?.roundFile ?? "";
    if (!respawnFile && researchStrategy) {
      respawnFile =
        [...strategyRounds(row)]
          .reverse()
          .find((entry) => entry.id === researchStrategy.id)?.file ??
        (stateDir && projectPath
          ? roundRelPath(
              stateDir,
              projectPath,
              roundFileName(researchStrategy.id, respawnRoundNo, respawnStamp),
            )
          : "");
    }
    const researchRestart = researchStrategy
      ? researchWorkerPrompt({
          displayName: row.display_name ?? row.name,
          prompt: row.prompt,
          strategyLabel: researchStrategy.label,
          strategyId: researchStrategy.id,
          strategySkill: researchStrategy.skill,
          stateDirText: text(stateHint),
          workspaceRoot: projectPath || "<workspace>",
          instructions: params.instructions,
          flavor: opts?.flavor ?? "restart",
          previousThreadId: row.worker_thread_id,
          roundNo: respawnRoundNo,
          roundStamp: respawnStamp,
          roundFile: respawnFile,
        })
      : null;
    const exploreRestart = exploreStage
      ? exploreWorkerPrompt({
          displayName: row.display_name ?? row.name,
          prompt: row.prompt,
          stage: exploreStage,
          stateDirText: text(stateHint),
          workspaceRoot: projectPath || "<workspace>",
          instructions: params.instructions,
          flavor: "restart",
          previousThreadId: row.worker_thread_id,
        })
      : null;
    const prompt =
      researchRestart ??
      exploreRestart ??
      `You are running a Stelow workflow inside the bb-plugin-stelow panel. \
The host re-seeded your per-workflow state, transitions.md, and stelow.json. Your workflow owns its own state dir (${text(stateHint)}) — \
its state.md holds name, intent, current_stage, status.${
        stateDir
          ? ""
          : " Resolve the exact path from stelow.json; \
its state.md holds name, intent, current_stage, status."
      } ${CARD_OWNER_RULES} \
The Stelow workflow skills (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-*) are provided by this plugin — \
start by loading them (they live under the plugin's skills directory; \`bb skill list\` shows them). The product strategy playbooks \
(stelow-product-*) are also provided by this plugin \u2014 check \`bb skill list\` first, and only fetch via \`npx skills add calionauta/stelow\` \
if one is missing. Use \`bb stelow advance <stage>\` to change stages (do NOT hand-edit current_stage). ${NEVER_SEED} \
Preserve every gate (product, interface, tech plan, diff). ${CLI_EQUIVALENTS} ${RECON_PROTOCOL} ${DRAFT_PROTOCOL}

${TURN_DISCIPLINE}

${COMMIT_STYLE}

Intent is currently \`${row.intent}\` in state.md. ${
      row.intent === "unknown"
        ? "It is still unknown, so your FIRST job is triage: classify it (new-product, feature, \
bugfix, refactor, or investigate), write it to state.md immediately, and only then continue — \
ask via the form below only if genuinely ambiguous."
        : "Use it — do NOT ask the user to pick or confirm intent again."
    } \
 \
Order of work, always: (1) settle intent; (2) load the workflow skills; (3) continue from the current \
stage. If a \`bb stelow\` command fails, read its stderr once and continue — do NOT spend the turn debugging \
the CLI; report the exact error and move on.

You are being restarted mid-workflow at a stage boundary so a new preset can take over for this phase. \
Read your state.md and transitions.md, and CONTINUE the workflow from the current stage. Do not restart \
from triage; do not re-confirm what is already settled in state.md. Pick up exactly where the workflow \
left off.${
      row.worker_thread_id
        ? ` Previous worker thread: ${row.worker_thread_id} (archived before this handoff). If state.md is thin — \
e.g. the previous worker stalled silently — its turn history may hold the missing context; retrieve \
it with \`bb thread output ${row.worker_thread_id}\`.`
        : ""
    }

CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form:

    bb stelow ask --thread "$BB_THREAD_ID" \\\ \
      --question "<a single clear question>" \\\ \
      --option "<label 1>" --option "<label 2>" [--option "<label 3>" ...] [--multiple]

Batch independent questions into ONE ask call by repeating --question groups (each with its own --option labels) — the user answers \
them together instead of being pinged one by one. Ask dependent questions (where Q2 needs Q1's answer) one at a time. When the \
human must compare artifacts to decide (interface picks, plan reviews), attach each option's evidence: --desc for trade-offs, \
--preview for the inline glance, --artifact for the workspace-relative file they can open.

Before asking a question, first summarize what you read (files, plan, codebase) so the user can answer \
with context. Each bb stelow ask call blocks until the user submits; the card stays in its column and \
signals it is waiting for an answer. Never re-ask the same question. ${INTERFACE_PICK} For unselected \
gates, write the approval receipt yourself (.stelow/approvals/{dirHash}/{file}.approved.md) and advance; \
for selected gates, open a structured ask instead. Stop when the user archives the card or the workflow \
reaches \`audit\`.

${DONE_PROTOCOL}

${SPLIT_PROTOCOL}

${params.instructions ? `Preset instructions:\n${params.instructions}\n` : ""}Request:\n${row.prompt}`;
    return { prompt, projectPath, workspace };
  }

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
    prepareRespawn: (card, preset, reason, options) =>
      prepareWorkerRespawn(card, preset as PresetRow, reason, options),
    resetAutoContinue,
    errors: {
      cardNotFound: "Card not found.",
      cardArchived: "This card is archived.",
      presetNotFound: "Preset not found.",
    },
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
  type QuestionStalenessVerdict = {
    docRevised: boolean;
    docRemoved: boolean;
    checkoutMoved: boolean;
    commitCount: number;
    touchedPaths: string[];
  };
  // Read-time staleness for a card's open questions: each questioned document
  // against its ask-time baseline, plus the touched-paths evidence behind a
  // moved checkout. Advisory only — every question stays answerable.
  async function stalenessForQuestions(
    cardId: string,
    questions: Array<{
      id: string;
      options: Array<{ artifact: { absolutePath: string | null } | null }>;
    }>,
  ): Promise<Map<string, QuestionStalenessVerdict>> {
    const out = new Map<string, QuestionStalenessVerdict>();
    try {
      const rows = db
        .prepare(
          "SELECT artifact_path, artifact_sha256, git_root, head_sha FROM question_evidence WHERE card_id = ?",
        )
        .all(cardId) as Array<{
        artifact_path: string;
        artifact_sha256: string;
        git_root: string | null;
        head_sha: string | null;
      }>;
      if (rows.length === 0) return out;
      const byPath = new Map(rows.map((row) => [row.artifact_path, row]));
      const heads = new Map<string, string | null>();
      const touchedByMove = new Map<
        string,
        { commitCount: number; paths: string[] }
      >();
      const headFor = async (gitRoot: string): Promise<string | null> => {
        if (!heads.has(gitRoot)) {
          const current = await recoveryGitEvidence(gitRoot).catch(() => null);
          heads.set(gitRoot, current?.headSha ?? null);
        }
        return heads.get(gitRoot) ?? null;
      };
      for (const question of questions) {
        const flags = {
          docRevised: false,
          docRemoved: false,
          checkoutMoved: false,
        };
        let detail = { commitCount: 0, paths: [] as string[] };
        for (const option of question.options ?? []) {
          const absolute = option?.artifact?.absolutePath;
          if (!absolute) continue;
          const row = byPath.get(absolute);
          if (!row) continue;
          const sha = await sha256OfHostFile(absolute);
          const head = row.git_root ? await headFor(row.git_root) : null;
          const single: {
            docRevised: boolean;
            docRemoved: boolean;
            checkoutMoved: boolean;
          } | null = stalenessOf(
            {
              artifactSha256: row.artifact_sha256,
              gitRoot: row.git_root,
              headSha: row.head_sha,
            },
            { sha256: sha, headSha: head },
          );
          if (!single) continue;
          if (single.docRevised) flags.docRevised = true;
          if (single.docRemoved) flags.docRemoved = true;
          if (single.checkoutMoved) flags.checkoutMoved = true;
          if (
            single.checkoutMoved &&
            row.git_root &&
            row.head_sha &&
            detail.paths.length === 0
          ) {
            const key = `${row.git_root} ${row.head_sha}`;
            if (!touchedByMove.has(key))
              touchedByMove.set(
                key,
                await gitTouchedSince(row.git_root, row.head_sha),
              );
            detail = touchedByMove.get(key)!;
          }
        }
        if (flags.docRevised || flags.docRemoved || flags.checkoutMoved) {
          out.set(question.id, {
            ...flags,
            commitCount: detail.commitCount,
            touchedPaths: detail.paths,
          });
        }
      }
    } catch {
      /* advisory only */
    }
    return out;
  }
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
  // Discard evidence: everything discardEligibility (lib/discard-policy)
  // needs, gathered fresh per call. Exploratory folders are exact paths;
  // project checkouts resolve through the card's workspace like the worker's.
  type DiscardEvidence = {
    status: string;
    workspaceKind: string;
    checkoutPath: string | null;
    dirExists: boolean;
    isGit: boolean;
    branch: string | null;
    hasUpstream: boolean;
    upstreamRef: string | null;
    changed: string[];
    untracked: string[];
    unpushedCommits: number;
    stashCount: number;
    resetTarget: string | null;
    linkedWorktree: boolean;
    sharedWith: number;
  };
  const EXPLORATORY_SCOPE = nodeJoin(
    process.env.HOME ?? "/tmp",
    ".bb",
    "stelow",
    "exploratory",
  );
  async function discardEvidence(card: CardRow): Promise<DiscardEvidence> {
    const blank: DiscardEvidence = {
      status: card.status,
      workspaceKind: card.workspace_kind,
      checkoutPath: null,
      dirExists: false,
      isGit: false,
      branch: null,
      hasUpstream: false,
      upstreamRef: null,
      changed: [],
      untracked: [],
      unpushedCommits: 0,
      stashCount: 0,
      resetTarget: null,
      linkedWorktree: false,
      sharedWith: 0,
    };
    if (card.workspace_kind === "exploratory") {
      const explorPath = card.workspace_path;
      if (!explorPath) return blank;
      let dirExists = false;
      try {
        dirExists = existsSync(explorPath);
      } catch {
        dirExists = false;
      }
      let sharedWith = 0;
      try {
        sharedWith =
          (
            db
              .prepare(
                "SELECT COUNT(*) AS n FROM cards WHERE id != ? AND status != 'archived' AND workspace_kind = 'exploratory' AND workspace_path = ?",
              )
              .get(card.id, explorPath) as { n: number } | undefined
          )?.n ?? 0;
      } catch {
        /* count is advisory */
      }
      return { ...blank, checkoutPath: explorPath, dirExists, sharedWith };
    }
    const workspace = await cardWorkspace(card);
    const checkout = workspace?.path ?? null;
    if (!checkout) return blank;
    const top = await runGitIn(checkout, ["rev-parse", "--show-toplevel"]);
    if (!top.ok || !top.stdout.trim())
      return { ...blank, checkoutPath: checkout };
    const gitRoot = top.stdout.trim();
    const [branchR, upstreamR, statusR, unpushedR, stashR] = await Promise.all([
      runGitIn(gitRoot, ["branch", "--show-current"]),
      runGitIn(gitRoot, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{u}",
      ]),
      runGitIn(gitRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
      runGitIn(gitRoot, ["rev-list", "--count", "HEAD", "--not", "--remotes"]),
      runGitIn(gitRoot, ["stash", "list", "--format=%gd"]),
    ]);
    const branch = branchR.ok ? branchR.stdout.trim() || null : null;
    const changed: string[] = [];
    const untracked: string[] = [];
    if (statusR.ok) {
      for (const line of statusR.stdout.split("\n")) {
        if (!line) continue;
        if (line.startsWith("??")) untracked.push(line.slice(3));
        else changed.push(line.slice(3));
      }
    }
    const unpushedCommits = unpushedR.ok
      ? Number.parseInt(unpushedR.stdout.trim(), 10) || 0
      : 0;
    const stashCount = stashR.ok
      ? stashR.stdout.split("\n").filter(Boolean).length
      : 0;
    // Reset target: parent of the first commit made since the card started
    // (card-attributable work); no card-era commit means dirty-files-only.
    let resetTarget: string | null = null;
    try {
      const since = Math.floor(card.created_at / 1000);
      const first = await runGitIn(gitRoot, [
        "log",
        "--format=%H",
        "--reverse",
        `--since=${since}`,
        "HEAD",
        "--",
      ]);
      const firstSha = first.ok
        ? (first.stdout
            .split("\n")
            .map((entry) => entry.trim())
            .filter(Boolean)[0] ?? null)
        : null;
      if (firstSha) {
        const parent = await runGitIn(gitRoot, ["rev-parse", `${firstSha}^`]);
        resetTarget =
          parent.ok && parent.stdout.trim() ? parent.stdout.trim() : null;
      } else {
        const head = await runGitIn(gitRoot, ["rev-parse", "HEAD"]);
        resetTarget = head.ok && head.stdout.trim() ? head.stdout.trim() : null;
      }
    } catch {
      resetTarget = null;
    }
    let linkedWorktree = false;
    try {
      linkedWorktree = lstatSync(nodeJoin(gitRoot, ".git")).isFile();
    } catch {
      linkedWorktree = false;
    }
    let sharedWith = 0;
    try {
      sharedWith =
        (
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM cards WHERE id != ? AND status != 'archived' AND project_id = ?",
            )
            .get(card.id, card.project_id) as { n: number } | undefined
        )?.n ?? 0;
    } catch {
      /* advisory */
    }
    return {
      ...blank,
      checkoutPath: gitRoot,
      isGit: true,
      branch,
      hasUpstream: upstreamR.ok && Boolean(upstreamR.stdout.trim()),
      upstreamRef:
        upstreamR.ok && upstreamR.stdout.trim()
          ? upstreamR.stdout.trim()
          : null,
      changed,
      untracked,
      unpushedCommits,
      stashCount,
      resetTarget,
      linkedWorktree,
      sharedWith,
    };
  }
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

  function stageEnteredAt(state: string): number | null {
    // `advance` appends the completed stage with `at:` as it enters the next
    // one. Therefore the final history timestamp is the current stage's entry
    // boundary (and is the only real format the helper writes).
    const values = [...state.matchAll(/^\s+at:\s*([^\n]+)$/gm)];
    const value = values.at(-1)?.[1]?.trim().replace(/["']/g, "") ?? "";
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
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

  async function questionContractsGate(
    card: CardRow,
    stateDir: string | null,
  ): Promise<string | null> {
    if (!stateDir) return null;
    const stateFile = await bb.sdk.files
      .read({ path: join(stateDir, "state.md") })
      .catch(() => null);
    const state =
      typeof stateFile?.content === "string" ? stateFile.content : null;
    if (!state) return null; // unreadable state fails open
    const stage = text(state.match(/^current_stage:\s*(\S+)/m)?.[1]);
    // Strict parse: missing keys yield nulls (never assumed defaults) — a
    // guard must not enforce against a mode the file never declared.
    // Gate-aware: an explicit set enforces directly, a ladder string
    // resolves through the compat map.
    const { appetite, reviewMode, reviewGates } = parseWorkflowConfig(state, {
      strict: true,
    });
    if (!stage || !appetite || (!reviewMode && !reviewGates)) return null; // config is not trustworthy
    // A corrupt or unreadable contract source must never deadlock every
    // advance: fail open here, the pin test guards the source itself.
    let required;
    try {
      required = requiredForStage({
        stage,
        appetite,
        reviewMode: reviewGates ?? reviewMode ?? [],
      }).filter((entry) => entry.kind !== "skip");
    } catch {
      return null;
    }
    if (required.length === 0) return null;
    const enteredAt = stageEnteredAt(state);
    if (!enteredAt) return null; // legacy history has no entry boundary
    const paths = await bb.sdk.files
      .listPaths({
        path: stateDir,
        includeFiles: true,
        includeDirectories: false,
        limit: 500,
      })
      .catch(() => null);
    if (!paths) return null;
    const allPaths = array(record(paths).paths)
      .map((entry) =>
        typeof entry === "string" ? entry : text(record(entry).path),
      )
      .filter(Boolean);
    const receipts = await Promise.all(
      allPaths.map(async (receiptPath) => {
        const receipt = await bb.sdk.files
          .read({ path: receiptPath })
          .catch(() => null);
        return {
          path: receiptPath.startsWith(`${stateDir}/`)
            ? receiptPath.slice(stateDir.length + 1)
            : receiptPath,
          content: typeof receipt?.content === "string" ? receipt.content : "",
          modifiedAtMs:
            typeof receipt?.modifiedAtMs === "number" &&
            Number.isFinite(receipt.modifiedAtMs)
              ? receipt.modifiedAtMs
              : null,
        };
      }),
    );
    // Synchronize the durable inbox before asking it for evidence. A provider
    // read failure remains fail-open inside the collector rather than becoming
    // proof that no answer exists.
    const synced = await syncOpenQuestionInbox(card);
    if (synced === null) return null;
    const answered = Boolean(
      db
        .prepare(
          "SELECT 1 FROM inbox_events WHERE card_id = ? AND kind = 'question' AND resolved_reason = 'answered' AND resolved_at >= ? LIMIT 1",
        )
        .get(card.id, enteredAt),
    );
    return checkAdvanceContracts({
      stage,
      enteredAt,
      contracts: required,
      receipts,
      answered,
    });
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

  // Gap-registry state for the ESCALATED → scopes → re-execution loop
  // (upstream stelow-workflow-execution-critique criteria 7-9). Reads every
  // matched Execution Critique Report: registry failures block, escalate
  // rows must each link an audit-gap scope, and linked scopes must be done
  // before the card completes. No matched critique means no enforcement —
  // unknown shapes never block.
  async function critiqueGapState(card: CardRow): Promise<{
    matched: boolean;
    failures: string[];
    totals: {
      total: number;
      fixed: number;
      documented: number;
      escalated: number;
    };
    escalated: Array<{ description: string }>;
    auditGapScopes: Array<{
      id: string;
      name: string;
      status: string;
      gap: string | null;
    }>;
    critiqueText: string;
  }> {
    const empty = {
      matched: false,
      failures: [] as string[],
      totals: { total: 0, fixed: 0, documented: 0, escalated: 0 },
      escalated: [] as Array<{ description: string }>,
      auditGapScopes: [] as Array<{
        id: string;
        name: string;
        status: string;
        gap: string | null;
      }>,
      critiqueText: "",
    };
    const workspace = await cardWorkspace(card).catch(() => null);
    if (!workspace?.path || !card.dir_hash) return empty;
    const stateDir = await workflowStateDir(
      bb,
      workspace.path,
      card.id,
      card.dir_hash,
    ).catch(() => null);
    if (!stateDir) return empty;
    const stateBlob = await bb.sdk.files
      .read({ path: join(stateDir, "state.md") })
      .then((f) => f.content)
      .catch(() => null);
    if (!stateBlob) return empty;
    const failures: string[] = [];
    const totals = { total: 0, fixed: 0, documented: 0, escalated: 0 };
    const escalated: Array<{ description: string }> = [];
    const critiqueTexts: string[] = [];
    let matched = false;
    for (const fields of parseArtifactManifest(stateBlob)) {
      if (typeof fields.path !== "string" || !fields.path.endsWith(".md"))
        continue;
      const full = resolveArtifactPath(workspace.path, fields.path);
      const content = full
        ? await bb.sdk.files
            .read({ path: full })
            .then((f) => f.content)
            .catch(() => null)
        : null;
      if (typeof content !== "string" || !content.trim()) continue;
      if (
        contractForBuildArtifact(fields.path, content)?.id !==
        "execution-critique"
      )
        continue;
      matched = true;
      // The judge that triages these gaps reads the critique itself — the
      // routing stays deterministic, but the second opinion needs evidence.
      critiqueTexts.push(content);
      for (const failure of validateGapRegistry(content))
        failures.push(`FAIL ${fields.label ?? fields.path}: ${failure.detail}`);
      const summary = summarizeGaps(content);
      if (summary.found) {
        totals.total += summary.total;
        totals.fixed += summary.fixed;
        totals.documented += summary.documented;
        totals.escalated += summary.escalated;
      }
      for (const gap of escalatedGaps(content)) {
        const description = String(gap.description ?? "").trim();
        if (
          description &&
          !escalated.some((entry) => entry.description === description)
        )
          escalated.push({ description });
      }
    }
    if (!matched) return empty;
    const auditGapScopes: Array<{
      id: string;
      name: string;
      status: string;
      gap: string | null;
    }> = [];
    try {
      for (const scope of loadCardScopes(workspace.path, card.id)) {
        const source = (scope as { source?: unknown }).source;
        if (source !== "audit-gap") continue;
        const gap = (scope as { gap?: unknown }).gap;
        auditGapScopes.push({
          id: scope.id,
          name: scope.name,
          status: scope.status,
          gap: typeof gap === "string" ? gap : null,
        });
      }
    } catch {
      /* stelow.json unreadable reads as no scopes; done names the fix */
    }
    return {
      matched,
      failures,
      totals,
      escalated,
      auditGapScopes,
      critiqueText: critiqueTexts.join("\n\n"),
    };
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

  function getCardByWorkerThread(threadId: string): CardRow | undefined {
    return db
      .prepare("SELECT * FROM cards WHERE worker_thread_id = ?")
      .get(threadId) as CardRow | undefined;
  }
  function updateCard(
    cardId: string,
    fields: Partial<
      Omit<
        CardRow,
        "id" | "project_id" | "intent" | "prompt" | "name" | "created_at"
      >
    >,
    opts?: { suppressCompletionEvent?: boolean },
  ): void {
    // Hot-reload race: bb closes the plugin DB while syncThreadState callbacks
    // are still in flight; writing then crashes the whole server process.
    if (!(db as unknown as { open?: boolean }).open) return;
    const previous = getCard(cardId);
    // Archived is terminal: strip any status change that would resuscitate
    // the card (a stopping worker settling after Archive is the classic
    // case). Archiving itself always passes through.
    const effective = stripArchivedResuscitation(
      previous?.status,
      fields as Record<string, unknown>,
    ) as typeof fields;
    const keys = Object.keys(effective);
    if (keys.length === 0) return;
    // No-op guard: sync polls call updateCard every cycle, usually with
    // identical values. Writing anyway would bump updated_at (reshuffling
    // board order and "Idle since" labels) and publish card-state
    // (reloading every panel) for zero visual change.
    const asRecord = (value: unknown): Record<string, unknown> =>
      value as Record<string, unknown>;
    const changed = previous
      ? keys.filter((k) => asRecord(previous)[k] !== asRecord(effective)[k])
      : keys;
    if (previous && changed.length === 0) return;
    const write: Record<string, unknown> = { updated_at: now() };
    for (const k of changed) write[k] = asRecord(effective)[k];
    // Write-time terminal re-check: async callers read the card, await
    // network, then write — Archive may have landed in between. Re-strip
    // against a fresh read so a pre-archive snapshot can never resuscitate.
    const latest = getCard(cardId);
    const finalWrite = stripArchivedResuscitation(
      latest?.status,
      write,
    ) as Record<string, unknown>;
    if (Object.keys(finalWrite).every((k) => k === "updated_at")) return;
    db.prepare(
      `UPDATE cards SET ${Object.keys(finalWrite)
        .map((k) => `${k} = @${k}`)
        .join(", ")} WHERE id = @id`,
    ).run({ id: cardId, ...finalWrite });
    const current = getCard(cardId);
    if (previous && current) {
      if (current.status === "archived" || current.status === "completed")
        resolveInboxEvents(
          cardId,
          current.updated_at,
          ["question", "error", "paused"],
          current.status === "archived" ? "archived" : "completed",
        );
      else if (current.activity === "running")
        resolveInboxEvents(
          cardId,
          current.updated_at,
          ["error", "paused"],
          "resumed",
        );
      // Research and Explore cards emit their own completion events and a
      // manual board move needs no "Completed" ping — the human just did it.
      // Only agent-driven build completions notify.
      // One completion event per card, whichever path finishes it. A drag to
      // Done is a board move, so it suppresses this; `bb stelow done` does not,
      // because there the completion IS the outcome. The copy names the thing
      // the human has to look at, since a finished Build card carries evidence
      // rather than a result to read.
      if (
        previous.status !== "completed" &&
        current.status === "completed" &&
        current.kind === "build" &&
        !opts?.suppressCompletionEvent
      )
        recordInboxEvent(
          current,
          "completed",
          "Build complete — audit evidence is ready to review in Done.",
          `completed:${cardId}:${current.updated_at}`,
          current.updated_at,
        );
      if (previous.activity !== "error" && current.activity === "error") {
        recordInboxEvent(
          current,
          "error",
          current.last_error || "Worker failed and needs attention.",
          `error:${cardId}:${current.updated_at}`,
          current.updated_at,
        );
        // A fresh failure that lands while a specific question is already
        // open is context, not a second action: supersede it at birth so
        // one card never counts twice. The row survives in Resolved
        // history, and the open card shows the error text beside the
        // question it must answer.
        const openQuestion = db
          .prepare(
            "SELECT 1 FROM inbox_events WHERE card_id = ? AND kind = 'question' AND resolved_at IS NULL AND archived_at IS NULL LIMIT 1",
          )
          .get(cardId);
        if (openQuestion)
          resolveInboxEvents(
            cardId,
            current.updated_at,
            ["error"],
            "superseded",
          );
      }
    }
    bb.realtime.publish("card-state", { cardId });
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
  async function notifyClaimWaiters(
    workspacePath: string,
    files: string[],
  ): Promise<void> {
    if (files.length === 0 || !workspacePath) return;
    const at = now();
    let waiterRows: Array<{ card_id: string; scope: string | null }>;
    try {
      waiterRows = waitersForFiles(db, { workspacePath, files });
    } catch {
      return;
    }
    const seen = new Set<string>();
    for (const waiter of waiterRows) {
      if (seen.has(waiter.card_id)) continue;
      seen.add(waiter.card_id);
      const waiting = getCard(waiter.card_id);
      if (!waiting || isClaimTerminal(waiting.status)) {
        try {
          clearClaimWaiters(db, { cardId: waiter.card_id });
        } catch {
          /* advisory */
        }
        continue;
      }
      resolveInboxEvents(waiter.card_id, at, ["paused"], "resumed");
      try {
        clearClaimWaiters(db, { cardId: waiter.card_id, workspacePath, files });
      } catch {
        /* advisory */
      }
      if (waiting.worker_thread_id) {
        const nudge = `Files you waited on are now free (${files.join(", ")}). Re-run \`bb stelow lock acquire --scope <id>\` for the files you \
still need, then continue the scope — do not re-claim files you no longer touch.`;
        try {
          await bb.sdk.threads.send({
            threadId: waiting.worker_thread_id,
            mode: "auto",
            input: [
              {
                type: "text",
                text: nudge,
                mentions: [],
                visibility: "agent-only",
              },
            ],
          });
        } catch {
          /* a dead thread stays parked; the user resumes by hand */
        }
      }
      bb.realtime.publish("card-state", { cardId: waiter.card_id });
    }
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

  // Deterministic sweep plus lifecycle polling shares one attention window:
  // an idle card becomes actionable only after two reconcile cycles.
  const IDLE_ATTENTION_MS = 90_000;
  const AUDIT_DONE_NUDGE =
    "The workflow is at the audit stage. If audit work remains, finish it first. Then commit completion with `bb stelow done` — it verifies in \
" +
    "code and refuses with the fix when something is missing. Never just announce completion and stop: only done completes the card.";

  // Research and explore share one lightweight poll; only the per-track
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

      async approveGate({ projectId, workflowId, gate }) {
        // Resolve via the owning card first: the project-root board has no
        // stelow.json for exploratory work, so board-only lookup fails there.
        // dir_hash is unique per card, hence a reliable key for both modes.
        const owner = db
          .prepare("SELECT * FROM cards WHERE dir_hash = ?")
          .get(workflowId) as CardRow | undefined;
        const board = owner
          ? await (async () => {
              const workspace = await cardWorkspace(owner);
              if (!workspace?.path)
                return {
                  rootPath: null as string | null,
                  workflows: [] as Workflow[],
                  error: "Workspace is unavailable for this card.",
                };
              return boardFromRoot(bb, workspace.path, owner.dir_hash);
            })()
          : await loadBoard(bb, projectId);
        const workflow = board.workflows.find((item) => item.id === workflowId);
        if (!board.rootPath || !workflow?.dirHash)
          return {
            approved: false,
            receiptPath: null,
            error: "Workflow directory metadata is unavailable.",
          };
        const spec = GATES[gate];
        if (
          gate !== "diff-gate" &&
          !workflow.artifacts.some(
            (artifact) => artifact.kind === spec.artifact,
          )
        ) {
          return {
            approved: false,
            receiptPath: null,
            error: "The gate artifact does not exist yet.",
          };
        }
        const receiptPath = `.stelow/approvals/${workflow.dirHash}/${spec.receipt}`;
        const absolute = join(board.rootPath, receiptPath);
        await bb.sdk.files.mkdir({
          path: join(board.rootPath, `.stelow/approvals/${workflow.dirHash}`),
          rootPath: board.rootPath,
          recursive: true,
        });
        const now = new Date().toISOString();
        const result = await bb.sdk.files.write({
          path: absolute,
          rootPath: board.rootPath,
          expectedSha256: null,
          content: `---\napproved: true\napproved_at: ${now}\napproved_via: bb-plugin-stelow\ngate: ${gate}\nworkflow: ${workflow.name}\n---\n`,
        });
        if (result.outcome === "conflict")
          return { approved: true, receiptPath, error: null };
        bb.realtime.publish("board-changed", { workflowId, gate });
        return { approved: true, receiptPath, error: null };
      },

      async answerQuestions({ cardId, answers }) {
        // Atomic batch answer: one worker continuation and one Inbox
        // reconciliation — no fragmented pings.
        const card = getCard(cardId);
        if (!card?.worker_thread_id)
          return {
            ok: false as const,
            answered: 0,
            error: "This card has no worker thread.",
          };
        if (isArchivedCard(card))
          return { ok: false as const, answered: 0, error: ERR_CARD_ARCHIVED };
        try {
          const list = await bb.sdk.threads.interactions.list({
            threadId: card.worker_thread_id,
          });
          const pendingById = new Map(
            pendingAsks(list).map((entry) => [entry.id, entry]),
          );
          const questionText = new Map<string, string>();
          for (const entry of pendingById.values()) {
            for (const item of expandInteractionQuestions({
              id: entry.id,
              title: entry.payload?.title,
              payload: entry.payload,
            })) {
              questionText.set(item.questionId, item.question);
            }
          }
          const grouped = groupBatchAnswers(answers);
          const decisions: Array<{ question: string; answers: string[] }> = [];
          const answeredInteractionIds = new Set<string>();
          for (const [interactionId, value] of grouped) {
            if (!pendingById.has(interactionId)) continue;
            await bb.sdk.threads.interactions.respond({
              threadId: card.worker_thread_id,
              interactionId,
              value: { answers: value.answers },
            });
            answeredInteractionIds.add(interactionId);
            if (value.kind === "single") {
              decisions.push({
                question: questionText.get(interactionId) ?? "",
                answers: value.answers,
              });
            } else {
              value.answers.forEach((slot, index) => {
                decisions.push({
                  question: questionText.get(`${interactionId}#${index}`) ?? "",
                  answers: slot,
                });
              });
            }
          }
          if (decisions.length === 0)
            return {
              ok: false as const,
              answered: 0,
              error: "No open question awaits an answer on this card.",
            };
          // Split proposals answered on the card land here instead of the
          // blocking call above — one shared recording (lib/split-proposal).
          recordSplitAnswer(db, cardId, decisions);
          // A structured interaction resumes the waiting command but not a new
          // agent turn. Exactly one continuation for the whole batch.
          await bb.sdk.threads.send({
            threadId: card.worker_thread_id,
            mode: "auto",
            input: [
              {
                type: "text",
                text: formatBatchContinuation(decisions),
                mentions: [],
              },
            ],
          });
          const unansweredIds = [...pendingById.keys()].filter(
            (id) => !answeredInteractionIds.has(id),
          );
          const openQuestionIds = [
            ...unansweredIds,
            ...openExpiredQuestionIds(cardId),
          ];
          // Name the answered ones BEFORE the sync: disappearance alone would
          // mislabel them superseded.
          markInboxQuestionsAnswered(cardId, [...answeredInteractionIds]);
          syncPendingQuestionInbox(card, openQuestionIds);
          // Contract provenance: answers that match a declared contract id
          // name it in the trail. Undeclared answers behave exactly as before.
          const contractNotes: string[] = [];
          for (const decision of decisions) {
            const matched = decision.question
              ? consumeAskContract(db, cardId, decision.question)
              : null;
            if (matched)
              contractNotes.push(
                `Q: ${decision.question}\nA: ${decision.answers.join(", ")} [contract: ${matched}]`,
              );
          }
          if (contractNotes.length > 0) {
            logCardComment(
              cardId,
              "card",
              cardId,
              "user",
              `Answer to a pending question:\n\n${contractNotes.join("\n\n")}`,
            );
          }
          // A fresh human answer resumes the worker: a stale provider error
          // from the interrupted turn must not linger as "Failed" beside the
          // recovery path. Failure history stays in the event log.
          updateCard(cardId, {
            activity:
              openQuestionIds.length > 0 ? "awaiting-answer" : "running",
            status: "in-progress",
            last_error: null,
          });
          return { ok: true as const, answered: decisions.length, error: null };
        } catch (error) {
          return {
            ok: false as const,
            answered: 0,
            error:
              error instanceof Error
                ? error.message
                : "Unable to answer the questions.",
          };
        }
      },

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

      async gapSummary({ cardId }) {
        // Build gap panel backing: resolved live from the matched execution
        // critique plus the stage-event ledger — counts, per-escalation
        // scope linkage, and lead/cycle time. No matched critique reads as
        // matched:false, never as zero gaps.
        const card = getCard(cardId);
        const empty = {
          matched: false,
          total: 0,
          fixed: 0,
          documented: 0,
          escalated: 0,
          items: [] as Array<{
            description: string;
            scopeStatus: string | null;
          }>,
          pendingScopes: 0,
          unscoped: 0,
          leadMs: null as number | null,
          cycleMs: null as number | null,
          done: false,
        };
        if (!card) return empty;
        const events = stageEvents(cardId);
        const doneEvent =
          [...events].reverse().find((event) => event.stage === "done") ?? null;
        const endAt = doneEvent ? doneEvent.entered_at : now();
        const timeline = summarizeTimeline(events, {
          createdAt: card.created_at,
          endAt,
        });
        const gapState = await critiqueGapState(card).catch(() => null);
        if (!gapState?.matched) {
          return {
            ...empty,
            leadMs: timeline.leadMs,
            cycleMs: timeline.cycleMs,
            done: card.status === "completed",
          };
        }
        const totals = gapState.totals;
        const items = gapState.escalated.map((gap) => {
          const scope =
            gapState.auditGapScopes.find(
              (entry) => entry.gap === gap.description,
            ) ?? null;
          return {
            description: gap.description,
            scopeStatus: scope ? scope.status : null,
          };
        });
        return {
          matched: true,
          total: totals.total,
          fixed: totals.fixed,
          documented: totals.documented,
          escalated: totals.escalated,
          items,
          pendingScopes: gapState.auditGapScopes.filter(
            (scope) => !isDoneStatus(scope.status),
          ).length,
          unscoped: gapState.escalated.filter(
            (gap) =>
              !gapState.auditGapScopes.some(
                (scope) => scope.gap === gap.description,
              ),
          ).length,
          leadMs: timeline.leadMs,
          cycleMs: timeline.cycleMs,
          done: card.status === "completed",
        };
      },

      async qualitySeal({ cardId, threadId, path }) {
        // Chat seal backing (docs/phase6-independent-review-plan.md): resolve
        // the card (directly or via worker thread), revalidate the artifact
        // live, and report provenance. Never trusts directive attributes —
        // unknown shapes and unreadable files read as unverified.
        const unverified = {
          status: "unverified" as const,
          failures: [] as string[],
          evidence: null as string | null,
          label: null as string | null,
        };
        const card =
          (cardId ? getCard(cardId) : null) ??
          (threadId ? (getCardByWorkerThread(threadId) ?? null) : null);
        if (!card) return unverified;
        const workspace = await cardWorkspace(card).catch(() => null);
        if (!workspace?.path) return unverified;
        const full = resolveArtifactPath(workspace.path, path);
        const content = full
          ? await bb.sdk.files
              .read({ path: full })
              .then((f) => f.content)
              .catch(() => null)
          : null;
        if (typeof content !== "string" || !content.trim()) return unverified;
        let failures: string[] = [];
        let label: string | null = null;
        let matched = false;
        let evidence: string | null = "verified";
        if (card.kind === "research") {
          const history = strategyRounds(card);
          const primary = history.find((entry) => entry.file === path);
          if (primary) {
            matched = true;
            label = researchStrategyById(primary.id)?.label ?? primary.id;
            const result = validateVariant(
              content,
              contractForStrategy(primary.id),
            );
            failures = result.pass
              ? []
              : result.failures.map((failure) => failure.detail).slice(0, 3);
          } else {
            for (const entry of history) {
              const parsed = parseRoundPath(path, entry.id);
              if (parsed?.subskill) {
                matched = true;
                label = `${researchStrategyById(entry.id)?.label ?? entry.id} — ${parsed.subskill}`;
                const index = await readResearchIndex(card).catch(() => null);
                const indexBlob =
                  index &&
                  index.ok === true &&
                  typeof index.content === "string"
                    ? index.content
                    : null;
                if (!isValidRoundContent(content, indexBlob)) {
                  failures = [
                    "missing, thin, or mirrors the index — rewrite it",
                  ];
                } else {
                  failures = validateSubstep(parsed.subskill, content)
                    .failures.map((failure) => failure.detail)
                    .slice(0, 3);
                }
                break;
              }
            }
          }
          const index = await readResearchIndex(card).catch(() => null);
          if (index && index.ok === true && typeof index.content === "string")
            evidence = evidenceStatus(index.content);
        } else if (card.kind === "explore") {
          if (path.endsWith(exploreArtifactFile(card.explore_stage ?? ""))) {
            matched = true;
            label =
              techniqueById(card.explore_stage ?? "")?.label ??
              card.explore_stage;
            if (!isValidExploreContent(content)) {
              failures = ["missing or thin — write the stage deliverable"];
            } else {
              failures = validateExplore(card.explore_stage ?? "", content)
                .failures.map((failure) => failure.detail)
                .slice(0, 3);
            }
          }
        } else {
          const contract = contractForBuildArtifact(path, content);
          if (contract) {
            matched = true;
            label = contract.id;
            const result = validateArtifact(content, contract);
            failures = result.pass
              ? []
              : result.failures.map((failure) => failure.detail).slice(0, 3);
          }
        }
        if (!matched) return unverified;
        return {
          status: sealStatus(
            failures.length === 0 ? { pass: true } : { pass: false },
            evidence ?? "verified",
          ),
          failures,
          evidence,
          label,
        };
      },

      async reseedCard({ cardId, presetId, intent: requestedIntent }) {
        const card = getCard(cardId);
        if (!card)
          return {
            reseeded: false,
            error: ERR_CARD_NOT_FOUND,
            reclassified: false,
          };
        if (isArchivedCard(card))
          return {
            reseeded: false,
            error: ERR_CARD_ARCHIVED,
            reclassified: false,
          };
        const intentDecision = resolveReseedIntent(card, requestedIntent);
        if (!intentDecision)
          return {
            reseeded: false,
            error: "Only Build cards use a workflow type.",
            reclassified: false,
          };
        const { intent, reclassified } = intentDecision;
        const workspace = await cardWorkspace(card);
        const source =
          workspace?.hostId && workspace.path
            ? { path: workspace.path, hostId: workspace.hostId }
            : null;
        if (!source)
          return {
            reseeded: false,
            error: `${ERR_WORKSPACE_UNAVAILABLE} Archive this card to remove it.`,
            reclassified: false,
          };
        // Re-seed into a fresh per-workflow dir so the card gets a clean state file.
        // A reseed restarts the workflow, not the human's review choices: the
        // card's current appetite and gate set carry over instead of the
        // hardcoded Core/Auto.
        const currentConfig = await (async () => {
          try {
            if (!card.dir_hash) return null;
            const stateDir = await workflowStateDir(
              bb,
              source.path,
              card.id,
              card.dir_hash,
            ).catch(() => null);
            if (!stateDir) return null;
            const content = await bb.sdk.files
              .read({ path: join(stateDir, "state.md") })
              .then((f) => f.content)
              .catch(() => null);
            if (typeof content !== "string") return null;
            return parseWorkflowConfig(content);
          } catch {
            return null;
          }
        })();
        const seed = await seedWorkflow(
          bb,
          source.path,
          card.id,
          card.name,
          intent,
          currentConfig?.appetite ?? "Core",
          currentConfig?.reviewGates ?? [],
          true,
        );
        if (seed.error)
          return { reseeded: false, error: seed.error, reclassified: false };
        if (seed.dirHash) {
          db.prepare(
            "UPDATE cards SET dir_hash = ?, updated_at = ? WHERE id = ?",
          ).run(seed.dirHash, now(), cardId);
          // A fresh workflow is a fresh episode: stale declarations must not
          // attribute future answers to the previous attempt's contracts.
          db.prepare("DELETE FROM ask_contracts WHERE card_id = ?").run(cardId);
        }
        let preset: PresetRow;
        if (presetId) {
          const found = getPresetById(presetId);
          if (!found)
            return {
              reseeded: false,
              error: ERR_PRESET_NOT_FOUND,
              reclassified: false,
            };
          preset = found;
          if (!pinCardPreset(cardId, preset.id)) {
            return {
              reseeded: false,
              error: ERR_PRESET_NOT_FOUND,
              reclassified: false,
            };
          }
        } else {
          // No explicit preset: reseed resolves the reliable-tier preset like
          // any fresh start (card pin, reliable override, band, default) —
          // never the bare card default under an active band policy.
          preset = getReliablePresetForBand(bandForCardKindStage(card.kind, card.stage), cardId);
        }
        const previousThreadId = card.worker_thread_id;
        const params = presetAttachmentParams(preset);
        const researchStrategy =
          card.kind === "research"
            ? researchStrategyById(card.research_strategy ?? "")
            : null;
        if (card.kind === "research" && !researchStrategy)
          return {
            reseeded: false,
            error:
              "This research has no known strategy. Archive it and start a new one.",
            reclassified: false,
          };
        const exploreStage =
          card.kind === "explore"
            ? techniqueById(card.explore_stage ?? "")
            : null;
        if (card.kind === "explore" && !exploreStage)
          return {
            reseeded: false,
            error:
              "This explore card has no known technique. Archive it and start a new one.",
            reclassified: false,
          };
        // Reseed wipes the state dir: reuse the round's own file path so the
        // re-run recreates exactly what the rounds list expects.
        const reseedRoundNo = Math.max(1, strategyList(card).length);
        const reseedStamp = roundTimestamp();
        let reseedFile = "";
        if (researchStrategy) {
          reseedFile =
            [...strategyRounds(card)]
              .reverse()
              .find((entry) => entry.id === researchStrategy.id)?.file ??
            (seed.stateDir
              ? roundRelPath(
                  seed.stateDir,
                  source.path,
                  roundFileName(
                    researchStrategy.id,
                    reseedRoundNo,
                    reseedStamp,
                  ),
                )
              : "");
          if (reseedFile) await ensureArtifactParent(source.path, reseedFile);
        }
        // The stage path stays deterministic after reseed; workers create it
        // only once they have reviewable content.
        const researchReseed = researchStrategy
          ? researchWorkerPrompt({
              displayName: card.display_name ?? card.name,
              prompt: card.prompt,
              strategyLabel: researchStrategy.label,
              strategyId: researchStrategy.id,
              strategySkill: researchStrategy.skill,
              stateDirText: text(
                seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>",
              ),
              workspaceRoot: source.path,
              instructions: params.instructions,
              flavor: "reseed",
              previousThreadId,
              roundNo: reseedRoundNo,
              roundStamp: reseedStamp,
              roundFile: reseedFile,
            })
          : null;
        const exploreReseed = exploreStage
          ? exploreWorkerPrompt({
              displayName: card.display_name ?? card.name,
              prompt: card.prompt,
              stage: exploreStage,
              stateDirText: text(
                seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>",
              ),
              workspaceRoot: source.path,
              instructions: params.instructions,
              flavor: "reseed",
              previousThreadId,
            })
          : null;
        const nextEnvironment = await workers.continuingEnvironment(
          card,
          workerEnvironment(
            source,
            params,
            card.workspace_kind === "exploratory",
          ),
        );
        const newThread = await workers.replacePrepared(
          {
            projectId: card.project_id,
            environment: nextEnvironment,
            visibility: "hidden",
            title: `Stelow: ${card.display_name ?? card.name}`,
            providerId: params.providerId,
            model: params.modelId,
            reasoningLevel: params.reasoningLevel as
              | "low"
              | "medium"
              | "high"
              | "xhigh"
              | "max"
              | "none"
              | "ultra"
              | "ultracode",
            permissionMode: params.permissionMode as
              | "accept-edits"
              | "auto"
              | "full",
            executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
            input: [
              {
                type: "text",
                mentions: [],
                text:
                  researchReseed ??
                  exploreReseed ??
                  `You are running a Stelow workflow inside the bb-plugin-stelow panel. The host re-seeded your per-workflow state, transitions.md, \
and stelow.json. Your workflow owns its own state dir (${text(seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>")}) — its state.md holds name, \
intent, current_stage, status. ${CARD_OWNER_RULES} The Stelow workflow skills (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-*) \
are provided by this plugin — start by loading them (they live under the plugin's skills directory; \`bb skill list\` shows them). The product \
strategy playbooks (stelow-product-*) are also provided by this plugin \u2014 check \`bb skill list\` first, and only fetch via \`npx skills \
add calionauta/stelow\` if one is missing. Use \`bb stelow advance <stage>\` to change stages (do NOT hand-edit current_stage). ${NEVER_SEED} \
Preserve every gate (product, interface, tech plan, diff). ${CLI_EQUIVALENTS} ${RECON_PROTOCOL} ${DRAFT_PROTOCOL}

${TURN_DISCIPLINE}

${COMMIT_STYLE}

Intent is currently \`${intent}\` in the re-seeded state.md. ${
      intent === "unknown"
        ? "It is still unknown, so your FIRST job is triage: classify it (new-product, feature, \
bugfix, refactor, or investigate), write it to state.md immediately, and only then continue — \
ask via the form below only if genuinely ambiguous."
        : "Use it — do NOT ask the user to pick or confirm intent again."
    } \
 \
Order of work, always: (1) settle intent; (2) load the workflow skills; (3) advance stages and do the \
work. If a \`bb stelow\` command fails, read its stderr once and continue — do NOT spend the turn debugging \
the CLI; report the exact error and move on.

CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form:

    bb stelow ask --thread "$BB_THREAD_ID" \ \
      --question "<a single clear question>" \ \
      --option "<label 1>" --option "<label 2>" [--option "<label 3>" ...] [--multiple]

Batch independent questions into ONE ask call by repeating --question groups (each with its own --option labels) — the user answers \
them together instead of being pinged one by one. Ask dependent questions (where Q2 needs Q1's answer) one at a time. When the \
human must compare artifacts to decide (interface picks, plan reviews), attach each option's evidence: --desc for trade-offs, \
--preview for the inline glance, --artifact for the workspace-relative file they can open.

Before asking a question, first summarize what you read (files, plan, codebase) so the user can answer \
with context — never dump a raw file list as the only content of a question. Do not skip the triage stage. \
Each bb stelow ask call blocks until the user submits; the card stays in its column and signals it is \
waiting for an answer. If an ask returns "No response after Ns" (timeout), STOP and wait: do NOT proceed \
with the workflow. The question stays pending on the card and remains answerable; when the user answers \
it on the card, the answer is delivered to you as a message and you continue from there. Never re-ask \
the same question — wait for the card answer. ${INTERFACE_PICK} For unselected gates, write the approval \
receipt yourself (.stelow/approvals/{dirHash}/{file}.approved.md) and advance; for selected gates, open \
a structured ask instead. Stop when the user archives the card or the workflow reaches \`audit\`.

${DONE_PROTOCOL}

${SPLIT_PROTOCOL}

${params.instructions ? `Preset instructions:\n${params.instructions}\n` : ""}Request:
${card.prompt}`,
              },
              ...cardAttachments(card.attachments),
            ],
          },
          previousThreadId,
        );
        db.prepare(
          "UPDATE cards SET intent = ?, updated_at = ? WHERE id = ?",
        ).run(intent, now(), cardId);
        const reseedReset = resetAutoContinue();
        updateCard(cardId, {
          stage:
            card.kind === "research"
              ? "research"
              : card.kind === "explore"
                ? "explore"
                : "triage",
          status: freshStatusForReseed(card, reclassified),
          activity: "running",
          last_error: null,
          worker_thread_id: newThread.id,
          worker_preset_id: preset.id,
          preset_restart_pending: 0,
          last_assistant_text: null,
          auto_continue_count: reseedReset.count,
          auto_continue_stage: reseedReset.stage,
        });
        workers.recordThread(cardId, newThread.id, preset.id, "reseed");
        if (seed.dirHash)
          void workers.lineage(
            source.path,
            seed.dirHash,
            newThread.id,
            preset.id,
            "reseed",
          );
        bb.realtime.publish("card-state", { cardId });
        return { reseeded: true, error: null, reclassified };
      },

      async promoteCard({ cardId, name }) {
        // Promotion is a worker handoff, not only a workspace relabel. Files
        // remain in place, but the old exploratory worker is replaced by a new
        // worker belonging to the new project. That makes Open thread truthful
        // and prevents two workers from writing the same workflow state.
        const card = getCard(cardId);
        if (!card)
          return {
            ok: false,
            projectId: null,
            projectName: null,
            threadId: null,
            error: ERR_CARD_NOT_FOUND,
          };
        if (card.workspace_kind !== "exploratory") {
          const projectName = await bb.sdk.projects
            .get({ projectId: card.project_id })
            .then((p) => p.name)
            .catch(() => card.project_id);
          return {
            ok: false,
            projectId: null,
            projectName: null,
            threadId: null,
            error: `This card already lives in project "${projectName}" — nothing to promote.`,
          };
        }
        if (card.status === "archived")
          return {
            ok: false,
            projectId: null,
            projectName: null,
            threadId: null,
            error: ERR_CARD_ARCHIVED,
          };
        const workspace = await cardWorkspace(card);
        if (!workspace?.path)
          return {
            ok: false,
            projectId: null,
            projectName: null,
            threadId: null,
            error: ERR_WORKSPACE_UNAVAILABLE,
          };
        if (!workspace.hostId)
          return {
            ok: false,
            projectId: null,
            projectName: null,
            threadId: null,
            error: "Workspace host is unavailable.",
          };
        const recovery = await recoverySnapshot(card);
        if (recovery.kind !== "promote") {
          // Every refusal names the exit, so a refusal is never a deadlock.
          const refusal: Record<typeof recovery.kind, string> = {
            attached:
              "This card already has a reviewed checkout attached. Use that checkout to review, test, and commit.",
            "external-project":
              "This card has an evidenced external project checkout. Review and attach that checkout instead of promoting the empty exploratory folder.",
            ambiguous:
              "Several registered checkouts match the worker's report. Review them in Workspace recovery and attach the right one.",
            "documents-only":
              "This exploratory workspace holds workflow documents only — there is no source material to turn into a project.",
          };
          return {
            ok: false,
            projectId: null,
            projectName: null,
            threadId: null,
            error: refusal[recovery.kind],
          };
        }
        const projectName = normalizePromoteName(
          name,
          card.display_name ?? card.name,
        );
        const projects = await bb.sdk.projects.list().catch(() => []);
        const decision = findAdoptableProject(
          projects,
          projectName,
          workspace.path,
        );
        if (decision.action === "conflict") {
          return {
            ok: false,
            projectId: null,
            projectName: null,
            threadId: null,
            error: `A project named "${projectName}" already exists — pick another name.`,
          };
        }
        let projectId: string;
        try {
          projectId =
            decision.action === "adopt" && decision.project
              ? decision.project.id
              : (
                  await bb.sdk.projects.create({
                    name: projectName,
                    source: {
                      type: "local_path",
                      hostId: workspace.hostId,
                      path: workspace.path,
                    },
                  })
                ).id;
        } catch (error) {
          return {
            ok: false,
            projectId: null,
            projectName: null,
            threadId: null,
            error:
              error instanceof Error
                ? error.message
                : "Could not create the project.",
          };
        }
        // Temporarily bind the card to the target project so the common respawn
        // helper uses the exact project source and projectId. If that spawn
        // fails, revert this ownership change: the old worker was never stopped
        // and the card stays coherent in its exploratory workspace.
        db.prepare(
          "UPDATE cards SET project_id = ?, workspace_kind = 'project', workspace_path = NULL, workspace_host_id = NULL, updated_at = ? WHERE id = ?",
        ).run(projectId, now(), cardId);
        const preset =
          card.kind === "build"
            ? getReliablePresetForBand(STAGE_TO_BAND[card.stage] ?? "analysis", cardId)
            : getPresetForCard(cardId);
        const handoff = await workers.respawn(
          cardId,
          preset.id,
          "project-promotion",
          { previousProjectId: card.project_id },
        );
        if (!handoff.ok || !handoff.threadId) {
          db.prepare(
            "UPDATE cards SET project_id = ?, workspace_kind = 'exploratory', workspace_path = ?, workspace_host_id = ?, activity = ?, last_error \
= ?, updated_at = ? WHERE id = ?",
          ).run(
            card.project_id,
            workspace.path,
            workspace.hostId,
            card.activity,
            card.last_error,
            now(),
            cardId,
          );
          bb.realtime.publish("card-state", { cardId });
          bb.realtime.publish("board-changed", { cardId });
          return {
            ok: false,
            projectId: null,
            projectName: null,
            threadId: null,
            error: `Could not start the project worker. The card remains exploratory; its existing worker is still active. ${handoff.error ?? "Try again."}`,
          };
        }
        logCardComment(
          cardId,
          "card",
          cardId,
          "agent",
          `Moved into project "${projectName}". Files stayed in place; a new project worker continues from the current stage. The exploratory \
worker is archived in Worker history.`,
        );
        bb.realtime.publish("card-state", { cardId });
        bb.realtime.publish("board-changed", { cardId });
        return {
          ok: true,
          projectId,
          projectName,
          threadId: handoff.threadId,
          error: null,
        };
      },

      async researchStrategies() {
        return { strategies: RESEARCH_STRATEGIES };
      },

      async createResearchCard({
        projectId,
        environment,
        prompt,
        attachments,
        strategy,
        presetId,
        start,
        execution,
      }) {
        const picked = researchStrategyById(strategy);
        if (!picked) {
          throw new Error(
            `Unknown research strategy "${strategy}". Pick one of: ${RESEARCH_STRATEGIES.map((entry) => entry.id).join(", ")}.`,
          );
        }
        return createCardInternal({
          projectId,
          environment,
          prompt,
          attachments,
          intent: "investigate",
          appetite: "Lean",
          reviewMode: "Auto",
          kind: "research",
          strategy: picked.id,
          presetId: presetId ?? null,
          start,
          execution: execution ?? null,
        });
      },

      async createExploreCard({
        projectId,
        environment,
        prompt,
        attachments,
        stageId,
        presetId,
        start,
        execution,
      }) {
        const picked = techniqueById(stageId);
        if (!picked) {
          throw new Error(
            `Unknown explore technique "${stageId}". Pick one of: ${TECHNIQUE_CATALOG.map((entry) => entry.id).join(", ")}.`,
          );
        }
        return createCardInternal({
          projectId,
          environment,
          prompt,
          attachments,
          intent: "explore",
          appetite: "Complete",
          reviewMode: "Product Spec + Interface + Tech Review + Code Diff",
          kind: "explore",
          stageId: picked.id,
          presetId: presetId ?? null,
          start,
          execution: execution ?? null,
        });
      },

      async stageCatalog() {
        return {
          stages: TECHNIQUE_CATALOG.map(
            ({ id, label, skill, emoji, blurb, keywords }) => ({
              id,
              label,
              skill,
              emoji,
              blurb,
              keywords,
            }),
          ),
        };
      },

      // Resolve the research index file for a card. Shared by researchIndex
      // (read) and fanOutResearch (read + flip). Returns the error instead of
      // throwing so every refusal names its exit.
      async researchIndex({ cardId }) {
        const card = getCard(cardId);
        const empty = {
          found: false,
          indexPath: null,
          content: null,
          truncated: false,
          opportunities: [],
          rounds: [],
          error: "",
        };
        if (!card) return { ...empty, error: ERR_CARD_NOT_FOUND };
        if (card.kind !== "research")
          return {
            ...empty,
            error:
              "Only research cards have results to review. Build cards track scopes instead.",
          };
        const resolved = await readResearchIndex(card);
        if (!resolved.ok) return { ...empty, error: resolved.error };
        const history = strategyRounds(card);
        const live = ["running", "awaiting-answer"].includes(card.activity);
        const workspace = await cardWorkspace(card).catch(() => null);
        const stateDir =
          card.dir_hash && workspace?.path
            ? await workflowStateDir(
                bb,
                workspace.path,
                card.id,
                card.dir_hash,
              ).catch(() => null)
            : null;
        const { rounds } = await researchRoundFiles(
          workspace?.path ?? null,
          workspace?.hostId ?? null,
          stateDir,
          history,
          live,
        );
        const parsed = parseResearchIndex(resolved.content);
        if (!parsed.found)
          return {
            ...empty,
            indexPath: resolved.display,
            rounds,
            error: "Research results are still being prepared.",
          };
        const LIMIT = 100_000;
        return {
          found: true,
          indexPath: resolved.display,
          content: resolved.content.slice(0, LIMIT),
          truncated: resolved.content.length > LIMIT,
          opportunities: parsed.opportunities.map(
            ({ id, title, checked, group }) => ({ id, title, checked, group }),
          ),
          rounds,
          error: null,
        };
      },

      async fanOutResearch({ cardId, opportunityIds }) {
        const card = getCard(cardId);
        if (!card) return { ok: false, created: [], error: ERR_CARD_NOT_FOUND };
        if (card.kind !== "research")
          return {
            ok: false,
            created: [],
            error: "Only research cards fan out. This is already a build card.",
          };
        if (card.status === "archived")
          return { ok: false, created: [], error: ERR_CARD_ARCHIVED };
        const resolved = await readResearchIndex(card);
        if (!resolved.ok)
          return { ok: false, created: [], error: resolved.error };
        const parsed = parseResearchIndex(resolved.content);
        if (!parsed.found)
          return {
            ok: false,
            created: [],
            error: "Research results are still being prepared.",
          };
        const wanted = new Set(opportunityIds);
        const matched = parsed.opportunities.filter(
          (item) => wanted.has(item.id) && !item.checked,
        );
        if (matched.length === 0)
          return {
            ok: false,
            created: [],
            error:
              "None of the selected opportunities are still available — reopen the index; they may already have been fanned out.",
          };
        const strategyLabel =
          researchStrategyById(card.research_strategy ?? "")?.label ??
          "research";
        // Exploratory research fans out into fresh exploratory build cards (each
        // owns its isolated workspace) instead of piling every card's state
        // into the shared container directory. Project research stays in its
        // project.
        const targetProjectId =
          card.workspace_kind === "exploratory"
            ? "proj_personal"
            : card.project_id;
        const created: Array<{ cardId: string; title: string }> = [];
        const createdOpportunityIds: string[] = [];
        let failure: string | null = null;
        for (const item of matched) {
          try {
            const spawned = await createCardInternal({
              projectId: targetProjectId,
              prompt: `Spawned from research "${card.display_name ?? card.name}" (${strategyLabel}).\n\nOpportunity: ${item.title}\n\nResearch context: \
full index at \
${resolved.absolute} — read its ## Summary before triage. Treat the opportunity above as the request; classify intent first, then work it through \
the normal build workflow.`,
              attachments: [],
              intent: "unknown",
              appetite: "Lean",
              reviewMode: "Auto",
              kind: "build",
            });
            const spawnedCard = getCard(spawned.cardId);
            created.push({
              cardId: spawned.cardId,
              title:
                spawnedCard?.display_name ?? spawnedCard?.name ?? item.title,
            });
            createdOpportunityIds.push(item.id);
          } catch (error) {
            failure =
              error instanceof Error
                ? error.message
                : "Could not spawn a build card.";
            break;
          }
        }
        // Persist exactly the successfully spawned opportunities before
        // reporting a partial failure, so retrying does not duplicate them.
        const flipped = checkIndexItems(
          resolved.content,
          createdOpportunityIds,
        );
        if (flipped.checked.length > 0) {
          try {
            await bb.sdk.files.write({
              path: resolved.absolute,
              content: flipped.updated,
            });
          } catch {
            /* boxes stay unchecked; the comment below still trails */
          }
        }
        if (created.length > 0) {
          logCardComment(
            cardId,
            "card",
            cardId,
            "agent",
            `Fanned out ${created.length} ${
              created.length === 1 ? "opportunity" : "opportunities"
            } into build: ${created.map((entry) => entry.title).join("; ")}.`,
          );
        }
        bb.realtime.publish("card-state", { cardId });
        bb.realtime.publish("board-changed", { cardId });
        if (failure) {
          const prefix =
            created.length > 0
              ? `Created ${created.length} ${created.length === 1 ? "build card" : "build cards"} before the remaining opportunities could not be created. `
              : "";
          return { ok: false, created, error: `${prefix}${failure}` };
        }
        return { ok: true, created, error: null };
      },

      // Working-tree diff for the diff-gate/audit review moment. Read-only:
      // never stages, never mutates the index. Tracked modifications come
      // from `git diff`; untracked files list as openable entries (no patch
      // invented for them). Everything is capped; failures degrade to an
      // explicit shape, never a throw past the contract.
      async cardDiff({ cardId }) {
        const empty = {
          found: false,
          isRepo: false,
          files: [],
          truncated: false,
          entitySummary: null as ReturnType<typeof summarizeSemDiff>,
          changedSymbols: null as ReturnType<typeof summarizeCymbalChanged>,
          error: null as string | null,
        };
        const card = getCard(cardId);
        if (!card) return { ...empty, error: ERR_CARD_NOT_FOUND };
        const workspace = await cardCheckout(card).catch(() => null);
        if (!workspace?.path)
          return { ...empty, error: ERR_WORKSPACE_UNAVAILABLE };
        // A recovered checkout is a read-only audit target, never a fuzzy path
        // alias. If its Git root changed since the human attached it, stop here
        // rather than showing a convincing diff from a different repository.
        const recoveryError = await recoveredCheckoutIntegrity(
          recoveryIntegrityDeps,
          card,
          workspace.path,
        );
        if (recoveryError)
          return { ...empty, found: true, error: recoveryError };
        const runGit = (
          args: string[],
          cwd?: string,
        ): Promise<{ ok: boolean; stdout: string }> =>
          new Promise((resolve) => {
            execFile(
              "git",
              args,
              {
                cwd: cwd ?? workspace.path,
                timeout: 15000,
                maxBuffer: 8 * 1024 * 1024,
              },
              (error, stdout) => {
                resolve({
                  ok: !error,
                  stdout: typeof stdout === "string" ? stdout : "",
                });
              },
            );
          });
        const top = await runGit(["rev-parse", "--show-toplevel"]);
        if (!top.ok || !top.stdout.trim())
          return { ...empty, found: true, error: "Not a git repository." };
        const toplevel = top.stdout.trim();
        const hostId = workspace.hostId ?? "";
        const files: Array<{
          path: string;
          display: string;
          patch: string | null;
          isNew: boolean;
          absolutePath: string;
          hostId: string;
        }> = [];
        let truncated = false;
        // HEAD (not bare `diff`) so staged changes review too. Fresh repos
        // without HEAD fail here — untracked listing below still covers them.
        // cwd=toplevel so every path resolves root-relative.
        const diff = await runGit(
          ["diff", "HEAD", "--no-color", "--no-ext-diff", "--unified=3", "--"],
          toplevel,
        );
        if (diff.ok && diff.stdout.trim()) {
          const split = splitDiffByFile(diff.stdout);
          truncated = truncated || split.truncated;
          for (const entry of split.files) {
            const absolute = resolveArtifactPath(toplevel, entry.path);
            if (!absolute) continue;
            files.push({
              path: entry.path,
              display: entry.path.split("/").pop() || entry.path,
              patch: entry.patch,
              isNew: false,
              absolutePath: absolute,
              hostId,
            });
          }
        }
        if (files.length < MAX_DIFF_FILES) {
          // -uall expands collapsed dirs (normal lists `skills/` — unopenable)
          // into individual files; quotepath=false avoids octal escapes the
          // JSON.parse fallback below could misread.
          const status = await runGit(
            [
              "-c",
              "core.quotepath=false",
              "-c",
              "status.relativePaths=false",
              "status",
              "--porcelain=v1",
              "-z",
              "--untracked-files=all",
            ],
            toplevel,
          );
          if (status.ok && status.stdout) {
            for (const line of status.stdout.split("\0")) {
              if (files.length >= MAX_DIFF_FILES) {
                truncated = true;
                break;
              }
              const match = /^\?\? (.+)$/.exec(line);
              if (!match) continue;
              let rel = match[1].trim().replace(/^\.\//, "");
              if (rel.startsWith('"') && rel.endsWith('"')) {
                try {
                  rel = JSON.parse(rel);
                } catch {
                  rel = rel.slice(1, -1);
                }
              }
              if (!rel || typeof rel !== "string") continue;
              const absolute = resolveArtifactPath(toplevel, rel);
              if (!absolute) continue;
              if (files.some((f) => f.path === rel)) continue;
              files.push({
                path: rel,
                display: rel.split("/").pop() || rel,
                patch: null,
                isNew: true,
                absolutePath: absolute,
                hostId,
              });
            }
          }
        } else {
          truncated = true;
        }
        // Entity-level summary via `sem` when installed (server-wide binary at
        // ~/.local/bin/sem, PATH fallback). Same HEAD baseline as the git diff
        // above; untracked files are excluded by sem itself. Strictly additive:
        // any failure (missing binary, timeout, off-shape JSON) yields null
        // and the git patch list below still renders on its own.
        let entitySummary: ReturnType<typeof summarizeSemDiff> = null;
        try {
          const semOut = await new Promise<string | null>((resolve) => {
            execFile(
              resolveLocalBin("sem"),
              [
                "diff",
                "-C",
                toplevel,
                "HEAD",
                "--format",
                "json",
                "--color",
                "never",
              ],
              { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
              (error, stdout) => {
                resolve(!error && typeof stdout === "string" ? stdout : null);
              },
            );
          });
          if (semOut) {
            try {
              entitySummary = summarizeSemDiff(JSON.parse(semOut));
            } catch {
              entitySummary = null;
            }
          }
        } catch {
          entitySummary = null;
        }
        // Changed symbols with caller impact via `cymbal` when installed.
        // Same HEAD baseline; cwd=toplevel (cymbal only operates on the
        // current worktree). Strictly additive like the sem summary above.
        let changedSymbols: ReturnType<typeof summarizeCymbalChanged> = null;
        try {
          const cymOut = await new Promise<string | null>((resolve) => {
            execFile(
              resolveLocalBin("cymbal"),
              [
                "changed",
                "--base",
                "HEAD",
                "--json",
                "--max-symbols",
                "20",
                "--max-impact",
                "100",
              ],
              { cwd: toplevel, timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
              (error, stdout) => {
                resolve(!error && typeof stdout === "string" ? stdout : null);
              },
            );
          });
          if (cymOut) {
            try {
              changedSymbols = summarizeCymbalChanged(JSON.parse(cymOut));
            } catch {
              changedSymbols = null;
            }
          }
        } catch {
          changedSymbols = null;
        }
        return {
          found: true,
          isRepo: true,
          files,
          truncated,
          entitySummary,
          changedSymbols,
          error: null,
        };
      },

      async auditTrailStatus({ cardId }) {
        // Freshness of Stelow's portable receipt, asked for on demand instead of
        // computed on every board read: `check` re-derives the whole projection,
        // which reads the workflow state and samples the worktree, so it is a
        // deliberate request rather than a listing cost. The answer is the
        // helper's own classification — this RPC never decides staleness itself,
        // and the path is the CLI's fixed contract, not a second lookup.
        const card = getCard(cardId);
        if (!card)
          return {
            state: "unavailable" as const,
            detail: ERR_CARD_NOT_FOUND,
            head: null,
            path: null,
            contract: null,
            recon: null,
          };
        if (card.kind !== "build")
          return {
            state: "unavailable" as const,
            detail: "Only Build cards carry an audit trail.",
            head: null,
            path: null,
            contract: null,
            recon: null,
          };
        const workspace = await cardWorkspace(card).catch(() => null);
        const projectPath = workspace?.path ?? null;
        if (!projectPath)
          return {
            state: "unavailable" as const,
            detail: ERR_WORKSPACE_UNAVAILABLE,
            head: null,
            path: null,
            contract: null,
            recon: null,
          };
        const stateDir = card.dir_hash
          ? await workflowStateDir(
              bb,
              projectPath,
              card.id,
              card.dir_hash,
            ).catch(() => null)
          : null;
        if (!stateDir)
          return {
            state: "unavailable" as const,
            detail:
              "Workflow state ownership cannot be verified. Reseed this card; project-root state is intentionally ignored.",
            head: null,
            path: null,
            contract: null,
            recon: null,
          };
        // This is the same completion contract, not a softer display-only
        // verdict: a trail with any unregistered durable output is refused.
        const run = await runHelper(
          ["audit-trail", "check", "--strict", "--json"],
          projectPath,
          stateDir,
        );
        const outcome = auditTrailOutcome(run);
        return {
          state: outcome.state,
          detail: outcome.detail,
          head:
            typeof outcome.result?.snapshot?.head === "string"
              ? outcome.result.snapshot.head
              : null,
          path: nodeJoin(stateDir, AUDIT_TRAIL_FILE),
          contract:
            typeof outcome.result?.contract === "string"
              ? outcome.result.contract
              : null,
          recon: reconReceiptStatus(
            await bb.sdk.files
              .read({ path: join(stateDir, RECON_RECEIPT_FILE) })
              .then((file) => file.content)
              .catch(() => null),
            stateDir,
          ),
        };
      },

      async runResearchStrategy({ cardId, strategy }) {
        // Composite research: run another strategy round on the same card.
        // Spawns a fresh worker on the new playbook that APPENDS a new ###
        // section to the index — existing items are never rewritten. The
        // previous worker retires only after the new one is live (same safe
        // order as every respawn).
        const card = getCard(cardId);
        if (!card)
          return { ok: false, strategy: null, error: ERR_CARD_NOT_FOUND };
        if (card.kind !== "research")
          return {
            ok: false,
            strategy: null,
            error:
              "Only research cards run strategies. Build cards advance stages instead.",
          };
        if (card.status === "archived")
          return { ok: false, strategy: null, error: ERR_CARD_ARCHIVED };
        const picked = researchStrategyById(strategy);
        if (!picked) {
          return {
            ok: false,
            strategy: null,
            error: `Unknown research strategy "${strategy}". Pick one of: ${RESEARCH_STRATEGIES.map((entry) => entry.id).join(", ")}.`,
          };
        }
        const effective = getReliablePresetForBand("research", cardId);
        const roundNo = strategyList(card).length + 1;
        const roundStamp = roundTimestamp();
        const roundAt = new Date(now()).toISOString();
        const fanoutWorkspace = await cardWorkspace(card).catch(() => null);
        const fanoutStateDir =
          card.dir_hash && fanoutWorkspace?.path
            ? await workflowStateDir(
                bb,
                fanoutWorkspace.path,
                card.id,
                card.dir_hash,
              ).catch(() => null)
            : null;
        const roundFile =
          fanoutStateDir && fanoutWorkspace?.path
            ? roundRelPath(
                fanoutStateDir,
                fanoutWorkspace.path,
                roundFileName(picked.id, roundNo, roundStamp),
              )
            : "";
        if (roundFile && fanoutWorkspace?.path)
          await ensureArtifactParent(fanoutWorkspace.path, roundFile);
        const result = await workers.respawn(
          cardId,
          effective.id,
          "strategy-add",
          {
            strategyId: picked.id,
            flavor: "append",
            roundNo,
            roundStamp,
            roundFile,
          },
        );
        if (!result.ok)
          return {
            ok: false,
            strategy: null,
            error: result.error ?? "Could not start the strategy round.",
          };
        const history = [
          ...strategyRounds(card),
          { id: picked.id, at: roundAt, file: roundFile },
        ];
        db.prepare(
          "UPDATE cards SET research_strategies = ?, updated_at = ? WHERE id = ?",
        ).run(JSON.stringify(history), now(), cardId);
        const presetName = getPresetById(effective.id)?.name ?? effective.id;
        logCardComment(
          cardId,
          "card",
          cardId,
          "agent",
          `Started a ${picked.label} research round on preset "${presetName}". Results will be added to this card. Previous worker archived.`,
        );
        bb.realtime.publish("card-state", { cardId });
        return { ok: true, strategy: picked.id, error: null };
      },

      async answerExpiredQuestions({ cardId, answers }) {
        // Timed-out questions remain one atomic blocking decision. Never resume
        // the worker with a subset: later answers may reverse its direction.
        const card = getCard(cardId);
        if (!card)
          return { ok: false as const, answered: 0, error: ERR_CARD_NOT_FOUND };
        if (isArchivedCard(card))
          return { ok: false as const, answered: 0, error: ERR_CARD_ARCHIVED };
        const openRows = db
          .prepare(
            "SELECT id, thread_id, question FROM expired_questions WHERE card_id = ? AND answered = 0",
          )
          .all(cardId) as Array<{
          id: string;
          thread_id: string;
          question: string;
        }>;
        const openIds = new Set(openRows.map((row) => row.id));
        const rows = new Map<
          string,
          { thread_id: string; question: string; answers: string[] }
        >();
        for (const item of answers) {
          const row = openRows.find((entry) => entry.id === item.questionId);
          const cleanAnswers = cleanAnswerList(item.answers);
          if (row && !rows.has(item.questionId) && cleanAnswers.length > 0)
            rows.set(item.questionId, {
              thread_id: row.thread_id,
              question: row.question,
              answers: cleanAnswers,
            });
        }
        if (openIds.size === 0)
          return {
            ok: false as const,
            answered: 0,
            error: "Questions not found or already answered.",
          };
        if (rows.size !== openIds.size)
          return {
            ok: false as const,
            answered: 0,
            error: "Answer every pending question before submitting.",
          };
        const decisions: Array<{ question: string; answers: string[] }> = [];
        // Resume the CURRENT worker: the row's thread may be stale (restart /
        // reseed archives the thread but keeps its expired questions).
        const threadId =
          card.worker_thread_id ??
          rows.values().next().value?.thread_id ??
          null;
        db.transaction(() => {
          for (const [questionId, row] of rows) {
            const matched = consumeAskContract(db, cardId, row.question);
            logCardComment(
              cardId,
              "card",
              cardId,
              "user",
              `Answer to a pending question${matched ? ` (contract: ${matched})` : ""}:\n\nQ: ${row.question}\nA: ${row.answers.join(", ")}`,
            );
            db.prepare(
              "UPDATE expired_questions SET answered = 1 WHERE id = ?",
            ).run(questionId);
            decisions.push({ question: row.question, answers: row.answers });
          }
        })();
        // Recovered split asks record through the same shared helper as live
        // asks; otherwise a valid response would resume the worker but make
        // `bb stelow split` refuse as unanswered.
        recordSplitAnswer(db, cardId, decisions);
        markInboxQuestionsAnswered(
          cardId,
          [...rows.keys()].map((questionId) => `expired:${questionId}`),
        );
        const openQuestionIds = await syncOpenQuestionInbox(card);
        // Same stale-error rule as live answers: answering clears the
        // interrupted turn's failure so the recovered card reads coherent.
        updateCard(cardId, {
          activity: hasOpenQuestions(cardId, openQuestionIds)
            ? "awaiting-answer"
            : "running",
          status: "in-progress",
          last_error: null,
        });
        bb.realtime.publish("card-state", { cardId });
        if (threadId) {
          try {
            await bb.sdk.threads.send({
              threadId,
              mode: "auto",
              input: [
                {
                  type: "text",
                  text: formatBatchContinuation(decisions),
                  mentions: [],
                },
              ],
            });
          } catch {
            // Thread may be stopped; the comments still record the answers.
          }
        }
        return { ok: true as const, answered: decisions.length, error: null };
      },

      async advanceCard({ cardId, stage }) {
        const card = getCard(cardId);
        if (!card) return { ok: false, stdout: "", error: ERR_CARD_NOT_FOUND };
        if (isArchivedCard(card))
          return { ok: false, stdout: "", error: ERR_CARD_ARCHIVED };
        if (card.kind === "research") {
          return {
            ok: false,
            stdout: "",
            error:
              "Research cards don't use stages — a completed index moves them to Done automatically.",
          };
        }
        if (card.kind === "explore") {
          return {
            ok: false,
            stdout: "",
            error:
              "Explore cards don't use stages — a completed artifact moves them to Done automatically.",
          };
        }
        const workspace = await cardWorkspace(card);
        if (!workspace?.path)
          return { ok: false, stdout: "", error: ERR_WORKSPACE_UNAVAILABLE };
        const stateDir = card.dir_hash
          ? await workflowStateDir(bb, workspace.path, card.id, card.dir_hash)
          : null;
        const source = { path: workspace.path, hostId: workspace.hostId };
        const guard = await ensureProjectArtifacts(
          bb,
          source.path,
          stateDir,
          Boolean(card.dir_hash),
        );
        if (guard) return { ok: false, stdout: "", error: guard };
        // Check the stage being left before the helper mutates state.md. The
        // workflow file is slug truth, so a refusal leaves both it and the DB
        // card at the same stage.
        const questionGuard = await questionContractsGate(card, stateDir);
        if (questionGuard)
          return { ok: false, stdout: "", error: questionGuard };
        const result = await runHelper(
          ["advance", stage],
          source.path,
          stateDir ?? undefined,
        );
        if (result.code !== 0)
          return {
            ok: false,
            stdout: result.stdout,
            error: result.stderr || "stelow advance failed",
          };
        // Band-preset swap, mirroring the CLI advance path: if the phase of the
        // stage just advanced to defines a preset different from this worker's,
        // respawn with the phase preset on the same state dir.
        const band = STAGE_TO_BAND[stage];
        const bandPreset = band
          ? getReliablePresetForBand(band, card.id)
          : null;
        const currentPresetId =
          card.worker_preset_id ?? getPresetForCard(card.id).id;
        if (band && bandPreset && bandPreset.id !== currentPresetId) {
          await workers.respawn(card.id, bandPreset.id);
        }
        // Reaching audit is still unfinished work. Only `bb stelow done` may
        // record completion after the host verifies its terminal conditions.
        // A manual advance is therefore never a way to bypass that invariant.
        const nextStatus = stage === "triage" ? "draft" : "in-progress";
        updateCard(cardId, { stage, status: nextStatus, activity: "running" });
        bb.realtime.publish("card-state", { cardId });
        return { ok: true, stdout: result.stdout, error: null };
      },

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

  registerStelowCli(bb, (argv, context) => runCliCommand(argv, context));

  async function runCliCommand(
    argv: string[],
    ctx: {
      projectId?: string | null;
      threadId?: string | null;
      signal?: AbortSignal;
    },
  ): Promise<{ exitCode: number; stdout?: string; stderr?: string }> {
    const inspection = await runInspection(argv, ctx);
    if (inspection) return inspection;
    if (argv[0] === "ask") {
      const flag = (name: string) => {
        const index = argv.indexOf(name);
        return index >= 0 ? argv[index + 1] : undefined;
      };
      const threadId = flag("--thread") ?? ctx.threadId;
      // --tag marks a machine-readable ask kind. Question content and the
      // surrounding card UI are English-only, so locale is not a choice.
      const tagValues: string[] = [];
      const askArgv: string[] = [];
      for (let i = 1; i < argv.length; i++) {
        if (argv[i] === "--tag") {
          tagValues.push(argv[i + 1] ?? "");
          i++;
          continue;
        }
        if (argv[i] === "--locale")
          return {
            exitCode: 2,
            stderr: "Questions are English-only; do not pass --locale.",
          };
        askArgv.push(argv[i]!);
      }
      const tag =
        tagValues.length > 0 ? tagValues[tagValues.length - 1]! : null;
      if (tag !== null && tag !== "split")
        return {
          exitCode: 2,
          stderr:
            "Unknown --tag. The only worker ask tag is --tag split (card-split proposals at triage).",
        };
      // Repeated --question groups ask several questions in ONE blocking
      // call: the human answers them together instead of being pinged N
      // times. Options/--multiple attach to the most recent --question.
      const parsed = parseAskGroups(askArgv);
      if (!threadId)
        return { exitCode: 2, stderr: "Missing --thread <thr_id>." };
      if (parsed.error || !parsed.groups)
        return {
          exitCode: 2,
          stderr:
            parsed.error ??
            "Usage: bb stelow ask --thread <thr_id> --question <text> [--multiple] --option <label> [--desc <text>] [--preview <text>] [--artifact <path>]...",
        };
      const groups = parsed.groups.map((group) => ({
        question: group.question,
        multiple: group.multiple,
        kind: tag === "split" ? ("split" as const) : ("standard" as const),
        options: group.options.map((o) => ({
          label: o.label,
          description: o.description,
          preview: o.preview,
          artifact: o.artifact,
        })),
        contract: group.contract ?? null,
      }));
      for (const group of groups) {
        const languageError = englishQuestionContentError(
          group.question,
          group.options,
        );
        if (languageError) return { exitCode: 2, stderr: languageError };
      }
      const batched = groups.length > 1;
      // The thread must own a card: otherwise the question would surface
      // nowhere and the persist below would silently skip. Refuse fast
      // with the fix (this is almost always a provider session id passed
      // where the bb worker thread id belongs) instead of blaming storage.
      const cardRow = db
        .prepare("SELECT id, status FROM cards WHERE worker_thread_id = ?")
        .get(threadId) as { id: string; status: string } | undefined;
      if (!cardRow)
        return {
          exitCode: 2,
          stderr: `No card owns thread "${threadId}". Pass your bb worker thread id ($BB_THREAD_ID, a thr_* id — confirm with: echo $BB_THREAD_ID), \
never a provider session id nor a workflow dirHash (sw-*).`,
        };
      if (cardRow.status === "archived")
        return { exitCode: 2, stderr: "This card is archived." };
      // A question may be open through the host interaction service or
      // through the durable recovery fallback. Do this preflight before
      // recording split intent: a proposal row alone is never evidence that
      // the person has a visible form to answer.
      const liveAsks = await fetchPendingAsks(threadId);
      if (liveAsks === null) {
        return {
          exitCode: 1,
          stderr:
            "Could not verify whether a card question is already open. Retry this same ask once; do not assume a prior question is visible.",
        };
      }
      // One dispatcher owns ask-refusal precedence (lib/ask-gate):
      // duplicate, then intent, then evidence. Nothing is persisted
      // before this line, so a refusal never pings the human. The split
      // branch below stays separate — it validates AND persists.
      {
        const gateCard = getCard(cardRow.id);
        const questionDecision = decideAskGate({
          liveCount: liveAsks.length,
          expiredCount: openExpiredQuestionIds(cardRow.id).length,
          kind: gateCard?.kind,
          intent: gateCard?.intent,
          stage: gateCard ? await cardStageSlug(gateCard) : null,
          tag,
          forced: argv.includes("--force"),
          groups,
        });
        if (!questionDecision.allowed)
          return {
            exitCode: questionDecision.code,
            stderr: questionDecision.reason!,
          };
      }
      // Optional contract declaration (lib/ask-contracts): links this ask
      // to a question contract for later matching. Validated, never
      // enforced here — unknown ids with a readable checklist refuse with
      // the valid list; without one the ask records raw (fail-open).
      // Split asks carry none (their own mechanics own the semantics).
      const declared = groups.filter(
        (group) => typeof group.contract === "string" && group.contract,
      );
      if (tag === "split" && declared.length > 0) {
        return {
          exitCode: 2,
          stderr: "Split asks carry no contract id — remove --contract.",
        };
      }
      if (declared.length > 0) {
        const checklist = await askContractChecklist(cardRow.id);
        const verdict = validateAskContracts(
          declared.map((group) => ({ contractId: group.contract })),
          checklist,
        );
        if (!verdict.ok) return { exitCode: 2, stderr: verdict.error! };
        recordAskContracts(
          db,
          declared.map((group) => ({
            id: randomId("askc"),
            cardId: cardRow.id,
            question: group.question,
            contractId: group.contract,
            askedAt: Date.now(),
          })),
        );
      }
      // A split proposal ask (lib/split-proposal): options are proposed
      // child cards, recorded by the host and executed by `bb stelow
      // split` after approval. Validated and stored BEFORE the blocking
      // call — a refused shape never pings the human.
      if (tag === "split") {
        if (groups.length !== 1)
          return {
            exitCode: 2,
            stderr:
              'A split ask carries exactly one question: the proposed cards as its options, plus one "Keep as one card" option.',
          };
        if (!groups[0]!.multiple)
          return {
            exitCode: 2,
            stderr:
              "A split ask must use --multiple so the user can approve more than one substantial deliverable (or choose Keep as one card).",
          };
        const splitCard = getCard(cardRow.id);
        if (!splitCard)
          return { exitCode: 2, stderr: `Unknown card "${cardRow.id}".` };
        // Single-source split gate (lib/split-proposal): state.md is truth,
        // never the DB cache.
        const splitGate = splitEligibility({
          kind: splitCard.kind,
          stage: await cardStageSlug(splitCard),
        });
        if (!splitGate.ok) return { exitCode: 2, stderr: splitGate.error! };
        const splitOptions = groups[0]!.options;
        const keepCount = splitOptions.filter(
          (o) =>
            o.label.trim().toLowerCase() === SPLIT_KEEP_LABEL.toLowerCase(),
        ).length;
        if (keepCount !== 1)
          return {
            exitCode: 2,
            stderr: `A split ask needs exactly one "${SPLIT_KEEP_LABEL}" option (exact label) so the user can veto.`,
          };
        const slices = splitOptions
          .filter(
            (o) =>
              o.label.trim().toLowerCase() !== SPLIT_KEEP_LABEL.toLowerCase(),
          )
          .map((o) => ({ title: o.label, desc: o.description }));
        const invalid = validateSplitSlices(slices);
        if (invalid) return { exitCode: 2, stderr: invalid };
        // The worker supplies the candidate slices, but the host owns the
        // irreversible semantics. State each consequence once: candidates
        // are a multi-select, while the keep option is an exclusive
        // alternative handled by the renderer and the split executor.
        groups[0]!.question = splitQuestionText(groups[0]!.question);
        db.prepare(
          "INSERT OR REPLACE INTO split_proposals (card_id, question, slices, selected, asked_at, answered_at, consumed_at, created) VALUES \
(?, ?, ?, NULL, ?, NULL, NULL, '[]')",
        ).run(
          cardRow.id,
          groups[0]!.question,
          JSON.stringify(slices),
          Date.now(),
        );
      }
      // Standard questions at the split point read like split decisions
      // but execute nothing: host-append the consequence disclosure to
      // every group (live form and persisted expired rows carry it alike),
      // decided through the same shared gate on slug truth.
      if (tag !== "split") {
        const stdCard = getCard(cardRow.id);
        const stdStage = stdCard ? await cardStageSlug(stdCard) : null;
        if (
          stdCard &&
          splitEligibility({ kind: stdCard.kind, stage: stdStage }).ok
        ) {
          for (const group of groups)
            group.question = withStandardSplitDisclosure(group.question);
        }
      }
      updateCard(cardRow.id, { activity: "awaiting-answer" });
      // Baseline the questioned documents for staleness notices: what each
      // file contains and where its checkout stands, right now, before the
      // blocking wait begins. Advisory and fail-soft — never blocks asking.
      void snapshotQuestionEvidence(
        cardRow.id,
        groups.flatMap((group) => group.options),
      );
      let result: Awaited<ReturnType<typeof bb.ui.requestInput>>;
      let requestFailed = false;
      const askedAt = Date.now();
      // Single-question calls keep the single-question payload shape;
      // batches carry `questions`.
      const askInput = {
        threadId,
        rendererId: "stelow-question",
        title: batched
          ? `Stelow questions (${groups.length})`
          : "Stelow question",
        timeoutMs: Number(process.env.STELOW_ASK_TIMEOUT_MS ?? 60 * 60 * 1000),
        // BB 0.43 timeline rows: the pending label names the wait while the
        // form is open, and describeSubmission decides what the transcript
        // keeps (decisions only — BB never stores the payload or raw value).
        // Hosts that predate the fields ignore them; the wait is unchanged.
        presentation: {
          label: askTimelineLabels({ batched, count: groups.length }),
        },
        describeSubmission: (value: unknown) => describeAskSubmission(value),
      } as const;
      const first = groups[0]!;
      try {
        // Contract ids are host bookkeeping, not renderer input: strip
        // them so the interaction payload keeps its exact BB shape.
        const payloadGroups = groups.map((group) => ({
          question: group.question,
          multiple: group.multiple,
          kind: group.kind,
          options: group.options,
        }));
        result = batched
          ? await bb.ui.requestInput(
              { ...askInput, payload: { questions: payloadGroups } },
              { signal: ctx.signal },
            )
          : await bb.ui.requestInput(
              {
                ...askInput,
                payload: {
                  question: first.question,
                  multiple: first.multiple,
                  kind: first.kind,
                  options: first.options,
                },
              },
              { signal: ctx.signal },
            );
      } catch {
        // The request itself blew up mid-flight (e.g. dispose tore down the
        // call): same bucket as a transient cancel — never lose the question.
        requestFailed = true;
        result = { outcome: "cancelled", reason: "request-aborted" };
      } finally {
        // The ask call ended (answered, cancelled, or torn down): mark the
        // worker running again. Activity only — board position is owned by
        // the sync poll, the answer RPCs, and advance/moveCard, on both
        // tracks. See lib/card-question-state.
        updateCard(cardRow.id, askFinishedUpdates());
      } // Cancellation without an answer falls into two buckets. Transient
      // infrastructure reasons (timeout, plugin reload/restart, aborted
      // request) mean the user simply never answered: persist the question
      // exactly like a timeout so it stays answerable on the card and the
      // worker stops to wait. Explicit end states (user dismissed, thread
      // stopped/deleted) are returned as-is for the worker to interpret.
      const cancelReason =
        result.outcome === "cancelled" ? result.reason : null;
      const transientCancel =
        requestFailed ||
        classifyAskCancel(result.outcome, cancelReason) === "persist";
      if (transientCancel) {
        // The user never answered within the window. Keep awaiting-answer
        // activity on the card (same column, decision still outstanding)
        // and tell the agent to STOP and wait rather
        // than guessing. The answer, when it arrives via the card, is
        // delivered as a comment that resumes the thread.
        // The persist itself is guarded: a reload landing exactly here
        // closes the DB under us, and then honesty beats optimism — tell
        // the worker to re-ask ONCE next turn instead of waiting on a
        // question that was never recorded.
        let persisted = false;
        let persistError: string | null = null;
        // Two attempts: a concurrent writer (reconcile timer, sync poll)
        // can hold the lock briefly — SQLITE_BUSY is transient, not fatal.
        for (let attempt = 1; attempt <= 2 && !persisted; attempt++) {
          try {
            // A timed-out batch persists as one expired row per sub-question
            // so the card can answer them individually or all at once.
            const expiredAt =
              askedAt +
              Number(process.env.STELOW_ASK_TIMEOUT_MS ?? 60 * 60 * 1000);
            const insert = db.prepare(
              "INSERT OR REPLACE INTO expired_questions (id, card_id, thread_id, question, multiple, kind, locale, options, expired_at, answered) \
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            );
            db.transaction(() => {
              for (const group of groups) {
                insert.run(
                  randomId("qexp"),
                  cardRow.id,
                  threadId,
                  group.question,
                  group.multiple ? 1 : 0,
                  group.kind,
                  "en",
                  JSON.stringify(group.options),
                  expiredAt,
                  0,
                );
              }
            })();
            updateCard(cardRow.id, { activity: "awaiting-answer" });
            bb.realtime.publish("card-state", { cardId: cardRow.id });
            persisted = true;
          } catch (err) {
            persistError =
              err instanceof Error
                ? `${err.name}: ${err.message}`
                : String(err);
            bb.log.warn(
              `stelow ask persist attempt ${attempt}/2 failed (card ${cardRow.id}, thread ${threadId}): ${persistError}`,
            );
            if (isRetryablePersistError(persistError) && attempt === 1) {
              await new Promise((resolve) => setTimeout(resolve, 250));
            } else {
              break;
            }
          }
        }
        const elapsed = Math.round((Date.now() - askedAt) / 1e3);
        if (!persisted) {
          const whyPersistFailed = requestFailed
            ? "request failure"
            : `cancel reason "${cancelReason ?? "unknown"}"`;
          return {
            exitCode: 1,
            stdout: `The question could not be recorded (interrupted storage after ${whyPersistFailed}). STOP and wait: do NOT proceed with the workflow. \
On your next turn, if no pending question exists on the card, ask it ONCE more via bb stelow ask.`,
          };
        }
        const why = interruptionWhy(cancelReason, requestFailed, elapsed);
        return {
          exitCode: 1,
          stdout: `${why} STOP and wait: do NOT proceed with the workflow. The question is still pending on the card (same column, marked as waiting \
for your answer) and remains answerable. When the user answers it on the card, the answer is delivered here as a message and you \
may continue. If you are re-asked about this same question later, do not re-ask the user again — wait for the card answer.`,
        };
      }
      // The host records what the human approved on a split proposal — right
      // here for the blocking call, and in answerQuestions for card-side
      // answers. `bb stelow split` trusts this row, never a worker claim.
      if (tag === "split" && result.outcome === "submitted") {
        const value = record(result.value);
        const picked = array(value.answers).filter(
          (answer): answer is string => typeof answer === "string",
        );
        db.prepare(
          "UPDATE split_proposals SET selected = ?, answered_at = ? WHERE card_id = ? AND selected IS NULL",
        ).run(JSON.stringify(picked), Date.now(), cardRow.id);
      }
      // Point-of-use split guard: a STANDARD ask at triage/select records
      // an answer that executes nothing. If the worker meant to propose a
      // split, the tag must be on the ask — remind once, while re-asking
      // is still legal (the card hasn't advanced; the call just unblocked).
      if (tag !== "split" && result.outcome === "submitted") {
        const askCard = getCard(cardRow.id);
        // Same single-source gate, same slug truth: the reminder fires
        // exactly where a re-ask is still legal.
        const askStage = askCard ? await cardStageSlug(askCard) : null;
        if (
          askCard &&
          splitEligibility({ kind: askCard.kind, stage: askStage }).ok
        ) {
          return {
            exitCode: 0,
            stdout: `${JSON.stringify(result)}\nSplit check: recorded as STANDARD — its answer is text only and executes nothing. If this question \
proposes splitting the card, re-ask it now with --tag split --multiple plus exactly one --option "Keep as one card", then run \
bb stelow split after the answer (still at ${askStage}, still in time).`,
          };
        }
      }
      return {
        exitCode: result.outcome === "submitted" ? 0 : 1,
        stdout: JSON.stringify(result),
      };
    }
    if (argv[0] === "seed") {
      const flag = (name: string) => {
        const index = argv.indexOf(name);
        return index >= 0 ? argv[index + 1] : undefined;
      };
      const projectId = flag("--project") ?? ctx.projectId;
      const name = flag("--name");
      const intent = flag("--intent");
      if (!projectId || !name || !intent)
        return {
          exitCode: 2,
          stderr:
            "Usage: bb stelow seed --project <proj_id> --name <name> --intent <intent>",
        };
      // Card workers are pre-seeded at spawn with the card id as owner. A
      // seed from inside a card thread would mint a name-derived owner at
      // the project root — an orphan no card resolves back — so refuse with
      // the card's own state dir as the redirect (lib/card-seed-guard).
      const seedCard = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)
        : undefined;
      if (seedCard) {
        const seedWorkspace = await cardWorkspace(seedCard);
        const seedRoot =
          seedWorkspace?.path ?? (await projectRoot(bb, projectId));
        let seedStateDir: string | null = null;
        if (seedRoot && seedCard.dir_hash) {
          seedStateDir = await workflowStateDir(
            bb,
            seedRoot,
            seedCard.id,
            seedCard.dir_hash,
          );
        }
        return {
          exitCode: 1,
          stderr: cardWorkerSeedRefusal({
            cardName: seedCard.name,
            stateDirText: seedStateDir,
          }),
        };
      }
      const rootPath = await projectRoot(bb, projectId);
      if (!rootPath)
        return {
          exitCode: 1,
          stderr: "Project workspace path is unavailable.",
        };
      const result = await seedWorkflow(
        bb,
        rootPath,
        workflowIdForName(name),
        name,
        intent,
      );
      return result.error
        ? { exitCode: 1, stderr: result.error }
        : { exitCode: 0, stdout: result.statePath ?? "" };
    }
    if (argv[0] === "advance") {
      return executionAdvance.cli(argv, {
        threadId: ctx.threadId,
        projectId: ctx.projectId,
      });
    }
    if (argv[0] === "gap-scopes") {
      // Deterministic ESCALATED → scopes conversion (upstream criteria 9).
      // The worker classifies gaps; code creates the rework scopes so the
      // loop cannot be skipped by prose. Idempotent: gaps already linked
      // to an audit-gap scope are skipped. Refuses on registry failures —
      // creating scopes from misclassified rows would launder them.
      const args = argv.slice(1);
      let cardId = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)?.id
        : undefined;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--card") {
          cardId = args[i + 1];
          i++;
          continue;
        }
        return {
          exitCode: 2,
          stderr: "Usage: bb stelow gap-scopes [--card <card_id>]",
        };
      }
      if (!cardId)
        return {
          exitCode: 2,
          stderr:
            "No card in context (run from the worker thread or pass --card <card_id>).",
        };
      const card = getCard(cardId);
      if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
      if (isArchivedCard(card))
        return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
      if (card.kind !== "build")
        return {
          exitCode: 1,
          stderr:
            "gap-scopes runs on Build cards — research and explore have no scopes.",
        };
      const gapState = await critiqueGapState(card).catch(() => null);
      if (!gapState?.matched)
        return {
          exitCode: 1,
          stderr:
            "No execution critique found — write it first, then run gap-scopes.",
        };
      if (gapState.failures.length > 0)
        return { exitCode: 1, stderr: gapState.failures.join("\n") };
      if (gapState.escalated.length === 0)
        return {
          exitCode: 0,
          stdout: "No escalated gaps — nothing to convert.",
        };
      const workspace = await cardWorkspace(card).catch(() => null);
      const rootPath = workspace?.path ?? null;
      if (!rootPath)
        return { exitCode: 1, stderr: "Workspace path is unavailable." };
      const trackingPath = join(rootPath, "stelow.json");
      let trackingData: LooseRecord;
      try {
        trackingData = JSON.parse(
          readFileSync(trackingPath, "utf8"),
        ) as LooseRecord;
      } catch {
        return {
          exitCode: 1,
          stderr:
            "stelow.json is missing for the Stelow workflow. Reseed the workflow.",
        };
      }
      const workflows = array(trackingData.workflows);
      const entry = workflowEntryForOwner(
        workflows,
        card.id,
      ) as LooseRecord | null;
      if (!entry)
        return {
          exitCode: 1,
          stderr: "No workflow entry owns this card. Reseed the workflow.",
        };
      const scopes = array(entry.scopes);
      const linked = new Set(
        gapState.auditGapScopes
          .map((scope) => scope.gap)
          .filter((gap): gap is string => typeof gap === "string"),
      );
      let maxId = 0;
      for (const scope of scopes) {
        const num = parseInt(
          String(record(scope).id ?? "").replace("scope-", ""),
          10,
        );
        if (Number.isFinite(num) && num > maxId) maxId = num;
      }
      const created: string[] = [];
      for (const gap of gapState.escalated) {
        if (linked.has(gap.description)) continue;
        maxId++;
        scopes.push({
          id: `scope-${maxId}`,
          name: gap.description.slice(0, 80),
          type: "feature",
          status: "pending",
          source: "audit-gap",
          gap: gap.description,
          tasks: [],
        });
        created.push(`scope-${maxId}: ${gap.description.slice(0, 80)}`);
      }
      if (created.length === 0)
        return {
          exitCode: 0,
          stdout:
            "Every escalated gap already links a rework scope — nothing to convert.",
        };
      entry.scopes = scopes;
      entry.updated = new Date().toISOString();
      try {
        writeFileSync(
          trackingPath,
          JSON.stringify(trackingData, null, 2),
          "utf8",
        );
      } catch {
        return {
          exitCode: 1,
          stderr: "Could not write stelow.json — retry gap-scopes.",
        };
      }
      try {
        recordTrackableEvent(db, {
          cardId,
          kind: "scope",
          trackableId: "audit-gap",
          transition: "rework-created",
          actor: "host",
          evidence: `${created.length} rework scope(s): ${created.map((line) => line.split(":")[0]).join(", ")}`,
        });
      } catch {
        /* trail never blocks */
      }
      // Rework scopes appear on the card immediately, not at the next
      // lifecycle event.
      bb.realtime.publish("card-state", { cardId });
      bb.realtime.publish("board-changed", { cardId });
      logCardComment(
        cardId,
        "card",
        cardId,
        "agent",
        `Gap-to-scope decision: ${gapState.totals.fixed} fixed inline, ${gapState.totals.documented} documented for next cycle, ${gapState.escalated.length} \
escalated — ${created.length} new rework scope(s):\n${created.map((line) => `- ${line}`).join("\n")}\nThe card loops back: advance \
to execution, execute the rework scopes, re-run the critique, then run done again.`,
      );
      return {
        exitCode: 0,
        stdout: `Decision recorded: ${gapState.totals.fixed} fixed, ${gapState.totals.documented} documented, ${gapState.escalated.length} escalated.\nCreated \
${created.length} rework scope(s):\n${created.map((line) => `- ${line}`).join("\n")}\nLoop back now: bb stelow advance execution \
— execute the new scopes, re-run the critique, then run done again.`,
      };
    }
    if (argv[0] === "metrics") {
      // Lead/cycle-time and gap-rate readout from the stage-event ledger
      // plus the live gap registry. Read-only: never writes, never blocks.
      // No --card means the fleet: every non-archived Build card aggregated.
      const args = argv.slice(1);
      const json = args.includes("--json");
      let cardId = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)?.id
        : undefined;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--card") {
          cardId = args[i + 1];
          i++;
          continue;
        }
        if (args[i] === "--json") continue;
        return {
          exitCode: 2,
          stderr: "Usage: bb stelow metrics [--json] [--card <card_id>]",
        };
      }
      if (!cardId && !args.includes("--card")) {
        const rows = db
          .prepare(
            "SELECT * FROM cards WHERE kind = 'build' AND status != 'archived'",
          )
          .all() as CardRow[];
        if (rows.length === 0)
          return { exitCode: 0, stdout: "No Build cards to aggregate." };
        let gaps = 0;
        let escalated = 0;
        let leadSum = 0;
        let leadCount = 0;
        let cycleSum = 0;
        let cycleCount = 0;
        let doneCount = 0;
        const perCard: Array<{
          card: string;
          name: string;
          done: boolean;
          gaps: number;
          escalated: number;
        }> = [];
        for (const row of rows) {
          try {
            const events = stageEvents(row.id);
            const doneEvent =
              [...events].reverse().find((event) => event.stage === "done") ??
              null;
            const timeline = summarizeTimeline(events, {
              createdAt: row.created_at,
              endAt: doneEvent ? doneEvent.entered_at : now(),
            });
            leadSum += timeline.leadMs;
            leadCount++;
            if (timeline.cycleMs !== null) {
              cycleSum += timeline.cycleMs;
              cycleCount++;
            }
            if (row.status === "completed") doneCount++;
            const gapState = await critiqueGapState(row).catch(() => null);
            const cardGaps = gapState?.matched ? gapState.totals.total : 0;
            const cardEscalated = gapState?.matched
              ? gapState.totals.escalated
              : 0;
            gaps += cardGaps;
            escalated += cardEscalated;
            perCard.push({
              card: row.id,
              name: row.name,
              done: row.status === "completed",
              gaps: cardGaps,
              escalated: cardEscalated,
            });
          } catch {
            /* one unreadable card never breaks the fleet readout */
          }
        }
        const payload = {
          cards: rows.length,
          done: doneCount,
          avgLeadMs: leadCount > 0 ? Math.round(leadSum / leadCount) : null,
          avgCycleMs: cycleCount > 0 ? Math.round(cycleSum / cycleCount) : null,
          gaps,
          escalated,
          escalatedRate: gaps > 0 ? escalated / gaps : null,
          perCard,
        };
        if (json)
          return { exitCode: 0, stdout: JSON.stringify(payload, null, 2) };
        const rate =
          payload.escalatedRate === null
            ? "n/a"
            : `${Math.round(payload.escalatedRate * 100)}%`;
        const lines = [
          `Fleet: ${rows.length} Build cards (${doneCount} done)`,
          `Avg lead time: ${
            payload.avgLeadMs === null ? "n/a" : formatDuration(payload.avgLeadMs)
          } · avg cycle time: ${
            payload.avgCycleMs === null ? "n/a" : formatDuration(payload.avgCycleMs)
          }`,
          `Gaps: ${gaps} total · ${escalated} escalated (${rate} escalated)`,
          ...perCard.map(
            (entry) =>
              `- ${entry.name}: ${entry.gaps} gaps · ${entry.escalated} escalated${entry.done ? " · done" : ""}`,
          ),
        ];
        return { exitCode: 0, stdout: lines.join("\n") };
      }
      if (!cardId)
        return {
          exitCode: 2,
          stderr:
            "No card in context (run from the worker thread or pass --card <card_id>).",
        };
      const card = getCard(cardId);
      if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
      const events = stageEvents(cardId);
      const doneEvent =
        [...events].reverse().find((event) => event.stage === "done") ?? null;
      const endAt = doneEvent ? doneEvent.entered_at : now();
      const timeline = summarizeTimeline(events, {
        createdAt: card.created_at,
        endAt,
      });
      const gapState =
        card.kind === "build"
          ? await critiqueGapState(card).catch(() => null)
          : null;
      const totals = gapState?.matched
        ? gapState.totals
        : { total: 0, fixed: 0, documented: 0, escalated: 0 };
      const payload = {
        card: cardId,
        name: card.name,
        done: card.status === "completed",
        leadMs: timeline.leadMs,
        cycleMs: timeline.cycleMs,
        byStage: timeline.byStage,
        gaps: totals,
        escalatedRate:
          totals.total > 0 ? totals.escalated / totals.total : null,
        reworkScopes: gapState?.matched
          ? gapState.auditGapScopes.map((scope) => ({
              id: scope.id,
              name: scope.name,
              status: scope.status,
            }))
          : [],
      };
      if (json)
        return { exitCode: 0, stdout: JSON.stringify(payload, null, 2) };
      const lines = [
        `Card ${card.name} (${cardId})${payload.done ? " — done" : ""}`,
        `Lead time: ${formatDuration(timeline.leadMs)} (created → ${doneEvent ? "done" : "now"})`,
        `Cycle time: ${
          timeline.cycleMs === null
            ? "not started (never left triage)"
            : `${formatDuration(timeline.cycleMs)} (first advance → ${
                doneEvent ? "done" : "now"
              })`
        }`,
      ];
      if (timeline.byStage.length > 0) {
        lines.push("Stages:");
        for (const entry of timeline.byStage)
          lines.push(`- ${entry.stage}: ${formatDuration(entry.ms)}`);
      }
      if (gapState?.matched) {
        const rate =
          payload.escalatedRate === null
            ? "n/a"
            : `${Math.round(payload.escalatedRate * 100)}%`;
        lines.push(
          `Gaps: ${totals.total} total · ${totals.fixed} fixed · ${totals.documented} documented · ${totals.escalated} escalated (${rate} escalated)`,
        );
        lines.push(
          payload.reworkScopes.length > 0
            ? `Rework scopes: ${payload.reworkScopes.map((scope) => `${scope.id} (${scope.status})`).join(", ")}`
            : "Rework scopes: none",
        );
      }
      return { exitCode: 0, stdout: lines.join("\n") };
    }
    if (argv[0] === "storage") {
      // Worktree disk attribution (read-only): every worktree BB reports,
      // sized with du, attributed to cards by thread, heaviest first.
      // Unattributed rows still list — an invisible copy is the failure
      // this exists to prevent. Per-path timeout; unreadable reads unknown.
      const args = argv.slice(1);
      const json = args.includes("--json");
      let onlyCardId: string | undefined;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--card") {
          onlyCardId = args[i + 1];
          i++;
          continue;
        }
        if (args[i] === "--json") continue;
        return {
          exitCode: 2,
          stderr: "Usage: bb stelow storage [--json] [--card <card_id>]",
        };
      }
      const duBytes = (path: string): Promise<number | null> =>
        new Promise((resolveDu) => {
          execFile("du", ["-sb", path], { timeout: 8000 }, (error, stdout) => {
            if (error) return resolveDu(null);
            const match = /^\d+/.exec(String(stdout ?? ""));
            resolveDu(match ? Number.parseInt(match[0], 10) : null);
          });
        });
      const environments = await bb.sdk.environments
        .list()
        .then((result) => (Array.isArray(result) ? result : []))
        .catch(() => []);
      const rows: Array<{
        environmentId: string;
        path: string | null;
        bytes: number | null;
        branch: string | null;
        status: string;
        stale: boolean;
        cardId: string | null;
        cardName: string | null;
        projectId: string | null;
        kind: string | null;
        cardStatus: string | null;
        stage: string | null;
      }> = [];
      for (const raw of environments) {
        const env = (raw ?? {}) as {
          id?: unknown;
          path?: unknown;
          isWorktree?: unknown;
          branchName?: unknown;
          status?: unknown;
          lifecycle?: unknown;
        };
        if (typeof env.id !== "string" || env.isWorktree !== true) continue;
        const path = typeof env.path === "string" && env.path ? env.path : null;
        const bytes = path ? await duBytes(path).catch(() => null) : null;
        const threadId = threadIdFromWorktreePath(path);
        const owner = threadId ? workers.ledgerCardId(threadId) : null;
        const card = owner ? getCard(owner) : undefined;
        if (onlyCardId && (!card || card.id !== onlyCardId)) continue;
        rows.push({
          environmentId: env.id,
          path,
          bytes,
          branch: typeof env.branchName === "string" ? env.branchName : null,
          status: typeof env.status === "string" ? env.status : "unknown",
          stale: isStaleEnvironment(env),
          cardId: card?.id ?? null,
          cardName: card ? (card.display_name ?? card.name) : null,
          projectId: card?.project_id ?? null,
          kind: card?.kind ?? null,
          cardStatus: card?.status ?? null,
          stage: card?.stage ?? null,
        });
      }
      rows.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1));
      const total = rows.reduce((sum, row) => sum + (row.bytes ?? 0), 0);
      const unknown = rows.filter((row) => row.bytes === null).length;
      if (json)
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            {
              totalBytes: total,
              worktrees: rows.length,
              unreadable: unknown,
              rows,
            },
            null,
            2,
          ),
        };
      if (rows.length === 0)
        return { exitCode: 0, stdout: "No worktrees reported." };
      const lines = [
        `Worktrees: ${rows.length} using ${formatBytes(total) ?? "unknown"}${unknown > 0 ? ` (${unknown} unreadable)` : ""}`,
        ...rows.map((row) => {
          const size = formatBytes(row.bytes) ?? "unknown size";
          const who = row.cardId
            ? `${row.cardName} (${row.cardId}, ${row.kind}/${row.cardStatus}/${row.stage})`
            : "unattributed";
          const stale = row.stale ? " · stale" : "";
          return `- ${size} · ${who}${row.branch ? ` · ${row.branch}` : ""}${stale}\n  ${row.path ?? "no path"}`;
        }),
      ];
      return { exitCode: 0, stdout: lines.join("\n") };
    }
    if (argv[0] === "manifest") {
      // Commit-message trailer source, not a file attachment: git commits
      // cannot carry files and GitHub shows no git-notes, so the durable
      // audit link is a paste-ready Stelow-Artifacts trailer naming the
      // registered artifacts. Read-only: never writes, never blocks.
      const args = argv.slice(1);
      const json = args.includes("--json");
      let cardId = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)?.id
        : undefined;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--card") {
          cardId = args[i + 1];
          i++;
          continue;
        }
        if (args[i] === "--json") continue;
        return {
          exitCode: 2,
          stderr: "Usage: bb stelow manifest [--json] [--card <card_id>]",
        };
      }
      if (!cardId)
        return {
          exitCode: 2,
          stderr:
            "No card in context (run from the worker thread or pass --card <card_id>).",
        };
      const card = getCard(cardId);
      if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
      const workspace = await cardWorkspace(card).catch(() => null);
      const stateDir =
        workspace?.path && card.dir_hash
          ? await workflowStateDir(
              bb,
              workspace.path,
              card.id,
              card.dir_hash,
            ).catch(() => null)
          : null;
      const stateBlob = stateDir
        ? await bb.sdk.files
            .read({ path: join(stateDir, "state.md") })
            .then((file) => file.content)
            .catch(() => null)
        : null;
      const artifacts = stateBlob
        ? parseArtifactManifest(stateBlob)
            .filter(
              (fields) =>
                typeof fields.path === "string" && fields.path.length > 0,
            )
            .map((fields) => ({
              stage: fields.stage ?? null,
              kind: fields.kind ?? null,
              label: fields.label ?? null,
              path: fields.path,
            }))
        : [];
      const gapState =
        card.kind === "build"
          ? await critiqueGapState(card).catch(() => null)
          : null;
      const trailer = buildArtifactTrailer(
        cardId,
        artifacts,
        gapState?.matched ? gapState.totals : null,
      );
      const payload = {
        card: cardId,
        name: card.name,
        stage: card.stage,
        artifacts,
        trailer,
      };
      if (json)
        return { exitCode: 0, stdout: JSON.stringify(payload, null, 2) };
      const lines = [
        `Manifest for ${card.name} (${cardId}) — paste below the commit subject:`,
        ...trailer,
      ];
      return { exitCode: 0, stdout: lines.join("\n") };
    }
    // Shared run-bundle writer: `export` calls it on demand, `done` calls
    // it on every completion so docs/runs/<card>/ converges to the card's
    // current artifacts instead of rotting after the first manual export.
    // Idempotent: stable basenames, overwrite-in-place, manifest rewritten.
    type BundleCheck = {
      ok: true;
      check: true;
      dir: string;
      fresh: boolean;
      stale: Array<{
        name: string;
        stage: string | null;
        sha8: string;
        sourcePath: string;
        reason: string;
      }>;
      added: string[];
      missing: string[];
      committed: boolean | null;
    };
    type BundleWrite = {
      ok: true;
      check: false;
      dir: string;
      files: Array<{
        name: string;
        stage: string | null;
        sha8: string;
        sourcePath: string;
      }>;
      missing: string[];
      trailer: string[];
      wrote: boolean;
    };
    type BundleFailure = { ok: false; error: string };
    async function exportRunBundle(
      card: CardRow,
      opts: { checkOnly: true; dirRel?: string },
    ): Promise<BundleCheck | BundleFailure>;
    async function exportRunBundle(
      card: CardRow,
      opts?: { checkOnly?: false; dirRel?: string },
    ): Promise<BundleWrite | BundleFailure>;
    async function exportRunBundle(
      card: CardRow,
      opts?: { checkOnly?: boolean; dirRel?: string },
    ): Promise<BundleCheck | BundleWrite | BundleFailure> {
      const workspace = await cardWorkspace(card).catch(() => null);
      if (!workspace?.path)
        return {
          ok: false as const,
          error: "The card has no workspace to export into.",
        };
      const stateDir = card.dir_hash
        ? await workflowStateDir(
            bb,
            workspace.path,
            card.id,
            card.dir_hash,
          ).catch(() => null)
        : null;
      const stateBlob = stateDir
        ? await bb.sdk.files
            .read({ path: join(stateDir, "state.md") })
            .then((file) => file.content)
            .catch(() => null)
        : null;
      const registered = stateBlob
        ? parseArtifactManifest(stateBlob).filter(
            (fields) =>
              typeof fields.path === "string" && fields.path.length > 0,
          )
        : [];
      const targetRel = opts?.dirRel ?? `docs/runs/${card.id}`;
      const targetAbs = resolveArtifactPath(workspace.path, targetRel);
      if (!targetAbs)
        return {
          ok: false as const,
          error: `Refusing export dir "${targetRel}": relative path inside the workspace only.`,
        };
      const shaOf = (content: string) =>
        createHash("sha256").update(content).digest("hex").slice(0, 8);
      // Read current sources once: check and write both need content + SHA.
      const readable: Array<{
        stage: string | null;
        sourcePath: string;
        content: string;
        sha8: string;
      }> = [];
      const unreadable: string[] = [];
      for (const fields of registered) {
        const sourcePath = fields.path as string;
        const full = resolveArtifactPath(workspace.path, sourcePath);
        const content = full
          ? await bb.sdk.files
              .read({ path: full })
              .then((file) => file.content)
              .catch(() => null)
          : null;
        if (typeof content !== "string" || !content.trim()) {
          unreadable.push(sourcePath);
          continue;
        }
        readable.push({
          stage: fields.stage ?? null,
          sourcePath,
          content,
          sha8: shaOf(content),
        });
      }
      if (opts?.checkOnly) {
        const manifestContent = await bb.sdk.files
          .read({ path: join(targetAbs, "manifest.md") })
          .then((file) => file.content)
          .catch(() => null);
        const bundled =
          manifestContent === null ? [] : parseBundleManifest(manifestContent);
        const shaBySource = new Map(
          readable.map((entry) => [entry.sourcePath, entry.sha8]),
        );
        const stale = staleBundleEntries(bundled, shaBySource);
        const added = unbundledSources(registered, bundled);
        const drifted =
          stale.length > 0 || added.length > 0 || unreadable.length > 0;
        // Commit dimension (read-only): does the bundle dir match HEAD, or
        // is it sitting uncommitted? Null when there is nothing to compare
        // (no bundle yet) or no git repo to compare against — the bundle
        // then lives in the workspace only, and the report says so.
        let committed: boolean | null = null;
        if (manifestContent !== null) {
          const status = await runGitIn(workspace.path, ["status", "--porcelain", "--", targetRel])
            .catch(() => null);
          committed =
            status && status.ok ? status.stdout.trim().length === 0 : null;
        }
        return {
          ok: true as const,
          check: true as const,
          dir: targetRel,
          fresh: !drifted,
          stale,
          added,
          missing: unreadable,
          committed,
        };
      }
      // Nothing readable and no bundle yet: writing a manifest of only
      // missing entries would be noise — skip, and say so.
      if (readable.length === 0) {
        const priorManifest = await bb.sdk.files
          .read({ path: join(targetAbs, "manifest.md") })
          .then((file) => file.content)
          .catch(() => null);
        if (priorManifest === null) {
          return {
            ok: true as const,
            check: false as const,
            dir: targetRel,
            files: [],
            missing: [...unreadable],
            trailer: [],
            wrote: false as const,
          };
        }
      }
      try {
        await bb.sdk.files.mkdir({
          path: targetAbs,
          rootPath: workspace.path,
          recursive: true,
        });
      } catch {
        return {
          ok: false as const,
          error: `Could not create ${targetRel} — retry export.`,
        };
      }
      const planned = assignBundleNames(readable);
      const files: Array<{
        name: string;
        stage: string | null;
        sha8: string;
        sourcePath: string;
      }> = [];
      const missing = [...unreadable];
      for (const plan of planned) {
        const source = readable.find(
          (entry) => entry.sourcePath === plan.sourcePath,
        );
        if (!source) continue;
        try {
          await bb.sdk.files.write({
            path: join(targetAbs, plan.name),
            rootPath: workspace.path,
            expectedSha256: null,
            content: source.content,
          });
        } catch {
          missing.push(plan.sourcePath);
          continue;
        }
        files.push({
          name: plan.name,
          stage: plan.stage,
          sha8: source.sha8,
          sourcePath: plan.sourcePath,
        });
      }
      const gapState =
        card.kind === "build"
          ? await critiqueGapState(card).catch(() => null)
          : null;
      const gapTotals = gapState?.matched ? gapState.totals : null;
      // Token evidence joins the bundle: provider-reported splits across
      // the card's threads, summed once, committed with the run. Bounded
      // (20 latest threads) and fail-open — export never blocks on it.
      let exportTokens = null;
      try {
        const threadIds = workers.ledgerThreadIds(card.id, 20);
        const reports = await Promise.all(
          threadIds.map(async (threadId) => {
            try {
              const events = await bb.sdk.threads.events.list({
                threadId,
                types: ["thread/tokenUsage/updated"],
                order: "desc",
                limit: "1",
              });
              return tokenBreakdownFromEvents(events);
            } catch {
              return null;
            }
          }),
        );
        exportTokens = sumTokenBreakdowns(reports);
      } catch {
        exportTokens = null;
      }
      const manifest = renderBundleManifest({
        cardId: card.id,
        cardName: card.name,
        stage: card.stage,
        generatedAt: new Date().toISOString(),
        files,
        missing,
        gapTotals,
        tokens: exportTokens,
      });
      try {
        await bb.sdk.files.write({
          path: join(targetAbs, "manifest.md"),
          rootPath: workspace.path,
          expectedSha256: null,
          content: manifest,
        });
      } catch {
        return {
          ok: false as const,
          error: `Exported ${files.length} file(s) but could not write manifest.md — retry export.`,
        };
      }
      const trailer = buildArtifactTrailer(
        card.id,
        files.map((file) => ({ stage: file.stage, path: file.sourcePath })),
        gapTotals,
      );
      return {
        ok: true as const,
        check: false as const,
        dir: targetRel,
        files,
        missing,
        trailer,
        wrote: true as const,
      };
    }
    if (argv[0] === "export") {
      // On-demand bundle refresh plus drift check. `done` refreshes the
      // bundle automatically on every completion; --check reports
      // changed/missing/new sources without writing anything.
      // Idempotent: stable basenames, overwrite-in-place.
      const args = argv.slice(1);
      const json = args.includes("--json");
      const checkOnly = args.includes("--check");
      let cardId = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)?.id
        : undefined;
      let dirFlag: string | undefined;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--card") {
          cardId = args[i + 1];
          i++;
          continue;
        }
        if (args[i] === "--dir") {
          dirFlag = args[i + 1];
          i++;
          continue;
        }
        if (args[i] === "--json" || args[i] === "--check") continue;
        return {
          exitCode: 2,
          stderr:
            "Usage: bb stelow export [--json] [--check] [--card <card_id>] [--dir <relpath>]",
        };
      }
      if (!cardId)
        return {
          exitCode: 2,
          stderr:
            "No card in context (run from the worker thread or pass --card <card_id>).",
        };
      const card = getCard(cardId);
      if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
      const bundle = checkOnly
        ? await exportRunBundle(card, { checkOnly: true, dirRel: dirFlag })
        : await exportRunBundle(card, { dirRel: dirFlag });
      if (!bundle.ok) return { exitCode: 1, stderr: bundle.error };
      if (bundle.check) {
        const drift = [
          ...bundle.stale.map(
            (entry) => `${entry.sourcePath} (${entry.reason})`,
          ),
          ...bundle.added.map((sourcePath) => `${sourcePath} (new)`),
          ...bundle.missing.map((sourcePath) => `${sourcePath} (unreadable)`),
        ];
        const settled = bundle.fresh && bundle.committed !== false;
        if (bundle.committed === false)
          drift.push(
            `${bundle.dir}/ differs from HEAD — commit it with the work`,
          );
        if (json)
          return {
            exitCode: settled ? 0 : 1,
            stdout: JSON.stringify(
              {
                fresh: bundle.fresh,
                committed: bundle.committed,
                stale: bundle.stale,
                added: bundle.added,
                missing: bundle.missing,
              },
              null,
              2,
            ),
          };
        if (settled)
          return {
            exitCode: 0,
            stdout: `Bundle fresh: docs/runs matches every registered artifact.${
              bundle.committed === null
                ? " (no git repo — bundle lives in the workspace only)"
                : " (committed)"
            }`,
          };
        return {
          exitCode: 1,
          stderr: [
            `Bundle not settled — run \`bb stelow export\`, then commit:`,
            ...drift.map((line) => `- ${line}`),
          ].join("\n"),
        };
      }
      if (!bundle.wrote)
        return {
          exitCode: 0,
          stdout: `No registered artifacts — nothing to bundle.${
            bundle.missing.length > 0
              ? ` (${bundle.missing.length} registered but unreadable: ${
                  bundle.missing.join(", ")
                })`
              : ""
          }`,
        };
      const payload = {
        card: card.id,
        dir: bundle.dir,
        files: bundle.files,
        missing: bundle.missing,
        trailer: bundle.trailer,
      };
      if (json)
        return { exitCode: 0, stdout: JSON.stringify(payload, null, 2) };
      const lines = [
        `Exported ${bundle.files.length} artifact(s) to ${bundle.dir}/ (+ manifest.md)${
          bundle.missing.length > 0
            ? ` — ${bundle.missing.length} registered but unreadable: ${
                bundle.missing.join(", ")
              }`
            : ""
        }.`,
        `Commit the directory with the work, then paste below the commit subject:`, ...bundle.trailer,
      ];
      return { exitCode: 0, stdout: lines.join("\n") };
    }
    if (argv[0] === "done") {
      // Explicit completion commit. Done-ness was inferred from `audit` +
      // idle, so narrate-and-stop looked identical to stuck. The worker
      // declares done; the host verifies in code (lib/completion): build
      // only at `audit`, research/explore only with a passing `verify`
      // and no pending question. Every refusal names the fix.
      const args = argv.slice(1);
      let cardId = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)?.id
        : undefined;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--card") {
          cardId = args[i + 1];
          i++;
          continue;
        }
        return {
          exitCode: 2,
          stderr: "Usage: bb stelow done [--card <card_id>]",
        };
      }
      if (!cardId)
        return {
          exitCode: 2,
          stderr:
            "No card in context (run from the worker thread or pass --card <card_id>).",
        };
      const card = getCard(cardId);
      if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
      if (isArchivedCard(card))
        return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
      const pending = await fetchPendingQuestions(card.worker_thread_id).catch(
        () => [],
      );
      if (card.kind === "build") {
        if (card.workspace_kind === "exploratory") {
          return {
            exitCode: 1,
            stderr:
              "Build completion is blocked: this card runs in an exploratory workspace with no code project or Git history. Restart the work \
in the intended BB project; this card's state artifacts remain readable for reference.",
          };
        }
        const workspace = await cardWorkspace(card);
        const projectPath = workspace?.path ?? null;
        let currentStage = card.stage;
        let stateBlob: string | null = null;
        let doneStateDir: string | null = null;
        if (projectPath && card.dir_hash) {
          doneStateDir = await workflowStateDir(
            bb,
            projectPath,
            card.id,
            card.dir_hash,
          );
          stateBlob = doneStateDir
            ? await bb.sdk.files
                .read({ path: join(doneStateDir, "state.md") })
                .then((f) => f.content)
                .catch(() => null)
            : null;
          if (!stateBlob)
            return {
              exitCode: 1,
              stderr:
                "Workflow state ownership cannot be verified. Reseed this card; project-root state is intentionally ignored.",
            };
          currentStage =
            text(stateBlob.match(/current_stage:\s*(\S+)/m)?.[1]) || card.stage;
        }
        // Gates read tracked truth (mergePlanned: false): the read-time
        // planned-task merge is display-only, so pre-merge cards keep
        // completing while tracked checklists bind.
        const trackedScopes = projectPath
          ? loadCardScopes(projectPath, card.id, { mergePlanned: false })
          : [];
        const refusal = doneEligibility({
          kind: "build",
          stage: currentStage,
          questionPending: pending.length > 0,
          scopesOpen: trackedScopes,
        });
        if (refusal) return { exitCode: 1, stderr: refusal };
        // Invisible-scopes companion: audit with zero synced scopes but
        // scope blocks in spec-tech means execution ran untracked — done
        // must not certify it. Missing/unreadable specs fail open here;
        // thin specs are owned by the depth gate below.
        if (projectPath) {
          const specTech = latestSpecTech(projectPath, card.id);
          const specCounts = countScopeDialects(specTech?.content ?? null);
          // Gate order lives in lib/build-gates (first refusal wins).
          const doneRefusal = doneBuildGates({
            kind: "build",
            stage: currentStage,
            scopes: trackedScopes,
            specMachine: specCounts.machine,
            specHuman: specCounts.human,
            specContent: specTech?.content ?? null,
          });
          if (doneRefusal) return { exitCode: 1, stderr: doneRefusal };
        }
        const receiptContent = doneStateDir
          ? await bb.sdk.files
              .read({ path: join(doneStateDir, AUDIT_RECEIPT_FILE) })
              .then((file) => file.content)
              .catch(() => null)
          : null;
        const checkout = await cardCheckout(card);
        const gitEvidence = checkout?.path
          ? await recoveryGitEvidence(checkout.path)
          : null;
        if (
          checkout?.path &&
          (!gitEvidence?.isGit || !gitEvidence.gitRoot || !gitEvidence.headSha)
        ) {
          return {
            exitCode: 1,
            stderr:
              "Build completion is blocked: the execution checkout no longer has verifiable Git root and HEAD evidence. Restore the intended \
checkout, re-run audit, then run done.",
          };
        }
        // Recognized workflow documents (spec-product, spec-tech, interfaces,
        // testing-strategy, critique reports) must meet their stage contract
        // (lib/artifact-contracts): unknown files, audit.md, and receipts
        // never block — only a matched document that fails depth does.
        const shallow = await buildDocDepthsForCard(card).catch(() => []);
        if (shallow.length > 0) {
          return {
            exitCode: 1,
            stderr: shallow
              .map(
                (doc) =>
                  `FAIL ${doc.label} (${doc.path}): needs depth — ${doc.failures.join("; ")} — rewrite it, then run done again.`,
              )
              .join("\n"),
          };
        }
        // Gap-registry loop: a matched execution critique with escalate
        // rows must link every row to an audit-gap scope, and every linked
        // scope must be done — otherwise done would certify known rework
        // as complete. No matched critique means no enforcement.
        const gapState = await critiqueGapState(card).catch(() => null);
        if (gapState?.matched) {
          if (gapState.failures.length > 0) {
            return { exitCode: 1, stderr: gapState.failures.join("\n") };
          }
          const unscoped = gapState.escalated.filter(
            (gap) =>
              !gapState.auditGapScopes.some(
                (scope) => scope.gap === gap.description,
              ),
          );
          if (unscoped.length > 0) {
            return {
              exitCode: 1,
              stderr: `Build completion is blocked: ${unscoped.length} escalated gap(s) have no rework scope — this card is not done, it loops back: \
run \`bb stelow gap-scopes\`, \`bb stelow advance execution\`, execute the new scopes, re-run \
the critique, then run done again:\n${unscoped.map((gap) => `- ${gap.description}`).join("\n")}`,
            };
          }
          const pendingRework = gapState.auditGapScopes.filter(
            (scope) => !isDoneStatus(scope.status),
          );
          if (pendingRework.length > 0) {
            return {
              exitCode: 1,
              stderr: `Build completion is blocked: ${pendingRework.length} audit-gap rework \
scope(s) still open — finish them, then run done again:\n${
                pendingRework.map((scope) => `- ${scope.name} (${scope.status})`).join("\n")
              }`,
            };
          }
        }
        const verificationRun = db
          .prepare(
            "SELECT command, git_root, head_sha, exit_code FROM verification_runs WHERE card_id = ? ORDER BY created_at DESC LIMIT 1",
          )
          .get(cardId) as
          | {
              command: string;
              git_root: string;
              head_sha: string;
              exit_code: number;
            }
          | undefined;
        const verification = verificationReadiness(
          verificationRun,
          gitEvidence,
        );
        if (!verification.ready)
          return { exitCode: 1, stderr: verification.error };
        const receipt = auditReceiptReadiness(
          receiptContent,
          stateBlob ? parseArtifactManifest(stateBlob) : [],
          checkout?.path ?? null,
          gitEvidence,
          verificationRun,
        );
        if (!receipt.ready) return { exitCode: 1, stderr: receipt.error };
        // Stelow owns a portable, deterministic audit trail. Build it only
        // after the stricter BB receipt passes, so every Done card carries
        // the same cross-host lineage record as any other host. `--strict`
        // makes the receipt's links complete (a produced document that was
        // never registered would otherwise be missing from them), and the
        // gate re-binds the trail to the Git identity the receipt was
        // validated at: the helper samples the tree while writing, so a
        // checkout that moved after the receipt check fails here instead of
        // leaving Done with two receipts attesting different trees.
        const trail = await runHelper(
          ["audit-trail", "build", "--strict", "--json"],
          projectPath!,
          doneStateDir ?? undefined,
        );
        const trailCheck =
          trail.code === 0
            ? await runHelper(
                ["audit-trail", "check", "--strict", "--json"],
                projectPath!,
                doneStateDir ?? undefined,
              )
            : null;
        const trailGate = auditTrailGate({
          build: trail,
          check: trailCheck,
          verifiedGit: gitEvidence,
        });
        if (!trailGate.ready)
          return {
            exitCode: 1,
            stderr: trailGate.error ?? "Audit trail validation failed.",
          };
        // The audit receipt, portable trail, and final Done transition all
        // name one checkout. Sample once more immediately before the state
        // write so an external checkout or commit between `check` and Done
        // cannot leave a completed card pointing at stale evidence.
        const postTrailGitEvidence = checkout?.path
          ? await recoveryGitEvidence(checkout.path)
          : null;
        if (
          checkout?.path &&
          !sameGitEvidence(gitEvidence, postTrailGitEvidence)
        ) {
          return {
            exitCode: 1,
            stderr:
              "The checkout moved while the portable audit trail was being finalized. Re-run audit, then done.",
          };
        }
        const bundle = await exportRunBundle(card, {});
        if (!bundle.ok)
          return {
            exitCode: 1,
            stderr: `Build completion is blocked: run-bundle export failed (${bundle.error}) — retry done.`,
          };
        const reset = resetAutoContinue();
        updateCard(cardId, {
          status: "completed",
          activity: "idle",
          last_error: null,
          stage: currentStage,
          auto_continue_count: reset.count,
          auto_continue_stage: reset.stage,
        });
        recordStageEvent(cardId, "done");
        try {
          recordTrackableEvent(db, {
            cardId,
            kind: "build",
            trackableId: cardId,
            transition: "completed",
            actor: "host",
            evidence: `audit at ${currentStage}`,
          });
        } catch {
          /* trail never blocks */
        }
        await releaseCardClaimsAndNotify(cardId);
        return {
          exitCode: 0,
          stdout: bundle.wrote
            ? [
                `Done. Workflow "${card.name}" completed at audit.`,
                `Run bundle refreshed at ${bundle.dir}/ — commit it with the work, then paste below the commit subject:`,
                ...bundle.trailer,
              ].join("\n")
            : `Done. Workflow "${card.name}" completed at audit. No registered artifacts — nothing to bundle.`,
        };
      }
      if (card.kind === "research") {
        const refusal = doneEligibility({
          kind: "research",
          stage: null,
          questionPending: pending.length > 0,
        });
        if (refusal) return { exitCode: 1, stderr: refusal };
        const readiness = await researchReadiness(card).catch(() => null);
        if (!readiness)
          return {
            exitCode: 1,
            stderr: "Unable to read card state — retry done.",
          };
        const report = researchVerifyReport(
          cardId,
          strategyRounds(card).length,
          readiness.ready || readiness.invalid.length > 0,
          readiness.invalid,
          readiness.evidence,
        );
        if (!report.pass) {
          const textOut = researchVerifyText(report);
          return {
            exitCode: 1,
            stdout: textOut.stdout,
            stderr:
              textOut.stderr ||
              "verify failed — fix the rounds above, then run done again.",
          };
        }
        if (
          decisionApi.reviewPolicy().mode === "required" &&
          !(await passingReviewCovers(card, readiness.fingerprint).catch(
            () => false,
          ))
        ) {
          return {
            exitCode: 1,
            stderr:
              "Review policy is required: no passing review covers the current index — run `bb stelow review`, then run done again. (Enable only \
with a reviewer you trust on adversarial spot-checks; see docs/phase6-independent-review-plan.md.)",
          };
        }
        const researchBundle = await exportRunBundle(card, {});
        if (!researchBundle.ok)
          return {
            exitCode: 1,
            stderr: `Research completion is blocked: run-bundle export failed (${researchBundle.error}) — retry done.`,
          };
        const reset = resetAutoContinue();
        updateCard(cardId, {
          status: "completed",
          activity: "idle",
          last_error: null,
          auto_continue_count: reset.count,
          auto_continue_stage: reset.stage,
        });
        recordStageEvent(cardId, "done");
        await releaseCardClaimsAndNotify(cardId);
        const doneCurrent = getCard(cardId);
        const doneHypothesisSuffix =
          readiness.evidence === "hypothesis-only"
            ? " Marked hypothesis-only: web research was unavailable — requires human validation."
            : "";
        if (doneCurrent)
          recordInboxEvent(
            doneCurrent,
            "completed",
            `Research complete — results ready to review in Done.${doneHypothesisSuffix}`,
            `completed:${cardId}:index:${readiness.fingerprint ?? "ready"}`,
            now(),
          );
        return {
          exitCode: 0,
          stdout: researchBundle.wrote
            ? [
                `Done. Research "${card.name}" completed.`,
                `Run bundle refreshed at ${researchBundle.dir}/ — commit it with the work, then paste below the commit subject:`,
                ...researchBundle.trailer,
              ].join("\n")
            : `Done. Research "${card.name}" completed. No registered artifacts — nothing to bundle.`,
        };
      }
      if (card.kind === "explore") {
        const refusal = doneEligibility({
          kind: "explore",
          stage: null,
          questionPending: pending.length > 0,
        });
        if (refusal) return { exitCode: 1, stderr: refusal };
        const artifact = await exploreArtifact(card).catch(() => ({
          ready: false as const,
          fingerprint: null as string | null,
          failures: [] as string[],
        }));
        const report = exploreVerifyReport(
          cardId,
          card.explore_stage,
          artifact.ready,
          artifact.failures,
        );
        if (!report.pass) {
          const textOut = exploreVerifyText(report);
          return {
            exitCode: 1,
            stdout: textOut.stdout,
            stderr:
              textOut.stderr ||
              "verify failed — fix the artifact above, then run done again.",
          };
        }
        if (
          decisionApi.reviewPolicy().mode === "required" &&
          !(await passingReviewCovers(card, artifact.fingerprint).catch(
            () => false,
          ))
        ) {
          return {
            exitCode: 1,
            stderr:
              "Review policy is required: no passing review covers the current artifact — run `bb stelow review`, then run done again. (Enable \
only with a reviewer you trust on adversarial spot-checks; see docs/phase6-independent-review-plan.md.)",
          };
        }
        const exploreBundle = await exportRunBundle(card, {});
        if (!exploreBundle.ok)
          return {
            exitCode: 1,
            stderr: `Exploration completion is blocked: run-bundle export failed (${exploreBundle.error}) — retry done.`,
          };
        const reset = resetAutoContinue();
        updateCard(cardId, {
          status: "completed",
          activity: "idle",
          last_error: null,
          auto_continue_count: reset.count,
          auto_continue_stage: reset.stage,
        });
        recordStageEvent(cardId, "done");
        await releaseCardClaimsAndNotify(cardId);
        const doneCurrent = getCard(cardId);
        if (doneCurrent)
          recordInboxEvent(
            doneCurrent,
            "completed",
            "Exploration complete — result ready to review in Done.",
            `explore-completed:${cardId}:${artifact.fingerprint ?? "ready"}`,
            now(),
          );
        return {
          exitCode: 0,
          stdout: exploreBundle.wrote
            ? [
                `Done. Exploration "${card.name}" completed.`,
                `Run bundle refreshed at ${exploreBundle.dir}/ — commit it with the work, then paste below the commit subject:`,
                ...exploreBundle.trailer,
              ].join("\n")
            : `Done. Exploration "${card.name}" completed. No registered artifacts — nothing to bundle.`,
        };
      }
      return {
        exitCode: 1,
        stderr: `Unknown card kind "${card.kind}". Archive this card and start a new one.`,
      };
    }
    if (argv[0] === "split") {
      // No content args by design (lib/split-proposal): the host executes
      // the recorded, human-approved proposal from `ask --tag split`. A
      // worker-supplied slice list would be self-dealing — creation is a
      // host act behind a human gate, so the only input is which card.
      const args = argv.slice(1);
      let cardId = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)?.id
        : undefined;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--card") {
          cardId = args[i + 1];
          i++;
          continue;
        }
        return {
          exitCode: 2,
          stderr: "Usage: bb stelow split [--card <card_id>]",
        };
      }
      if (!cardId)
        return {
          exitCode: 2,
          stderr:
            "No card in context (run from the worker thread or pass --card <card_id>).",
        };
      const card = getCard(cardId);
      if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
      if (isArchivedCard(card))
        return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
      // Same single-source gate as the ask path: slug truth, one error copy.
      const splitGate = splitEligibility({
        kind: card.kind,
        stage: await cardStageSlug(card),
      });
      if (!splitGate.ok) return { exitCode: 1, stderr: splitGate.error! };
      const proposal = db
        .prepare(
          "SELECT slices, selected, asked_at, consumed_at, created FROM split_proposals WHERE card_id = ?",
        )
        .get(cardId) as
        | {
            slices: string;
            selected: string | null;
            asked_at: number;
            consumed_at: number | null;
            created: string;
          }
        | undefined;
      if (!proposal)
        return {
          exitCode: 1,
          stderr:
            'No split proposal on this card. Open one first at triage: `bb stelow ask --tag split --multiple --question <text> --option <card> \
--desc <slice>...` plus exactly one `--option "Keep as one card"`.',
        };
      if (proposal.consumed_at)
        return {
          exitCode: 1,
          stderr:
            "This card already split — see its comments for the children. Splitting twice would duplicate them.",
        };
      const existingChildren = db
        .prepare("SELECT id FROM cards WHERE split_from = ?")
        .all(cardId) as Array<{ id: string }>;
      if (existingChildren.length > 0)
        return {
          exitCode: 1,
          stderr: `This card already split into ${existingChildren.length} ${existingChildren.length === 1 ? "card" : "cards"} — see its comments. \
Splitting twice would duplicate them.`,
        };
      if (!proposal.selected)
        return {
          exitCode: 1,
          stderr:
            "The split proposal is not answered yet. Wait for the card answer, then run split again.",
        };
      if (Date.now() - proposal.asked_at > SPLIT_PROPOSAL_TTL_MS)
        return {
          exitCode: 1,
          stderr:
            "The split approval is older than 24h — re-ask at the current stage instead of executing a stale one.",
        };
      const slices = JSON.parse(proposal.slices) as Array<{
        title: string;
        desc: string;
      }>;
      const selected = JSON.parse(proposal.selected) as string[];
      const outcome = splitOutcome(slices, selected);
      if (outcome.action === "keep")
        return {
          exitCode: 1,
          stderr:
            "The user chose to keep one card — no split. Continue this workflow normally past triage.",
        };
      if (outcome.action === "refuse")
        return { exitCode: 1, stderr: outcome.reason };
      // Retry after a partial failure skips slices already created (recorded
      // below before reporting), so a retry never duplicates a child.
      const createdSoFar = JSON.parse(proposal.created || "[]") as Array<{
        slice: string;
        cardId: string;
      }>;
      const createdKeys = new Set(
        createdSoFar.map((entry) => entry.slice.trim().toLowerCase()),
      );
      const todo = outcome.approved.filter(
        (slice) => !createdKeys.has(text(slice.title).trim().toLowerCase()),
      );
      const created: Array<{ slice: string; cardId: string }> = [
        ...createdSoFar,
      ];
      let failure: string | null = null;
      // A Build split needs the same codebase as its parent. An exploratory
      // workspace contains only Stelow state, so fanning out there creates
      // cards that can claim a refactor without ever seeing the repository.
      // Refuse before creating even one child; Research/Explore are the
      // deliberate tracks for personal, document-only work.
      if (card.workspace_kind === "exploratory") {
        return {
          exitCode: 1,
          stderr:
            "Cannot split a Build workflow from an exploratory workspace: it has no code project or Git history. Turn the work into a BB project \
(or restart it in the intended project), then propose the split again.",
        };
      }
      // Children inherit the parent's project and appetite — the user chose
      // them for this work and they must share its source workspace.
      const targetProjectId = card.project_id;
      const parentStateDir = card.dir_hash
        ? await cardWorkspace(card)
            .then((workspace) =>
              workspace?.path
                ? workflowStateDir(bb, workspace.path, card.id, card.dir_hash!)
                : null,
            )
            .catch(() => null)
        : null;
      const parentStateAbs = parentStateDir
        ? join(parentStateDir, "state.md")
        : null;
      let parentAppetite = "Lean";
      let parentReviewGates: string[] = [];
      if (parentStateAbs) {
        const blob = await bb.sdk.files
          .read({ path: parentStateAbs })
          .then((file) => file.content)
          .catch(() => null);
        // Shared parser: the indented `config:` block with whole,
        // untruncated values (a bare `(\S+)` once degraded
        // "Product Spec + …" to "Product" on live children). Children
        // inherit the parent's gate set, not just its ladder label.
        if (typeof blob === "string") {
          const parsed = parseWorkflowConfig(blob);
          parentAppetite = parsed.appetite;
          parentReviewGates = parsed.reviewGates;
        }
      }
      for (const slice of todo) {
        const title = text(slice.title);
        const desc = text(slice.desc);
        try {
          const spawned = await createCardInternal({
            projectId: targetProjectId,
            prompt: `${title}\n\nSplit from "${card.display_name ?? card.name}" (triage proposed ${slices.length}, approved ${outcome.approved.length}). \
This card owns ONLY this slice — ignore everything else from the parent request:\n${desc}\n\nParent triage context: ${parentStateAbs ?? "unavailable"} \
— read its triage notes, nothing else. Classify intent first, then work it through the normal build workflow.`,
            attachments: cardAttachments(card.attachments).map(
              (attachment) => ({
                type: attachment.type,
                path: attachment.path,
              }),
            ),
            intent: "unknown",
            appetite: parentAppetite,
            reviewMode: parentReviewGates,
            kind: "build",
          });
          db.prepare("UPDATE cards SET split_from = ? WHERE id = ?").run(
            cardId,
            spawned.cardId,
          );
          logCardComment(
            spawned.cardId,
            "card",
            spawned.cardId,
            "agent",
            `Split from "${card.display_name ?? card.name}" (${cardId}): this card owns "${title}".`,
          );
          created.push({ slice: title, cardId: spawned.cardId });
        } catch (error) {
          failure =
            error instanceof Error
              ? error.message
              : "Could not spawn a build card.";
          break;
        }
      }
      // Persist exactly the successfully spawned children before reporting
      // a partial failure, so retrying skips them instead of duplicating.
      db.prepare(
        "UPDATE split_proposals SET created = ? WHERE card_id = ?",
      ).run(JSON.stringify(created), cardId);
      if (created.length > 0) {
        logCardComment(
          cardId,
          "card",
          cardId,
          "agent",
          `Split into ${created.length} ${created.length === 1 ? "build card" : "build cards"}: ${created.map((entry) => entry.slice).join("; ")}.`,
        );
      }
      bb.realtime.publish("card-state", { cardId });
      bb.realtime.publish("board-changed", { cardId });
      if (failure) {
        const prefix =
          created.length > 0
            ? `Created ${created.length} ${created.length === 1 ? "build card" : "build cards"} before the remaining slices could not be created. `
            : "";
        return {
          exitCode: 1,
          stdout: `${prefix}Run split again to retry the rest.`,
          stderr: `${prefix}${failure}`,
        };
      }
      // Full approval consumes the proposal; a remainder keeps the parent
      // alive narrowed to it, otherwise the parent's whole content moved
      // and it archives with the trail above.
      db.prepare(
        "UPDATE split_proposals SET consumed_at = ? WHERE card_id = ?",
      ).run(Date.now(), cardId);
      const { remaining, archiveParent } = splitRemainder(
        slices,
        outcome.approved,
      );
      if (archiveParent) {
        // Full split parks the parent just like an Archive button or a
        // drag to Archived. The command's stdout is guidance, not a
        // lifecycle guarantee: end its worker here so it cannot consume a
        // turn after its card has disappeared from active work.
        await workers.stop(card.worker_thread_id);
        updateCard(cardId, { status: "archived", activity: "idle" });
        return {
          exitCode: 0,
          stdout: `Split into ${created.length} build ${created.length === 1 ? "card" : "cards"}: ${created.map((entry) => entry.slice).join("; ")}. \
The parent card is archived — stop: your workflow ends here.`,
        };
      }
      return {
        exitCode: 0,
        stdout: `Split into ${created.length} build ${created.length === 1 ? "card" : "cards"}: ${created.map((entry) => entry.slice).join("; ")}. \
The parent keeps the remainder (${remaining.map((slice) => text(slice.title)).join("; ")}) — continue it narrowed to that.`,
      };
    }
    if (argv[0] === "sync-scopes") {
      const args = argv.slice(1);
      const flag = (name: string) => {
        const index = args.indexOf(name);
        return index >= 0 ? args[index + 1] : undefined;
      };
      const projectId = flag("--project") ?? ctx.projectId;
      const passthrough: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--project") {
          i++;
          continue;
        }
        if (args[i] === "--name" || args[i] === "--json") {
          passthrough.push(args[i]!);
          if (args[i] === "--name") {
            passthrough.push(args[i + 1] ?? "");
            i++;
          }
          continue;
        }
        return {
          exitCode: 2,
          stderr:
            "Usage: bb stelow sync-scopes [--project <proj_id>] [--name <workflow>] [--json]",
        };
      }
      const cliCard = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)
        : undefined;
      const workspace = cliCard ? await cardWorkspace(cliCard) : null;
      const rootPath =
        workspace?.path ?? (await projectRoot(bb, projectId ?? null));
      if (!rootPath)
        return { exitCode: 1, stderr: "Workspace path is unavailable." };
      const stateDir = cliCard?.dir_hash
        ? await workflowStateDir(bb, rootPath, cliCard.id, cliCard.dir_hash)
        : null;
      const guard = await ensureProjectArtifacts(
        bb,
        rootPath,
        stateDir,
        Boolean(cliCard?.dir_hash),
      );
      if (guard) return { exitCode: 1, stderr: guard };
      const result = await runHelper(
        ["sync-scopes", ...passthrough],
        rootPath,
        stateDir ?? undefined,
      );
      if (result.code !== 0)
        return {
          exitCode: 1,
          stderr: result.stderr || "sync-scopes failed",
          stdout: result.stdout,
        };
      // Tracking edits are file writes the host cannot watch, so the
      // sync doubles as the refresh signal: the executor runs it after
      // appending discovered tasks or flipping task status, and this
      // publish makes the card reload (ScopeProgress, list, counts)
      // instead of waiting for the next lifecycle event.
      if (cliCard) {
        bb.realtime.publish("card-state", { cardId: cliCard.id });
        bb.realtime.publish("board-changed", { cardId: cliCard.id });
      }
      return { exitCode: 0, stdout: result.stdout };
    }
    if (argv[0] === "scope") {
      return runScopeCommand(argv, ctx, {
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
      });
    }
    if (argv[0] === "lock") {
      const args = argv.slice(1);
      const op = args[0];
      if (op !== "acquire" && op !== "release" && op !== "check") {
        return {
          exitCode: 2,
          stderr:
            "Usage: bb stelow lock <acquire|release|check> [--project <proj_id>] --scope <id> [--file <f>...] [--ttl N] [--json]",
        };
      }
      const rest: string[] = [];
      let projectId: string | null = ctx.projectId ?? null;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--project") {
          projectId = args[i + 1] ?? null;
          i++;
          continue;
        }
        if (
          args[i] === "--scope" ||
          args[i] === "--file" ||
          args[i] === "--ttl" ||
          args[i] === "--json"
        ) {
          rest.push(args[i]!);
          if (args[i] !== "--json") {
            rest.push(args[i + 1] ?? "");
            i++;
          }
          continue;
        }
        if (!args[i]!.startsWith("--")) {
          rest.push(args[i]!);
          continue;
        }
        return {
          exitCode: 2,
          stderr:
            "Usage: bb stelow lock <acquire|release|check> [--project <proj_id>] --scope <id> [--file <f>...] [--ttl N] [--json]",
        };
      }
      const cliCard = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)
        : undefined;
      const workspace = cliCard ? await cardWorkspace(cliCard) : null;
      const rootPath = workspace?.path ?? (await projectRoot(bb, projectId));
      if (!rootPath)
        return { exitCode: 1, stderr: "Workspace path is unavailable." };
      const stateDir = cliCard?.dir_hash
        ? await workflowStateDir(bb, rootPath, cliCard.id, cliCard.dir_hash)
        : null;
      const guard = await ensureProjectArtifacts(
        bb,
        rootPath,
        stateDir,
        Boolean(cliCard?.dir_hash),
      );
      if (guard) return { exitCode: 1, stderr: guard };
      // Helper exit codes are meaningful here (1 = lock conflict): pass through.
      const result = await runHelper(["lock", op, ...rest], rootPath, stateDir ?? undefined);
      // Workspace-level claim registry (lib/card-claims): the helper lock
      // is per-card (invisible to sibling cards); the registry below is
      // keyed by the checkout the worker actually writes to
      // (lib/card-claim-key), so cards isolated in their own worktrees do
      // not falsely serialize. Host/UI callers without a card context keep
      // the helper behavior unchanged.
      // State dir and helper cwd stay on the source: state ≠ execution.
      const claimRoot =
        cliCard && rootPath
          ? (resolveClaimKey({ checkoutPath: (await cardCheckout(cliCard).catch(() => null))?.path ?? null,
              sourcePath: rootPath,
            }) ?? rootPath)
          : rootPath;
      if (cliCard && claimRoot) {
        const scopeIndex = rest.indexOf("--scope");
        const claimScope =
          scopeIndex >= 0 ? (rest[scopeIndex + 1] ?? null) : null;
        const claimFiles: string[] = [];
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === "--file" && rest[i + 1]) {
            claimFiles.push(rest[i + 1]!);
            i++;
          } else if (
            !rest[i]!.startsWith("--") &&
            rest[i - 1] !== "--scope" &&
            rest[i - 1] !== "--ttl"
          )
            claimFiles.push(rest[i]!);
        }
        const at = now();
        if (op === "acquire") {
          let outcome: {
            acquired: Array<{ file: string; fencing: number }>;
            renewed: Array<{ file: string }>;
            stolen: Array<{
              file: string;
              previousHolder: string;
              fencing: number;
            }>;
            conflicts: Array<{
              file: string;
              heldBy: string;
              heldScope: string | null;
              expiresAt: number;
            }>;
          } | null = null;
          try {
            outcome = acquireWorkspaceClaims(db, {
              cardId: cliCard.id,
              workspacePath: claimRoot,
              files: claimFiles,
              scope: claimScope,
              ttlMs: CLAIM_TTL_MS,
              nowMs: at,
            });
          } catch {
            /* advisory: helper lock already decided */
          }
          if (outcome) {
            for (const steal of outcome.stolen) {
              logCardComment(
                cliCard.id,
                "card",
                cliCard.id,
                "agent",
                `Stole expired workspace claim on ${steal.file} (previous holder card ${steal.previousHolder}) — its lease lapsed, so work continues; \
the previous holder re-acquires if still live.`,
              );
            }
            // Claims left by terminal/gone cards are dead weight: reap and
            // re-acquire instead of parking a live card behind a ghost.
            const dead = outcome.conflicts.filter((entry) => {
              const holder = getCard(entry.heldBy);
              return !holder || isClaimTerminal(holder.status);
            });
            if (dead.length > 0) {
              try {
                const del = db.prepare(
                  "DELETE FROM card_claims WHERE workspace_path = ? AND file_path = ? AND card_id = ?",
                );
                for (const entry of dead)
                  del.run(claimRoot, entry.file, entry.heldBy);
                outcome = acquireWorkspaceClaims(db, {
                  cardId: cliCard.id,
                  workspacePath: claimRoot,
                  files: claimFiles,
                  scope: claimScope,
                  ttlMs: CLAIM_TTL_MS,
                  nowMs: at,
                });
              } catch {
                /* advisory */
              }
            }
            const live = outcome.conflicts.filter((entry) => {
              const holder = getCard(entry.heldBy);
              return holder !== undefined && !isClaimTerminal(holder.status);
            });
            if (live.length > 0) {
              try {
                addClaimWaiters(db, {
                  cardId: cliCard.id,
                  workspacePath: claimRoot,
                  files: live.map((entry) => entry.file),
                  scope: claimScope,
                  nowMs: at,
                });
              } catch {
                /* advisory */
              }
              for (const entry of live) {
                const holder = getCard(entry.heldBy);
                recordInboxEvent(
                  cliCard,
                  "paused",
                  lockBlockedSummary(
                    entry.file,
                    holder?.display_name ?? holder?.name ?? entry.heldBy,
                    entry.expiresAt,
                  ),
                  `lock-blocked:${cliCard.id}:${entry.file}`,
                  at,
                );
              }
              const lines = live.map((entry) => {
                const holder = getCard(entry.heldBy);
                const heldBy = holder?.display_name ?? holder?.name ?? entry.heldBy;
                const expiresAt = new Date(entry.expiresAt).toISOString();
                return `BB-LOCK-BLOCKED file=${entry.file} heldBy=${heldBy} expiresAt=${expiresAt}`;
              });
              const retryGuidance = "do not retry in a loop";
              const stderr = [
                lines.join("\n"),
                `Park this scope and work an independent one (or wait for the host nudge) — ${retryGuidance}.`,
                "The host resumes this card when the file frees.",
                ...(result.stderr ? [result.stderr] : []),
              ].join("\n");
              return { exitCode: 1, stdout: result.stdout, stderr };
            }
          }
        } else if (op === "release") {
          let released: Array<{ workspacePath: string; file: string }> = [];
          try {
            released = releaseWorkspaceClaims(db, {
              cardId: cliCard.id,
              workspacePath: claimRoot,
              files: claimFiles,
            });
          } catch {
            /* advisory */
          }
          if (released.length > 0)
            await notifyClaimWaiters(
              claimRoot,
              released.map((row) => row.file),
            );
        } else {
          // check doubles as a lease heartbeat for the caller's own
          // claims; cross-card walls ride on stderr so --json stdout
          // stays parseable.
          let seen: {
            free: string[];
            conflicts: Array<{
              file: string;
              heldBy: string;
              expiresAt: number;
            }>;
          } | null = null;
          try {
            seen = checkWorkspaceClaims(db, {
              cardId: cliCard.id,
              workspacePath: claimRoot,
              files: claimFiles,
              ttlMs: CLAIM_TTL_MS,
              nowMs: at,
            });
          } catch {
            /* advisory */
          }
          const liveWalls = (seen?.conflicts ?? []).filter((entry) => {
            const holder = getCard(entry.heldBy);
            return holder !== undefined && !isClaimTerminal(holder.status);
          });
          if (liveWalls.length > 0) {
            const lines = liveWalls.map(
              (entry) =>
                `BB-LOCK-WALL file=${entry.file} heldBy=${entry.heldBy} expiresAt=${new Date(entry.expiresAt).toISOString()}`,
            );
            return {
              exitCode: result.code ?? 1,
              stdout: result.stdout,
              stderr: `${lines.join("\n")}${result.stderr ? `\n${result.stderr}` : ""}`,
            };
          }
        }
      }
      // Acquire/release mutate the claim room the card reads: publish so
      // claimed indicators flip without waiting for a lifecycle event.
      // Check stays silent (read-only).
      if (
        (op === "acquire" || op === "release") &&
        result.code === 0 &&
        cliCard
      ) {
        bb.realtime.publish("card-state", { cardId: cliCard.id });
        bb.realtime.publish("board-changed", { cardId: cliCard.id });
      }
      return {
        exitCode: result.code ?? 1,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }
    if (argv[0] === "config") {
      const args = argv.slice(1);
      if (args[0] !== "get" || !args[1]) {
        return {
          exitCode: 2,
          stderr:
            "Usage: bb stelow config get <field> [default] [--project <proj_id>]",
        };
      }
      const rest: string[] = ["get", args[1]];
      if (args[2] && !args[2].startsWith("--")) rest.push(args[2]);
      let projectId: string | null = ctx.projectId ?? null;
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--project") {
          projectId = args[i + 1] ?? null;
          i++;
          continue;
        }
        if (args[i] === "--json") continue;
        if (args[i]!.startsWith("--") && args[i] !== args[2]) {
          return {
            exitCode: 2,
            stderr:
              "Usage: bb stelow config get <field> [default] [--project <proj_id>]",
          };
        }
      }
      const cliCard = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)
        : undefined;
      const workspace = cliCard ? await cardWorkspace(cliCard) : null;
      const rootPath = workspace?.path ?? (await projectRoot(bb, projectId));
      if (!rootPath)
        return { exitCode: 1, stderr: "Workspace path is unavailable." };
      const stateDir = cliCard?.dir_hash
        ? await workflowStateDir(bb, rootPath, cliCard.id, cliCard.dir_hash)
        : null;
      const guard = await ensureProjectArtifacts(
        bb,
        rootPath,
        stateDir,
        Boolean(cliCard?.dir_hash),
      );
      if (guard) return { exitCode: 1, stderr: guard };
      const result = await runHelper(
        ["config", ...rest],
        rootPath,
        stateDir ?? undefined,
      );
      if (result.code !== 0)
        return {
          exitCode: 1,
          stderr: result.stderr || "config failed",
          stdout: result.stdout,
        };
      return { exitCode: 0, stdout: result.stdout };
    }
    if (argv[0] === "preview") {
      // Worker-facing preview control: the same decisions the panel uses, so a
      // worker can start, inspect, and stop the dev server it just built. The
      // checkout is the identity, so two cards on one workspace share it.
      const args = argv.slice(1);
      const action = ["status", "start", "stop"].includes(args[0] ?? "")
        ? args[0]!
        : "status";
      const json = args.includes("--json");
      let cardId: string | null = null;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--card") {
          cardId = args[i + 1] ?? null;
          i++;
          continue;
        }
        if (args[i]!.startsWith("--")) {
          return {
            exitCode: 2,
            stderr:
              "Usage: bb stelow preview [status|start|stop] [--card <card_id>] [--json]",
          };
        }
      }
      const card = cardId
        ? getCard(cardId)
        : ctx.threadId
          ? getCardByWorkerThread(ctx.threadId)
          : undefined;
      if (!card)
        return {
          exitCode: 1,
          stderr:
            "No card found. Pass --card <card_id>, or run this from a card's worker thread.",
        };
      if (action === "start" || action === "stop") {
        const result =
          action === "start"
            ? await previewStart(card.id)
            : await previewStop(card.id);
        const view = await previewView(card.id);
        if (json)
          return {
            exitCode: result.ok ? 0 : 1,
            stdout: `${JSON.stringify(view)}\n`,
          };
        if (!result.ok)
          return {
            exitCode: 1,
            stderr: `${result.error ?? `${action} failed`}\n`,
          };
        return { exitCode: 0, stdout: previewText(view) };
      }
      const view = await previewView(card.id);
      if (json) return { exitCode: 0, stdout: `${JSON.stringify(view)}\n` };
      if (!view.available)
        return {
          exitCode: 1,
          stderr: `${view.error ?? "No web app detected in this workspace."}\n`,
        };
      return { exitCode: 0, stdout: previewText(view) };
    }
    if (argv[0] === "fan-out") {
      // Worker-facing entry to the fanOutResearch RPC: opportunity IDs only,
      // never prose. Confirmation happens beforehand via bb stelow ask —
      // this command trusts IDs because the RPC re-validates them against
      // the parsed index (unknown/already-checked ids refuse loudly).
      const args = argv.slice(1);
      const ids: string[] = [];
      let cardId = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)?.id
        : undefined;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--opportunity") {
          if (args[i + 1]) ids.push(args[i + 1]!);
          i++;
          continue;
        }
        if (args[i] === "--card") {
          cardId = args[i + 1];
          i++;
          continue;
        }
        if (args[i] === "--project") {
          i++;
          continue;
        }
        return {
          exitCode: 2,
          stderr:
            "Usage: bb stelow fan-out --opportunity <id> [--opportunity ...] [--card <card_id>]",
        };
      }
      if (!cardId)
        return {
          exitCode: 2,
          stderr:
            "No card in context (run from the worker thread or pass --card <card_id>).",
        };
      if (ids.length === 0)
        return {
          exitCode: 2,
          stderr:
            "Pass at least one --opportunity <id> (opportunity ids from the research index, never prose).",
        };
      const result = await bb.sdk.plugins.callRpc<{
        ok: boolean;
        created: Array<{ cardId: string; title: string }>;
        error: string | null;
      }>({
        pluginId: "stelow",
        method: "fanOutResearch",
        input: { cardId, opportunityIds: ids },
        outputSchema: z.any(),
      });
      if (!result.ok)
        return { exitCode: 1, stderr: result.error ?? "fan-out failed" };
      return {
        exitCode: 0,
        stdout: `Fanned out ${result.created.length}: ${result.created.map((c) => `${c.title} (${c.cardId})`).join("; ")}`,
      };
    }
    if (argv[0] === "verify") {
      // Deterministic worker self-check: the same predicates the sync gate
      // enforces (lib/research-artifacts), runnable BEFORE finishing so a
      // worker fixes its own artifacts instead of the inbox flagging them
      // after. Prompts require this; the sync stays the backstop.
      const args = argv.slice(1);
      let cardId = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)?.id
        : undefined;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--card") {
          cardId = args[i + 1];
          i++;
          continue;
        }
        if (args[i] === "--tests") continue;
        if (args[i] === "--json") continue;
        return {
          exitCode: 2,
          stderr:
            "Usage: bb stelow verify [--card <card_id>] [--tests] [--json]",
        };
      }
      if (!cardId)
        return {
          exitCode: 2,
          stderr:
            "No card in context (run from the worker thread or pass --card <card_id>).",
        };
      const card = getCard(cardId);
      if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
      const asJson = args.includes("--json");
      const runTests = args.includes("--tests");
      if (runTests) {
        if (card.kind !== "build")
          return {
            exitCode: 2,
            stderr:
              "--tests applies to Build cards only; research and explore use their artifact verification.",
          };
        if (card.workspace_kind === "exploratory")
          return {
            exitCode: 1,
            stderr:
              "Build test verification needs a real project checkout. Create or open the recovery audit card instead of testing this preserved \
exploratory card.",
          };
        const checkout = await cardCheckout(card);
        const evidence = checkout?.path
          ? await recoveryGitEvidence(checkout.path)
          : null;
        if (
          !checkout?.path ||
          !evidence?.isGit ||
          !evidence.gitRoot ||
          !evidence.headSha
        )
          return {
            exitCode: 1,
            stderr:
              "The Build checkout has no verifiable Git root and HEAD. Restore its project workspace, then retry.",
          };
        const command = testCommandForCheckout(checkout.path);
        if (!command)
          return {
            exitCode: 1,
            stderr:
              "No safe conventional test command was found (package.json test script, go.mod, Cargo.toml, or pytest project). Add a project test \
command; Stelow will not execute arbitrary shell text from a receipt.",
          };
        const result = await runHostTests(checkout.path, command);
        const run = {
          id: randomId("verify"),
          cardId,
          command: command.display,
          gitRoot: evidence.gitRoot,
          headSha: evidence.headSha,
          exitCode: result.exitCode,
          outputSha256: createHash("sha256")
            .update(result.output)
            .digest("hex"),
          createdAt: now(),
        };
        db.prepare(
          "INSERT INTO verification_runs (id, card_id, command, git_root, head_sha, exit_code, output_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          run.id,
          run.cardId,
          run.command,
          run.gitRoot,
          run.headSha,
          run.exitCode,
          run.outputSha256,
          run.createdAt,
        );
        const report = {
          pass: result.exitCode === 0,
          command: command.display,
          gitRoot: evidence.gitRoot,
          headSha: evidence.headSha,
          outputSha256: run.outputSha256,
          output: result.output.slice(-8000),
        };
        // Same stage contracts done enforces, surfaced early as warnings:
        // fix them before done refuses with the same lines.
        const docDepths = await buildDocDepthsForCard(card).catch(() => []);
        const docWarning =
          docDepths.length > 0
            ? `\nWARNING: workflow documents need depth (done will refuse):\n${
                docDepths
                  .map((doc) => `FAIL ${doc.label} (${doc.path}): ${doc.failures.join("; ")}`)
                  .join("\n")
              }`
            : "";
        // Same rework loop done enforces, surfaced early: escalations
        // without scopes and open rework warn here instead of ambushing
        // at done. Read-only — creating scopes stays a gap-scopes call.
        const gapState = await critiqueGapState(card).catch(() => null);
        const unscoped = gapState?.matched
          ? gapState.escalated.filter(
              (gap) =>
                !gapState.auditGapScopes.some(
                  (scope) => scope.gap === gap.description,
                ),
            )
          : [];
        const openRework = (gapState?.auditGapScopes ?? []).filter(
          (scope) => !isDoneStatus(scope.status),
        );
        const gapLoop = {
          unscoped: unscoped.map((gap) => gap.description),
          openRework: openRework.map(
            (scope) => `${scope.id} (${scope.status})`,
          ),
        };
        const gapWarning =
          unscoped.length > 0 || openRework.length > 0
            ? `\nWARNING: rework loop open (done will refuse):\n${
                [
                  ...unscoped.map(
                    (gap) => `UNSCOPED ${gap.description} — run bb stelow gap-scopes`,
                  ),
                  ...openRework.map(
                    (scope) =>
                      `OPEN ${scope.id} (${scope.status}) — finish it, then re-run the critique`,
                  ),
                ].join("\n")
              }`
            : "";
        if (asJson)
          return {
            exitCode: result.exitCode,
            stdout: JSON.stringify({ ...report, docDepths, gapLoop }, null, 2),
          };
        return result.exitCode === 0
          ? {
              exitCode: 0,
              stdout: `PASS: ${command.display} recorded at ${evidence.headSha}.\n${report.output}${docWarning}${gapWarning}`,
            }
          : {
              exitCode: result.exitCode,
              stderr: `FAIL: ${command.display} recorded at ${evidence.headSha}.\n${report.output}${docWarning}${gapWarning}`,
            };
      }
      if (card.kind === "research") {
        const readiness = await researchReadiness(card).catch(() => null);
        if (!readiness)
          return {
            exitCode: 1,
            stderr: "Unable to read card state — retry verify.",
          };
        const report = researchVerifyReport(
          cardId,
          strategyRounds(card).length,
          readiness.ready || readiness.invalid.length > 0,
          readiness.invalid,
          readiness.evidence,
        );
        if (asJson)
          return {
            exitCode: report.pass ? 0 : 1,
            stdout: JSON.stringify(report, null, 2),
          };
        const text = researchVerifyText(report);
        return {
          exitCode: text.exitCode,
          ...(text.stdout ? { stdout: text.stdout } : {}),
          ...(text.stderr ? { stderr: text.stderr } : {}),
        };
      }
      if (card.kind === "explore") {
        const artifact = await exploreArtifact(card).catch(() => ({
          ready: false as const,
          fingerprint: null as string | null,
          failures: [] as string[],
        }));
        const report = exploreVerifyReport(
          cardId,
          card.explore_stage,
          artifact.ready,
          artifact.failures,
        );
        if (asJson)
          return {
            exitCode: report.pass ? 0 : 1,
            stdout: JSON.stringify(report, null, 2),
          };
        const text = exploreVerifyText(report);
        return {
          exitCode: text.exitCode,
          ...(text.stdout ? { stdout: text.stdout } : {}),
          ...(text.stderr ? { stderr: text.stderr } : {}),
        };
      }
      return {
        exitCode: 2,
        stderr: `Build verification requires --tests: run \`bb stelow verify --tests\` before its audit receipt and done.`,
      };
    }
    if (argv[0] === "review") {
      // Independent artifact review (docs/phase6-independent-review-plan.md):
      // explicit opt-in, read-only, cross-lineage. Refuses without a
      // designated review preset (never falls back to the worker preset)
      // and when deterministic verify fails (never spend review budget on
      // thin files). Research and explore review the card deliverable;
      // --artifact reviews one registered manifest document (any card,
      // including build documents like spec-product or spec-tech).
      const args = argv.slice(1);
      let cardId = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)?.id
        : undefined;
      let artifactArg: string | null = null;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--card") {
          cardId = args[i + 1];
          i++;
          continue;
        }
        if (args[i] === "--artifact") {
          artifactArg = args[i + 1] ?? null;
          i++;
          continue;
        }
        return {
          exitCode: 2,
          stderr:
            "Usage: bb stelow review [--card <card_id>] [--artifact <path>]",
        };
      }
      if (!cardId)
        return {
          exitCode: 2,
          stderr:
            "No card in context (run from the worker thread or pass --card <card_id>).",
        };
      const card = getCard(cardId);
      if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
      if (isArchivedCard(card))
        return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
      if (!artifactArg && card.kind === "build")
        return {
          exitCode: 2,
          stderr:
            "Card review covers research and explore cards; for build documents pass --artifact <registered path> (e.g. a spec-product or spec-tech file).",
        };
      if (
        card.kind !== "research" &&
        card.kind !== "explore" &&
        card.kind !== "build"
      )
        return {
          exitCode: 2,
          stderr: `Unknown card kind "${card.kind}". Archive this card and start a new one.`,
        };
      const designated = getReviewPresetId();
      const reviewPreset = designated ? getPresetById(designated) : null;
      if (!reviewPreset) {
        return {
          exitCode: 2,
          stderr:
            "No artifact-reviewer preset designated. In Manage presets, mark one preset as the reviewer (a different model family from your \
workers, low reasoning, restrictive permission) — review never falls back to the worker preset.",
        };
      }
      const params = presetAttachmentParams(reviewPreset);
      const permissionNote =
        params.permissionMode === "full"
          ? " (preset permission coerced full → accept-edits: reviewers read, never write)"
          : "";
      // Deterministic precondition: review only sees verify-PASS artifacts.
      let artifactText = "";
      let contractLabel = "";
      let evidence: "verified" | "hypothesis-only" = "verified";
      let reviewFingerprint: string | null = null;
      if (artifactArg) {
        const workspace = await cardWorkspace(card);
        if (!workspace?.path || !card.dir_hash)
          return {
            exitCode: 1,
            stderr: "No workflow state for this card yet.",
          };
        const stateDir = await workflowStateDir(
          bb,
          workspace.path,
          card.id,
          card.dir_hash,
        ).catch(() => null);
        if (!stateDir)
          return {
            exitCode: 1,
            stderr: "No workflow state for this card yet.",
          };
        const stateBlob = await bb.sdk.files
          .read({ path: join(stateDir, "state.md") })
          .then((f) => f.content)
          .catch(() => null);
        const registered = stateBlob
          ? parseArtifactManifest(stateBlob).some(
              (fields) => fields.path === artifactArg,
            )
          : false;
        if (!registered)
          return {
            exitCode: 2,
            stderr: `Unknown artifact "${artifactArg}" — review only registered manifest documents (see the card Artifacts).`,
          };
        const full = resolveArtifactPath(workspace.path, artifactArg);
        const content = full
          ? await bb.sdk.files
              .read({ path: full })
              .then((f) => f.content)
              .catch(() => null)
          : null;
        if (typeof content !== "string" || !content.trim())
          return {
            exitCode: 1,
            stderr: `Artifact "${artifactArg}" is missing or empty — write it first, then review.`,
          };
        const contract = contractForBuildArtifact(artifactArg, content);
        if (!contract)
          return {
            exitCode: 2,
            stderr: `Artifact "${artifactArg}" matches no known stage contract — review covers spec-product, spec-tech, interfaces, testing-strategy, \
and critique reports.`,
          };
        const depth = validateArtifact(content, contract);
        if (!depth.pass) {
          return {
            exitCode: 1,
            stderr: `Review refused: deterministic depth fails — fix first, then review (review budget is never spent on thin files).\nFAIL ${artifactArg}: \
${depth.failures
              .map((failure) => failure.detail)
              .slice(0, 3)
              .join("; ")}`,
          };
        }
        contractLabel = `build document (${contract.id})`;
        artifactText = content;
      } else if (card.kind === "research") {
        const readiness = await researchReadiness(card).catch(() => null);
        if (!readiness)
          return {
            exitCode: 1,
            stderr: "Unable to read card state — retry review.",
          };
        if (!readiness.ready || readiness.invalid.length > 0) {
          const report = researchVerifyReport(
            cardId,
            strategyRounds(card).length,
            readiness.ready || readiness.invalid.length > 0,
            readiness.invalid,
            readiness.evidence,
          );
          const textOut = researchVerifyText(report);
          return {
            exitCode: 1,
            stderr: `Review refused: deterministic verify fails — fix first, then review \
(review budget is never spent on thin files).\n${
              textOut.stderr ?? textOut.stdout ?? ""
            }`,
          };
        }
        evidence = readiness.evidence;
        reviewFingerprint = readiness.fingerprint;
        const history = strategyRounds(card);
        const latest = history[history.length - 1];
        const strategyLabel =
          researchStrategyById(latest?.id ?? "")?.label ??
          latest?.id ??
          "research";
        contractLabel = `${strategyLabel} primary round`;
        const workspace = await cardWorkspace(card);
        const index = await readResearchIndex(card).catch(() => null);
        const indexText = index && index.ok === true ? index.content : "";
        const primary =
          workspace?.path && latest?.file
            ? await bb.sdk.files
                .read({
                  path: resolveArtifactPath(workspace.path, latest.file) ?? "",
                })
                .then((f) => f.content)
                .catch(() => null)
            : null;
        artifactText = `Research index:\n${typeof indexText === "string" ? indexText : ""}\n\nPrimary round:\n${typeof primary === "string" ? primary : ""}`;
      } else {
        const artifact = await exploreArtifact(card).catch(() => ({
          ready: false as const,
          fingerprint: null as string | null,
          failures: [] as string[],
        }));
        if (!artifact.ready) {
          const report = exploreVerifyReport(
            cardId,
            card.explore_stage,
            artifact.ready,
            artifact.failures,
          );
          const textOut = exploreVerifyText(report);
          return {
            exitCode: 1,
            stderr: `Review refused: deterministic verify fails — fix first, then review \
(review budget is never spent on thin files).\n${
              textOut.stderr ?? textOut.stdout ?? ""
            }`,
          };
        }
        reviewFingerprint = artifact.fingerprint;
        const techniqueLabel =
          techniqueById(card.explore_stage ?? "")?.label ??
          card.explore_stage ??
          "explore";
        contractLabel = `${techniqueLabel} stage deliverable`;
        const workspace = await cardWorkspace(card);
        const stateDir =
          card.dir_hash && workspace?.path
            ? await workflowStateDir(
                bb,
                workspace.path,
                card.id,
                card.dir_hash,
              ).catch(() => null)
            : null;
        const content = stateDir
          ? await bb.sdk.files
              .read({
                path: join(
                  stateDir,
                  exploreArtifactFile(card.explore_stage ?? ""),
                ),
              })
              .then((f) => f.content)
              .catch(() => null)
          : null;
        artifactText = typeof content === "string" ? content : "";
      }
      const reviewWorkspace = await cardWorkspace(card);
      if (!reviewWorkspace?.path)
        return { exitCode: 1, stderr: ERR_WORKSPACE_UNAVAILABLE };
      const reviewSource = reviewWorkspace.hostId
        ? { path: reviewWorkspace.path, hostId: reviewWorkspace.hostId }
        : null;
      const reviewFallback = reviewSource
        ? workerEnvironment(
            reviewSource,
            params,
            card.workspace_kind === "exploratory",
          )
        : { type: "project-default" as const };
      const reviewEnvironment = await workers.continuingEnvironment(
        card,
        reviewFallback,
      );
      const prompt = buildReviewPrompt({
        cardName: card.display_name ?? card.name,
        request: card.prompt,
        contractLabel,
        artifactContent: artifactText,
        deterministicFailures: [],
        evidence,
      });
      let reviewThread: { id: string };
      try {
        reviewThread = await spawnDisposable(
          {
            projectId: card.project_id,
            environment: reviewEnvironment,
            visibility: "hidden",
            // Disposable reviewer: archiving the worker archives the review
            // with it (BB 0.43 dependent threads). Lifecycle only — the
            // verdict still travels through files, never thread history.
            ...(card.worker_thread_id
              ? { lifecycleOwnerThreadId: card.worker_thread_id }
              : {}),
            title: `Stelow review: ${card.display_name ?? card.name}`,
            providerId: params.providerId,
            model: params.modelId,
            reasoningLevel: params.reasoningLevel as
              | "low"
              | "medium"
              | "high"
              | "xhigh"
              | "max"
              | "none"
              | "ultra"
              | "ultracode",
            permissionMode: (params.permissionMode === "full"
              ? "accept-edits"
              : params.permissionMode) as "accept-edits" | "auto" | "full",
            executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
            prompt,
          },
          "review",
        );
      } catch (error) {
        return {
          exitCode: 1,
          stderr: `Review spawn failed: ${error instanceof Error ? error.message : "unknown error"}.${permissionNote}`,
        };
      }
      logCardComment(
        cardId,
        "card",
        cardId,
        "agent",
        `Review requested — reviewer thread ${reviewThread.id} (${reviewPreset.name}).${permissionNote}`,
      );
      const POLL_MS = 10000;
      const POLL_MAX = 60;
      for (let poll = 0; poll < POLL_MAX; poll++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        const thread = await bb.sdk.threads
          .get({ threadId: reviewThread.id })
          .catch(() => null);
        const status = (thread as { status?: unknown } | null)?.status;
        if (status === "idle" || status === "stopping") break;
        // The worker may be archived mid-review (dependent lifecycle above):
        // stop polling and let the verdict read below report the miss.
        if (status === "archived" || status === "deleted") break;
        if (status === "failed" || status === "error") {
          return {
            exitCode: 1,
            stderr: `Reviewer thread ${reviewThread.id} ended with status ${String(status)} — open it to inspect, then rerun review.`,
          };
        }
        if (poll === POLL_MAX - 1) {
          return {
            exitCode: 1,
            stderr: `Reviewer thread ${reviewThread.id} still running after 10 minutes — open it to follow \
along; the verdict lands as reviews/review-<stamp>.md \
on this card when it finishes.`,
          };
        }
      }
      const output = await bb.sdk.threads
        .output({ threadId: reviewThread.id })
        .then((result) => result.output ?? "")
        .catch(() => "");
      const parsed = parseReviewOutput(output, artifactText);
      const stamp = roundTimestamp();
      const reviewStateDir = card.dir_hash
        ? await workflowStateDir(
            bb,
            reviewWorkspace.path,
            card.id,
            card.dir_hash,
          ).catch(() => null)
        : null;
      let reviewPath: string | null = null;
      if (reviewStateDir) {
        const full = join(reviewStateDir, `reviews/review-${stamp}.md`);
        try {
          await bb.sdk.files.mkdir({
            path: dirname(full),
            rootPath: reviewWorkspace.path,
            recursive: true,
          });
          const reviewVerdictJson = JSON.stringify(
            { status: parsed.status, findings: parsed.findings },
            null,
            2,
          );
          await bb.sdk.files.write({
            path: full,
            content: `# Review ${stamp}\n\nCard: ${card.display_name ?? card.name}\nReviewer thread: ${reviewThread.id}\nPreset: ${reviewPreset.name}\nStatus: \
${parsed.status}\nFingerprint: ${reviewFingerprint ?? "none"}\n\n${reviewSummary(parsed)}\n\n## Verdict\n\n\`\`\`json\n${reviewVerdictJson}\n\`\`\`\n`,
          });
          reviewPath =
            workspaceRelative(reviewWorkspace.path, full) ??
            `reviews/review-${stamp}.md`;
        } catch {
          /* verdict still reported via comment + stdout */
        }
      }
      const summary = `${reviewSummary(parsed)}${reviewPath ? ` Record: ${reviewPath}.` : ""}${permissionNote}`;
      logCardComment(cardId, "card", cardId, "agent", summary);
      return {
        exitCode: 0,
        stdout: `${summary}\nReviewer thread: ${reviewThread.id}`,
      };
    }
    if (argv[0] === "criteria") {
      // Advisory semantic criteria check: score an artifact against its
      // skill's semantic criteria through the Decision API. Read-only —
      // writes no rows, publishes nothing, blocks nothing. Runs only in
      // api mode with a configured provider; everything else refuses
      // with the fix named.
      const args = argv.slice(1);
      let cardId = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)?.id
        : undefined;
      let skillArg: string | null = null;
      let artifactArg: string | null = null;
      const asJson = args.includes("--json");
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--card") {
          cardId = args[i + 1];
          i++;
          continue;
        }
        if (args[i] === "--skill") {
          skillArg = args[i + 1] ?? null;
          i++;
          continue;
        }
        if (args[i] === "--artifact") {
          artifactArg = args[i + 1] ?? null;
          i++;
          continue;
        }
        if (args[i] === "--json") continue;
        return {
          exitCode: 2,
          stderr:
            "Usage: bb stelow criteria --skill <skill-id> --artifact <path> [--card <card_id>] [--json]",
        };
      }
      if (!cardId)
        return {
          exitCode: 2,
          stderr:
            "No card in context (run from the worker thread or pass --card <card_id>).",
        };
      const card = getCard(cardId);
      if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
      if (!skillArg)
        return {
          exitCode: 2,
          stderr:
            "Pass --skill <skill-id> (e.g. stelow-workflow-shape-up) or a path under skills/.",
        };
      if (!artifactArg)
        return {
          exitCode: 2,
          stderr: "Pass --artifact <workspace-relative path>.",
        };
      if (isDecisionApiDisabled(process.env))
        return {
          exitCode: 1,
          stderr:
            "Decision API is disabled on this host (STELOW_DECISION_API=0).",
        };
      const criteriaPoint = db
        .prepare(
          "SELECT mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points WHERE point = ?",
        )
        .get(DECISION_POINT_ARTIFACT_CRITERIA) as
        | {
            mode: string;
            thresholds: string;
            provider: string | null;
            endpoint: string | null;
            api_key: string | null;
            model: string | null;
            preset_id: string | null;
          }
        | undefined;
      const criteriaMode = normalizePointMode(criteriaPoint?.mode, "rules");
      if (criteriaMode !== "api" && criteriaMode !== "preset") {
        return {
          exitCode: 1,
          stderr:
            "Artifact criteria runs in Built-in rules mode. Set it to Decision API or preset judging in Manage agent presets → Decision routers.",
        };
      }
      const skillRel = skillArg.includes("/")
        ? skillArg
        : `${skillArg}/SKILL.md`;
      const skillFull = resolveArtifactPath(PLUGIN_SKILLS_DIR, skillRel);
      let skillText: string | null = null;
      try {
        skillText = skillFull ? readFileSync(skillFull, "utf8") : null;
      } catch {
        skillText = null;
      }
      if (!skillText)
        return {
          exitCode: 2,
          stderr: `Unknown skill "${skillArg}" — skills live under the plugin's skills/ directory (stelow-*).`,
        };
      const workspace = await cardWorkspace(card);
      if (!workspace?.path)
        return { exitCode: 1, stderr: ERR_WORKSPACE_UNAVAILABLE };
      const full = resolveArtifactPath(workspace.path, artifactArg);
      const content = full
        ? await bb.sdk.files
            .read({ path: full })
            .then((f) => f.content)
            .catch(() => null)
        : null;
      if (typeof content !== "string" || !content.trim())
        return {
          exitCode: 1,
          stderr: `Artifact "${artifactArg}" is missing or empty — write it first, then judge.`,
        };
      const criteriaCfg = db
        .prepare(
          "SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1",
        )
        .get() as
        | {
            endpoint: string;
            api_key: string;
            model: string;
            provider: string | null;
          }
        | undefined;
      const criteriaRoute = decisionApi.routeConfig(criteriaPoint, criteriaCfg);
      const criteriaProvider = normalizeDecisionProvider(
        criteriaRoute.provider ?? "jev",
      );
      const { key: criteriaKey } = resolveDecisionApiKey({
        storedKey: criteriaRoute.apiKey ?? null,
        env: process.env,
      });
      if (!criteriaKey && providerRequiresKey(criteriaProvider))
        return {
          exitCode: 1,
          stderr:
            "No key: set one in Decision API settings or export DECISION_API_KEY.",
        };
      let criteriaStored: unknown = null;
      try {
        criteriaStored = criteriaPoint
          ? JSON.parse(criteriaPoint.thresholds)
          : null;
      } catch {
        criteriaStored = null;
      }
      const criteriaThresholds = normalizeThresholds(
        criteriaStored,
        defaultThresholdsFor(DECISION_POINT_ARTIFACT_CRITERIA),
      );
      const criteriaJudge =
        criteriaMode === "preset" ? (criteriaPoint?.preset_id ?? null) : null;
      if (criteriaMode === "preset" && !criteriaJudge)
        return {
          exitCode: 1,
          stderr:
            "Preset judging needs a judge preset — pick any preset in Decision routers, including one no stage uses.",
        };
      const judgment =
        criteriaMode === "preset" && criteriaJudge
          ? await judgePresetCriteria({
              presetId: criteriaJudge,
              projectId: card.project_id,
              skillText,
              artifactText: content,
              routeAt: criteriaThresholds.routeAt,
            })
          : await judgeArtifactCriteria({
              provider: criteriaProvider,
              endpoint:
                criteriaRoute.endpoint ?? defaultEndpointFor(criteriaProvider),
              apiKey: criteriaKey ?? "",
              model: normalizeDecisionApiModel(
                criteriaRoute.model,
                defaultModelFor(criteriaProvider),
              ),
              skillText,
              artifactText: content,
              routeAt: criteriaThresholds.routeAt,
            });
      if (!judgment.ok)
        return {
          exitCode: 1,
          stderr: `Criteria judging failed: ${judgment.error ?? "call failed"} — built-in rules still apply; retry or check the provider.`,
        };
      const criteriaJudgeLabel =
        criteriaMode === "preset" && criteriaJudge
          ? `preset ${criteriaJudge}`
          : criteriaProvider;
      const met = judgment.findings.filter(
        (finding) => finding.verdict === "met",
      ).length;
      const unmet = judgment.findings.filter(
        (finding) => finding.verdict === "unmet",
      ).length;
      const unverifiable = judgment.findings.length - met - unmet;
      if (asJson) {
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            {
              skill: skillArg,
              artifact: artifactArg,
              provider: criteriaProvider,
              presetId: criteriaMode === "preset" ? criteriaJudge : null,
              findings: judgment.findings,
              summary: { met, unmet, unverifiable },
            },
            null,
            2,
          ),
        };
      }
      const mark = (verdict: string) =>
        verdict === "met" ? "✓" : verdict === "unmet" ? "✗" : "?";
      const lines = judgment.findings.map(
        (finding) =>
          `${mark(finding.verdict)} ${finding.id} — ${finding.verdict}${
            finding.score !== null
              ? ` (score ${finding.score}, confidence ${finding.confidence ?? "n/a"})`
              : ""
          }: \
${finding.text}`,
      );
      return {
        exitCode: 0,
        stdout: [
          `Artifact criteria: ${skillArg} × ${artifactArg} (${criteriaJudgeLabel}, ${judgment.findings.length} criteria)`,
          ...lines,
          `Summary: ${met} met, ${unmet} unmet, ${unverifiable} unverifiable — advisory only, never blocking.`,
        ].join("\n"),
      };
    }
    if (argv[0] === "verify-tasks") {
      // Advisory task-evidence check: completed statuses are worker
      // assertions — this asks a judge, per task, whether the working
      // diff shows evidence, through the artifact-criteria point (rules
      // reports everything unverifiable without calling out). Read-only,
      // never a gate: findings guide the worker, done decides separately.
      const args = argv.slice(1);
      let taskCardId = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)?.id
        : undefined;
      const asJson = args.includes("--json");
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--card") {
          taskCardId = args[i + 1];
          i++;
          continue;
        }
        if (args[i] === "--json") continue;
        return {
          exitCode: 2,
          stderr: "Usage: bb stelow verify-tasks [--card <card_id>] [--json]",
        };
      }
      if (!taskCardId)
        return {
          exitCode: 2,
          stderr:
            "No card in context (run from the worker thread or pass --card <card_id>).",
        };
      const taskCard = getCard(taskCardId);
      if (!taskCard)
        return { exitCode: 2, stderr: `Unknown card "${taskCardId}".` };
      if (isDecisionApiDisabled(process.env))
        return {
          exitCode: 1,
          stderr:
            "Decision API is disabled on this host (STELOW_DECISION_API=0).",
        };
      const taskPoint = db
        .prepare(
          "SELECT mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points WHERE point = ?",
        )
        .get(DECISION_POINT_ARTIFACT_CRITERIA) as
        | {
            mode: string;
            thresholds: string;
            provider: string | null;
            endpoint: string | null;
            api_key: string | null;
            model: string | null;
            preset_id: string | null;
          }
        | undefined;
      const taskMode = normalizePointMode(taskPoint?.mode, "rules");
      if (taskMode !== "api" && taskMode !== "preset") {
        return {
          exitCode: 1,
          stderr:
            "Task evidence needs the Artifact criteria router in Decision API or preset mode. Set it in Manage agent presets → Decision routers.",
        };
      }
      const taskWorkspace = await cardWorkspace(taskCard).catch(() => null);
      if (!taskWorkspace?.path)
        return { exitCode: 1, stderr: ERR_WORKSPACE_UNAVAILABLE };
      const taskScopes = loadCardScopes(taskWorkspace.path, taskCard.id);
      const doneTasks = taskScopes.flatMap((scope) =>
        (Array.isArray(scope.tasks) ? scope.tasks : [])
          .filter((task) => isDoneStatus(task.status))
          .map((task) => ({
            id: task.id,
            name: task.name,
            scope: scope.name,
            verify: taskVerifyCommand(task),
          })),
      );
      if (doneTasks.length === 0)
        return {
          exitCode: 0,
          stdout:
            "No completed tasks to evidence — pending tasks are openly pending, nothing to judge.",
        };
      const taskCfg = db
        .prepare(
          "SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1",
        )
        .get() as
        | {
            endpoint: string;
            api_key: string;
            model: string;
            provider: string | null;
          }
        | undefined;
      const taskRoute = decisionApi.routeConfig(taskPoint, taskCfg);
      const taskProvider = normalizeDecisionProvider(
        taskRoute.provider ?? "jev",
      );
      const { key: taskKey } = resolveDecisionApiKey({
        storedKey: taskRoute.apiKey ?? null,
        env: process.env,
      });
      if (!taskKey && providerRequiresKey(taskProvider))
        return {
          exitCode: 1,
          stderr:
            "No key: set one in Decision API settings or export DECISION_API_KEY.",
        };
      let taskStored: unknown = null;
      try {
        taskStored = taskPoint ? JSON.parse(taskPoint.thresholds) : null;
      } catch {
        taskStored = null;
      }
      const taskThresholds = normalizeThresholds(
        taskStored,
        defaultThresholdsFor(DECISION_POINT_ARTIFACT_CRITERIA),
      );
      const taskDiff = await workingDiffFor(
        taskWorkspace.path,
        TASK_EVIDENCE_DIFF_CHARS,
      );
      const taskQuestions = tasksToScoreQuestions(doneTasks);
      type TaskFinding = {
        id: string;
        name: string;
        score: number | null;
        confidence: number | null;
        verdict: string;
        error: string | null;
        source: "command" | "judge";
      };
      // Tasks carrying their own verify command run deterministically
      // first (authoritative, zero judge cost): exit 0 reads met, any
      // other exit reads unmet, spawn/timeout failures read unverifiable
      // with the reason. Checkout-pinned via execFile, no shell — the
      // worker already owns a shell, so this grants no new privilege.
      const commandTasks = doneTasks.filter((task) => task.verify !== null);
      const judgedTasks = doneTasks.filter((task) => task.verify === null);
      const runVerifyCommand = (
        cmd: string,
      ): Promise<{ ok: boolean; code: number | null; failed: boolean }> =>
        new Promise((resolveRun) => {
          const [bin, ...rest] = cmd.split(/\s+/);
          execFile(
            bin,
            rest,
            {
              cwd: taskWorkspace.path,
              timeout: 60000,
              maxBuffer: 4 * 1024 * 1024,
            },
            (error, _stdout) => {
              if (
                error &&
                (error as NodeJS.ErrnoException).code !== null &&
                (error as NodeJS.ErrnoException).code !== undefined &&
                typeof (error as { code?: unknown }).code !== "number"
              ) {
                resolveRun({ ok: false, code: null, failed: true });
                return;
              }
              const code =
                typeof (error as { code?: unknown } | null)?.code === "number"
                  ? (error as { code: number }).code
                  : 0;
              resolveRun({ ok: code === 0, code, failed: false });
            },
          );
        });
      const commandFindings = await Promise.all(
        commandTasks.map(async (task) => {
          const ran = await runVerifyCommand(task.verify as string).catch(
            () => ({ ok: false, code: null as number | null, failed: true }),
          );
          const base = {
            id: task.id,
            name: task.name,
            source: "command" as const,
          };
          if (ran.failed)
            return {
              ...base,
              score: null,
              confidence: null,
              verdict: "unverifiable",
              error: "verify command did not run",
            };
          return {
            ...base,
            score: ran.ok ? 2 : 0,
            confidence: 1,
            verdict: ran.ok ? "met" : "unmet",
            error: null as string | null,
          };
        }),
      );
      let taskFindings: Array<TaskFinding>;
      if (judgedTasks.length === 0) {
        // Everything verified deterministically — no judge to consult,
        // no preset or key required.
        taskFindings = [...commandFindings];
      } else {
        if (taskMode === "preset" && !taskPoint?.preset_id)
          return {
            exitCode: 1,
            stderr:
              "Preset judging needs a judge preset — pick any preset in Decision routers, including one no stage uses.",
          };
        const judged = await judgeScoredBatch({
          items: judgedTasks.map((task) => ({
            id: task.id,
            text: `${task.name} (scope: ${task.scope})`,
          })),
          questions: taskQuestions as Record<string, unknown>,
          keyPrefix: "task",
          state: taskDiff,
          mode: taskMode,
          presetId: taskPoint?.preset_id ?? null,
          projectId: taskCard.project_id,
          title: "Stelow judge: task evidence",
          provider: taskProvider,
          endpoint: taskRoute.endpoint ?? defaultEndpointFor(taskProvider),
          apiKey: taskKey ?? "",
          model: normalizeDecisionApiModel(
            taskRoute.model,
            defaultModelFor(taskProvider),
          ),
          routeAt: taskThresholds.routeAt,
        });
        if (!judged.ok)
          return {
            exitCode: 1,
            stderr: `Task judging failed: ${judged.error} — retry or check the router.`,
          };
        taskFindings = judged.findings.map((finding) => ({
          ...finding,
          source: "judge" as const,
        }));
      }
      // Deterministic findings first, judged after — both in doneTasks
      // order inside their group; scope rollup reads the merged set.
      taskFindings = [...commandFindings, ...taskFindings];
      const taskMet = taskFindings.filter(
        (finding) => finding.verdict === "met",
      ).length;
      const taskUnmet = taskFindings.filter(
        (finding) => finding.verdict === "unmet",
      ).length;
      const taskUnverifiable = taskFindings.length - taskMet - taskUnmet;
      // Scope rollup is deterministic, never judged: a done scope reads
      // from its tasks' verdicts, so scopes cost zero extra calls.
      const scopeRollup = resolveScopeVerdicts({
        scopes: taskScopes,
        taskFindings,
      });
      if (asJson) {
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            {
              card: taskCardId,
              provider: taskProvider,
              findings: taskFindings,
              scopes: scopeRollup,
              summary: {
                met: taskMet,
                unmet: taskUnmet,
                unverifiable: taskUnverifiable,
              },
            },
            null,
            2,
          ),
        };
      }
      const taskMark = (verdict: string) =>
        verdict === "met" ? "✓" : verdict === "unmet" ? "✗" : "?";
      const taskLines = taskFindings.map(
        (finding) =>
          `${taskMark(finding.verdict)} ${finding.name} — ${finding.verdict}${
            finding.source === "command"
              ? " (verified)"
              : finding.confidence !== null
                ? ` (confidence ${finding.confidence})`
                : ""
          }`,
      );
      const scopeLines = scopeRollup.map(
        (scope) =>
          `${taskMark(scope.verdict)} ${scope.name} — ${scope.verdict} (${scope.detail})`,
      );
      return {
        exitCode: 0,
        stdout: [
          `Task evidence (${doneTasks.length} completed tasks judged against the working diff):`,
          ...taskLines,
          `Scopes (deterministic rollup, no extra calls):`,
          ...scopeLines,
          `Summary: ${taskMet} met, ${taskUnmet} unmet, ${taskUnverifiable} unverifiable — advisory only, never blocking.`,
        ].join("\n"),
      };
    }
    if (argv[0] === "verify-delegation") {
      // Advisory delegation tripwire: the host cannot see subagent
      // freshness — only whether any delegation happened at all. Counts
      // structural delegation items in the worker thread timeline;
      // prose matches never count. Zero reads as inconclusive ("may be
      // self-review"), never as certain. Read-only, never a gate.
      const args = argv.slice(1);
      let delegationCardId = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)?.id
        : undefined;
      const asJson = args.includes("--json");
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--card") {
          delegationCardId = args[i + 1];
          i++;
          continue;
        }
        if (args[i] === "--json") continue;
        return {
          exitCode: 2,
          stderr:
            "Usage: bb stelow verify-delegation [--card <card_id>] [--json]",
        };
      }
      if (!delegationCardId)
        return {
          exitCode: 2,
          stderr:
            "No card in context (run from the worker thread or pass --card <card_id>).",
        };
      const delegationCard = getCard(delegationCardId);
      if (!delegationCard)
        return { exitCode: 2, stderr: `Unknown card "${delegationCardId}".` };
      if (!delegationCard.worker_thread_id)
        return {
          exitCode: 0,
          stdout: "No worker thread — nothing to inspect for delegations.",
        };
      const timeline = await bb.sdk.threads
        .timeline({
          threadId: delegationCard.worker_thread_id,
          segmentLimit: "100",
        })
        .catch(() => null);
      if (!timeline)
        return {
          exitCode: 1,
          stderr: "Could not read the worker thread timeline — retry later.",
        };
      // segmentLimit 100 covers realistic worker threads whole; pagination
      // cursors are not interpreted — a truncated giant thread would
      // undercount, and the summary discloses observation, not certainty.
      const evidence = summarizeDelegationEvidence({
        delegations: countDelegations(timeline),
        truncated: false,
      });
      if (asJson) {
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            {
              card: delegationCardId,
              delegations: countDelegations(timeline),
              observed: evidence.observed,
            },
            null,
            2,
          ),
        };
      }
      return { exitCode: 0, stdout: evidence.summary };
    }
    if (argv[0] === "gap-triage") {
      // Advisory gap-triage: the worker classified the critique's gaps
      // (fixed / documented / escalate). This asks a judge, per escalated
      // gap, whether it is a genuine gap — second-opining the worker's own
      // classification, never the routing (the impact×effort matrix and
      // scope conversion stay deterministic). The judge reads the critique
      // and the working diff, never the gap wording alone. Read-only,
      // never a gate.
      const args = argv.slice(1);
      let gapCardId = ctx.threadId
        ? getCardByWorkerThread(ctx.threadId)?.id
        : undefined;
      const asJson = args.includes("--json");
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--card") {
          gapCardId = args[i + 1];
          i++;
          continue;
        }
        if (args[i] === "--json") continue;
        return {
          exitCode: 2,
          stderr: "Usage: bb stelow gap-triage [--card <card_id>] [--json]",
        };
      }
      if (!gapCardId)
        return {
          exitCode: 2,
          stderr:
            "No card in context (run from the worker thread or pass --card <card_id>).",
        };
      const gapCard = getCard(gapCardId);
      if (!gapCard)
        return { exitCode: 2, stderr: `Unknown card "${gapCardId}".` };
      if (gapCard.kind !== "build")
        return {
          exitCode: 1,
          stderr:
            "gap-triage runs on Build cards — research and explore have no execution critique.",
        };
      if (isDecisionApiDisabled(process.env))
        return {
          exitCode: 1,
          stderr:
            "Decision API is disabled on this host (STELOW_DECISION_API=0).",
        };
      const gapWorkspace = await cardWorkspace(gapCard).catch(() => null);
      if (!gapWorkspace?.path)
        return { exitCode: 1, stderr: ERR_WORKSPACE_UNAVAILABLE };
      const gapState = await critiqueGapState(gapCard).catch(() => null);
      if (!gapState?.matched)
        return {
          exitCode: 1,
          stderr:
            "No execution critique found — write it first, then triage its gaps.",
        };
      if (gapState.failures.length > 0)
        return { exitCode: 1, stderr: gapState.failures.join("\n") };
      if (gapState.escalated.length === 0)
        return {
          exitCode: 0,
          stdout:
            "No escalated gaps to triage — nothing the registry routed to a rework scope.",
        };
      const gapPoint = db
        .prepare(
          "SELECT mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points WHERE point = ?",
        )
        .get(DECISION_POINT_ARTIFACT_CRITERIA) as
        | {
            mode: string;
            thresholds: string;
            provider: string | null;
            endpoint: string | null;
            api_key: string | null;
            model: string | null;
            preset_id: string | null;
          }
        | undefined;
      const gapMode = normalizePointMode(gapPoint?.mode, "rules");
      if (gapMode !== "api" && gapMode !== "preset") {
        return {
          exitCode: 1,
          stderr:
            "Gap triage needs the Artifact criteria router in Decision API or preset mode. Set it in Manage agent presets → Decision routers.",
        };
      }
      const gapCfg = db
        .prepare(
          "SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1",
        )
        .get() as
        | {
            endpoint: string;
            api_key: string;
            model: string;
            provider: string | null;
          }
        | undefined;
      const gapRoute = decisionApi.routeConfig(gapPoint, gapCfg);
      const gapProvider = normalizeDecisionProvider(gapRoute.provider ?? "jev");
      const { key: gapKey } = resolveDecisionApiKey({
        storedKey: gapRoute.apiKey ?? null,
        env: process.env,
      });
      if (!gapKey && providerRequiresKey(gapProvider))
        return {
          exitCode: 1,
          stderr:
            "No key: set one in Decision API settings or export DECISION_API_KEY.",
        };
      let gapStored: unknown = null;
      try {
        gapStored = gapPoint ? JSON.parse(gapPoint.thresholds) : null;
      } catch {
        gapStored = null;
      }
      const gapThresholds = normalizeThresholds(
        gapStored,
        defaultThresholdsFor(DECISION_POINT_ARTIFACT_CRITERIA),
      );
      const batch = gapsToTriageBatch(gapState.escalated);
      if (batch.items.length === 0)
        return {
          exitCode: 0,
          stdout: "Escalated gaps carry no descriptions to triage.",
        };
      // Genuineness cannot be judged from the gap's wording alone: the
      // judge gets the critique that claimed the gaps plus the working
      // diff that shows whether the code still has them.
      const gapDiff = await workingDiffFor(
        gapWorkspace.path,
        TASK_EVIDENCE_DIFF_CHARS,
      );
      const gapEvidence = buildGapTriageState({
        critiqueText: gapState.critiqueText,
        diff: gapDiff,
      });
      const gapJudged = await judgeScoredBatch({
        items: batch.items,
        questions: batch.questions as Record<string, unknown>,
        keyPrefix: "gap",
        state: gapEvidence,
        mode: gapMode,
        presetId: gapPoint?.preset_id ?? null,
        projectId: gapCard.project_id,
        title: "Stelow judge: gap triage",
        provider: gapProvider,
        endpoint: gapRoute.endpoint ?? defaultEndpointFor(gapProvider),
        apiKey: gapKey ?? "",
        model: normalizeDecisionApiModel(
          gapRoute.model,
          defaultModelFor(gapProvider),
        ),
        routeAt: gapThresholds.routeAt,
      });
      if (!gapJudged.ok)
        return {
          exitCode: 1,
          stderr: `Gap triage failed: ${gapJudged.error} — retry or check the router.`,
        };
      const gapGenuine = gapJudged.findings.filter(
        (finding) => finding.verdict === "met",
      ).length;
      const gapNotReal = gapJudged.findings.filter(
        (finding) => finding.verdict === "unmet",
      ).length;
      const gapUncertain = gapJudged.findings.length - gapGenuine - gapNotReal;
      if (asJson) {
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            {
              card: gapCardId,
              provider: gapProvider,
              evidence: {
                critiqueChars: gapState.critiqueText.length,
                diffChars: gapDiff.length,
              },
              findings: gapJudged.findings,
              summary: {
                genuine: gapGenuine,
                dismissed: gapNotReal,
                unverifiable: gapUncertain,
              },
            },
            null,
            2,
          ),
        };
      }
      const gapMark = (verdict: string) =>
        verdict === "met" ? "✓" : verdict === "unmet" ? "✗" : "?";
      const gapLines = gapJudged.findings.map(
        (finding) =>
          `${gapMark(finding.verdict)} ${finding.verdict}${finding.confidence !== null ? ` (confidence ${finding.confidence})` : ""}: ${finding.name}`,
      );
      const gapBlind =
        gapDiff.length === 0
          ? " (no working-tree diff — judgments rest on the critique alone; commit or stage the work and re-run for code-grounded verdicts)"
          : "";
      return {
        exitCode: 0,
        stdout: [
          `Gap triage (${gapJudged.findings.length} escalated gaps judged for genuineness against the critique and the working diff):`,
          ...gapLines,
          `Summary: ${gapGenuine} genuine, ${gapNotReal} dismissed, ${gapUncertain} unverifiable — advisory only; routing stays deterministic.${gapBlind}`,
        ].join("\n"),
      };
    }
    if (argv[0] === "draft") {
      const result = await drafting.command(argv, ctx.threadId ?? undefined);
      if (result) return result;
    }
    if (argv[0] === "preset") {
      const sub = argv[1];
      // Preset mutation is a host/UI concern (card Agent preset section,
      // Presets screen). A worker thread rewriting the shared preset pool
      // mid-flight would change the brains of every other card — refuse
      // with the redirect. Listing stays open (workers read their assignment).
      if (
        (sub === "add" || sub === "remove" || sub === "assign") &&
        ctx.threadId &&
        getCardByWorkerThread(ctx.threadId)
      ) {
        return {
          exitCode: 1,
          stderr:
            "Refused: presets are managed from the card's Agent preset section (or the Presets screen), never by a worker thread. If you need \
a different brain for this phase, ask for it via `bb stelow ask` instead of reassigning presets yourself.",
        };
      }
      const flag = (name: string, list: string[]) => {
        const index = list.indexOf(name);
        return index >= 0 ? list[index + 1] : undefined;
      };
      if (!sub || sub === "list") {
        const listed = await presetServer.handlers.listPresets();
        return {
          exitCode: 0,
          stdout: listed.presets
            .map((row) =>
              [
                row.id,
                row.isDefault ? "*" : " ",
                row.builtIn ? "B" : " ",
                row.name,
                `${row.providerId}/${row.modelId}`,
                row.reasoningLevel,
                row.permissionMode,
              ].join("\t"),
            )
            .join("\n"),
        };
      }
      if (sub === "add") {
        const args = argv.slice(2);
        const name = flag("--name", args);
        const providerId = flag("--provider", args) ?? "pi";
        const modelId = flag("--model", args) ?? "bifrost/harness-coding";
        const reasoningLevel = flag("--reasoning", args) ?? "medium";
        const permissionMode = flag("--permission", args) ?? "full";
        const environmentKind = (flag("--workspace", args) ??
          "project-default") as "project-default" | "new-worktree";
        const instructions = flag("--instructions", args) ?? "";
        if (!name)
          return {
            exitCode: 2,
            stderr:
              "Usage: bb stelow preset add --name <name> [--provider <id>] [--model <id>] [--reasoning <level>] [--permission <mode>] [--workspace \
<kind>] [--instructions <text>]",
          };
        try {
          const result = await presetServer.handlers.upsertPreset({
            id: null,
            name,
            providerId,
            modelId,
            reasoningLevel,
            permissionMode: permissionMode as "accept-edits" | "auto" | "full",
            environmentKind,
            baseBranch: null,
            machineId: null,
            instructions,
          });
          return {
            exitCode: 0,
            stdout: `OK ${result.preset.id} ${result.preset.name}`,
          };
        } catch (error) {
          return {
            exitCode: 1,
            stderr:
              error instanceof Error ? error.message : "Unable to add preset.",
          };
        }
      }
      if (sub === "remove") {
        const id = argv[2];
        if (!id)
          return { exitCode: 2, stderr: "Usage: bb stelow preset remove <id>" };
        const result = await presetServer.handlers.deletePreset({ id });
        if (!result.deleted)
          return {
            exitCode: 1,
            stderr: result.error ?? "Could not remove preset.",
          };
        return { exitCode: 0, stdout: `Removed ${id}` };
      }
      if (sub === "assign") {
        const args = argv.slice(2);
        const cardId = flag("--card", args);
        const presetId = flag("--preset", args);
        if (!cardId || !presetId)
          return {
            exitCode: 2,
            stderr:
              "Usage: bb stelow preset assign --card <card_id> --preset <preset_id>",
          };
        const result = await presetServer.handlers.assignPreset({
          cardId,
          presetId,
        });
        if (!result.ok)
          return {
            exitCode: 1,
            stderr: result.error ?? "Could not assign preset.",
          };
        return { exitCode: 0, stdout: `Assigned ${presetId} to ${cardId}` };
      }
      return {
        exitCode: 2,
        stderr: "Usage: bb stelow preset list|add|remove|assign",
      };
    }
    return cliUnknownResult(argv);
  }

  registerMentionProviders(bb, {
    db,
    loadBoard: (projectId) => loadBoard(bb, projectId),
  });
}
