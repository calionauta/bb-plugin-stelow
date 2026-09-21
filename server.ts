import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join as nodeJoin, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { isPublishableArtifactContent, parseArtifactManifest, resolveArtifactPath, unregisteredArtifactPaths, buildArtifactTrailer, renderBundleManifest } from "./lib/artifact-manifest.mjs";
import { assignBundleNames, parseBundleManifest, staleBundleEntries, unbundledSources } from "./lib/run-bundle.mjs";
import { PHASE_ENTRY_STAGES, STAGE_BANDS, STAGE_SEQUENCE, STAGE_TO_BAND } from "./lib/workflow-vocabulary.mjs";
import { splitDiffByFile, MAX_DIFF_FILES } from "./lib/diff-split.mjs";
import { summarizeSemDiff } from "./lib/sem-summary.mjs";
import { summarizeCymbalChanged } from "./lib/cymbal-changed.mjs";
import { skippedStages } from "./lib/stage-skips.mjs";
import { ensureInboxResolvedReasonColumn, ensureInboxSeverityColumns, hasPendingReview, insertInboxEvent, listInboxEvents, markQuestionsAnswered, refreshEventSeverity, refreshStalledPaused, resolveActionInboxEvents, syncQuestionInboxEvents } from "./lib/inbox-events.mjs";
import { parseSeverityReasons } from "./lib/inbox-severity.mjs";
import { acquireWorkspaceClaims, addClaimWaiters, CLAIM_TTL_MS, checkWorkspaceClaims, clearClaimWaiters, ensureCardClaimsTables, releaseAllCardClaims, releaseWorkspaceClaims, sweepExpiredClaims, waitersForFiles } from "./lib/card-claims.mjs";
import { isClaimTerminal, errorNeedsAttention } from "./lib/card-terminal.mjs";
import { resolveClaimKey } from "./lib/card-claim-key.mjs";
import { classifyAskCancel, interruptionWhy, isRetryablePersistError } from "./lib/ask-cancel.mjs";
import { questionWaitUpdates, askFinishedUpdates } from "./lib/card-question-state.mjs";
import { parseAskGroups, cleanOptions, normalizeAskArtifactPath, inheritAskArtifact, expandInteractionQuestions, groupBatchAnswers, formatBatchContinuation } from "./lib/question-batch.mjs";
import { decideAskGate } from "./lib/ask-gate.mjs";
import { cleanAnswerList } from "./lib/expired-question-answers.mjs";
import { matchAutomationIssues } from "./lib/automation-rules.mjs";
import { consumeAskContract, recordAskContracts, validateAskContracts } from "./lib/ask-contracts.mjs";
import { resolvePluginRoot } from "./lib/plugin-paths.mjs";
import { loadAboutLogo } from "./lib/about-logo.mjs";
import { applyFailedCheck, mapUpdateEntry, selectOwnEntry } from "./lib/plugin-update.mjs";
import { discardConfirm, discardEligibility, discardTrail } from "./lib/discard-policy.mjs";
import { fetchLatestPluginRelease, isNewerRelease } from "./lib/github-release.mjs";
import { recordWorkerThread, stallCount, refreshRestartPending, healPresetStaleness } from "./lib/worker-ledger.mjs";
import { mergeLineageFile, writeMergedFile } from "./lib/workflow-lineage.mjs";
import { normalizePromoteName, findAdoptableProject } from "./lib/promote-card.mjs";
import { STATE_TEMPLATE } from "./lib/state-template.mjs";
import { workflowDirHash, workflowEntryForOwner, workflowIdForName, workflowStateRelativeDir, ownsWorkflowState, upsertWorkflowEntry } from "./lib/workflow-state-identity.mjs";
import { RESEARCH_STRATEGIES, researchStrategyById, parseStrategyList, expectedSubsteps, missingSubsteps, mergeStrategyContracts } from "./lib/research-strategies.mjs";
import { normalizeHistory, roundTimestamp, roundFileName, parseRoundPath, substepPathsForRound, ROUNDS_DIR } from "./lib/research-rounds.mjs";
import { researchRoundMirrorsIndex, isValidRoundContent, isValidExploreContent, exploreArtifactFile, findInvalidRounds, findInvalidSubsteps, substepQuality, researchVerifyReport, researchVerifyText, exploreVerifyReport, exploreVerifyText } from "./lib/research-artifacts.mjs";
import { validateArtifact, validateSubstep, validateVariant, validateExplore, buildDocDepths, sealStatus } from "./lib/artifact-validation.mjs";
import { buildReviewPrompt, parseReviewOutput, reviewSummary, reviewCoversFingerprint } from "./lib/review-verdict.mjs";
import { assertDisposableSpawn } from "./lib/delegation-map.mjs";
import { resolveDraftPreset, buildDraftPrompt, validateDraftOutput, buildCardNamePrompt, validateCardName, heuristicDisplayName, CARD_NAME_MAX_CHARS } from "./lib/draft-burst.mjs";
import { resolveReliablePreset } from "./lib/reliable-preset.mjs";
import { judgeArtifactCriteria, groupCriteriaByKind, parseCriteriaBlock } from "./lib/skill-criteria.mjs";
import { liveWorkerCards, bandForCardKindStage } from "./lib/preset-staleness.mjs";
import { resolveDecisionApiKey, normalizeDecisionApiModel, isDecisionApiEndpointValid, evaluateDecisionCall, isDecisionApiDisabled, buildProbeCall, meetsDecisionThreshold, normalizeDecisionProvider, providerRequiresKey, defaultEndpointFor, defaultModelFor, DECISION_PROVIDERS } from "./lib/decision-api.mjs";
import { DECISION_POINTS, DECISION_POINT_TRIAGE_INTENT, DECISION_POINT_ARTIFACT_CRITERIA, DECISION_POINT_AUTO_CONTINUE, DECISION_POINT_INBOX_SEVERITY, TRIAGE_INTENT_CRITERIA, getDecisionPoint as getDecisionPointDef, normalizePointMode, defaultThresholdsFor, normalizeThresholds, normalizePointRoute, resolvePointRoute, pointSupportsPresetJudge, triageIntentQuestions, resolveSeedIntent, autoContinueQuestions, resolveAutoContinue, severityBumpQuestions } from "./lib/decision-points.mjs";
import { doingNowNames } from "./lib/doing-now.mjs";
import { scopeFingerprint } from "./lib/scope-fingerprint.mjs";
import { buildPresetJudgePrompt, parsePresetJudgeOutput, PRESET_JUDGE_TIMEOUT_MS, PRESET_JUDGE_POLL_MS } from "./lib/preset-judge.mjs";
import { tasksToScoreQuestions, resolveTaskVerdicts, TASK_EVIDENCE_DIFF_CHARS } from "./lib/task-evidence.mjs";
import { contractForStrategy, contractForBuildArtifact } from "./lib/artifact-contracts.mjs";
import { BOARD_MOVE_COLUMNS, CARD_KINDS, bandForKind, describeCardEnvironment, isLightweightKind, normalizeKind } from "./lib/tracks.mjs";
import { TECHNIQUE_CATALOG, techniqueById } from "./lib/stage-catalog.mjs";
import { parseResearchIndex, checkIndexItems } from "./lib/research-index.mjs";
import { isResearchReadyForReview, researchReadyFingerprint } from "./lib/research-ready.mjs";
import { evidenceStatus } from "./lib/research-evidence.mjs";
import { resolveCardMove } from "./lib/card-move.mjs";
import { isArchivedCard, stripArchivedResuscitation } from "./lib/worker-action-policy.mjs";
import { cliHelpText, cliUsageLine, nearestCommand } from "./lib/cli-suggest.mjs";
import { parsePushRemoteUrl } from "./lib/remote-url.mjs";
import { buildSquashScript, parseSquashOutput, squashExitMessage } from "./lib/squash-merge.mjs";
import { canEditWorkflowIntent, freshStatusForReseed, normalizeBuildSeedIntent, resolveReseedIntent } from "./lib/workflow-intent-policy.mjs";
import { WORKFLOW_SKILLS } from "./lib/workflow-skills-sync.mjs";
import { failureCauseFromEvents, truncateCause } from "./lib/worker-failure.mjs";
import { MAX_SPAWN_RETRIES, claimSpawnRetry, isRetryableSpawnError, resetSpawnRetry, spawnRetryDelayMs } from "./lib/spawn-retry.mjs";
import { PREVIEW_STATES, previewShape, previewText } from "./lib/preview-session.mjs";
import { cardWorkerSeedRefusal, withRuntimeIgnoreEntry } from "./lib/card-seed-guard.mjs";
import { ensureAutoContinueColumns, lastTurnAdvancedStages, nextAutoContinue, resetAutoContinue, shouldAutoContinue, shouldDoneNudge } from "./lib/auto-continue.mjs";
import { SPLIT_KEEP_LABEL, SPLIT_PROPOSAL_TTL_MS, matchSplitDecision, recordSplitAnswer, splitActionState, splitEligibility, splitOutcome, splitRemainder, validateSplitSlices, withStandardSplitDisclosure } from "./lib/split-proposal.mjs";
import { splitQuestionText } from "./lib/split-question-presentation.mjs";
import { askTimelineLabels, describeAskSubmission, englishQuestionContentError } from "./lib/question-presentation.mjs";
import { doneEligibility } from "./lib/completion.mjs";
import { AUDIT_RECEIPT_FILE, AUDIT_RECEIPT_NOTE, auditReceiptReadiness } from "./lib/audit-receipt.mjs";
import { statusForNewCardWork } from "./lib/card-work-resume.mjs";
import { composerPresetOverride, composerSpawnInput } from "./lib/composer-execution.mjs";
import { playbookEntries, renderPlaybook } from "./lib/playbook.mjs";
import { parseWorkflowConfig } from "./lib/workflow-config.mjs";
import { formatReviewGates, legacyLabelForGates, normalizeReviewGates, preReviewArtifactKind } from "./lib/review-gates.mjs";
import { requiredForStage } from "./lib/question-contracts.mjs";
import { checkAdvanceContracts } from "./lib/advance-contracts.mjs";
import { createPreviewRuntime } from "./lib/preview-runtime.mjs";
import { canCommitPublication, canMarkPullRequestDraft, canMarkPullRequestReady, canMergePullRequest, canSquashMerge, publicationBlocker, publicationSource } from "./lib/vcs-publication.mjs";
import { hasWorkspaceSource, recoveryDisposition, recoveryMessage, reportedCheckoutPaths, reportedRecoveryEvidence } from "./lib/workspace-recovery.mjs";
import { detectedTestCommand, sameGitEvidence, verificationReadiness } from "./lib/audit-verification.mjs";
import { AUDIT_TRAIL_FILE, AUDIT_TRAIL_NOTE, auditTrailGate, auditTrailOutcome } from "./lib/audit-trail-contract.mjs";
import { RECON_RECEIPT_FILE, reconReceiptStatus } from "./lib/recon-receipt.mjs";
import { stalenessOf } from "./lib/question-staleness.mjs";
import { tokenUsageFromEvents, tokenBreakdownFromEvents, sumTokenBreakdowns } from "./lib/token-usage.mjs";
import { escalatedGaps, summarizeGaps, validateGapRegistry } from "./lib/gap-registry.mjs";
import { formatDuration, summarizeTimeline, summarizeDurations } from "./lib/card-metrics.mjs";
import { createGithubAutomation, githubIssuesEnabled, githubRpcContract, runGithubMigrations } from "./server/github-issues.js";
import { attachChildTokenUsage, attachChildTokenBreakdown, shapeChildThreads } from "./lib/thread-children.mjs";

const pluginDir = resolvePluginRoot(dirname(fileURLToPath(import.meta.url)), existsSync);
const HELPER_SCRIPT = (() => {
  const candidates = [
    nodeJoin(pluginDir, "data", "stelow"),
    nodeJoin(pluginDir, "..", "data", "stelow"),
  ];
  for (const candidate of candidates) {
    try { if (readFileSync(candidate, "utf8").length > 0) return candidate; } catch { /* try next */ }
  }
  return candidates[0]!;
})();
const PLUGIN_SKILLS_DIR = nodeJoin(pluginDir, "skills");
const PLUGIN_ORCHESTRATOR_REF = nodeJoin(PLUGIN_SKILLS_DIR, "stelow-workflow-orchestrator", "references");

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
  const registry = JSON.parse(readFileSync(nodeJoin(pluginDir, "data", "product-strategies.json"), "utf8"));
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
  for (const candidate of [nodeJoin(pluginDir, "version.json"), nodeJoin(pluginDir, "dist", "version.json"), nodeJoin(pluginDir, "package.json")]) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown; builtAt?: unknown };
      if (typeof parsed.version === "string") {
        version = parsed.version;
        builtAt = typeof parsed.builtAt === "string" ? parsed.builtAt : null;
        break;
      }
    } catch { /* try next */ }
  }
  return { version, builtAt };
})();

/** The upstream version shipped with this plugin release. */
function readPinnedStelowVersion(): string | null {
  for (const candidate of [nodeJoin(pluginDir, "data", "stelow-package.json"), nodeJoin(pluginDir, "..", "data", "stelow-package.json")]) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string") return parsed.version;
    } catch { /* try next */ }
  }
  return null;
}

// Memoized About logo data URI (loaded on first About visit).
let aboutLogoCache: string | null | undefined;

// Stage bands: groups of workflow stages that share a worker preset. A card's
// worker swaps presets only at band boundaries (analysis -> planning -> execution
// -> review), so context continuity is preserved within a band. Research and
// explore cards run single stages with their own band so lightweight tracks
// have an explicit preset default independent of the build analysis phase.
// Bands live in lib/workflow-vocabulary.mjs (single source shared with the panel).

// Pi exposes every route it can delegate to (OpenRouter, OpenCode, Bifrost,
// etc.). Stelow's Pi presets intentionally offer only the configured Bifrost
// routes used by this installation, keeping the picker actionable.
const PI_BIFROST_PRESET_MODELS = [
  { model: "bifrost/harness-coding", displayName: "Harness Coding (Bifrost)" },
  { model: "bifrost/gpt-5.6-sol", displayName: "GPT-5.6 Sol (ChatGPT via Bifrost)" },
  { model: "bifrost/gpt-5.6-terra", displayName: "GPT-5.6 Terra (ChatGPT via Bifrost)" },
  { model: "bifrost/gpt-5.6-luna", displayName: "GPT-5.6 Luna (ChatGPT via Bifrost)" },
] as const;

const statusSchema = z.enum([
  "draft",
  "planning",
  "approved",
  "in-progress",
  "completed",
  "archived",
  "pending",
  "done",
  "skipped",
  "blocked",
  "escalated",
  "failed",
]);

const appetiteSchema = z.enum(["Lean", "Core", "Complete"]);
const reviewModeSchema = z.enum([
  "Auto",
  "Product Spec Gate",
  "Product Spec + Interface Gates",
  "Product Spec + Interface + Scopes",
  "Product Spec + Interface + Tech Review",
  "Product Spec + Interface + Tech Review + Code Diff",
]);
// Canonical storage is the gate set; legacy ladder strings are accepted
// and normalized on read through the compat map (lib/review-gates).
const reviewGateAtomSchema = z.enum(["spec", "interface", "scope", "tech", "diff"]);
const reviewModeInputSchema = z.union([reviewModeSchema, z.array(reviewGateAtomSchema)]).default("Auto");
const boardWorkflowDefaultsSchema = z.object({ appetite: appetiteSchema, reviewMode: z.string(), reviewGates: z.array(reviewGateAtomSchema).default([]) }).strict();

const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: statusSchema,
  source: z.string().optional(),
  note: z.string().optional(),
});

const scopeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  status: statusSchema,
  source: z.string().optional(),
  gap: z.string().optional(),
  tasks: z.array(taskSchema),
});
const artifactSchema = z.object({
  kind: z.enum(["product-spec", "interfaces", "tech-plan", "critique", "other"]),
  label: z.string(),
  path: z.string(),
  approved: z.boolean(),
});

const attachmentSchema = z.object({
  path: z.string().min(1).max(4_000),
  type: z.enum(["localFile", "localImage"]),
}).strict();

// What the user picked in the NewThreadComposer when opening a card. The
// composer's default* props are seeds only — every field stays changeable —
// so creation must carry the submitted choice instead of spawning the
// band/default preset. One schema shared by createCard, createResearchCard
// and createExploreCard; the merge rules live in lib/composer-execution.
const composerExecutionSchema = z.object({
  providerId: z.string().min(1).max(60).optional(),
  model: z.string().min(1).max(120).optional(),
  reasoningLevel: z.string().min(1).max(20).optional(),
  permissionMode: z.enum(["accept-edits", "auto", "full"]).optional(),
  serviceTier: z.enum(["default", "fast"]).optional(),
  executionInputSources: z.object({
    providerId: z.enum(["explicit", "client-preference"]).optional(),
    model: z.enum(["explicit", "client-preference"]).optional(),
    reasoningLevel: z.enum(["explicit", "client-preference"]).optional(),
    permissionMode: z.enum(["explicit", "client-preference"]).optional(),
    serviceTier: z.enum(["explicit", "client-preference"]).optional(),
  }).strict().optional(),
}).strict();

// Ask option detail (mirrors the Option schema in
// orchestrator stages/ask-patterns.md): preview is the inline glance,
// artifact the openable source of truth. Both nullable so label-only
// options (and every historical row) keep working unchanged.
const askArtifactSchema = z.object({
  path: z.string(),
  display: z.string(),
  absolutePath: z.string().nullable(),
  hostId: z.string().nullable(),
});
const askOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
  preview: z.string().nullable(),
  artifact: askArtifactSchema.nullable(),
});

const workflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: statusSchema,
  stage: z.string(),
  appetite: z.string(),
  reviewMode: z.string(),
  reviewGates: z.array(reviewGateAtomSchema),
  dirHash: z.string().optional(),
  cwd: z.string().optional(),
  phases: z.array(z.object({ id: z.string(), name: z.string(), status: statusSchema })),
  scopes: z.array(scopeSchema),
  artifacts: z.array(artifactSchema),
});

const inboxEventSnapshotSchema = z.object({
  id: z.string(),
  kind: z.enum(["question", "error", "paused", "completed"]),
  summary: z.string(),
  occurredAt: z.number(),
  resolvedAt: z.number().nullable(),
  resolvedReason: z.enum(["answered", "superseded", "resumed", "completed", "archived"]).nullable(),
  archivedAt: z.number().nullable(),
  severity: z.number(),
  severityReasons: z.array(z.string()),
});

const publicationCapabilitySchema = z.object({ available: z.boolean(), reason: z.string().nullable() });
const publicationSnapshotSchema = z.object({
  available: z.boolean(),
  message: z.string().nullable(),
  source: z.string().nullable(),
  environmentId: z.string().nullable(),
  isWorktree: z.boolean(),
  branch: z.object({ current: z.string().nullable(), default: z.string().nullable(), headSha: z.string().nullable() }).nullable(),
  workingTree: z.object({ state: z.string(), hasUncommittedChanges: z.boolean(), files: z.number() }).nullable(),
  mergeBase: z.object({ branch: z.string(), ahead: z.number(), behind: z.number(), hasCommittedUnmergedChanges: z.boolean() }).nullable(),
  pullRequest: z.object({ number: z.number(), title: z.string(), url: z.string(), state: z.string(), attention: z.string(), review: z.string(), checks: z.string(), mergeability: z.string() }).nullable(),
  pullRequestMessage: z.string().nullable(),
  capabilities: z.object({ commit: publicationCapabilitySchema, squashMerge: publicationCapabilitySchema, markReady: publicationCapabilitySchema, markDraft: publicationCapabilitySchema, mergePullRequest: publicationCapabilitySchema }),
  events: z.array(z.object({ id: z.string(), action: z.string(), message: z.string(), commitSha: z.string().nullable(), pullRequestUrl: z.string().nullable(), createdAt: z.number() })),
});
const publicationCommitDiffSchema = z.object({
  found: z.boolean(),
  commitSha: z.string().nullable(),
  shortstat: z.string().nullable(),
  files: z.array(z.object({ path: z.string(), display: z.string(), patch: z.string().nullable(), binary: z.boolean(), changeKind: z.string(), additions: z.number(), deletions: z.number(), truncated: z.boolean(), loadMode: z.string() })),
  truncated: z.boolean(),
  error: z.string().nullable(),
});
// BB-native self-update state. Displays ride along because git installs
// report commit shas as versions — the panel formats those, never raw shas.
const pluginUpdateSchema = z.object({
  outcome: z.enum(["checking", "update-available", "current", "incompatible", "pinned", "unavailable"]),
  installed: z.string().nullable(),
  installedDisplay: z.string().nullable(),
  candidate: z.string().nullable(),
  candidateDisplay: z.string().nullable(),
  detail: z.string().nullable(),
  checkedAt: z.number().nullable(),
});

// Newest GitHub release known for installs BB cannot update (supplement to
// the BB verdict, never a competitor): shared by buildInfo and
// checkPluginUpdate so a forced re-check delivers both halves together.
const githubReleaseSchema = z.object({ tag: z.string(), url: z.string(), checkedAt: z.number(), newer: z.boolean() });

export const rpcContract = defineRpcContract({
  board: {
    experimental_description: "Board workflows, stages, and GitHub status for one project",
    input: z.object({ projectId: z.string().nullable() }).strict(),
    output: z.object({
      rootPath: z.string().nullable(),
      workflows: z.array(workflowSchema),
      error: z.string().nullable(),
      githubStatus: z.object({ ok: z.boolean(), pluginAvailable: z.boolean(), ghOk: z.boolean(), repos: z.array(z.object({ repo: z.string(), projectId: z.string().nullable() })) }),
      githubAutomationEnabled: z.boolean(),
    }),
  },
  projects: {
    experimental_description: "Projects BB knows, for board and card pickers",
    input: z.object({}).strict(),
    output: z.object({ projects: z.array(z.object({ id: z.string(), name: z.string() })) }),
  },
  answerQuestions: {
    experimental_description: "Answer a card's live structured questions in one atomic submit",
    input: z.object({ cardId: z.string(), answers: z.array(z.object({ questionId: z.string().min(1).max(200), answers: z.array(z.string().max(2_000)).max(10) })).min(1).max(12) }).strict(),
    output: z.object({ ok: z.boolean(), answered: z.number(), error: z.string().nullable() }),
  },
  ...githubRpcContract,
  listCards: {
    experimental_description: "Cards with status, worker state, and scope progress, optionally by track",
    input: z.object({ projectId: z.string().nullable(), kind: z.enum(["build", "research", "explore"]).nullable().optional() }).strict(),
    output: z.object({ cards: z.array(z.object({ id: z.string(), name: z.string(), displayName: z.string(), prompt: z.string(), intent: z.string(), projectId: z.string(), projectName: z.string(), workspaceKind: z.enum(["project", "exploratory"]), workspacePath: z.string().nullable(), environmentLabel: z.string().nullable(), kind: z.enum(["build", "research", "explore"]), researchStrategy: z.string().nullable(), researchStrategies: z.array(z.string()), exploreStage: z.string().nullable(), status: statusSchema, stage: z.string(), workerThreadId: z.string().nullable(), activity: z.enum(["idle", "running", "awaiting-answer", "error"]), lastError: z.string().nullable(), needsAttention: z.boolean(), hasPendingReview: z.boolean(), presetName: z.string().nullable(), presetProviderId: z.string().nullable(), presetModelId: z.string().nullable(), updatedAt: z.number(), stallCount: z.number(), scopeSummary: z.object({ scopesTotal: z.number(), scopesDone: z.number(), tasksTotal: z.number(), tasksDone: z.number() }), doingNow: z.array(z.string()) })) }),
  },
  listNotifications: {
    experimental_description: "Inbox events: needs-attention first, then completions, history, archived",
    input: z.object({ includeArchived: z.boolean().default(false) }).strict(),
    output: z.object({ notifications: z.array(inboxEventSnapshotSchema.extend({ cardId: z.string(), cardName: z.string(), projectName: z.string(), cardKind: z.enum(["build", "research", "explore"]), readAt: z.number().nullable() })) }),
  },
  markNotificationRead: {
    experimental_description: "Mark one inbox event read",
    input: z.object({ notificationId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  markCardNotificationsRead: {
    experimental_description: "Mark a card's events of one kind read",
    input: z.object({ cardId: z.string(), kind: z.enum(["question", "error", "paused", "completed"]) }).strict(),
    output: z.object({ marked: z.boolean() }),
  },
  archiveNotification: {
    experimental_description: "Archive one inbox event",
    input: z.object({ notificationId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  restoreNotification: {
    experimental_description: "Restore an archived inbox event to history",
    input: z.object({ notificationId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  cardByWorkerThread: {
    experimental_description: "Find the card that owns a worker thread",
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ cardId: z.string().nullable(), kind: z.enum(["build", "research", "explore"]).nullable() }),
  },
  getNotification: {
    experimental_description: "One inbox event for a card",
    input: z.object({ notificationId: z.string(), cardId: z.string() }).strict(),
    output: z.object({ notification: inboxEventSnapshotSchema.nullable() }),
  },
  readCardFile: {
    experimental_description: "Read a workspace file through the card's checkout",
    input: z.object({ cardId: z.string(), path: z.string().min(1).max(4_000) }).strict(),
    output: z.object({ content: z.string().nullable(), truncated: z.boolean(), error: z.string().nullable() }),
  },
  qualitySeal: {
    experimental_description: "Verification seal for an artifact path",
    input: z.object({ cardId: z.string().nullable().optional(), threadId: z.string().nullable().optional(), path: z.string().min(1).max(4_000) }).strict(),
    output: z.object({ status: z.enum(["verified", "hypothesis-only", "needs-revision", "unverified"]), failures: z.array(z.string()), evidence: z.string().nullable(), label: z.string().nullable() }),
  },
  gapSummary: {
    experimental_description: "Execution-critique gaps: totals, pending scopes, lead and cycle time",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      matched: z.boolean(),
      total: z.number(), fixed: z.number(), documented: z.number(), escalated: z.number(),
      items: z.array(z.object({ description: z.string(), scopeStatus: z.string().nullable() })),
      pendingScopes: z.number(), unscoped: z.number(),
      leadMs: z.number().nullable(), cycleMs: z.number().nullable(), done: z.boolean(),
    }),
  },
  flowMetrics: {
    experimental_description: "Lead/cycle per finished card with p50/p90, plus stuck and review-awaiting now",
    input: z.object({ projectId: z.string().nullable().optional(), since: z.number().int().nonnegative().nullable().optional(), until: z.number().int().nonnegative().nullable().optional() }).strict(),
    output: z.object({
      items: z.array(z.object({ cardId: z.string(), kind: z.enum(["build", "research", "explore"]), name: z.string(), leadMs: z.number().nullable(), cycleMs: z.number().nullable(), doneAt: z.number().nullable() })),
      summary: z.object({ count: z.number(), leadP50Ms: z.number().nullable(), leadP90Ms: z.number().nullable(), cycleP50Ms: z.number().nullable(), cycleP90Ms: z.number().nullable() }),
      attention: z.array(z.object({ cardId: z.string(), kind: z.enum(["build", "research", "explore"]), name: z.string(), reason: z.enum(["stuck", "review"]) })),
    }),
  },
  boardWorkflowDefaults: {
    experimental_description: "Board defaults: planning depth and review gates for new cards",
    input: z.object({}).strict(),
    output: boardWorkflowDefaultsSchema,
  },
  createCard: {
    experimental_description: "Create a build card and optionally start its triage worker",
    input: z.object({ projectId: z.string(), environment: z.unknown(), prompt: z.string().min(1).max(20_000), attachments: z.array(attachmentSchema).max(20).default([]), intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate", "unknown"]).default("unknown"), appetite: appetiteSchema.default("Lean"), reviewMode: reviewModeInputSchema, presetId: z.string().nullable().optional(), start: z.boolean().default(true), execution: composerExecutionSchema.optional() }).strict(),
    output: z.object({ cardId: z.string(), threadId: z.string().nullable() }),
  },
  updateCardIntent: {
    experimental_description: "Correct a build card's workflow type while it is still in triage",
    input: z.object({ cardId: z.string(), intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate", "unknown"]) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  renameCard: {
    experimental_description: "Rename a card's display title (1-120 chars); blank restores the heuristic",
    input: z.object({ cardId: z.string(), name: z.string().max(120) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  cardDetail: {
    experimental_description: "Full card picture: scopes, questions, artifacts, workers, Git state",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      card: z.object({ id: z.string(), name: z.string(), displayName: z.string(), prompt: z.string(), intent: z.string(), projectId: z.string(), projectName: z.string(), workspaceKind: z.enum(["project", "exploratory"]), workspacePath: z.string().nullable(), environmentLabel: z.string().nullable(), kind: z.enum(["build", "research", "explore"]), researchStrategy: z.string().nullable(), researchStrategies: z.array(z.string()), exploreStage: z.string().nullable(), status: statusSchema, stage: z.string(), workerThreadId: z.string().nullable(), activity: z.enum(["idle", "running", "awaiting-answer", "error"]), lastError: z.string().nullable(), needsAttention: z.boolean(), hasPendingReview: z.boolean(), presetName: z.string().nullable(), presetProviderId: z.string().nullable(), presetModelId: z.string().nullable(), presetOverridden: z.boolean(), updatedAt: z.number(), stallCount: z.number(), scopeSummary: z.object({ scopesTotal: z.number(), scopesDone: z.number(), tasksTotal: z.number(), tasksDone: z.number() }), presetId: z.string(), workerPresetId: z.string().nullable(), presetRestartPending: z.boolean(), leadMs: z.number().nullable(), cycleMs: z.number().nullable(), doingNow: z.array(z.string()) }),
      attachments: z.array(attachmentSchema.extend({ display: z.string(), relPath: z.string().nullable(), absolutePath: z.string(), hostId: z.string().nullable() })),
      mentionedFiles: z.array(z.object({ path: z.string(), display: z.string(), absolutePath: z.string(), hostId: z.string(), relPath: z.string().nullable() })),
      scopes: z.array(z.object({ id: z.string(), name: z.string(), type: z.string().optional(), status: statusSchema, source: z.string().optional(), gap: z.string().optional(), blockedBy: z.array(z.string()).optional(), dependsOn: z.array(z.string()).optional(), tasks: z.array(z.object({ id: z.string(), name: z.string(), status: statusSchema, source: z.string().optional(), note: z.string().optional(), blockedBy: z.array(z.string()).optional(), dependsOn: z.array(z.string()).optional() })) })),
      comments: z.array(z.object({ id: z.string(), target: z.enum(["card", "scope", "task"]), targetId: z.string(), author: z.enum(["user", "agent"]), body: z.string(), createdAt: z.number() })),
      pendingQuestions: z.array(z.object({ id: z.string(), title: z.string(), question: z.string(), multiple: z.boolean(), kind: z.enum(["standard", "split"]), options: z.array(askOptionSchema), expiresAt: z.number().nullable(), staleness: z.object({ docRevised: z.boolean(), docRemoved: z.boolean(), checkoutMoved: z.boolean(), commitCount: z.number(), touchedPaths: z.array(z.string()) }).nullable().optional() })),
      expiredQuestions: z.array(z.object({ id: z.string(), question: z.string(), multiple: z.boolean(), kind: z.enum(["standard", "split"]), options: z.array(askOptionSchema), expiredAt: z.number(), staleness: z.object({ docRevised: z.boolean(), docRemoved: z.boolean(), checkoutMoved: z.boolean(), commitCount: z.number(), touchedPaths: z.array(z.string()) }).nullable().optional() })),
      // Dumb-UI split flag: the card reads show/ok/reason, never
      // re-implements stage rules (single source: lib/split-proposal).
      splitAction: z.object({ show: z.boolean(), ok: z.boolean(), reason: z.string().nullable() }),
      stageSkips: z.object({ offRoute: z.array(z.string()), skipped: z.array(z.object({ stage: z.string(), reason: z.string() })) }),
      artifacts: z.array(z.object({ stage: z.string(), kind: z.string(), path: z.string(), display: z.string(), generatedAt: z.string(), absolutePath: z.string(), hostId: z.string(), note: z.string().nullable().optional() })),
      workerHistory: z.array(z.object({ threadId: z.string(), presetName: z.string().nullable(), startedAt: z.number(), endedAt: z.number().nullable(), endedReason: z.string().nullable(), tokenUsage: z.number().nullable(), tokenBreakdown: z.object({ input: z.number().nullable(), output: z.number().nullable(), cached: z.number().nullable(), reasoning: z.number().nullable(), total: z.number().nullable() }).nullable(), children: z.array(z.object({ threadId: z.string(), title: z.string().nullable(), status: z.string(), providerId: z.string().nullable(), tokenUsage: z.number().nullable(), tokenBreakdown: z.object({ input: z.number().nullable(), output: z.number().nullable(), cached: z.number().nullable(), reasoning: z.number().nullable(), total: z.number().nullable() }).nullable() })) })),
      // Environment of the worker thread: enables workspace-kind file links
      // (the official viewer with comments). Host-kind links fail for
      // exploratory workspaces, which live outside provisioned environments.
      fileEnvironmentId: z.string().nullable(),
      nextStages: z.array(z.string()),
      githubLink: z.object({ repo: z.string(), number: z.number().int().positive(), url: z.string(), postedAt: z.number().nullable() }).nullable(),
    }),
  },
  addCardComment: {
    experimental_description: "Comment on a card, scope, or task; the worker sees it",
    input: z.object({ cardId: z.string(), target: z.enum(["card", "scope", "task"]), targetId: z.string(), body: z.string().min(1).max(10_000) }).strict(),
    output: z.object({ commentId: z.string(), error: z.string().nullable() }),
  },
  cancelCard: {
    experimental_description: "Stop the worker and archive the card; history preserved",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ archived: z.boolean() }),
  },
  deleteCard: {
    experimental_description: "Hard-delete an archived card, its rows, and its run files",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ deleted: z.boolean(), error: z.string().nullable() }),
  },
  discardPreview: {
    experimental_description: "Preview destroying unpushed work before archiving, blast radius first",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ eligible: z.boolean(), action: z.enum(["worktree-drop", "branch-reset", "dir-delete"]).nullable(), reason: z.string().nullable(), branch: z.string().nullable(), files: z.array(z.string()), fileCount: z.number(), commitCount: z.number(), sharedWith: z.number(), confirmTitle: z.string().nullable(), confirmBody: z.string().nullable(), error: z.string().nullable() }),
  },
  discardCardChanges: {
    experimental_description: "Destroy unpushed work, then archive; leaves an audit trail",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), summary: z.string().nullable(), error: z.string().nullable() }),
  },
  reseedCard: {
    experimental_description: "Restart a card fresh from triage; scopes and comments kept",
    input: z.object({ cardId: z.string(), presetId: z.string().nullable().optional(), intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate", "unknown"]).optional() }).strict(),
    output: z.object({ reseeded: z.boolean(), error: z.string().nullable(), reclassified: z.boolean() }),
  },
  retryWorker: {
    experimental_description: "Nudge the same worker in place; nothing resets",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  restartWorker: {
    experimental_description: "Fresh worker thread on the current preset from the current stage",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  startWorker: {
    experimental_description: "Start a parked inbox card's worker",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  requestSplitProposal: {
    experimental_description: "Ask the worker for a one-time card-split proposal",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  moveCard: {
    experimental_description: "Move a card between board columns, Bucket rules enforced",
    input: z.object({ cardId: z.string(), status: z.enum(BOARD_MOVE_COLUMNS as [string, ...string[]]) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  researchStrategies: {
    experimental_description: "Research strategy catalog: labels, skills, keywords",
    input: z.object({}).strict(),
    output: z.object({ strategies: z.array(z.object({ id: z.string(), label: z.string(), skill: z.string(), blurb: z.string(), emoji: z.string(), keywords: z.array(z.string()) })) }),
  },
  createResearchCard: {
    experimental_description: "Create a research card and optionally start its worker",
    input: z.object({ projectId: z.string(), environment: z.unknown(), prompt: z.string().min(1).max(20_000), attachments: z.array(attachmentSchema).max(20).default([]), strategy: z.string().min(1).max(60), presetId: z.string().nullable().optional(), start: z.boolean().default(true), execution: composerExecutionSchema.optional() }).strict(),
    output: z.object({ cardId: z.string(), threadId: z.string().nullable() }),
  },
  createExploreCard: {
    experimental_description: "Create an explore card for one technique and optionally start it",
    input: z.object({ projectId: z.string(), environment: z.unknown(), prompt: z.string().min(1).max(20_000), attachments: z.array(attachmentSchema).max(20).default([]), stageId: z.string().min(1).max(60), presetId: z.string().nullable().optional(), start: z.boolean().default(true), execution: composerExecutionSchema.optional() }).strict(),
    output: z.object({ cardId: z.string(), threadId: z.string().nullable() }),
  },
  stageCatalog: {
    experimental_description: "Explore technique catalog: labels, skills, keywords",
    input: z.object({}).strict(),
    output: z.object({ stages: z.array(z.object({ id: z.string(), label: z.string(), skill: z.string(), emoji: z.string(), blurb: z.string(), keywords: z.array(z.string()) })) }),
  },
  researchIndex: {
    experimental_description: "Research index with ranked opportunities and round readiness",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ found: z.boolean(), indexPath: z.string().nullable(), content: z.string().nullable(), truncated: z.boolean(), opportunities: z.array(z.object({ id: z.string(), title: z.string(), checked: z.boolean(), group: z.string().nullable() })), rounds: z.array(z.object({ n: z.number(), strategyId: z.string(), label: z.string(), emoji: z.string(), at: z.string(), status: z.enum(["ready", "pending", "missing"]), missing: z.array(z.string()), substeps: z.array(z.object({ slug: z.string(), status: z.enum(["ready", "missing", "invalid", "needs-depth"]) })), files: z.array(z.object({ display: z.string(), path: z.string(), absolutePath: z.string(), hostId: z.string(), generatedAt: z.string() })) })), error: z.string().nullable() }),
  },
  fanOutResearch: {
    experimental_description: "Fan checked index opportunities out into build cards",
    input: z.object({ cardId: z.string(), opportunityIds: z.array(z.string().min(1).max(120)).min(1).max(20) }).strict(),
    output: z.object({ ok: z.boolean(), created: z.array(z.object({ cardId: z.string(), title: z.string() })), error: z.string().nullable() }),
  },
  cardDiff: {
    experimental_description: "Working-tree diff vs HEAD with entity and symbol summaries",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ found: z.boolean(), isRepo: z.boolean(), files: z.array(z.object({ path: z.string(), display: z.string(), patch: z.string().nullable(), isNew: z.boolean(), absolutePath: z.string(), hostId: z.string() })), truncated: z.boolean(), entitySummary: z.object({ total: z.number(), fileCount: z.number(), added: z.number(), modified: z.number(), deleted: z.number(), renamed: z.number(), moved: z.number(), cosmeticOnly: z.boolean() }).nullable(), changedSymbols: z.array(z.object({ symbol: z.string(), files: z.array(z.string()), callers: z.number(), testCallers: z.number() })).nullable(), error: z.string().nullable() }),
  },
  auditTrailStatus: {
    experimental_description: "Audit-trail verification state for a build card",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      state: z.enum(["verified", "changed", "missing", "refused", "unsupported", "unavailable"]),
      detail: z.string().nullable(),
      head: z.string().nullable(),
      path: z.string().nullable(),
      contract: z.string().nullable(),
      recon: z.object({ state: z.enum(["recorded", "missing", "invalid"]), detail: z.string() }).nullable(),
    }),
  },
  publicationStatus: {
    experimental_description: "Git publication snapshot: branch, tree, merge-base, PR, capabilities",
    input: z.object({ cardId: z.string() }).strict(),
    output: publicationSnapshotSchema,
  },
  publicationCommitDiff: {
    experimental_description: "Read-only diff of one recorded publication commit",
    input: z.object({ cardId: z.string(), commitSha: z.string().regex(/^[0-9a-f]{7,64}$/i) }).strict(),
    output: publicationCommitDiffSchema,
  },
  publicationCommit: {
    experimental_description: "Save a local commit in the card's checkout through BB",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), message: z.string(), commitSha: z.string().nullable() }),
  },
  publicationSquashMerge: {
    experimental_description: "Squash branch commits into one local commit on the base branch",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), message: z.string(), commitSha: z.string().nullable() }),
  },
  publicationPushTerminal: {
    experimental_description: "Push the branch in the card's own terminal and stream the result",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), message: z.string(), terminalId: z.string().nullable() }),
  },
  publicationPullPush: {
    experimental_description: "Pull with rebase then push in the card's checkout, the rejected-push fix",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), message: z.string(), terminalId: z.string().nullable() }),
  },
  publicationPushTerminals: {
    experimental_description: "Live push shells for a card with readable output tails",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable(), remote: z.object({ owner: z.string(), repo: z.string(), webUrl: z.string() }).nullable(), terminals: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), exitCode: z.number().nullable(), createdAt: z.number(), pushState: z.enum(["waiting", "running", "succeeded", "failed"]), pushExit: z.number().nullable(), outputTail: z.string().nullable(), outputUnavailable: z.boolean() })) }),
  },
  publicationPullRequestAction: {
    experimental_description: "Mark a PR ready or draft, or merge it; checks stay authoritative",
    input: z.object({ cardId: z.string(), operation: z.enum(["ready", "draft", "merge"]), method: z.enum(["merge", "rebase", "squash"]).optional() }).strict(),
    output: z.object({ ok: z.boolean(), message: z.string(), pullRequestUrl: z.string().nullable() }),
  },
  runResearchStrategy: {
    experimental_description: "Run one more research strategy round on a card",
    input: z.object({ cardId: z.string(), strategy: z.string().min(1).max(60) }).strict(),
    output: z.object({ ok: z.boolean(), strategy: z.string().nullable(), error: z.string().nullable() }),
  },
  promoteCard: {
    experimental_description: "Turn an exploratory card into a real BB project, files in place",
    input: z.object({ cardId: z.string(), name: z.string().min(1).max(120) }).strict(),
    output: z.object({ ok: z.boolean(), projectId: z.string().nullable(), projectName: z.string().nullable(), threadId: z.string().nullable(), error: z.string().nullable() }),
  },
  workspaceRecovery: {
    experimental_description: "One evidenced next step for work that happened elsewhere",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ kind: z.enum(["attached", "promote", "external-project", "ambiguous", "documents-only"]), message: z.string(), workspace: z.object({ path: z.string().nullable(), isGit: z.boolean(), hasSource: z.boolean() }), candidates: z.array(z.object({ projectId: z.string(), projectName: z.string(), path: z.string(), branch: z.string().nullable(), headSha: z.string().nullable(), changedFiles: z.number(), evidence: z.string() })), looseEvidence: z.array(z.object({ path: z.string(), kind: z.enum(["folder", "patch"]) })), recovery: z.object({ projectId: z.string(), projectName: z.string(), path: z.string(), attachedAt: z.number() }).nullable(), audit: z.object({ cardId: z.string(), cardName: z.string(), createdAt: z.number() }).nullable(), error: z.string().nullable() }),
  },
  attachRecoveryCheckout: {
    experimental_description: "Attach a reviewed registered checkout to an exploratory card",
    input: z.object({ cardId: z.string(), projectId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  createRecoveryAudit: {
    experimental_description: "Create a build card auditing an attached recovery checkout",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), auditCardId: z.string().nullable(), auditCardName: z.string().nullable(), error: z.string().nullable() }),
  },
  answerExpiredQuestions: {
    experimental_description: "Answer timed-out questions from the card, all-or-nothing like live",
    input: z.object({ cardId: z.string(), answers: z.array(z.object({ questionId: z.string().min(1).max(200), answers: z.array(z.string().min(1).max(10_000)).min(1).max(20) })).min(1).max(12) }).strict(),
    output: z.object({ ok: z.boolean(), answered: z.number(), error: z.string().nullable() }),
  },
  advanceCard: {
    experimental_description: "Advance a card to a stage preview under upstream transition rules",
    input: z.object({ cardId: z.string(), stage: z.string().min(1).max(40) }).strict(),
    output: z.object({ ok: z.boolean(), stdout: z.string(), error: z.string().nullable() }),
  },
  approveGate: {
    experimental_description: "Approve a review gate and write its receipt file",
    input: z.object({ projectId: z.string().nullable(), workflowId: z.string(), gate: z.enum(["gate", "int-gate", "plan-gate", "diff-gate"]) }).strict(),
    output: z.object({ approved: z.boolean(), receiptPath: z.string().nullable(), error: z.string().nullable() }),
  },
  startWorkflow: {
    experimental_description: "Start a cardless workflow thread (legacy entry)",
    input: z.object({ projectId: z.string(), prompt: z.string().min(1).max(20_000) }).strict(),
    output: z.object({ threadId: z.string() }),
  },
  advance: {
    experimental_description: "Advance a cardless workflow (legacy entry)",
    input: z.object({ projectId: z.string().nullable(), stage: z.string().min(1).max(40) }).strict(),
    output: z.object({ stage: z.string(), stdout: z.string(), error: z.string().nullable() }),
  },
  ensureWorkflow: {
    experimental_description: "Seed state files for a cardless workflow (legacy entry)",
    input: z.object({ projectId: z.string().nullable(), name: z.string().min(1).max(120), intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate"]) }).strict(),
    output: z.object({ rootPath: z.string().nullable(), statePath: z.string().nullable(), error: z.string().nullable() }),
  },
  listPresets: {
    experimental_description: "Agent presets: provider, model, reasoning, permission, environment",
    input: z.object({}).strict(),
    output: z.object({ presets: z.array(z.object({ id: z.string(), name: z.string(), providerId: z.string(), modelId: z.string(), reasoningLevel: z.string(), permissionMode: z.string(), environmentKind: z.string(), baseBranch: z.string().nullable(), machineId: z.string().nullable(), instructions: z.string(), isDefault: z.boolean(), builtIn: z.boolean() })) }),
  },
  upsertPreset: {
    experimental_description: "Create or update an agent preset; built-ins protected",
    input: z.object({
      id: z.string().min(1).nullable().optional(),
      name: z.string().min(1).max(60),
      providerId: z.string().min(1).max(60),
      modelId: z.string().min(1).max(120),
      reasoningLevel: z.string().min(1).max(20),
      permissionMode: z.enum(["accept-edits", "auto", "full"]),
      environmentKind: z.enum(["project-default", "new-worktree"]).default("project-default"),
      baseBranch: z.string().nullable().optional(),
      machineId: z.string().nullable().optional(),
      instructions: z.string().max(8_000).default(""),
    }).strict(),
    output: z.object({ preset: z.object({ id: z.string(), name: z.string() }) }),
  },
  deletePreset: {
    experimental_description: "Delete a custom agent preset",
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ deleted: z.boolean(), error: z.string().nullable() }),
  },
  listBandPresets: {
    experimental_description: "Per-phase worker preset routing with stage lists",
    input: z.object({}).strict(),
    output: z.object({ bands: z.array(z.object({ band: z.string(), presetId: z.string().nullable(), stages: z.array(z.string()) })) }),
  },
  setBandPreset: {
    experimental_description: "Pin a preset to a workflow band; null inherits",
    input: z.object({ band: z.string(), presetId: z.string().nullable() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  getReviewPreset: {
    experimental_description: "Designated independent reviewer preset, if any",
    input: z.object({}).strict(),
    output: z.object({ preset: z.object({ id: z.string(), name: z.string(), providerId: z.string(), modelId: z.string(), reasoningLevel: z.string(), permissionMode: z.string() }).nullable() }),
  },
  assignReviewPreset: {
    experimental_description: "Designate the reviewer preset; null clears",
    input: z.object({ presetId: z.string().nullable() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  getGenerationPreset: {
    experimental_description: "Designated draft-generation preset, if any",
    input: z.object({}).strict(),
    output: z.object({ preset: z.object({ id: z.string(), name: z.string(), providerId: z.string(), modelId: z.string(), reasoningLevel: z.string(), permissionMode: z.string() }).nullable() }),
  },
  assignGenerationPreset: {
    experimental_description: "Designate the draft-generation preset; null clears",
    input: z.object({ presetId: z.string().nullable() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  getReliablePreset: {
    experimental_description: "Board-level reliable-tier preset override, if any",
    input: z.object({}).strict(),
    output: z.object({ preset: z.object({ id: z.string(), name: z.string(), providerId: z.string(), modelId: z.string(), reasoningLevel: z.string(), permissionMode: z.string() }).nullable() }),
  },
  assignReliablePreset: {
    experimental_description: "Set the reliable-tier preset override; null clears",
    input: z.object({ presetId: z.string().nullable() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  getDecisionApiConfig: {
    experimental_description: "Decision API endpoint, model, and key presence, never the key",
    input: z.object({}).strict(),
    output: z.object({ endpoint: z.string(), model: z.string(), hasKey: z.boolean(), keySource: z.string().nullable(), keyRequired: z.boolean(), disabled: z.boolean(), provider: z.string(), configured: z.boolean() }),
  },
  setDecisionApiConfig: {
    experimental_description: "Configure the shared decision endpoint: endpoint, key, model",
    input: z.object({ endpoint: z.string().max(500).nullable().optional(), apiKey: z.string().max(1000).nullable().optional(), model: z.string().max(120).nullable().optional(), provider: z.string().max(20).nullable().optional() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  testDecisionApi: {
    experimental_description: "Probe the decision endpoint with one fixed call and latency",
    input: z.object({}).strict(),
    output: z.object({ ok: z.boolean(), latencyMs: z.number().nullable(), model: z.string().nullable(), error: z.string().nullable() }),
  },
  getDecisionPoint: {
    experimental_description: "One decision router's mode, thresholds, route override, and judge preset",
    input: z.object({ point: z.string() }).strict(),
    output: z.object({ point: z.string(), mode: z.string(), thresholds: z.record(z.string(), z.number()), route: z.object({ provider: z.string().nullable(), endpoint: z.string().nullable(), apiKey: z.string().nullable(), model: z.string().nullable() }).nullable(), presetId: z.string().nullable() }),
  },
  listDecisionPoints: {
    experimental_description: "Every decision router with rules, modes, and current settings",
    input: z.object({}).strict(),
    output: z.object({ points: z.array(z.object({ id: z.string(), label: z.string(), description: z.string(), rules: z.string(), requires: z.string().nullable(), modes: z.array(z.string()), mode: z.string(), thresholds: z.record(z.string(), z.number()), route: z.object({ provider: z.string().nullable(), endpoint: z.string().nullable(), apiKey: z.string().nullable(), model: z.string().nullable() }).nullable(), presetId: z.string().nullable() })) }),
  },
  setDecisionPoint: {
    experimental_description: "Set a decision router's mode, thresholds, route override, and judge preset",
    input: z.object({ point: z.string(), mode: z.string(), thresholds: z.record(z.string(), z.number()).optional(), route: z.object({ provider: z.string().max(40).nullable().optional(), endpoint: z.string().max(500).nullable().optional(), apiKey: z.string().max(1000).nullable().optional(), model: z.string().max(120).nullable().optional() }).strict().nullable().optional(), presetId: z.string().max(200).nullable().optional() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  getReviewPolicy: {
    experimental_description: "Independent-review gate policy: off or required",
    input: z.object({}).strict(),
    output: z.object({ mode: z.enum(["off", "required"]) }),
  },
  setReviewPolicy: {
    experimental_description: "Set the independent-review gate policy",
    input: z.object({ mode: z.enum(["off", "required"]) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  assignPreset: {
    experimental_description: "Pin a preset to one card; takes effect on restart",
    input: z.object({ cardId: z.string(), presetId: z.string().nullable() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  setDefaultPreset: {
    experimental_description: "Set the board default agent preset",
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  listProviderModels: {
    experimental_description: "BB provider catalog with model availability for preset pickers",
    input: z.object({}).strict(),
    output: z.object({
      providers: z.array(z.object({ id: z.string(), displayName: z.string(), modelsAvailable: z.boolean() })),
      models: z.array(z.object({ providerId: z.string(), model: z.string(), displayName: z.string() })),
    }),
  },
  buildInfo: {
    experimental_description: "Plugin and upstream versions, skills, and update verdicts",
    input: z.object({}).strict(),
    output: z.object({ version: z.string(), builtAt: z.string().nullable(), stelowVersion: z.string().nullable(), skills: z.array(z.string()), pluginUpdate: pluginUpdateSchema, githubRelease: githubReleaseSchema.nullable() }),
  },
  applyPluginUpdate: {
    experimental_description: "Apply a BB-offered plugin update behind explicit confirmation",
    input: z.object({}).strict(),
    output: z.object({ applied: z.boolean(), outcome: z.enum(["rolled-back", "current", "updated", "unavailable"]), detail: z.string().nullable(), from: z.string().nullable(), to: z.string().nullable() }),
  },
  checkPluginUpdate: {
    experimental_description: "Force a fresh plugin update check: BB plus GitHub release",
    input: z.object({}).strict(),
    output: z.object({ pluginUpdate: pluginUpdateSchema, githubRelease: githubReleaseSchema.nullable() }),
  },
  aboutLogo: {
    experimental_description: "Product identity mark as a data URI; BB serves no static files",
    input: z.object({}).strict(),
    output: z.object({ dataUri: z.string().nullable() }),
  },
  toolStatus: {
    experimental_description: "Host binaries the workflow can use: sem, cymbal, ripwire, ast-grep",
    input: z.object({}).strict(),
    output: z.object({ tools: z.array(z.object({ id: z.string(), present: z.boolean(), version: z.string().nullable() })) }),
  },
  installTool: {
    experimental_description: "Install one optional host tool with the official installer",
    input: z.object({ id: z.enum(["sem", "ast-grep", "cymbal", "ripwire"]) }).strict(),
    output: z.object({ ok: z.boolean(), version: z.string().nullable(), log: z.string() }),
  },
  previewState: {
    experimental_description: "Dev-server preview state: address, command, log, share hints",
    input: z.object({ cardId: z.string(), appOrigin: z.string().nullable().optional() }).strict(),
    output: z.object({
      available: z.boolean(),
      error: z.string().nullable(),
      checkout: z.string().nullable(),
      source: z.string().nullable(),
      label: z.string().nullable(),
      evidence: z.string().nullable(),
      state: z.enum([...PREVIEW_STATES]),
      command: z.string().nullable(),
      port: z.number().nullable(),
      url: z.string().nullable(),
      provider: z.string().nullable(),
      reason: z.string().nullable(),
      frame: z.enum(["frame", "open", "copy"]).nullable(),
      frameReason: z.string().nullable(),
      paired: z.boolean(),
      hints: z.array(z.object({ tone: z.enum(["info", "warn"]), text: z.string(), action: z.string().nullable(), href: z.string().nullable() })),
      log: z.string(),
      startedAt: z.number().nullable(),
    }),
  },
  previewStart: {
    experimental_description: "Start the card workspace's dev server on loopback",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  previewStop: {
    experimental_description: "Stop the card workspace's dev server",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  previewShare: {
    experimental_description: "Retry the Connect share URL for a live preview",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
});

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
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as LooseRecord : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeStatus(value: unknown): z.infer<typeof statusSchema> {
  const candidate = text(value, "pending");
  return statusSchema.safeParse(candidate).success ? candidate as z.infer<typeof statusSchema> : "pending";
}

// Short human status for the GitHub completion summary (English).
function statusLabelForSummary(status: string): string {
  if (status === "in-progress") return "in progress";
  if (status === "done" || status === "completed") return "done";
  return status;
}

async function projectRoot(bb: BbPluginApi, projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  try {
    const project = await bb.sdk.projects.get({ projectId });
    const source = project.sources.find((entry) => entry.isDefault) ?? project.sources[0];
    return source?.path ?? null;
  } catch {
    return null;
  }
}

// Resolve a card's state only when both persisted ownership records agree.
// A matching name or dirHash alone is deliberately insufficient: projects can
// contain repeated requests and converted exploratory workspaces.
async function workflowStateDir(bb: BbPluginApi, rootPath: string, workflowId: string, dirHash: string): Promise<string | null> {
  try {
    const tracking = await readJson(bb.sdk.files, join(rootPath, "stelow.json"));
    const workflow = workflowEntryForOwner(array(tracking?.workflows), workflowId, dirHash);
    const relativeDir = workflowStateRelativeDir(workflow);
    if (!relativeDir) return null;
    const stateDir = join(rootPath, relativeDir);
    const state = await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((file) => file.content).catch(() => null);
    return ownsWorkflowState(state, workflowId) ? stateDir : null;
  } catch {
    return null;
  }
}

function join(root: string, relative: string): string {
  return `${root.replace(/\/$/, "")}/${relative.replace(/^\//, "")}`;
}

function fileTimestamp(file: { modifiedAtMs?: unknown } | null, fallback: string): string {
  const modifiedAtMs = file?.modifiedAtMs;
  return typeof modifiedAtMs === "number" && Number.isFinite(modifiedAtMs) && modifiedAtMs > 0
    ? new Date(modifiedAtMs).toISOString()
    : fallback;
}

function safeRelative(path: string): string {
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === "..")) {
    throw new Error("Path must stay inside the project workspace.");
  }
  return path;
}

async function seedWorkflow(bb: BbPluginApi, rootPath: string, workflowId: string, name: string, intent: string, appetite = "Core", reviewMode: string | string[] = "Auto", fresh = false): Promise<{ statePath: string | null; stateDir: string | null; dirHash: string | null; error: string | null }> {
  const transitionsPath = join(rootPath, "skills/stelow-workflow-orchestrator/references/transitions.md");
  const trackingPath = join(rootPath, "stelow.json");
  try {
    mkdirSync(join(rootPath, ".stelow/approvals"), { recursive: true });
    mkdirSync(join(rootPath, "skills/stelow-workflow-orchestrator/references"), { recursive: true });
    // Live runs stay out of git: a worker `git add -A` must never sweep
    // `.stelow/` into the project history — the committed record is the
    // exported docs/runs/<card>/ bundle. Best-effort, git checkouts only,
    // never blocks seeding.
    try {
      if (existsSync(join(rootPath, ".git"))) {
        const ignorePath = join(rootPath, ".gitignore");
        let current = "";
        try { current = readFileSync(ignorePath, "utf8"); } catch { /* created below */ }
        const next = withRuntimeIgnoreEntry(current);
        if (next !== null) writeFileSync(ignorePath, next, "utf8");
      }
    } catch { /* hygiene never blocks seeding */ }

    let trackingData: LooseRecord = {};
    try { trackingData = JSON.parse(readFileSync(trackingPath, "utf8")) as LooseRecord; } catch { /* create fresh */ }
    if (!Array.isArray(trackingData.workflows)) trackingData.workflows = [];

    // A name is a label, not an identity. Reuse is reserved for this exact
    // immutable owner (a card id for panel work) and requires both the index
    // and the state file to agree. An entry that carries no owner id is never
    // adopted, and neither is a state file that names someone else.
    const workflows = trackingData.workflows as unknown[];
    const entry = workflowEntryForOwner(workflows, workflowId);
    const entryDir = workflowStateRelativeDir(entry);
    const reusable = !fresh && entry && entryDir
      && await bb.sdk.files.read({ path: join(rootPath, `${entryDir}/state.md`) })
        .then((file) => ownsWorkflowState(file.content, workflowId))
        .catch(() => false);
    // Seeding an owner that is already seeded is a no-op: it returns the
    // workflow's own paths and leaves its entry, stage, and progress alone.
    if (reusable && entryDir) {
      const existingDir = join(rootPath, entryDir);
      return { statePath: join(existingDir, "state.md"), stateDir: existingDir, dirHash: text(record(entry).dirHash), error: null };
    }
    const dirHash = workflowDirHash(workflowId, fresh);
    // One function owns the path shape, so what is written here is exactly what
    // workflowStateDir() later resolves. `created` pins the path's date segment
    // to the workflow's first seed, so a re-seed never moves its directory.
    const created = text(record(entry).created) || new Date().toISOString();
    const relativeDir = workflowStateRelativeDir({ created, dirHash });
    if (!relativeDir) return { statePath: null, stateDir: null, dirHash: null, error: "Unable to derive the workflow state directory." };
    const stateDir = join(rootPath, relativeDir);
    mkdirSync(stateDir, { recursive: true });
    const statePath = join(stateDir, "state.md");
    const stateBlob = await bb.sdk.files.read({ path: statePath }).then((f) => f.content).catch(() => "");
    if (!stateBlob.includes("current_stage:") || !ownsWorkflowState(stateBlob, workflowId)) {
      // Canonical storage is the gate set (`review_gates: [spec, …]`, empty
      // ≡ Auto). The legacy `review_mode:` ladder label is kept for
      // upstream readers; novel sets have no rung, so they read back as
      // Auto there — the worker prompt names `review_gates` first.
      const gates = normalizeReviewGates(reviewMode);
      const rung = legacyLabelForGates(gates) ?? "Auto";
      const body = STATE_TEMPLATE.replace("<workflow-id>", workflowId).replace("<workflow-name>", name).replace("<new-product|feature|bugfix|refactor|investigate|unknown>", intent);
      writeFileSync(statePath, body.replace("appetite: Core", `appetite: ${appetite}`).replace("review_mode: Auto", `review_gates: ${formatReviewGates(gates)}\n  review_mode: ${rung}`), "utf8");
    }

    if (!existsSync(transitionsPath)) {
      writeFileSync(transitionsPath, readFileSync(TRANSITIONS_REF, "utf8"), "utf8");
    }

    trackingData.workflows = upsertWorkflowEntry(workflows, { workflowId, name, description: "", status: "in-progress", cwd: rootPath, dirHash, created, updated: new Date().toISOString(), stage: { current_stage: "triage", previous_stage: null, transitioned_at: new Date().toISOString(), history: [{ stage: "triage", entered_at: new Date().toISOString() }] }, phases: [], config: { appetite, review_mode: legacyLabelForGates(normalizeReviewGates(reviewMode)) ?? "Auto", review_gates: normalizeReviewGates(reviewMode) } });
    writeFileSync(trackingPath, JSON.stringify(trackingData, null, 2), "utf8");
    return { statePath, stateDir, dirHash, error: null };
  } catch (error) {
    return { statePath: null, stateDir: null, dirHash: null, error: error instanceof Error ? error.message : "Unable to seed workflow." };
  }
}

function workerEnvironment(source: { path: string; hostId: string }, params: { environmentKind: string; machineId: string | null }, forceWorkspaceHost = false) {
  // Card workflow state is stored in the declared workspace. The default preset
  // must therefore run there as well; BB's generic project-default may point at
  // a managed worktree, which silently splits state from execution.
  if (forceWorkspaceHost || params.environmentKind === "project-default") {
    return { type: "host" as const, hostId: forceWorkspaceHost ? source.hostId : (params.machineId ?? source.hostId), workspace: { type: "unmanaged" as const, path: source.path } };
  }
  return { type: "project-default" as const };
}

type ThreadEnvironment = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0]["environment"];

/**
 * The BB composer owns the person's environment and branch selection. A
 * preset is only a fallback for older callers that do not provide one; it may
 * never silently replace an explicit BB choice.
 */
function selectedCardEnvironment(requested: unknown, fallback: ThreadEnvironment): ThreadEnvironment {
  if (!requested || typeof requested !== "object" || Array.isArray(requested)) return fallback;
  const value = requested as Record<string, unknown>;
  if (value.type === "project-default") return value as ThreadEnvironment;
  if (value.type === "reuse" && typeof value.environmentId === "string") return value as ThreadEnvironment;
  if (value.type !== "host" || !value.workspace || typeof value.workspace !== "object" || Array.isArray(value.workspace)) return fallback;
  const workspace = value.workspace as Record<string, unknown>;
  if (workspace.type === "unmanaged" || workspace.type === "managed-worktree" || workspace.type === "personal") return value as ThreadEnvironment;
  return fallback;
}

function isManagedWorktreeEnvironment(value: ThreadEnvironment): boolean {
  if (!value || typeof value !== "object" || !("type" in value) || value.type !== "host" || !("workspace" in value)) return false;
  const workspace = value.workspace;
  return Boolean(workspace && typeof workspace === "object" && "type" in workspace && workspace.type === "managed-worktree");
}

function cardAttachments(raw: string | null): Array<z.infer<typeof attachmentSchema>> {
  try { return z.array(attachmentSchema).parse(JSON.parse(raw ?? "[]")); } catch { return []; }
}

function workspaceRelative(rootPath: string, path: string): string | null {
  const value = isAbsolute(path) ? relative(rootPath, path) : path;
  try { return safeRelative(value); } catch { return null; }
}

// Round-artifact validity lives in lib/research-artifacts (pure, unit-tested):
// researchRoundMirrorsIndex + isValidRoundContent + findInvalidRounds. The
// round listing, the readiness gate, and the completion check all share them,
// so the three can never diverge on what counts as a valid round artifact.

async function detectMentionedFiles(bb: BbPluginApi, rootPath: string | null, text: string): Promise<Array<{ path: string; display: string; absolutePath: string }>> {
  if (!rootPath) return [];
  const candidates = new Set<string>();
  // Match file-ish tokens: path/to/file.ext (no spaces, may include -_./)
  for (const match of text.matchAll(/\b(?:(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:md|markdown|txt|json|yaml|yml|toml|ts|tsx|js|jsx|py|go|rs|sh|css|html|env))(?:\b|(?=[\s,.;:)]))/g)) {
    const token = match[0]!.replace(/[.,;:)]+$/, "");
    if (token.length >= 3 && token.length <= 120) candidates.add(token);
  }
  const found: Array<{ path: string; display: string; absolutePath: string }> = [];
  // Exact paths only. A basename "search" used to run when nothing matched,
  // which surfaced files the request never named (a split card's prompt names
  // the PARENT card's state.md, and the search matched its own). An unfaithful
  // suggestion is worse than none, so a miss simply lists nothing.
  for (const candidate of candidates) {
    try {
      await bb.sdk.files.read({ path: join(rootPath, candidate) });
      found.push({ path: candidate, display: candidate, absolutePath: join(rootPath, candidate) });
    } catch { /* not found at that exact path — never guess */ }
  }
  return found.slice(0, 6);
}

function parseNextStages(rootPath: string | null, currentStage: string): string[] {
  if (!rootPath) return [];
  const transitionsPath = join(rootPath, "skills/stelow-workflow-orchestrator/references/transitions.md");
  if (!existsSync(transitionsPath)) return [];
  let content: string;
  try { content = readFileSync(transitionsPath, "utf8"); } catch { return []; }
  // NOTE: do not use a `(?=^### |\Z)`-style regex here — `\Z` is an
  // end-of-string anchor in Python but a literal "Z" in JavaScript, which
  // silently broke parsing of the last stage block (`audit`). Splitting on
  // headers avoids the dialect trap and any regex injection via stage names.
  const sections = content.split(/^### /m);
  const section = sections.find((entry) => entry === currentStage || entry.startsWith(`${currentStage}\n`) || entry.startsWith(`${currentStage} `));
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

// Scopes follow the immutable owner, never the name: two cards carrying the
// same request must not read each other's scope progress.
function loadCardScopes(rootPath: string | null, workflowId: string): Awaited<ReturnType<typeof rpcContract.cardDetail.output.parse>>["scopes"] {
  if (!rootPath) return [];
  const tracking = join(rootPath, "stelow.json");
  if (!existsSync(tracking)) return [];
  let trackingData: LooseRecord;
  try { trackingData = JSON.parse(readFileSync(tracking, "utf8")) as LooseRecord; } catch { return []; }
  const match = workflowEntryForOwner(array(trackingData.workflows), workflowId) as LooseRecord | null;
  if (!match) return [];
  return workflowScopes(match);
}

async function ensureProjectArtifacts(bb: BbPluginApi, rootPath: string, stateDir?: string | null, requireOwnedState = false): Promise<string | null> {
  const tracking = join(rootPath, "stelow.json");
  const transitions = join(rootPath, "skills/stelow-workflow-orchestrator/references/transitions.md");
  if (requireOwnedState && !stateDir) {
    return "This card's workflow state cannot be verified. Reseed the card; Stelow will not use project-root state as a fallback.";
  }
  const state = stateDir ? join(stateDir, "state.md") : join(rootPath, "state.md");
  if (!existsSync(transitions)) {
    mkdirSync(dirname(transitions), { recursive: true });
    writeFileSync(transitions, readFileSync(TRANSITIONS_REF, "utf8"), "utf8");
  }
  if (!existsSync(state) || !(await bb.sdk.files.read({ path: state }).then((file) => file.content.includes("current_stage:")).catch(() => false))) {
    return "state.md is missing for the Stelow workflow. Reseed the workflow.";
  }
  if (!existsSync(tracking)) {
    return "stelow.json is missing for the Stelow workflow. Reseed the workflow.";
  }
  return null;
}

function runHelper(args: string[], cwd: string, stateDir?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), STELOW_TRANSITIONS: nodeJoin(cwd, "skills/stelow-workflow-orchestrator/references/transitions.md") };
    if (stateDir) {
      env.STELOW_STATEDIR = stateDir;
      env.STELOW_STATE = nodeJoin(stateDir, "state.md");
    } else {
      // Project-root mode: single state.md for workflows without a
      // per-workflow state dir.
      env.STELOW_STATE = nodeJoin(cwd, "state.md");
    }
    const child = spawn("bash", [HELPER_SCRIPT, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => resolveRun({ code: null, stdout, stderr: error.message }));
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


async function readJson(files: FilesApi, path: string): Promise<LooseRecord | null> {
  try {
    const file = await files.read({ path });
    return record(JSON.parse(file.content));
  } catch {
    return null;
  }
}

function workflowScopes(raw: LooseRecord): Workflow["scopes"] {
  return array(raw.scopes).map((entry, index) => {
    const scope = record(entry);
    return {
      id: text(scope.id, `scope-${index + 1}`),
      name: text(scope.name, text(scope.title, `Scope ${index + 1}`)),
      ...(typeof scope.type === "string" ? { type: scope.type } : {}),
      status: normalizeStatus(scope.status),
      ...(typeof scope.source === "string" ? { source: scope.source } : {}),
      ...(typeof scope.gap === "string" ? { gap: scope.gap } : {}),
      ...(Array.isArray(scope.blockedBy) ? { blockedBy: (scope.blockedBy as unknown[]).map((entry) => typeof entry === "string" ? entry : String(entry)) } : {}),
      ...(Array.isArray(scope.depends_on) ? { dependsOn: (scope.depends_on as unknown[]).map((entry) => typeof entry === "string" ? entry : String(entry)) } : {}),
      tasks: array(scope.tasks).map((item, taskIndex) => {
        const task = record(item);
        const strArray = (value: unknown): string[] | undefined => Array.isArray(value) ? value.map((entry) => typeof entry === "string" ? entry : String(entry)) : undefined;
        return {
          id: text(task.id, `task-${taskIndex + 1}`),
          name: text(task.name, text(task.title, `Task ${taskIndex + 1}`)),
          status: normalizeStatus(task.status),
          ...(typeof task.source === "string" ? { source: task.source } : {}),
          ...(typeof task.note === "string" ? { note: task.note } : {}),
          ...(strArray(task.blockedBy) ?? strArray(task.blocked_by) ? { blockedBy: strArray(task.blockedBy) ?? strArray(task.blocked_by) } : {}),
          ...(strArray(task.dependsOn) ?? strArray(task.depends_on) ? { dependsOn: strArray(task.dependsOn) ?? strArray(task.depends_on) } : {}),
        };
      }),
    };
  });
}

async function findArtifacts(files: FilesApi, root: string, workflow: LooseRecord): Promise<Workflow["artifacts"]> {
  const created = text(workflow.created).slice(0, 10);
  const dirHash = text(workflow.dirHash);
  if (!created || !dirHash) return [];
  const workflowRoot = join(root, `.stelow/${created}/${dirHash}`);
  let paths: string[] = [];
  try {
    const result = await files.listPaths({ path: workflowRoot, includeFiles: true, includeDirectories: false });
    paths = array(record(result).paths).map((entry) => typeof entry === "string" ? entry : text(record(entry).path)).filter(Boolean);
  } catch {
    return [];
  }
  const receipts = new Set<string>();
  try {
    const receiptResult = await files.listPaths({ path: join(root, `.stelow/approvals/${dirHash}`), includeFiles: true, includeDirectories: false });
    for (const entry of array(record(receiptResult).paths)) receipts.add(typeof entry === "string" ? entry.split("/").pop()! : text(record(entry).path).split("/").pop()!);
  } catch { /* no approvals yet */ }

  const candidates = await Promise.all(paths
    .filter((path) => path.endsWith(".md"))
    .map(async (path) => {
      const content = await files.read({ path }).then((file) => file.content).catch(() => null);
      if (!isPublishableArtifactContent(content)) return null;
      const relative = path.startsWith(root) ? path.slice(root.length + 1) : `.stelow/${created}/${dirHash}/${path.replace(/^\//, "")}`;
      const filename = relative.split("/").pop() ?? relative;
      const kind: Workflow["artifacts"][number]["kind"] = filename.startsWith("spec-product") ? "product-spec"
        : filename.startsWith("interfaces") ? "interfaces"
        : filename.startsWith("spec-tech") ? "tech-plan"
        : filename.includes("critique") ? "critique" : "other";
      const receipt = kind === "product-spec" ? GATES.gate.receipt
        : kind === "interfaces" ? GATES["int-gate"].receipt
        : kind === "tech-plan" ? GATES["plan-gate"].receipt : "";
      return { kind, label: filename, path: relative, approved: receipt ? receipts.has(receipt) : false };
    }));
  return candidates
    .filter((artifact): artifact is Workflow["artifacts"][number] => artifact !== null)
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function loadBoard(bb: BbPluginApi, projectId: string | null) {
  const rootPath = await projectRoot(bb, projectId);
  if (!rootPath) return { rootPath: null, workflows: [], error: projectId ? "Project workspace path is unavailable." : "Select a bb project to view its Stelow board." };
  return boardFromRoot(bb, rootPath);
}

// Board scoped to an explicit workspace root (project source, or a single
// exploratory card dir). onlyDirHash restricts the listing to one workflow —
// used when a card worker asks for status: its project's source root holds no
// stelow.json (each exploratory card owns its own file), so resolving by
// project alone yields a misleading "not found".
async function boardFromRoot(bb: BbPluginApi, rootPath: string, onlyDirHash?: string | null) {
  const trackingPath = join(rootPath, "stelow.json");
  const tracking = await readJson(bb.sdk.files, trackingPath);
  if (!tracking) return { rootPath, workflows: [], error: `No stelow.json found (looked in ${trackingPath}). Start a Stelow workflow first — card workers: your file lives in your own state dir, not the project root.` };
  const entries = array(tracking.workflows).filter((value) => !onlyDirHash || text(record(value).dirHash) === onlyDirHash);
  if (onlyDirHash && entries.length === 0) return { rootPath, workflows: [], error: `No workflow ${onlyDirHash} in ${trackingPath}. The card may have been reseeded — read the state dir from your spawn prompt.` };

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
          const stateBlob = await bb.sdk.files.read({ path: join(rootPath, `.stelow/${created}/${dirHash}/state.md`) });
          workflowStage = text(stateBlob.content.match(/current_stage:\s*(\S+)/)?.[1]);
        } catch { /* no per-workflow state yet */ }
      }
    }
    workflows.push({
      id: text(raw.dirHash, text(raw.name, `workflow-${index + 1}`)),
      name: text(raw.name, `Workflow ${index + 1}`),
      description: text(raw.description),
      status: normalizeStatus(raw.status),
      stage: workflowStage || text(stage.current_stage, phases.find((phase) => phase.status === "in-progress")?.name ?? "Not started"),
      appetite: text(config.appetite, "Core"),
      reviewMode: text(config.review_mode, "Auto"),
      reviewGates: normalizeReviewGates(
        Array.isArray(config.review_gates) ? config.review_gates.filter((entry): entry is string => typeof entry === "string") : config.review_mode,
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
  const CLI_EQUIVALENTS = "Run `bb stelow playbook` first: it prints your state.md, transitions.md, and stage playbook paths — never discover them with `bb skill list | awk` pipelines. Scope sync runs automatically when you advance into execution; where a skill shows a `scripts/stelow ...` command, use the `bb stelow` equivalent instead (`bb stelow sync-scopes`, `bb stelow lock acquire|release|check`, `bb stelow config get`) — same flags. Never run `bb stelow seed`: card workflows arrive pre-seeded and the command refuses card workers. File-claim discipline: `lock acquire` also registers a workspace-level claim so sibling cards on this checkout see your files. A `BB-LOCK-BLOCKED` stderr means another live card holds the file — do NOT spin or retry in a loop: park that scope (work an independent scope meanwhile), the host pages the user and resumes you with a nudge when the file frees. `lock release` the moment a scope no longer needs its files; terminal states release everything automatically.";
  // Prompt clauses that every build spawn path must carry. They are consts
  // (not pasted prose) so a new spawn site cannot silently drop one — the
  // prompt-contract test fails when a site stops referencing them. This is
  // what burned us before: spawn and reseed taught the seed ban and the
  // turn discipline while the band-swap restart prompt carried neither.
  const NEVER_SEED = "Your workflow is already seeded in your state dir above — never run `bb stelow seed` (it is refused for card workers; seeding again orphans a second workflow outside your card).";
  const TURN_DISCIPLINE = "Turn discipline: never end a turn with a bare progress report while current_stage is not `audit` and no question is pending — narrating progress is not finishing it. Progress narration belongs in <state-dir>/session.log, not as your final message. A turn ends only in a tool call, a structured `bb stelow ask`, or workflow completion. If you catch yourself writing a status summary with nothing left to run, run `bb stelow status` and take the next stage action instead. Question language: write every structured ask, option label, and option description in English. The card UI is English-only; never rely on it to translate your prose.";
  // Commit hygiene: workers commit to arbitrary checkouts, and some repos
  // release from commits (release-please, semantic-release). The worker
  // detects that itself from repo markers and only then writes conventional
  // messages — freeform everywhere else, never empty or wip.
  const COMMIT_STYLE = "When you commit to the checkout yourself, first check for release automation (a release-please config or manifest, .releaserc*, a semantic-release block, or CHANGELOG.md plus v* tags). If the repo releases from commits, write `type: subject` conventional messages (`feat`, `fix`, `docs`, `test`, `chore`); otherwise a plain one-line summary. Never commit empty or `wip` messages.";
  // Interface-pick discipline is shared by every spawn prompt plus the
  // continue nudge: one const so a wording fix lands everywhere (the
  // prompt-contracts test pins single definition + all references).
  const INTERFACE_PICK = "Interface-pick discipline: check review_gates in state.md first (review_mode is the legacy ladder label — normalize it to gates when review_gates is absent). For each selected gate the workflow waits for a human decision with a live structured ask; unselected gates never park: the LLM decides itself, writes the receipt (assumptions_resolved, selected_by: llm, approval receipts), and advances. Gate-tool fallback: if visual_review is unavailable in this host, do NOT park in chat waiting.";
  // Explicit completion: done-ness was inferred from `audit` + idle, so a
  // narrate-and-stop at audit looked identical to stuck-at-audit. The
  // worker commits with `bb stelow done`; the host verifies in code.
  const DONE_PROTOCOL = "Finish explicitly: run `bb stelow done` to mark the card complete — never just announce completion and stop. Build cards complete only at the `audit` stage; research/explore cards complete only after `bb stelow verify` passes. Before Build `done`, run `bb stelow verify --tests` from the final checkout; it executes the project’s safe conventional test command and records the result against the current Git root and HEAD. Run `bb stelow verify-tasks` and report any unmet findings honestly in audit.md — advisory only, it never blocks `done`. If the execution critique escalates gaps, run `bb stelow gap-scopes` and loop back with `bb stelow advance execution` — a card with open gaps is not done, it is back in execution. Execute the new rework scopes, re-run the critique, and only then return to audit for `done`: `done` refuses while escalated gaps lack scopes or rework scopes stay open. Then write `<state-dir>/audit.md` and register it in state.md under `artifacts:` with `stage: audit`. It must contain headings for Acceptance criteria, Verification, Tests (the exact host-run command and result), Git evidence (branch/commit or explicit non-Git reason), and Execution context. Under Execution context, record the absolute path of the checkout you actually wrote to (confirm it with `pwd` / `git rev-parse --show-toplevel`) and state that you did not write outside it; the host refuses `done` when it does not match this card's own workspace, and its error names the exact path to record. `done` refuses otherwise and names the fix — read its stderr and keep working instead of stopping. When you commit this work to the checkout, the run bundle is already fresh: `done` refreshes `docs/runs/<card>/` plus `manifest.md` (SHA pins, gap counts) automatically on every completion and prints the paste-ready trailer in its output — a reopened card that completes again refreshes it again. Commit that directory with the work, then paste the trailer block below the commit subject: a commit cannot carry files, so the bundle plus the trailer is the durable audit link. Between completions, `bb stelow export --check` reports changed, unreadable, newly registered, and uncommitted sources without writing anything.";
  const RECON_PROTOCOL = "For any codebase reconnaissance, work from the target Git workspace root, never the card-state or skill directory. Run the bundled Stelow `recon.sh` preflight before using optional tools, passing this card's exact <state-dir> as its second argument; it writes `<state-dir>/context/recon-receipt.json`. Do not install tools inside the workflow. Cite that receipt and name missing optional tools in planning or audit output; a missing receipt is currently a warning, not a reason to fabricate or skip recon.";
  // Explicit split: one card is one workflow. This is deliberately a
  // high bar, not a "two bullets means two cards" rule: the default is one
  // focused card with scopes. The host creates cards only from a recorded,
  // human-approved proposal (`bb stelow split` takes no content args).
  const SPLIT_PROTOCOL = "Split is exceptional, not a checklist decomposition: DEFAULT to one focused card with scoped work. Propose ONE split only at triage — or, if it becomes clear only there, at Choose work (`select`) before committing its choice — when there are 2+ substantial, end-to-end deliverables that each have a distinct user outcome, acceptance criterion, and independently auditable workflow. Do NOT split merely because the request has bullets, files, UI/API pieces, sequential steps, or small fixes; keep shared implementation, one outcome, or tightly coupled changes together. Each proposed child must be worth its own normal workflow; if that is doubtful, keep one card. When the high bar is met, open `bb stelow ask --tag split --multiple --question <text> --option <card title> --desc <its outcome and done criterion>...` plus exactly one `--option \"Keep as one card\"` (exact label). Each option carries its slice in --desc (+ --artifact when the slice references files). Select one or more deliveries OR the Keep as one card option — never both. Then STOP and wait for the answer. A split-proposal record or an earlier chat message is NOT a pending question: only a visible structured form on the card is. If the ask failed before that form appeared, correct the command and submit the same ask once; never wait for an invisible question. Never split unilaterally, never invent cards, and do not advance from the current split point until answered. After the answer, run `bb stelow split` (no args — the host executes the recorded approval) and follow its stdout: an archived parent means stop. Never hedge with a standard question that merely validates a grouping (“looks good?”) — either the bar above is met (ask --tag split) or it isn't (keep one card and advance). A standard answer executes nothing and can never become a split later.";
  // One-shot trigger for the human "Propose split" action. A pointer, not a
  // second protocol copy: the full syntax lives once in SPLIT_PROTOCOL
  // above (prompt-contracts pins that), the nudge carries only the delta.
  const SPLIT_REQUEST_NUDGE = "Split requested: the user explicitly asked for a split proposal. Follow SPLIT_PROTOCOL in your system prompt: ask with --tag split --multiple (one --option per delivery plus exactly one --option \\\"Keep as one card\\\"), then STOP and wait; after the answer, execute the recorded approval with `bb stelow split`. Do not ask a standard question about splitting instead — only a --tag split proposal is executable.";
  // Optional paid review, always explicit: after `bb stelow verify` PASSes you
  // may OFFER `bb stelow review` through `bb stelow ask` — never run it
  // unasked. Review spends reviewer budget on a different-model reviewer and
  // only sees structurally valid artifacts; `review` refuses thin files and
  // cards without a designated reviewer preset.
  const REVIEW_PROTOCOL = "Optional paid review: after `bb stelow verify` passes, you may OFFER `bb stelow review` via `bb stelow ask` — never run it unasked, never auto-run it. Review spends reviewer budget and only accepts structurally valid artifacts.";
  const DRAFT_PROTOCOL = "Cheap drafts: for disposable prose bursts (alternative wordings, expansions, taglines — never protocol work, never anything needing tools or exact shapes), run `bb stelow draft --prompt <brief>` — a hidden thread on the generation preset returns text you must judge 100% before using. If no generation preset is set it runs on your band preset; an empty or failed draft means do it yourself, never retry in a loop.";
  const db = bb.storage.database();
  // BB is the source of truth for the installed plugin and its update range.
  // This read-only check never changes the helper or an active workflow.
  // Mount-time reads share one in-flight check and reuse a fresh result for
  // a minute, so the sidebar and About never double-hit upstream resolution.
  type PluginUpdateState = z.infer<typeof pluginUpdateSchema>;
  let pluginUpdate: PluginUpdateState = { outcome: "checking", installed: null, installedDisplay: null, candidate: null, candidateDisplay: null, detail: null, checkedAt: null };
  // Newest GitHub release the panel knows, for installs BB cannot update.
  // Supplement only: while BB offers a candidate this stays null so two
  // "new version" sources never compete. A failed lookup keeps the previous
  // value — stale discovery beats none, and the next check refreshes it.
  let githubRelease: { tag: string; url: string; checkedAt: number; newer: boolean } | null = null;
  let updateCheckAt = 0;
  let updateCheckInflight: Promise<void> | null = null;
  async function refreshPluginUpdate(force = false) {
    if (!force && pluginUpdate.outcome !== "checking" && Date.now() - updateCheckAt < 60_000) return;
    if (updateCheckInflight) {
      await updateCheckInflight;
      return;
    }
    updateCheckInflight = (async () => {
      try {
        const entries = await bb.sdk.plugins.checkUpdates({ pluginId: bb.pluginId });
        pluginUpdate = { ...mapUpdateEntry(selectOwnEntry(entries, bb.pluginId)), checkedAt: Date.now() };
        if (pluginUpdate.outcome === "update-available") {
          githubRelease = null;
        } else {
          const latest = await fetchLatestPluginRelease();
          if (latest) githubRelease = { ...latest, checkedAt: Date.now(), newer: isNewerRelease(BUILD_INFO.version, latest.tag) };
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        // A transient failure keeps the last known verdict (a real candidate
        // button must not vanish on a network blip) — applyFailedCheck only
        // falls back to "unavailable" when there was no verdict yet.
        pluginUpdate = applyFailedCheck(pluginUpdate, detail);
        bb.log.warn(`plugin update check failed: ${detail}`);
      } finally {
        updateCheckAt = Date.now();
      }
    })();
    try {
      await updateCheckInflight;
    } finally {
      updateCheckInflight = null;
    }
  }
  bb.background.schedule("stelow-plugin-update-check", "17 6 * * *", () => void refreshPluginUpdate(true));
  void refreshPluginUpdate();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      intent TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      activity TEXT NOT NULL,
      worker_thread_id TEXT,
      worker_preset_id TEXT,
      dir_hash TEXT,
      attachments TEXT NOT NULL DEFAULT '[]',
      last_error TEXT,
      last_assistant_text TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      target TEXT NOT NULL,
      target_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_comments_card ON comments(card_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      reasoning_level TEXT NOT NULL,
      permission_mode TEXT NOT NULL CHECK (permission_mode IN ('accept-edits','auto','full')),
      environment_kind TEXT NOT NULL DEFAULT 'project-default' CHECK (environment_kind IN ('project-default','new-worktree')),
      base_branch TEXT,
      machine_id TEXT,
      instructions TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      built_in INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS card_presets (
      card_id TEXT PRIMARY KEY,
      preset_id TEXT NOT NULL,
      assigned_at INTEGER NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS expired_questions (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      question TEXT NOT NULL,
      multiple INTEGER NOT NULL DEFAULT 0,
      options TEXT NOT NULL,
      expired_at INTEGER NOT NULL,
      answered INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    )`,
  ]);
  // Ask-contract declarations (lib/ask-contracts). Deliberately outside
  // bb.storage.migrate: index 6+ collides with a legacy-unknown row
  // recorded before hash tracking existed, and BB refuses any statement
  // there. NEVER append to the migrate array above — new tables go here
  // via direct idempotent exec, like every other table below.
  db.exec(`CREATE TABLE IF NOT EXISTS ask_contracts (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    question_text TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    asked_at INTEGER NOT NULL,
    consumed_at INTEGER,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ask_contracts_card ON ask_contracts(card_id, consumed_at, asked_at)`);

  const cardColumns = db.prepare("PRAGMA table_info(cards)").all() as Array<{ name: string }>;
  if (!cardColumns.some((column) => column.name === "display_name")) {
    db.exec("ALTER TABLE cards ADD COLUMN display_name TEXT");
  }
  if (!cardColumns.some((column) => column.name === "last_idle_at")) {
    db.exec("ALTER TABLE cards ADD COLUMN last_idle_at INTEGER");
  }
  if (!cardColumns.some((column) => column.name === "dir_hash")) {
    db.exec("ALTER TABLE cards ADD COLUMN dir_hash TEXT");
  }
  if (!cardColumns.some((column) => column.name === "worker_preset_id")) {
    db.exec("ALTER TABLE cards ADD COLUMN worker_preset_id TEXT");
  }
  if (!cardColumns.some((column) => column.name === "preset_restart_pending")) {
    db.exec("ALTER TABLE cards ADD COLUMN preset_restart_pending INTEGER NOT NULL DEFAULT 0");
  }
  if (!cardColumns.some((column) => column.name === "attachments")) {
    db.exec("ALTER TABLE cards ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'");
  }
  if (!cardColumns.some((column) => column.name === "workspace_kind")) {
    db.exec("ALTER TABLE cards ADD COLUMN workspace_kind TEXT NOT NULL DEFAULT 'project'");
  }
  if (!cardColumns.some((column) => column.name === "workspace_path")) {
    db.exec("ALTER TABLE cards ADD COLUMN workspace_path TEXT");
  }
  if (!cardColumns.some((column) => column.name === "workspace_host_id")) {
    db.exec("ALTER TABLE cards ADD COLUMN workspace_host_id TEXT");
  }
  if (!cardColumns.some((column) => column.name === "kind")) {
    db.exec("ALTER TABLE cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'build'");
  }
  if (!cardColumns.some((column) => column.name === "research_strategy")) {
    db.exec("ALTER TABLE cards ADD COLUMN research_strategy TEXT");
  }
  if (!cardColumns.some((column) => column.name === "research_strategies")) {
    db.exec("ALTER TABLE cards ADD COLUMN research_strategies TEXT");
  }
  if (!cardColumns.some((column) => column.name === "explore_stage")) {
    db.exec("ALTER TABLE cards ADD COLUMN explore_stage TEXT");
  }
  // Automatic spawn-retry budget (lib/spawn-retry): attempts claimed per
  // failed thread, so a restart/reseed or a new failure starts fresh.
  if (!cardColumns.some((column) => column.name === "spawn_retry_count")) {
    db.exec("ALTER TABLE cards ADD COLUMN spawn_retry_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!cardColumns.some((column) => column.name === "spawn_retry_thread")) {
    db.exec("ALTER TABLE cards ADD COLUMN spawn_retry_thread TEXT");
  }
  // Spawn environment in one stored word (lib/tracks): the open card reads
  // it instead of guessing shared-vs-worktree from paths.
  if (!cardColumns.some((column) => column.name === "environment_label")) {
    db.exec("ALTER TABLE cards ADD COLUMN environment_label TEXT");
  }
  const expiredQuestionColumns = db.prepare("PRAGMA table_info(expired_questions)").all() as Array<{ name: string }>;
  if (!expiredQuestionColumns.some((column) => column.name === "kind")) {
    db.exec("ALTER TABLE expired_questions ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard'");
  }
  if (!expiredQuestionColumns.some((column) => column.name === "locale")) {
    db.exec("ALTER TABLE expired_questions ADD COLUMN locale TEXT");
  }
  // Auto-continue budget for chatty workers (lib/auto-continue): consecutive
  // resumes without a stage advance, reset whenever the stage moves.
  ensureAutoContinueColumns(db);
  ensureInboxResolvedReasonColumn(db);
  ensureInboxSeverityColumns(db);
  // Card-split proposals (lib/split-proposal): one recorded, human-approved
  // proposal per card. The host executes it on `bb stelow split` — workers
  // never create cards, so there is no worker verb that takes card content.
  db.exec(`CREATE TABLE IF NOT EXISTS split_proposals (
    card_id TEXT PRIMARY KEY,
    question TEXT NOT NULL DEFAULT '',
    slices TEXT NOT NULL,
    selected TEXT,
    asked_at INTEGER NOT NULL,
    answered_at INTEGER,
    consumed_at INTEGER,
    created TEXT NOT NULL DEFAULT '[]'
  )`);
  // Preserve a legacy card's original workspace claim separately from a
  // user-confirmed checkout. Recovery never silently rewrites history.
  db.exec(`CREATE TABLE IF NOT EXISTS workspace_recoveries (
    card_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    source_path TEXT NOT NULL,
    original_workspace_path TEXT,
    evidence TEXT NOT NULL,
    git_root TEXT,
    branch TEXT,
    head_sha TEXT,
    changed_files INTEGER NOT NULL DEFAULT 0,
    attached_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
  // The original exploratory card remains historical evidence. A recovery
  // audit is a separate, normal Build card in the registered project, with a
  // real BB workspace and therefore the usual test/commit/PR controls.
  db.exec(`CREATE TABLE IF NOT EXISTS recovery_audits (
    source_card_id TEXT PRIMARY KEY,
    audit_card_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (source_card_id) REFERENCES cards(id) ON DELETE CASCADE,
    FOREIGN KEY (audit_card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
  // Host-run test evidence is scoped to one card and Git identity. It is
  // intentionally a ledger rather than a mutable receipt paragraph.
  db.exec(`CREATE TABLE IF NOT EXISTS verification_runs (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    command TEXT NOT NULL,
    git_root TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    exit_code INTEGER NOT NULL,
    output_sha256 TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_verification_runs_card ON verification_runs(card_id, created_at DESC)");
  // Stage-entry ledger for lead/cycle-time metrics. One row per card stage
  // entry (creation stage, every advance, done) — append-only, never
  // updated. updated_at cannot serve this: any touch rewrites it.
  db.exec(`CREATE TABLE IF NOT EXISTS card_stage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    entered_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_card_stage_events_card ON card_stage_events(card_id, entered_at)");
  // Ask-time evidence for staleness notices: what each questioned document
  // contained and where its checkout stood when the question was asked.
  // Keyed by (card, artifact path), latest wins — re-asking about a revised
  // document re-baselines it. Advisory only: readers compare, never block.
  db.exec(`CREATE TABLE IF NOT EXISTS question_evidence (
    card_id TEXT NOT NULL,
    artifact_path TEXT NOT NULL,
    artifact_sha256 TEXT NOT NULL,
    git_root TEXT,
    head_sha TEXT,
    asked_at INTEGER NOT NULL,
    PRIMARY KEY (card_id, artifact_path),
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
  if (!cardColumns.some((column) => column.name === "split_from")) {
    db.exec("ALTER TABLE cards ADD COLUMN split_from TEXT");
  }
  // stage_presets may not be applied by bb.storage.migrate on existing DBs,
  // so ensure it idempotently here as well. Band validity is enforced by
  // setBandPreset against STAGE_BANDS — the schema carries no band allowlist.
  db.exec(`CREATE TABLE IF NOT EXISTS stage_presets (
    band TEXT PRIMARY KEY,
    preset_id TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
  )`);
  // Singleton reviewer designation (id = 1): which preset `bb stelow review`
  // spends. Explicit only — no default, no band fallback, never inherited.
  // Deleting the preset clears the designation via cascade.
  db.exec(`CREATE TABLE IF NOT EXISTS review_preset (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    preset_id TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
  )`);
  // Singleton generation preset (id = 1): the cheap model for disposable
  // Tier G draft bursts. Explicit only — no default, no worker fallback at
  // this layer (the cascade in lib/draft-burst.mjs decides the fallback at
  // spawn time). Deleting the preset clears the designation via cascade.
  db.exec(`CREATE TABLE IF NOT EXISTS generation_preset (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    preset_id TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
  )`);
  // Singleton reliable preset (id = 1): the optional board-level override
  // for reliable-tier spawns (worker starts, restarts, band swaps,
  // research fan-out, automation drafts). Explicit only — empty means the
  // band preset (today's behavior). Deleting the preset clears the
  // designation via cascade.
  db.exec(`CREATE TABLE IF NOT EXISTS reliable_preset (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    preset_id TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
  )`);
  // Decision API: one Jev-compatible endpoint for every decision point.
  // Endpoint + key + model live here once, never per point. An absent row
  // means unconfigured — points fall back to built-in rules.
  db.exec(`CREATE TABLE IF NOT EXISTS decision_api_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    endpoint TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  // Provider column for installs created before provider adapters: jev is
  // the wire-compatible default, so old rows keep working unchanged.
  const decisionApiColumns = db.prepare("PRAGMA table_info(decision_api_config)").all() as Array<{ name: string }>;
  if (!decisionApiColumns.some((column) => column.name === "provider")) {
    db.exec("ALTER TABLE decision_api_config ADD COLUMN provider TEXT NOT NULL DEFAULT 'jev'");
  }
  // Per-point router modes + thresholds as free-form JSON. Absent rows mean
  // registry defaults (built-in rules), so new points need no migration.
  db.exec(`CREATE TABLE IF NOT EXISTS decision_points (
    point TEXT PRIMARY KEY,
    mode TEXT NOT NULL CHECK (mode IN ('rules', 'api', 'preset')),
    thresholds TEXT NOT NULL DEFAULT '{}',
    provider TEXT,
    endpoint TEXT,
    api_key TEXT,
    model TEXT,
    preset_id TEXT,
    updated_at INTEGER NOT NULL
  )`);
  // Per-point routing (route override columns + preset judge pin) arrived
  // after the table: older rows also carry CHECK(mode IN ('rules', 'api')),
  // which would refuse preset mode. Rebuild once to widen it, preserving
  // rows — guarded by the new column so reruns are no-ops.
  const pointColumns = db.prepare("PRAGMA table_info(decision_points)").all() as Array<{ name: string }>;
  if (!pointColumns.some((column) => column.name === "preset_id")) {
    // One transaction: a crash between DROP and RENAME must never lose the
    // four rows — half a migration is worse than none.
    const rebuildDecisionPoints = db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS decision_points_new (
      point TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK (mode IN ('rules', 'api', 'preset')),
      thresholds TEXT NOT NULL DEFAULT '{}',
      provider TEXT,
      endpoint TEXT,
      api_key TEXT,
      model TEXT,
      preset_id TEXT,
      updated_at INTEGER NOT NULL
    )`);
      db.exec(`INSERT OR IGNORE INTO decision_points_new (point, mode, thresholds, updated_at) SELECT point, mode, thresholds, updated_at FROM decision_points`);
      db.exec(`DROP TABLE decision_points`);
      db.exec(`ALTER TABLE decision_points_new RENAME TO decision_points`);
    });
    rebuildDecisionPoints();
  }
  // Review enforcement policy (default off): when required, research/explore
  // done refuses without a passing review stamped with the current
  // fingerprint. Mechanism only — calibration stays a documented prerequisite.
  db.exec(`CREATE TABLE IF NOT EXISTS review_policy (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT NOT NULL CHECK (mode IN ('off', 'required')),
    assigned_at INTEGER NOT NULL
  )`);
  // Rebuild tables created with the build-only band allowlist, preserving
  // rows. Runs once: the rebuilt schema has no CHECK to match against.
  const stagePresetsSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'stage_presets'").get() as { sql: string } | undefined;
  if (stagePresetsSql?.sql.includes("CHECK (band IN")) {
    db.exec(`ALTER TABLE stage_presets RENAME TO stage_presets_rebuild;
      CREATE TABLE stage_presets (
        band TEXT PRIMARY KEY,
        preset_id TEXT NOT NULL,
        assigned_at INTEGER NOT NULL,
        FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
      );
      INSERT INTO stage_presets (band, preset_id, assigned_at) SELECT band, preset_id, assigned_at FROM stage_presets_rebuild;
      DROP TABLE stage_presets_rebuild;`);
  }
  // This table is deliberately created outside the historical migration array:
  // older local installations have different recorded migration lengths.
  db.exec(`CREATE TABLE IF NOT EXISTS inbox_events (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('question','error','paused','completed')),
    summary TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    occurred_at INTEGER NOT NULL,
    read_at INTEGER,
    archived_at INTEGER,
    resolved_at INTEGER,
    resolved_reason TEXT,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_inbox_events_visible ON inbox_events(archived_at, occurred_at DESC);`);
  // Workspace-level file claims (lib/card-claims): cross-card coordination
  // for cards sharing one checkout. Same outside-the-migration-array
  // pattern as inbox_events above.
  ensureCardClaimsTables(db);
  const inboxColumns = db.prepare("PRAGMA table_info(inbox_events)").all() as Array<{ name: string }>;
  if (!inboxColumns.some((column) => column.name === "resolved_at")) db.exec("ALTER TABLE inbox_events ADD COLUMN resolved_at INTEGER");
  // One-time cleanup of a historical bug: research completions used to emit
  // two events (the generic transition + the research-specific one). The
  // generic rows are redundant noise for research cards — drop them. The
  // duplicate-insert path is fixed upstream, so this converges on first run.
  db.prepare(`DELETE FROM inbox_events WHERE kind = 'completed' AND summary = 'Completed. Review the final outcome.' AND card_id IN (SELECT id FROM cards WHERE kind = 'research')`).run();

  // card_threads is the worker ledger: one row per worker thread a card has
  // ever had (initial spawn, band-swap / manual restarts, reseeds). Old rows
  // stay as history; the open row (ended_at NULL) is the current worker.
  // Threads themselves are archived+hidden on replacement, so the list UI
  // never pollutes — this table is the auditable memory of it.
  db.exec(`CREATE TABLE IF NOT EXISTS card_threads (
    thread_id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    preset_id TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    ended_reason TEXT,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_card_threads_card ON card_threads(card_id, started_at DESC);`);

  // GitHub issues live decoupled in server/github-issues.ts: tables,
  // backfills, matcher wiring, scheduler, and RPCs. One call owns it all.
  runGithubMigrations(db);

  const automationColumns = db.prepare("PRAGMA table_info(automation_rules)").all() as Array<{ name: string }>;
  if (!automationColumns.some((column) => column.name === "autostart")) {
    db.exec("ALTER TABLE automation_rules ADD COLUMN autostart INTEGER NOT NULL DEFAULT 0");
  }

  // Publication is intentionally separate from a card's Done state. A card is
  // workflow-complete before its owner decides whether and how to publish it.
  db.exec(`CREATE TABLE IF NOT EXISTS publication_events (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    action TEXT NOT NULL,
    message TEXT NOT NULL,
    commit_sha TEXT,
    pull_request_url TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_publication_events_card ON publication_events(card_id, created_at DESC);`);

  const presetColumns = db.prepare("PRAGMA table_info(presets)").all() as Array<{ name: string }>;
  if (!presetColumns.some((column) => column.name === "environment_kind")) {
    db.exec("ALTER TABLE presets ADD COLUMN environment_kind TEXT NOT NULL DEFAULT 'project-default'");
  }
  if (!presetColumns.some((column) => column.name === "base_branch")) {
    db.exec("ALTER TABLE presets ADD COLUMN base_branch TEXT");
  }
  if (!presetColumns.some((column) => column.name === "machine_id")) {
    db.exec("ALTER TABLE presets ADD COLUMN machine_id TEXT");
  }

  const defaultPresetId = "preset_default";
  const existingDefault = db.prepare("SELECT * FROM presets WHERE id = ?").get(defaultPresetId) as PresetRow | undefined;
  if (existingDefault) {
    // Migrate the built-in default preset: codex is not installed on this host;
    // the pi provider routes to Bifrost harness-coding.
    if (existingDefault.provider_id === "codex") {
      db.prepare("UPDATE presets SET provider_id = ?, model_id = ?, permission_mode = ?, updated_at = ? WHERE id = ?").run("pi", "bifrost/harness-coding", "full", now(), defaultPresetId);
    } else if (existingDefault.permission_mode !== "full" && existingDefault.provider_id === "pi") {
      // pi only supports full permission mode.
      db.prepare("UPDATE presets SET permission_mode = ?, updated_at = ? WHERE id = ?").run("full", now(), defaultPresetId);
    }
  } else {
    db.prepare("INSERT INTO presets (id, name, provider_id, model_id, reasoning_level, permission_mode, environment_kind, instructions, is_default, built_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      defaultPresetId, "Default", "pi", "bifrost/harness-coding", "medium", "full", "project-default", "", 1, 1, now(), now(),
    );
  }
  // Drop non-built-in presets that reference codex (unusable without the Codex CLI).
  db.prepare("DELETE FROM presets WHERE built_in = 0 AND provider_id = 'codex'").run();

  function now(): number { return Date.now(); }

  // Append-only stage-entry ledger (lead/cycle-time source). Best-effort:
  // metrics degrade to created_at/updated_at when rows are missing, so a
  // failed write never blocks the card transition it annotates.
  function recordStageEvent(cardId: string, stage: string): void {
    try {
      db.prepare("INSERT INTO card_stage_events (card_id, stage, entered_at) VALUES (?, ?, ?)").run(cardId, stage, now());
    } catch { /* metrics-only; never block */ }
  }

  function stageEvents(cardId: string): Array<{ stage: string; entered_at: number }> {
    try {
      return db.prepare("SELECT stage, entered_at FROM card_stage_events WHERE card_id = ? ORDER BY entered_at ASC, id ASC").all(cardId) as Array<{ stage: string; entered_at: number }>;
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
  function flowTimesForCard(card: { id: string; created_at: number }): { leadMs: number | null; cycleMs: number | null; doneAt: number | null } {
    const events = stageEvents(card.id);
    const doneEvent = [...events].reverse().find((event) => event.stage === "done") ?? null;
    if (!doneEvent) return { leadMs: null, cycleMs: null, doneAt: null };
    const timeline = summarizeTimeline(events, { createdAt: card.created_at, endAt: doneEvent.entered_at });
    return { leadMs: timeline.leadMs, cycleMs: timeline.cycleMs, doneAt: doneEvent.entered_at };
  }
  function randomId(prefix: string): string { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }

  // Shared card-creation path for both the UI "start card" handler and the
  // GitHub import. A Personal-project request gets an isolated persistent
  // exploratory workspace; project cards keep using their declared source.
  //
  // kind "research" runs a stelow-product-* strategy instead of the build
  // workflow: no stages, no gates, no advance. The worker writes research-index.md
  // (exact shape below) into its own state dir; the user marks Done and
  // fans opportunities out into build cards from the plugin UI.
  const CARD_OWNER_RULES = "You are the card owner: preserve context, ask the user, and publish the canonical result yourself. workflow_id is an immutable ownership marker: never edit it, copy another workflow's state, or use a project-root state.md as a substitute. Do not split this card's initial workflow into subagents. You may delegate only independent work with a distinct input and output file, then review and synthesize it yourself. Never delegate structured questions, card state changes, lifecycle commands, or the canonical result. Delegate fresh: package the full task in the call itself (brief plus every file path and fact the delegate needs) — never fork a thread, inherit history, or let siblings talk to each other.";

  function researchWorkerPrompt({ displayName, prompt, strategyLabel, strategyId, strategySkill, stateDirText, workspaceRoot, instructions, flavor, previousThreadId, roundNo, roundStamp, roundFile }: { displayName: string; prompt: string; strategyLabel: string; strategyId: string; strategySkill: string; stateDirText: string; workspaceRoot: string; instructions: string; flavor: "initial" | "restart" | "reseed" | "append"; previousThreadId: string | null; roundNo: number; roundStamp: string; roundFile: string }): string {
    const flavorLine = flavor === "initial"
      ? "This is a fresh research task."
      : flavor === "append"
        ? "A previous strategy round already wrote to research-index.md. Load the playbook below and APPEND a new ### section for it — never rewrite, delete, or re-check existing items."
        : flavor === "restart"
          ? "You are being restarted mid-research with a fresh worker. Re-read your research-index.md and CONTINUE the research — do not start over unless the index is empty."
          : "The host re-seeded your state dir: start the research over with a fresh research-index.md.";
    return `You are running a Stelow research task inside the bb-plugin-stelow panel. Your work owns its own state dir (${stateDirText}) inside the workspace (${workspaceRoot}). ${CARD_OWNER_RULES} ${flavorLine}${previousThreadId ? ` Previous worker thread: ${previousThreadId} (archived). If the index is thin, its turn history may hold missing context; retrieve it with \`bb thread output ${previousThreadId}\`.` : ""}

Step 1 — load the strategy playbook: the ${strategyLabel} method (${strategySkill}) is provided by this plugin \u2014 use \`bb skill list\` to confirm it (fetch via \`npx skills add calionauta/stelow\` only if missing), then follow that playbook — not the stelow-workflow-* build skills, which do not apply here.

Step 2 — research the request below inside this workspace. Research happens primarily on the WEB using your search tools — the playbook expects real-time sources (LinkedIn, X/Twitter, Reddit practitioner communities, industry reports), not prior knowledge. You may also read code and docs. If you genuinely have no web search tools available, say so explicitly in the index instead of inventing findings — never fabricate market data, quotes, or statistics. You MUST NOT write product code or open pull requests. Research only.

Step 3 — write your findings to <state-dir>/research-index.md (create it) in EXACTLY this shape (headings verbatim — the plugin parses them deterministically for review and fan-out):

    # Research index: ${displayName}

    ## Summary
    <concise cross-strategy synthesis, evidence limits, key decisions — keep it short>

    ## Outputs
    | Strategy | Round | Output | Artifact | Notes |
    | --- | --- | --- | --- | --- |
    | ${strategyLabel} | ${roundNo} | <what this output is> | <path relative to ${workspaceRoot}> | <notes> |

    ## Opportunities
    ### ${strategyLabel} — <today's YYYY-MM-DD date>
    - [ ] <opportunity title> — <one-line why it matters>

Unchecked boxes mean "available for fan-out" and NOTHING else — they are not task state. NEVER check a box yourself — the plugin checks the ones the user turns into build cards. If you run another strategy later, APPEND a new ### section under ## Opportunities plus new rows under ## Outputs; never rewrite existing items.

Step 3b — write this round's native output NEXT TO the index, never instead of it. Contract (the plugin enforces it in code — a round that fails these checks blocks Done and is flagged in the inbox, so treat this as a hard requirement, not advice):
- target: <workspaceRoot>/${roundFile} — this is the deterministic destination reserved for this round. Create it with the playbook's full result VERBATIM. Do NOT add a manifest block for it: the card discovers this canonical round file once it has content.
- one file per write command with a direct path; never combine round + index + state.md writes in one heredoc/command chain. Prefer your host's native file-write tool.
- verify by reading ${roundFile} back: it must hold the playbook's FULL result VERBATIM — every required section, item, table, and score the playbook asks for — never the research index, never empty, never a condensed summary. If the read-back fails any check, rewrite immediately before finishing.
- fan-out sub-steps (e.g. JTBD's numbered prompts): save EACH beside it as <strategyId>-<substep-slug>-r${roundNo}-${roundStamp}.md (same stamp; <substep-slug> is the lowercase-hyphenated sub-step name), each with its own full prompt output — the host validates every substep file individually and blocks Done on any missing or thin one.
- scoping before broad Full Mapping: when the request names no audience, problem/job, or geography, ask FIRST via \`bb stelow ask\` (Targeted prompt vs Full Mapping vs Recommend) before running all ten prompts. Proceeding on assumptions is allowed only as explicitly marked hypotheses.
- self-check BEFORE finishing: run \`bb stelow verify\` — it prints PASS or names each failing round with the fix. Do NOT end your turn on a FAIL; rewrite and re-verify until PASS.

Step 4 — register the index plus any EXTRA sub-step files so each renders on the card: append one block per file to <state-dir>/state.md (create the artifacts: section if missing; paths relative to the workspace root ${workspaceRoot}; if a block with the same path is already there, do NOT append a duplicate):

    artifacts:
      - stage: research
        kind: document
        path: <research-index.md path relative to ${workspaceRoot}>
        label: Research index
(one more block per sub-step file, with label "Round ${roundNo} — ${strategyLabel} (<substep-slug>)" and its own path. The round's own file needs no block — it is pre-registered.)

Step 5 — end your turn with one file chip per produced file: emit \`::stelow-artifact{path="<path relative to ${workspaceRoot}>" display="<short file name>"}\` once per file (the index, the round file, and every sub-step file), each directive on its own line — bb renders these as clickable chips so the user can open, read, and comment on each output directly from the thread. Then emit one quality seal per produced file: \`::stelow-quality{path="<same relative path>"}\` once per file, each on its own line — bb revalidates each file live and renders verified / hypothesis / needs-work / unverified (the seal resolves from the host, never from your claim).

CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form, NEVER just write text like "waiting for your choice":

    bb stelow ask --thread "$BB_THREAD_ID" \\
      --question "<a single clear question>" \\
      --option "<label 1>" --option "<label 2>" [--multiple]

Batch independent questions into ONE ask call by repeating --question groups (each with its own --option labels) — the user answers them together instead of being pinged one by one. Ask dependent questions (where Q2 needs Q1's answer) one at a time. When the human must compare artifacts to decide (interface picks, plan reviews), attach each option's evidence: --desc for trade-offs, --preview for the inline glance, --artifact for the workspace-relative file they can open.

On timeout ("No response after Ns"), STOP and wait — the question stays answerable on the card. Never re-ask the same question. There are no stages and no gates here: NEVER run \`bb stelow advance\`. When the index is complete with ranked opportunities, STOP and end your turn — the user reviews the index, marks the card Done, and fans opportunities out into build cards. If the user instead confirms specific opportunities in-thread, fan them out yourself ONLY after that structured confirmation: \`bb stelow fan-out --opportunity <id> [--opportunity ...]\` (ids from the index, never prose — the command refuses unknown ids). Stop early when the user archives the card.

${DONE_PROTOCOL}

${REVIEW_PROTOCOL}

${DRAFT_PROTOCOL}

${instructions ? `Preset instructions:\n${instructions}\n` : ""}Request:
${prompt}`;
  }

  // Explore runs ONE build-stage skill standalone — no triage, no Shape
  // Up sequence, no gates. The worker loads the stage's playbook, applies it
  // to the input, and saves a single artifact into the card's state dir.
  function exploreWorkerPrompt({ displayName, prompt, stage, stateDirText, workspaceRoot, instructions, flavor, previousThreadId }: { displayName: string; prompt: string; stage: { id: string; label: string; skill: string }; stateDirText: string; workspaceRoot: string; instructions: string; flavor: "initial" | "restart" | "reseed"; previousThreadId: string | null }): string {
    const flavorLine = flavor === "initial"
      ? "This is a fresh single-stage exploration."
      : flavor === "restart"
        ? "You are being restarted mid-exploration with a fresh worker. Re-read your artifact and CONTINUE — do not start over unless it is empty."
        : "The host re-seeded your state dir: run the stage again from scratch.";
    return `You are running a SINGLE-STAGE Stelow exploration inside the bb-plugin-stelow panel. Your work owns its own state dir (${stateDirText}) inside the workspace (${workspaceRoot}). ${CARD_OWNER_RULES} ${flavorLine}${previousThreadId ? ` Previous worker thread: ${previousThreadId} (archived). If the artifact is thin, its turn history may hold missing context; retrieve it with \`bb thread output ${previousThreadId}\`.` : ""}

Step 1 — load the stage skill: ${stage.label} (${stage.skill}) is bundled with this plugin (\`bb skill list\` shows it). Load it and follow its instructions exactly.

Step 2 — apply the stage to the request below. Work STANDALONE: there is no triage, no Shape Up pipeline, no stage machine, no gates, and no \`bb stelow advance\`. Do NOT run the build workflow skills (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-orchestrator) — only the stage skill above. You may read code, docs, or files in the workspace to ground the work; use the structured form below only if the input is genuinely ambiguous. Depth contract: the deliverable must meet its stage contract (required sections, tables, depth per the skill's Completeness contract — \`bb stelow verify\` enforces it and names the failing check). Full exploration: every variant the stage skill offers. Ask the user via the structured form whenever a choice affects the outcome — never auto-decide picks. But never park waiting for approval: there are no gates here, so a decision that would be a gate in the pipeline resolves via ask, then you finish.

Step 3 — produce the stage's deliverable as ONE Markdown file: <state-dir>/explore-${stage.id}.md (create it; overwrite any existing content with the fresh result). Prefer your host's native file-write tool; if you must use a shell, write ONE file per command with a direct path and read it back to verify it meets the stage contract (required sections, tables, depth — never a condensed summary). Self-check BEFORE finishing: run \`bb stelow verify\` — it prints PASS or the fix. Do NOT end your turn on a FAIL.

Step 4 — register the artifact so it renders on the card: append one block to <state-dir>/state.md (create the artifacts: section if missing; paths relative to the workspace root ${workspaceRoot}; if a block with the same path is already there, do NOT append a duplicate):

    artifacts:
      - stage: explore
        kind: document
        path: <explore-${stage.id}.md path relative to ${workspaceRoot}>
        label: ${stage.label}

Step 5 — end your turn with one file chip per produced file: emit \`::stelow-artifact{path="<path relative to ${workspaceRoot}>" display="${stage.label}"}\` on its own line — bb renders these as clickable chips. Then emit \`::stelow-quality{path="<same relative path>"}\` on its own line — bb revalidates the file live and renders verified / hypothesis / needs-work / unverified.

CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form, NEVER just write text like "waiting for your choice":

    bb stelow ask --thread "$BB_THREAD_ID" \\
      --question "<a single clear question>" \\
      --option "<label 1>" --option "<label 2>" [--multiple]

On timeout ("No response after Ns"), STOP and wait — the question stays answerable on the card. Never re-ask the same question. When the stage deliverable is complete, STOP and end your turn — the user reviews the artifact and marks the card Done. Stop early when the user archives the card.

${DONE_PROTOCOL}

${REVIEW_PROTOCOL}

${DRAFT_PROTOCOL}

${instructions ? `Preset instructions:\n${instructions}\n` : ""}Request:
${prompt}`;
  }

  // One route for every api-mode judgment: the point's stored override wins
  // field by field, the shared endpoint row fills the rest. An empty
  // override resolves exactly to today's global behavior.
  type PointRouteRow = { provider: string | null; endpoint: string | null; api_key: string | null; model: string | null };
  type GlobalRouteRow = { endpoint: string; api_key: string; model: string; provider: string | null };
  function pointRouteConfig(point: PointRouteRow | undefined | null, cfg: GlobalRouteRow | undefined) {
    return resolvePointRoute({
      override: point ? { provider: point.provider, endpoint: point.endpoint, apiKey: point.api_key, model: point.model } : null,
      fallback: { provider: cfg?.provider ?? null, endpoint: cfg?.endpoint ?? null, apiKey: cfg?.api_key ?? null, model: cfg?.model ?? null },
    });
  }

  // Preset judgment runner: one hidden thread on the pinned preset answers a
  // strict-JSON question. Always cleans up (stop + archive); every failure
  // returns ok:false so callers fall back to built-in rules or refuse with
  // the fix named. Burns a full provider turn — only wired to low-frequency
  // points (triage seed, explicit criteria calls).
  async function judgeViaPreset({ presetId, projectId, title, prompt, timeoutMs = PRESET_JUDGE_TIMEOUT_MS }: { presetId: string; projectId: string | null; title: string; prompt: string; timeoutMs?: number }): Promise<{ ok: boolean; text: string | null; error: string | null }> {
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
        reasoningLevel: preset.reasoning_level as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
        permissionMode: preset.permission_mode as "accept-edits" | "auto" | "full",
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
        await new Promise((resolve) => setTimeout(resolve, PRESET_JUDGE_POLL_MS));
      }
      const text = (await bb.sdk.threads.output({ threadId }).catch(() => null))?.output ?? null;
      if (typeof text !== "string" || text.length === 0) return fail("Preset judge returned no output.");
      return { ok: true, text, error: null };
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Preset judge failed.");
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
  function presetCriteriaFindings({ verdicts, semantic, routeAt }: { verdicts: Array<{ id: string; status: string; confidence: number | null }>; semantic: Array<{ id: string; text: string }>; routeAt: number }) {
    const byId = new Map(semantic.map((criterion) => [criterion.id, criterion.text]));
    return verdicts
      .filter((verdict) => byId.has(verdict.id))
      .map((verdict) => {
        const confident = typeof verdict.confidence === "number" && verdict.confidence >= routeAt;
        return {
          id: verdict.id,
          kind: "semantic" as const,
          text: byId.get(verdict.id) ?? verdict.id,
          score: null as number | null,
          confidence: verdict.confidence,
          verdict: (!confident || verdict.status === "unverifiable") ? "unverifiable" as const : (verdict.status as "met" | "unmet"),
          error: null as string | null,
        };
      });
  }

  // Preset variant of artifact-criteria judging for explicit calls
  // (criteria): one spawned judgment per artifact, mapped onto the Jev
  // findings shape so downstream never branches on the judge.
  // One findings shape for every judge path (Jev or preset): the verbose
  // literal lives here once, so the three early returns cannot drift apart.
  type PresetFinding = { id: string; kind: "semantic"; text: string; score: number | null; confidence: number | null; verdict: "met" | "unmet" | "unverifiable"; error: string | null };
  async function judgePresetCriteria({ presetId, projectId, skillText, artifactText, routeAt }: { presetId: string; projectId: string | null; skillText: string; artifactText: string; routeAt: number }) {
    const semantic = groupCriteriaByKind(parseCriteriaBlock(skillText)).semantic;
    if (semantic.length === 0) return { ok: true as const, findings: [] as Array<PresetFinding>, evaluated: 0 };
    const prompt = buildPresetJudgePrompt({ kind: "criteria", state: artifactText, questions: semantic.map((criterion) => ({ id: criterion.id, text: criterion.text })) });
    const judged = await judgeViaPreset({ presetId, projectId, title: "Stelow judge: artifact criteria", prompt });
    if (!judged.ok || !judged.text) return { ok: false as const, findings: [] as Array<PresetFinding>, evaluated: 0, error: judged.error ?? "judge failed" };
    const parsed = parsePresetJudgeOutput({ kind: "criteria", text: judged.text });
    if (!parsed.ok || !("verdicts" in parsed) || (parsed.verdicts.length === 0 && semantic.length > 0)) return { ok: false as const, findings: [] as Array<PresetFinding>, evaluated: 0, error: !parsed.ok ? parsed.error : "judge verdicts match no known criteria" };
    const findings = presetCriteriaFindings({ verdicts: parsed.verdicts, semantic, routeAt });
    return { ok: true as const, findings, evaluated: findings.length };
  }

  // Fire-and-forget card titling on the Generation tier: a short hidden
  // burst proposes a better title than the prompt-derived heuristic, then
  // the human renames inline. Silent on every failure path — creation
  // already succeeded with the heuristic, and a title is never worth an
  // error. Registered as delegation site "card-title".
  async function suggestCardName(cardId: string): Promise<void> {
    try {
      const card = getCard(cardId);
      if (!card) return;
      const band = card.kind === "research" ? "research" : card.kind === "explore" ? "explore" : STAGE_TO_BAND[card.stage] ?? "analysis";
      const designated = db.prepare("SELECT preset_id FROM generation_preset WHERE id = 1").get() as { preset_id: string } | undefined;
      const boardDefault = designated ? getPresetById(designated.preset_id) : null;
      const bandPreset = getPresetForBand(band, cardId);
      const resolved = resolveDraftPreset({ cardPin: null, boardDefault: boardDefault?.id ?? null, bandFallback: bandPreset?.id ?? null });
      const titlePreset = resolved.presetId ? getPresetById(resolved.presetId) : null;
      if (!titlePreset) return;
      const params = presetAttachmentParams(titlePreset);
      let titleThread: { id: string };
      try {
        titleThread = await spawnDisposable({
          projectId: card.project_id,
          environment: { type: "project-default" },
          visibility: "hidden",
          title: `Stelow title: ${card.display_name ?? card.name}`,
          providerId: params.providerId,
          model: params.modelId,
          reasoningLevel: params.reasoningLevel as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
          permissionMode: (params.permissionMode === "full" ? "accept-edits" : params.permissionMode) as "accept-edits" | "auto" | "full",
          input: [{ type: "text", mentions: [], text: buildCardNamePrompt({ prompt: card.prompt, kind: card.kind }) }],
        }, "card-title");
      } catch {
        return;
      }
      const TITLE_POLLS = 12;
      for (let poll = 0; poll < TITLE_POLLS; poll++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const thread = await bb.sdk.threads.get({ threadId: titleThread.id }).catch(() => null);
        const status = (thread as { status?: unknown } | null)?.status;
        if (status === "idle" || status === "stopping" || status === "archived" || status === "deleted") break;
        if (status === "failed" || status === "error" || poll === TITLE_POLLS - 1) {
          await stopWorkerThread(titleThread.id).catch(() => undefined);
          return;
        }
      }
      const output = await bb.sdk.threads.output({ threadId: titleThread.id }).then((result) => result.output ?? "").catch(() => "");
      await stopWorkerThread(titleThread.id).catch(() => undefined);
      const validated = validateCardName(output);
      if (!validated.ok || !validated.name) return;
      const live = getCard(cardId);
      // Never overwrite a human rename that landed while judging.
      if (!live || (live.display_name ?? live.name) !== (card.display_name ?? card.name)) return;
      db.prepare("UPDATE cards SET display_name = ?, updated_at = ? WHERE id = ?").run(validated.name, now(), cardId);
      bb.realtime.publish("card-state", { cardId });
    } catch {
      // Titles never break creation.
    }
  }

  // Independent pre-review on gate entry (see advance hook): same reviewer
  // machinery as the review command, but advisory-only — findings land as
  // a card comment, never a reviews/ file, and every miss is silent.
  async function requestGatePreReview(cardId: string, stage: string): Promise<void> {
    try {
      const kind = preReviewArtifactKind(stage);
      if (!kind) return;
      const card = getCard(cardId);
      if (!card || card.kind !== "build" || isArchivedCard(card)) return;
      const designated = db.prepare("SELECT preset_id FROM review_preset WHERE id = 1").get() as { preset_id: string } | undefined;
      const reviewPreset = designated ? getPresetById(designated.preset_id) : null;
      if (!reviewPreset) return;
      const workspace = await cardWorkspace(card).catch(() => null);
      if (!workspace?.path) return;
      const board = await boardFromRoot(bb, workspace.path, card.dir_hash).catch(() => null);
      const artifact = board?.workflows.find((item) => item.id === card.dir_hash)?.artifacts.find((entry) => entry.kind === kind) ?? null;
      if (!artifact) return;
      const full = resolveArtifactPath(workspace.path, artifact.path);
      const content = full ? await bb.sdk.files.read({ path: full }).then((f) => f.content).catch(() => null) : null;
      if (typeof content !== "string" || !content.trim()) return;
      const contract = contractForBuildArtifact(artifact.path, content);
      const depth = contract ? validateArtifact(content, contract) : null;
      if (!depth || !depth.pass) return;
      const params = presetAttachmentParams(reviewPreset);
      const prompt = buildReviewPrompt({ cardName: card.display_name ?? card.name, request: card.prompt, contractLabel: `pre-review for ${stage}`, artifactContent: content, deterministicFailures: [], evidence: "verified" });
      let preThread: { id: string };
      try {
        preThread = await spawnDisposable({
          projectId: card.project_id,
          environment: { type: "project-default" },
          visibility: "hidden",
          ...(card.worker_thread_id ? { lifecycleOwnerThreadId: card.worker_thread_id } : {}),
          title: `Stelow pre-review (${stage}): ${card.display_name ?? card.name}`,
          providerId: params.providerId,
          model: params.modelId,
          reasoningLevel: params.reasoningLevel as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
          permissionMode: (params.permissionMode === "full" ? "accept-edits" : params.permissionMode) as "accept-edits" | "auto" | "full",
          executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
          prompt,
        }, "review");
      } catch {
        return;
      }
      for (let poll = 0; poll < 60; poll++) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        const thread = await bb.sdk.threads.get({ threadId: preThread.id }).catch(() => null);
        const status = (thread as { status?: unknown } | null)?.status;
        if (status === "idle" || status === "stopping" || status === "archived" || status === "deleted") break;
        if (status === "failed" || status === "error" || poll === 59) {
          await stopWorkerThread(preThread.id).catch(() => undefined);
          return;
        }
      }
      const output = await bb.sdk.threads.output({ threadId: preThread.id }).then((result) => result.output ?? "").catch(() => "");
      await stopWorkerThread(preThread.id).catch(() => undefined);
      const parsed = parseReviewOutput(output, content);
      if (!parsed || !Array.isArray(parsed.findings) || parsed.findings.length === 0) return;
      logCardComment(cardId, "card", cardId, "agent", `Independent pre-review (${stage}, ${reviewPreset.name}):\n\n${reviewSummary(parsed)}`);
      bb.realtime.publish("card-state", { cardId });
    } catch {
      // Advisory path: silence is the status quo ante.
    }
  }

  // Triage-intent router: seed a build card's intent from the Decision API
  // when the point runs in api mode. Advisory only — the worker always
  // re-settles intent in triage — and fail-soft: any missing config, key,
  // error, or low-confidence answer leaves "unknown", exactly as today.
  async function seedBuildIntentFromRouter(promptText: string, projectId: string | null): Promise<string> {
    try {
      if (isDecisionApiDisabled(process.env)) return "unknown";
      const point = db.prepare("SELECT mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points WHERE point = ?").get(DECISION_POINT_TRIAGE_INTENT) as { mode: string; thresholds: string; provider: string | null; endpoint: string | null; api_key: string | null; model: string | null; preset_id: string | null } | undefined;
      const mode = normalizePointMode(point?.mode, "rules");
      if (mode !== "api" && mode !== "preset") return "unknown";
      const cfg = db.prepare("SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1").get() as { endpoint: string; api_key: string; model: string; provider: string | null } | undefined;
      let stored: unknown = null;
      try { stored = point ? JSON.parse(point.thresholds) : null; } catch { stored = null; }
      const thresholds = normalizeThresholds(stored, defaultThresholdsFor(DECISION_POINT_TRIAGE_INTENT));
      if (mode === "preset") {
        const presetId = point?.preset_id ?? null;
        if (!presetId) return "unknown";
        const prompt = buildPresetJudgePrompt({ kind: "choice", state: promptText, questions: triageIntentQuestions() });
        const judged = await judgeViaPreset({ presetId, projectId, title: "Stelow judge: triage intent", prompt });
        if (!judged.ok || !judged.text) {
          bb.log.warn(`triage intent router fell back to built-in rules: ${judged.error ?? "judge failed"}`);
          return "unknown";
        }
        const parsed = parsePresetJudgeOutput({ kind: "choice", text: judged.text, validChoices: Object.keys(TRIAGE_INTENT_CRITERIA) });
        if (!parsed.ok || !("choice" in parsed)) {
          bb.log.warn(`triage intent router fell back to built-in rules: ${!parsed.ok ? parsed.error : "verdict shape mismatch"}`);
          return "unknown";
        }
        const resolved = resolveSeedIntent({ apiAnswers: { intent: { type: "choice", choice: parsed.choice, confidence: parsed.confidence } }, routeAt: thresholds.routeAt });
        if (resolved.source !== "api") return "unknown";
        bb.log.info(`triage intent seeded from preset judge (${presetId}): ${resolved.intent} (confidence ${resolved.confidence})`);
        return resolved.intent;
      }
      const route = pointRouteConfig(point, cfg);
      const provider = normalizeDecisionProvider(route.provider ?? "jev");
      const { key } = resolveDecisionApiKey({ storedKey: route.apiKey ?? null, env: process.env });
      if (!key && providerRequiresKey(provider)) return "unknown";
      const result = await evaluateDecisionCall({
        provider,
        endpoint: route.endpoint ?? defaultEndpointFor(provider),
        apiKey: key ?? "",
        model: normalizeDecisionApiModel(route.model, defaultModelFor(provider)),
        state: promptText,
        questions: triageIntentQuestions(),
      });
      if (!result.ok) {
        bb.log.warn(`triage intent router fell back to built-in rules: ${result.error ?? "call failed"}`);
        return "unknown";
      }
      const resolved = resolveSeedIntent({ apiAnswers: result.answers, routeAt: thresholds.routeAt });
      if (resolved.source === "api") bb.log.info(`triage intent seeded from Decision API: ${resolved.intent} (confidence ${resolved.confidence})`);
      return resolved.intent;
    } catch {
      return "unknown";
    }
  }

  // Auto-continue veto: when the point runs in api mode and the heuristic
  // already cleared a resume, ask one Noul whether the last output shows
  // real progress. A confident "no" vetoes the resume (the card falls
  // through to the paused path); everything else keeps the heuristic
  // standing. Tool-only turns carry no output text — the advance scan
  // already proved them, so they skip the call entirely.
  async function vetAutoContinueNudge(stateText: string | null): Promise<boolean> {
    try {
      if (!stateText || !stateText.trim()) return true;
      const point = db.prepare("SELECT mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points WHERE point = ?").get(DECISION_POINT_AUTO_CONTINUE) as { mode: string; thresholds: string; provider: string | null; endpoint: string | null; api_key: string | null; model: string | null; preset_id: string | null } | undefined;
      if (normalizePointMode(point?.mode, "rules") === "preset") bb.log.warn("auto-continue ignores preset mode: hot paths stay on rules/api so judgments never burn worker turns.");
      if (normalizePointMode(point?.mode, "rules") !== "api") return true;
      if (isDecisionApiDisabled(process.env)) return true;
      const cfg = db.prepare("SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1").get() as { endpoint: string; api_key: string; model: string; provider: string | null } | undefined;
      const route = pointRouteConfig(point, cfg);
      const provider = normalizeDecisionProvider(route.provider ?? "jev");
      const { key } = resolveDecisionApiKey({ storedKey: route.apiKey ?? null, env: process.env });
      if (!key && providerRequiresKey(provider)) return true;
      let stored: unknown = null;
      try { stored = point ? JSON.parse(point.thresholds) : null; } catch { stored = null; }
      const thresholds = normalizeThresholds(stored, defaultThresholdsFor(DECISION_POINT_AUTO_CONTINUE));
      const result = await evaluateDecisionCall({
        provider,
        endpoint: route.endpoint ?? defaultEndpointFor(provider),
        apiKey: key ?? "",
        model: normalizeDecisionApiModel(route.model, defaultModelFor(provider)),
        state: stateText,
        questions: autoContinueQuestions(),
      });
      if (!result.ok) {
        bb.log.warn(`auto-continue veto skipped, heuristic stands: ${result.error ?? "call failed"}`);
        return true;
      }
      const answer = result.answers?.progress ?? null;
      const resolved = resolveAutoContinue({ apiNoul: answer && answer.type === "noul" ? answer.noul : null, routeAt: thresholds.routeAt });
      if (!resolved.proceed) bb.log.info(`auto-continue vetoed by Decision API (progress ${answer && answer.type === "noul" ? answer.noul : "n/a"})`);
      return resolved.proceed;
    } catch {
      return true;
    }
  }

  async function createCardInternal({ projectId, environment, prompt, attachments, intent, appetite, reviewMode, presetId, kind, strategy, stageId, start = true, execution }: { projectId: string; environment?: unknown; prompt: string; attachments: Array<{ path: string; type: "localFile" | "localImage" }>; intent: string; appetite: string; reviewMode: string | string[]; presetId?: string | null; kind?: "build" | "research" | "explore"; strategy?: string | null; stageId?: string | null; start?: boolean; execution?: { providerId?: string; model?: string; reasoningLevel?: string; permissionMode?: "accept-edits" | "auto" | "full"; serviceTier?: "default" | "fast"; executionInputSources?: { providerId?: "explicit" | "client-preference"; model?: "explicit" | "client-preference"; reasoningLevel?: "explicit" | "client-preference"; permissionMode?: "explicit" | "client-preference"; serviceTier?: "explicit" | "client-preference" } } | null }): Promise<{ cardId: string; threadId: string | null }> {
    const project = await bb.sdk.projects.get({ projectId }).catch(() => null);
    // The composer submits the Personal project id for “Don't work in a
    // project”. Some SDK project reads omit its `kind`, so accept its stable
    // id as well as the documented kind marker.
    const isExploratory = projectId === "proj_personal" || project?.kind === "personal";
    if (isExploratory && (kind ?? "build") === "build") {
      throw new Error("Build cards require a project workspace with a Git source. Choose the code project in BB before starting; use Research or Explore for personal, document-only work.");
    }
    const source = project?.sources.find((entry) => entry.isDefault) ?? project?.sources[0];
    if (!isExploratory && !source?.path) throw new Error("Project workspace path is unavailable.");
    const cardId = randomId("card");
    const environmentRecord = environment && typeof environment === "object" ? environment as Record<string, unknown> : {};
    const requestedHostId = typeof environmentRecord.hostId === "string" ? environmentRecord.hostId : null;
    const hosts = await bb.sdk.hosts.list();
    // The plugin's synchronous filesystem operations run on this host. BB's
    // public host contract does not identify it, so only accept the sole host.
    if (isExploratory && hosts.length !== 1) {
      throw new Error("Exploratory work currently requires a single local BB host.");
    }
    const localHostId = hosts[0]?.id ?? null;
    if (isExploratory && requestedHostId && requestedHostId !== localHostId) {
      throw new Error("Exploratory work currently requires the local host.");
    }
    const exploratoryHostId = localHostId;
    const rootPath = isExploratory
      ? nodeJoin(process.env.HOME ?? "/tmp", ".bb", "stelow", "exploratory", cardId)
      : source?.path;
    let workspaceProjectId = projectId;
    let workspaceSource: { path: string; hostId: string } | undefined = source ? { path: source.path, hostId: source.hostId } : undefined;
    if (isExploratory && rootPath && exploratoryHostId) {
      mkdirSync(rootPath, { recursive: true });
      const existing = (await bb.sdk.projects.list()).find((entry) => entry.name === "Stelow exploratory work" && entry.sources.some((candidate) => candidate.hostId === exploratoryHostId && candidate.path === nodeJoin(process.env.HOME ?? "/tmp", ".bb", "stelow", "exploratory")));
      const exploratoryProject = existing ?? await bb.sdk.projects.create({ name: "Stelow exploratory work", source: { type: "local_path", hostId: exploratoryHostId, path: nodeJoin(process.env.HOME ?? "/tmp", ".bb", "stelow", "exploratory") } });
      workspaceProjectId = exploratoryProject.id;
      workspaceSource = { path: rootPath, hostId: exploratoryHostId };
    }
    if (!rootPath || !workspaceSource) throw new Error("A workspace path is unavailable for this card.");
    const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "stelow";
    const displayName = heuristicDisplayName(prompt, slug);
    const isResearch = kind === "research";
    const isExplore = kind === "explore";
    const researchStrategy = isResearch ? researchStrategyById(strategy ?? "") : null;
    if (isResearch && !researchStrategy) {
      throw new Error(`Unknown research strategy "${strategy ?? ""}". Pick one of: ${RESEARCH_STRATEGIES.map((entry) => entry.id).join(", ")}.`);
    }
    const exploreStage = isExplore ? techniqueById(stageId ?? "") : null;
    if (isExplore && !exploreStage) {
      throw new Error(`Unknown explore technique "${stageId ?? ""}". Pick one of: ${TECHNIQUE_CATALOG.map((entry) => entry.id).join(", ")}.`);
    }
    // Explicit intent wins (import heuristic, reseed reclassification);
    // otherwise the triage router may seed from the Decision API, else the
    // worker settles "unknown" in triage as before.
    const explicitIntent = normalizeBuildSeedIntent(intent);
    const initialIntent = isResearch ? "investigate" : isExplore ? "explore" : explicitIntent !== "unknown" ? explicitIntent : await seedBuildIntentFromRouter(prompt, workspaceProjectId);
    // Canonical gates: legacy ladder strings normalize through the compat
    // map, so the composer, board defaults, and reseed all carry the set.
    const reviewGates = normalizeReviewGates(reviewMode);
    const reviewRung = legacyLabelForGates(reviewGates) ?? (reviewGates.length === 0 ? "Auto" : `Custom ${formatReviewGates(reviewGates)}`);
    const seed = await seedWorkflow(bb, rootPath, cardId, slug, initialIntent, appetite, reviewGates);
    if (seed.error) throw new Error(seed.error);
    const preset = presetId ? (getPresetById(presetId) ?? getDefaultPreset()) : getDefaultPreset();
    // Spawn workers on their track's entry band (lib/tracks: each track
    // owns its band). A board-level reliable override replaces the band
    // preset when set; otherwise falls back to the card/board default when
    // the band is unconfigured.
    const spawnBand = bandForKind(kind ?? "build");
    const bandRow = db.prepare("SELECT preset_id FROM stage_presets WHERE band = ?").get(spawnBand) as { preset_id: string } | undefined;
    const reliableRow = db.prepare("SELECT preset_id FROM reliable_preset WHERE id = 1").get() as { preset_id: string } | undefined;
    const bandPreset = bandRow ? getPresetById(bandRow.preset_id) : null;
    const reliablePreset = reliableRow ? getPresetById(reliableRow.preset_id) : null;
    const basePreset = reliablePreset ?? bandPreset ?? preset;
    // The composer owns the provider/model pickers: when the submitted
    // choice differs from the resolved base preset, pin it as this card's
    // override (same card-override-* mechanism as the Agent preset dialog)
    // so the spawn — and every later restart/reseed, which resolve through
    // the override-aware getReliablePresetForBand — runs what the user picked.
    // A matching choice pins nothing: the card stays on the shared preset.
    const override = composerPresetOverride(basePreset, execution ?? null);
    let spawnPreset = basePreset;
    // Pinned after the card row exists (card_presets references cards): the
    // presets row itself is standalone and must exist before the spawn below.
    let pinnedOverrideId: string | null = null;
    if (override && override.providerId && override.modelId && override.reasoningLevel && override.permissionMode) {
      const ts = now();
      db.prepare("INSERT OR REPLACE INTO presets (id, name, provider_id, model_id, reasoning_level, permission_mode, environment_kind, base_branch, machine_id, instructions, is_default, built_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)").run(
        `card-override-${cardId}`, `Card override ${cardId}`, override.providerId, override.modelId, override.reasoningLevel, override.permissionMode, basePreset.environment_kind, basePreset.base_branch, basePreset.machine_id, basePreset.instructions, ts, ts,
      );
      const pinned = getPresetById(`card-override-${cardId}`);
      if (pinned) {
        spawnPreset = pinned;
        pinnedOverrideId = pinned.id;
      }
    }
    const params = presetAttachmentParams(spawnPreset);
    const spawnExecution = composerSpawnInput(params, execution ?? null);
    const workerAttachments = attachments.map((attachment) => ({ type: attachment.type, path: attachment.path }));
    // BB requires Personal-project threads to retain a `personal` workspace.
    // Exploratory work therefore uses one Stelow-owned project with a local source.
    const workerProjectId = workspaceProjectId;
    const selectedEnvironment = isExploratory
      ? workerEnvironment(workspaceSource, params, true)
      : selectedCardEnvironment(environment, workerEnvironment(workspaceSource, params));
    const selectedManagedWorktree = isManagedWorktreeEnvironment(selectedEnvironment);
    const creationStamp = roundTimestamp();
    const creationRoundFile = isResearch && researchStrategy && seed.stateDir
      ? roundRelPath(seed.stateDir, rootPath, roundFileName(researchStrategy.id, 1, creationStamp))
      : "";
    if (creationRoundFile) await ensureArtifactParent(rootPath, creationRoundFile);
    // Paths are deterministic, but files are created only when their worker
    // has reviewable content. A missing output is pending, never an empty UI.
    const researchPrompt = isResearch && researchStrategy ? researchWorkerPrompt({
      displayName,
      prompt,
      strategyLabel: researchStrategy.label,
      strategyId: researchStrategy.id,
      strategySkill: researchStrategy.skill,
      stateDirText: text(seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>"),
      workspaceRoot: rootPath,
      instructions: params.instructions,
      flavor: "initial",
      previousThreadId: null,
      roundNo: 1,
      roundStamp: creationStamp,
      roundFile: creationRoundFile,
    }) : null;
    const explorePrompt = isExplore && exploreStage ? exploreWorkerPrompt({
      displayName,
      prompt,
      stage: exploreStage,
      stateDirText: text(seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>"),
      workspaceRoot: rootPath,
      instructions: params.instructions,
      flavor: "initial",
      previousThreadId: null,
    }) : null;
    // Deferred start: an unstarted card parks in To-Do with no thread and
    // no activity. The sync poll ignores threadless cards by construction,
    // so nothing runs, burns, or badges until the human starts it.
    let thread: Awaited<ReturnType<typeof bb.sdk.threads.spawn>> | null = null;
    if (start) {
    try {
      // delegation-site: worker-spawn
      thread = await bb.sdk.threads.spawn({
      projectId: workerProjectId,
      environment: selectedEnvironment,
      visibility: "hidden",
      title: `Stelow: ${displayName}`,
      // spawnExecution merges the composer's choice over the resolved
      // preset; the preset fallbacks below only cover the impossible case
      // of a preset row missing a NOT NULL column (fail closed on strings).
      providerId: spawnExecution.providerId ?? params.providerId,
      model: spawnExecution.model ?? params.modelId,
      reasoningLevel: (spawnExecution.reasoningLevel ?? params.reasoningLevel) as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
      permissionMode: (spawnExecution.permissionMode ?? params.permissionMode) as "accept-edits" | "auto" | "full",
      ...(spawnExecution.serviceTier ? { serviceTier: spawnExecution.serviceTier } : {}),
      executionInputSources: spawnExecution.executionInputSources,
      input: [{ type: "text", mentions: [], text: researchPrompt ?? explorePrompt ?? `You are running a Stelow workflow inside the bb-plugin-stelow panel. Your workflow owns its own state dir (${text(seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>")}) — its state.md holds name, intent, current_stage, status. ${CARD_OWNER_RULES}

${selectedManagedWorktree ? "BB provisioned the managed worktree selected by the user. Treat your current working directory as the code root; never redirect code changes to the project source path used for Stelow's workflow metadata." : ""}

Step 1 — verify intent first: this card starts as intent=\`${initialIntent}\` in state.md (pre-seeded when the request already carried one, else \`unknown\`). Read the request, confirm or pick the fitting intent (new-product, feature, bugfix, refactor, investigate) and write it to state.md immediately so the card updates in real time. Ask one concise question via the form below only when genuinely ambiguous. Do NOT load phase skills or do product work before intent is settled. Appetite=\`${appetite}\` and review gates=\`${formatReviewGates(reviewGates)}\` (${reviewRung}) are already recorded in state.md — use them, never re-ask.

Order of work, always: (1) triage — settle intent and record it in state.md; (2) load the workflow skills; (3) advance stages and do the work. If a \`bb stelow\` command fails, read its stderr once and continue the workflow — do NOT spend the turn debugging the CLI; report the exact error and move on.

Load the workflow skills first (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-* via \`bb skill list\`). Use \`bb stelow advance <stage>\` to change stages (do NOT hand-edit current_stage). ${NEVER_SEED} Preserve every gate (product, interface, tech plan, diff). ${CLI_EQUIVALENTS} ${RECON_PROTOCOL} ${DRAFT_PROTOCOL}

${TURN_DISCIPLINE}

${COMMIT_STYLE}

CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form, NEVER just write text like "waiting for your choice":

    bb stelow ask --thread "$BB_THREAD_ID" \\
      --question "<a single clear question>" \\
      --option "<label 1>" --option "<label 2>" [--option "<label 3>" ...] [--multiple]

Batch independent questions into ONE ask call by repeating --question groups (each with its own --option labels) — the user answers them together instead of being pinged one by one. Ask dependent questions (where Q2 needs Q1's answer) one at a time. When the human must compare artifacts to decide (interface picks, plan reviews), attach each option's evidence: --desc for trade-offs, --preview for the inline glance, --artifact for the workspace-relative file they can open.

Before asking, summarize what you read so the user can answer with context. Do not skip triage; do not start shaping before triage is settled. Each ask blocks until answered; the card stays in its column and signals it is waiting for an answer. On timeout ("No response after Ns"), STOP and wait — the question stays answerable on the card and the answer arrives as a message. Never re-ask the same question. ${INTERFACE_PICK} For unselected gates, write the approval receipt yourself (.stelow/approvals/{dirHash}/{file}.approved.md) and advance; for selected gates, open a structured ask instead. Stop when the user archives the card or the workflow reaches \`audit\`.

${DONE_PROTOCOL}

${SPLIT_PROTOCOL}

${params.instructions ? `Preset instructions:\n${params.instructions}\n` : ""}Request:
${prompt}` }, ...workerAttachments],
      });
    } catch (error) {
      // No card row exists yet: drop the override preset staged above so a
      // failed spawn leaves no orphan card-override row behind.
      if (pinnedOverrideId) db.prepare("DELETE FROM presets WHERE id = ?").run(pinnedOverrideId);
      throw error;
    }
    }
    const ts = now();
    const createdAt = new Date(ts).toISOString();
    // Columns are the single source of truth: placeholders derive from this
    // list, so adding a column cannot leave the SQL with a stray "?".
    const CARD_COLUMNS = ["id", "project_id", "name", "display_name", "prompt", "intent", "status", "stage", "activity", "worker_thread_id", "worker_preset_id", "dir_hash", "attachments", "workspace_kind", "workspace_path", "workspace_host_id", "kind", "research_strategy", "research_strategies", "explore_stage", "last_error", "last_assistant_text", "environment_label", "created_at", "updated_at"];
    const selectedEnvRecord = selectedEnvironment && typeof selectedEnvironment === "object" ? selectedEnvironment as Record<string, unknown> : {};
    const selectedEnvWorkspace = selectedEnvRecord.workspace && typeof selectedEnvRecord.workspace === "object" && !Array.isArray(selectedEnvRecord.workspace) ? selectedEnvRecord.workspace as Record<string, unknown> : {};
    const environmentLabel = describeCardEnvironment({ exploratory: isExploratory, envType: selectedEnvRecord.type, workspaceType: selectedEnvWorkspace.type });
    const cardValues = [cardId, workspaceProjectId, slug, displayName, prompt, initialIntent, isResearch || isExplore ? "pending" : "draft", isResearch ? "research" : isExplore ? "explore" : "triage", start ? "running" : "idle", thread?.id ?? null, spawnPreset.id, seed.dirHash, JSON.stringify(attachments), isExploratory ? "exploratory" : "project", isExploratory ? rootPath : null, isExploratory ? workspaceSource.hostId : null, isResearch ? "research" : isExplore ? "explore" : "build", researchStrategy?.id ?? null, isResearch && researchStrategy ? JSON.stringify([{ id: researchStrategy.id, at: createdAt, file: creationRoundFile }]) : null, exploreStage?.id ?? null, null, null, environmentLabel, ts, ts];
    if (cardValues.length !== CARD_COLUMNS.length) {
      throw new Error(`Card insert mismatch: ${cardValues.length} values for ${CARD_COLUMNS.length} columns.`);
    }
    db.prepare(`INSERT INTO cards (${CARD_COLUMNS.join(", ")}) VALUES (${CARD_COLUMNS.map(() => "?").join(", ")})`).run(...cardValues);
    recordStageEvent(cardId, isResearch ? "research" : isExplore ? "explore" : "triage");
    // NOTE: no card_presets row here on purpose unless the composer pinned
    // one above. An override row means "the user explicitly pinned this
    // card", and writing the spawn default as one would mislabel every
    // fresh card as overridden (and trip staleness). The pin lands after
    // the card row because card_presets references cards.
    if (pinnedOverrideId) {
      db.prepare("INSERT OR REPLACE INTO card_presets (card_id, preset_id, assigned_at) VALUES (?, ?, ?)").run(cardId, pinnedOverrideId, ts);
    }
    if (thread) {
      recordWorkerThread(db, cardId, thread.id, spawnPreset.id, "initial");
      if (seed.dirHash) void recordWorkflowLineage(rootPath, seed.dirHash, thread.id, spawnPreset.id, "initial");
    }
    // Build remembers the user's planning depth / review gates for the next
    // card. Research and Explore carry fixed internals that must never
    // clobber those build defaults.
    if (!isResearch && !isExplore) await bb.storage.kv.set("board-workflow-defaults", { appetite, reviewMode: reviewRung, reviewGates });
    bb.realtime.publish("card-state", { cardId });
    // Title suggestion rides along, never blocking: creation already
    // succeeded with the heuristic, the burst upgrades it when it lands.
    void suggestCardName(cardId).catch(() => undefined);
    return { cardId, threadId: thread?.id ?? null };
  }

  type CardRow = { id: string; project_id: string; name: string; display_name: string | null; prompt: string; intent: string; status: string; stage: string; activity: string; worker_thread_id: string | null; worker_preset_id: string | null; preset_restart_pending: number | null; dir_hash: string | null; auto_continue_count: number | null; auto_continue_stage: string | null; spawn_retry_count: number | null; spawn_retry_thread: string | null; attachments: string; workspace_kind: "project" | "exploratory"; workspace_path: string | null; workspace_host_id: string | null; kind: "build" | "research" | "explore"; research_strategy: string | null; research_strategies: string | null; explore_stage: string | null; last_error: string | null; last_assistant_text: string | null; last_idle_at: number | null; environment_label: string | null; created_at: number; updated_at: number };
  type CommentRow = { id: string; card_id: string; target: string; target_id: string; author: string; body: string; created_at: number };
  type InboxEventRow = { id: string; card_id: string; kind: "question" | "error" | "paused" | "completed"; summary: string; occurred_at: number; read_at: number | null; archived_at: number | null; resolved_at: number | null; resolved_reason: string | null; severity: number | null; severity_reasons: string | null };
  type PresetRow = {
    id: string; name: string; provider_id: string; model_id: string; reasoning_level: string;
    permission_mode: string; environment_kind: string; base_branch: string | null; machine_id: string | null;
    instructions: string; is_default: number; built_in: number; created_at: number; updated_at: number;
  };

  function getDefaultPreset(): PresetRow {
    const row = db.prepare("SELECT * FROM presets WHERE is_default = 1 ORDER BY created_at ASC LIMIT 1").get() as PresetRow | undefined;
    if (row) return row;
    const fallback = db.prepare("SELECT * FROM presets ORDER BY created_at ASC LIMIT 1").get() as PresetRow | undefined;
    if (fallback) return fallback;
    db.prepare("INSERT INTO presets (id, name, provider_id, model_id, reasoning_level, permission_mode, environment_kind, instructions, is_default, built_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "preset_default", "Default", "pi", "bifrost/harness-coding", "medium", "full", "project-default", "", 1, 1, now(), now(),
    );
    return db.prepare("SELECT * FROM presets WHERE id = ?").get("preset_default") as PresetRow;
  }

  function getPresetById(id: string): PresetRow | null {
    const row = db.prepare("SELECT * FROM presets WHERE id = ?").get(id) as PresetRow | undefined;
    return row ?? null;
  }

  function getPresetForCard(cardId: string): PresetRow {
    const row = db.prepare("SELECT preset_id FROM card_presets WHERE card_id = ?").get(cardId) as { preset_id: string } | undefined;
    if (!row) return getDefaultPreset();
    const preset = getPresetById(row.preset_id);
    return preset ?? getDefaultPreset();
  }

  // Resolve the worker preset for a stage band. An explicit per-card override
  // (set in the card's Agent preset section, e.g. to escape a quota error)
  // wins over the band policy: explicit + later beats phase default. Without
  // an override, a configured band preset applies, else the card/board default.
  function getPresetForBand(band: string, cardId: string): PresetRow {
    const override = db.prepare("SELECT preset_id FROM card_presets WHERE card_id = ?").get(cardId) as { preset_id: string } | undefined;
    if (override) {
      const pinned = getPresetById(override.preset_id);
      if (pinned) return pinned;
    }
    const row = db.prepare("SELECT preset_id FROM stage_presets WHERE band = ?").get(band) as { preset_id: string } | undefined;
    if (!row) return getPresetForCard(cardId);
    const preset = getPresetById(row.preset_id);
    return preset ?? getPresetForCard(cardId);
  }

  // Resolve the preset for reliable-tier spawns (worker starts, restarts,
  // band swaps, research fan-out, automation drafts). The per-card override
  // still wins; the board-level reliable override replaces the band preset
  // when set; empty override means the band preset (today's behavior).
  // Stays beside getPresetForBand — never inside it — so the draft-burst
  // band fallback keeps resolving the pure band preset.
  function getReliablePresetForBand(band: string, cardId: string): PresetRow {
    const override = db.prepare("SELECT preset_id FROM card_presets WHERE card_id = ?").get(cardId) as { preset_id: string } | undefined;
    const reliable = db.prepare("SELECT preset_id FROM reliable_preset WHERE id = 1").get() as { preset_id: string } | undefined;
    const bandRow = db.prepare("SELECT preset_id FROM stage_presets WHERE band = ?").get(band) as { preset_id: string } | undefined;
    const resolved = resolveReliablePreset({
      cardPin: override?.preset_id ?? null,
      reliableOverride: reliable?.preset_id ?? null,
      bandPreset: bandRow?.preset_id ?? null,
      defaultPreset: null,
    });
    if (resolved.presetId) {
      const pinned = getPresetById(resolved.presetId);
      if (pinned) return pinned;
    }
    return getPresetForCard(cardId);
  }

  function presetAttachmentParams(preset: PresetRow): { providerId: string; modelId: string; reasoningLevel: string; permissionMode: string; environmentKind: string; baseBranch: string | null; machineId: string | null; instructions: string } {
    return {
      providerId: preset.provider_id,
      modelId: preset.model_id,
      reasoningLevel: preset.reasoning_level,
      permissionMode: preset.permission_mode,
      environmentKind: preset.environment_kind,
      baseBranch: preset.base_branch,
      machineId: preset.machine_id,
      instructions: preset.instructions,
    };
  }

  // Respawn a card's worker with a new preset at a band boundary. Kept on the
  // same per-workflow state dir (dir_hash) so the new worker re-reads the
  // already-advanced state.md and continues from the current stage — no context
  // is re-created or reset. The old worker is archived/stopped by this helper.
  async function respawnWorkerForBand(cardId: string, presetId: string, endedReason = "band-swap", opts?: { strategyId?: string; flavor?: "restart" | "append"; roundNo?: number; roundStamp?: string; roundFile?: string; previousProjectId?: string | null }): Promise<{ ok: boolean; error?: string; threadId?: string }> {
    const row = getCard(cardId);
    if (!row) return { ok: false, error: ERR_CARD_NOT_FOUND };
    const preset = getPresetById(presetId);
    if (!preset) return { ok: false, error: ERR_PRESET_NOT_FOUND };
    const params = presetAttachmentParams(preset);
    const workspace = await cardWorkspace(row);
    const projectPath = workspace?.path ?? "";
    const source = workspace?.hostId ? { path: workspace.path, hostId: workspace.hostId } : null;
    // Resolve the real per-workflow state dir (stelow.json -> created date), so
    // the respawned worker is told the correct path — never a guessed date.
    let stateDir: string | null = null;
    if (row.dir_hash && projectPath) {
      stateDir = await workflowStateDir(bb, projectPath, row.id, row.dir_hash).catch(() => null);
    }
    if (row.dir_hash && !stateDir) {
      return { ok: false, error: "This card's workflow state cannot be verified. Reseed it before restarting its worker." };
    }
    const stateHint = stateDir ?? (row.dir_hash ? ".stelow/<date>/" + row.dir_hash : "<project>/.stelow/<date>/<dirHash>");
    // Research cards restart with the strategy prompt, never the build
    // stage machine. The run strategy defaults to the latest round; a new
    // round passes its own. A research card without a known strategy cannot
    // restart honestly — refuse with the fix instead of spawning a confused
    // worker.
    const history = strategyList(row);
    const runStrategyId = row.kind === "research" ? (opts?.strategyId ?? history[history.length - 1] ?? row.research_strategy ?? "") : null;
    const researchStrategy = row.kind === "research" ? researchStrategyById(runStrategyId ?? "") : null;
    if (row.kind === "research" && !researchStrategy) return { ok: false, error: "This research has no known strategy. Archive it and start a new one." };
    const exploreStage = row.kind === "explore" ? techniqueById(row.explore_stage ?? "") : null;
    if (row.kind === "explore" && !exploreStage) return { ok: false, error: "This explore card has no known technique. Archive it and start a new one." };
    // Restart reuses the round's own file (idempotent rewrite); a fresh
    // spawn passes its own. Fall back to a composed path only when history
    // carries none (shouldn't happen for spawned rounds).
    const respawnRoundNo = opts?.roundNo ?? Math.max(1, history.length);
    const respawnStamp = opts?.roundStamp ?? roundTimestamp();
    let respawnFile = opts?.roundFile ?? "";
    if (!respawnFile && researchStrategy) {
      respawnFile = [...strategyRounds(row)].reverse().find((entry) => entry.id === researchStrategy.id)?.file
        ?? (stateDir && projectPath ? roundRelPath(stateDir, projectPath, roundFileName(researchStrategy.id, respawnRoundNo, respawnStamp)) : "");
    }
    const researchRestart = researchStrategy ? researchWorkerPrompt({
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
    }) : null;
    const exploreRestart = exploreStage ? exploreWorkerPrompt({
      displayName: row.display_name ?? row.name,
      prompt: row.prompt,
      stage: exploreStage,
      stateDirText: text(stateHint),
      workspaceRoot: projectPath || "<workspace>",
      instructions: params.instructions,
      flavor: "restart",
      previousThreadId: row.worker_thread_id,
    }) : null;
    try {
      const nextEnvironment = await continuingWorkerEnvironment(row, source ? workerEnvironment(source, params, row.workspace_kind === "exploratory") : { type: "project-default" });
      // delegation-site: worker-spawn
      const newThread = await bb.sdk.threads.spawn({
        projectId: row.project_id,
        environment: nextEnvironment,
        visibility: "hidden",
        title: `Stelow: ${row.display_name ?? row.name}`,
        providerId: params.providerId,
        model: params.modelId,
        reasoningLevel: params.reasoningLevel as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
        permissionMode: params.permissionMode as "accept-edits" | "auto" | "full",
        executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
        prompt: researchRestart ?? exploreRestart ?? `You are running a Stelow workflow inside the bb-plugin-stelow panel. The host re-seeded your per-workflow state, transitions.md, and stelow.json. Your workflow owns its own state dir (${text(stateHint)}) — its state.md holds name, intent, current_stage, status.${stateDir ? "" : " Resolve the exact path from stelow.json; its state.md holds name, intent, current_stage, status."} ${CARD_OWNER_RULES} The Stelow workflow skills (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-*) are provided by this plugin — start by loading them (they live under the plugin's skills directory; \`bb skill list\` shows them). The product strategy playbooks (stelow-product-*) are also provided by this plugin \u2014 check \`bb skill list\` first, and only fetch via \`npx skills add calionauta/stelow\` if one is missing. Use \`bb stelow advance <stage>\` to change stages (do NOT hand-edit current_stage). ${NEVER_SEED} Preserve every gate (product, interface, tech plan, diff). ${CLI_EQUIVALENTS} ${RECON_PROTOCOL} ${DRAFT_PROTOCOL}

${TURN_DISCIPLINE}

${COMMIT_STYLE}

Intent is currently \`${row.intent}\` in state.md. ${row.intent === "unknown" ? "It is still unknown, so your FIRST job is triage: classify it (new-product, feature, bugfix, refactor, or investigate), write it to state.md immediately, and only then continue — ask via the form below only if genuinely ambiguous." : "Use it — do NOT ask the user to pick or confirm intent again."} Order of work, always: (1) settle intent; (2) load the workflow skills; (3) continue from the current stage. If a \`bb stelow\` command fails, read its stderr once and continue — do NOT spend the turn debugging the CLI; report the exact error and move on.

You are being restarted mid-workflow at a stage boundary so a new preset can take over for this phase. Read your state.md and transitions.md, and CONTINUE the workflow from the current stage. Do not restart from triage; do not re-confirm what is already settled in state.md. Pick up exactly where the workflow left off.${row.worker_thread_id ? ` Previous worker thread: ${row.worker_thread_id} (archived before this handoff). If state.md is thin — e.g. the previous worker stalled silently — its turn history may hold the missing context; retrieve it with \`bb thread output ${row.worker_thread_id}\`.` : ""}

CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form:

    bb stelow ask --thread "$BB_THREAD_ID" \\\\
      --question "<a single clear question>" \\\\
      --option "<label 1>" --option "<label 2>" [--option "<label 3>" ...] [--multiple]

Batch independent questions into ONE ask call by repeating --question groups (each with its own --option labels) — the user answers them together instead of being pinged one by one. Ask dependent questions (where Q2 needs Q1's answer) one at a time. When the human must compare artifacts to decide (interface picks, plan reviews), attach each option's evidence: --desc for trade-offs, --preview for the inline glance, --artifact for the workspace-relative file they can open.

Before asking a question, first summarize what you read (files, plan, codebase) so the user can answer with context. Each bb stelow ask call blocks until the user submits; the card stays in its column and signals it is waiting for an answer. Never re-ask the same question. ${INTERFACE_PICK} For unselected gates, write the approval receipt yourself (.stelow/approvals/{dirHash}/{file}.approved.md) and advance; for selected gates, open a structured ask instead. Stop when the user archives the card or the workflow reaches \`audit\`.

${DONE_PROTOCOL}

${SPLIT_PROTOCOL}

${params.instructions ? `Preset instructions:\n${params.instructions}\n` : ""}Request:\n${row.prompt}`,
      });
      // The new worker is live — only now retire the old one (archive+stop), so a
      // spawn failure never leaves the card with no worker. If the old worker is
      // the one that just called advance, it has already returned its CLI output.
      if (row.worker_thread_id) {
        try { await bb.sdk.threads.archive({ threadId: row.worker_thread_id }); } catch { /* ignore */ }
        try { await bb.sdk.threads.stop({ threadId: row.worker_thread_id }); } catch { /* ignore */ }
      }
      const ts = now();
      updateCard(cardId, { worker_thread_id: newThread.id, worker_preset_id: preset.id, preset_restart_pending: 0, activity: "running", last_error: null, updated_at: ts });
      recordWorkerThread(db, cardId, newThread.id, preset.id, endedReason);
      if (row.dir_hash) void recordWorkflowLineage(projectPath, row.dir_hash, newThread.id, preset.id, endedReason);
      // Official inline mention of the archived predecessor (not just copied
      // text): renders as a chip the user can open, and the worker can expand
      // it natively for context state.md doesn't carry. Best-effort — the
      // prompt text already references the thread id.
      if (row.worker_thread_id) {
        try {
          const tag = "@previous-worker";
          const mentionText = `Continuity link — ${tag} is the archived worker this thread replaces. Consult it if state.md is thin.`;
          const start = mentionText.indexOf(tag);
          await bb.sdk.threads.send({ threadId: newThread.id, mode: "auto", input: [{ type: "text", text: mentionText, mentions: [{ start, end: start + tag.length, resource: { kind: "thread", label: `Stelow: ${row.display_name ?? row.name} (previous)`, threadId: row.worker_thread_id, projectId: opts?.previousProjectId ?? row.project_id } }] }] });
        } catch { /* mention nicety; prompt reference suffices */ }
      }
      return { ok: true, threadId: newThread.id };
    } catch (error) {
      // Spawn failed — surface it instead of leaving a silent zombie card.
      const msg = error instanceof Error ? error.message : "Respawn failed.";
      updateCard(cardId, { activity: "error", last_error: msg });
      return { ok: false, error: msg };
    }
  }

  async function cardWorkspace(card: CardRow): Promise<{ path: string; hostId: string | null } | null> {
    if (card.workspace_kind === "exploratory") {
      return card.workspace_path ? { path: card.workspace_path, hostId: card.workspace_host_id } : null;
    }
    const project = await bb.sdk.projects.get({ projectId: card.project_id }).catch(() => null);
    const source = project?.sources.find((entry) => entry.isDefault) ?? project?.sources[0];
    return source?.path ? { path: source.path, hostId: source.hostId } : null;
  }

  type RecoveryGitEvidence = { isGit: boolean; gitRoot: string | null; branch: string | null; headSha: string | null; changedFiles: number };
  type QuestionStalenessVerdict = { docRevised: boolean; docRemoved: boolean; checkoutMoved: boolean; commitCount: number; touchedPaths: string[] };
  // Read-time staleness for a card's open questions: each questioned document
  // against its ask-time baseline, plus the touched-paths evidence behind a
  // moved checkout. Advisory only — every question stays answerable.
  async function stalenessForQuestions(
    cardId: string,
    questions: Array<{ id: string; options: Array<{ artifact: { absolutePath: string | null } | null }> }>,
  ): Promise<Map<string, QuestionStalenessVerdict>> {
    const out = new Map<string, QuestionStalenessVerdict>();
    try {
      const rows = db.prepare("SELECT artifact_path, artifact_sha256, git_root, head_sha FROM question_evidence WHERE card_id = ?").all(cardId) as Array<{ artifact_path: string; artifact_sha256: string; git_root: string | null; head_sha: string | null }>;
      if (rows.length === 0) return out;
      const byPath = new Map(rows.map((row) => [row.artifact_path, row]));
      const heads = new Map<string, string | null>();
      const touchedByMove = new Map<string, { commitCount: number; paths: string[] }>();
      const headFor = async (gitRoot: string): Promise<string | null> => {
        if (!heads.has(gitRoot)) {
          const current = await recoveryGitEvidence(gitRoot).catch(() => null);
          heads.set(gitRoot, current?.headSha ?? null);
        }
        return heads.get(gitRoot) ?? null;
      };
      for (const question of questions) {
        const flags = { docRevised: false, docRemoved: false, checkoutMoved: false };
        let detail = { commitCount: 0, paths: [] as string[] };
        for (const option of question.options ?? []) {
          const absolute = option?.artifact?.absolutePath;
          if (!absolute) continue;
          const row = byPath.get(absolute);
          if (!row) continue;
          const sha = await sha256OfHostFile(absolute);
          const head = row.git_root ? await headFor(row.git_root) : null;
          const single: { docRevised: boolean; docRemoved: boolean; checkoutMoved: boolean } | null = stalenessOf(
            { artifactSha256: row.artifact_sha256, gitRoot: row.git_root, headSha: row.head_sha },
            { sha256: sha, headSha: head },
          );
          if (!single) continue;
          if (single.docRevised) flags.docRevised = true;
          if (single.docRemoved) flags.docRemoved = true;
          if (single.checkoutMoved) flags.checkoutMoved = true;
          if (single.checkoutMoved && row.git_root && row.head_sha && detail.paths.length === 0) {
            const key = `${row.git_root} ${row.head_sha}`;
            if (!touchedByMove.has(key)) touchedByMove.set(key, await gitTouchedSince(row.git_root, row.head_sha));
            detail = touchedByMove.get(key)!;
          }
        }
        if (flags.docRevised || flags.docRemoved || flags.checkoutMoved) {
          out.set(question.id, { ...flags, commitCount: detail.commitCount, touchedPaths: detail.paths });
        }
      }
    } catch { /* advisory only */ }
    return out;
  }
  function runGitIn(cwd: string, args: string[], maxBuffer = 1024 * 1024): Promise<{ ok: boolean; stdout: string }> {
    return new Promise((done) => {
      execFile("git", args, { cwd, timeout: 15_000, maxBuffer }, (error, stdout) => done({ ok: !error, stdout: typeof stdout === "string" ? stdout : "" }));
    });
  }
  // Discard evidence: everything discardEligibility (lib/discard-policy)
  // needs, gathered fresh per call. Exploratory folders are exact paths;
  // project checkouts resolve through the card's workspace like the worker's.
  type DiscardEvidence = {
    status: string; workspaceKind: string; checkoutPath: string | null; dirExists: boolean;
    isGit: boolean; branch: string | null; hasUpstream: boolean; upstreamRef: string | null;
    changed: string[]; untracked: string[]; unpushedCommits: number; stashCount: number; resetTarget: string | null;
    linkedWorktree: boolean; sharedWith: number;
  };
  const EXPLORATORY_SCOPE = nodeJoin(process.env.HOME ?? "/tmp", ".bb", "stelow", "exploratory");
  async function discardEvidence(card: CardRow): Promise<DiscardEvidence> {
    const blank: DiscardEvidence = { status: card.status, workspaceKind: card.workspace_kind, checkoutPath: null, dirExists: false, isGit: false, branch: null, hasUpstream: false, upstreamRef: null, changed: [], untracked: [], unpushedCommits: 0, stashCount: 0, resetTarget: null, linkedWorktree: false, sharedWith: 0 };
    if (card.workspace_kind === "exploratory") {
      const explorPath = card.workspace_path;
      if (!explorPath) return blank;
      let dirExists = false;
      try { dirExists = existsSync(explorPath); } catch { dirExists = false; }
      let sharedWith = 0;
      try {
        sharedWith = (db.prepare("SELECT COUNT(*) AS n FROM cards WHERE id != ? AND status != 'archived' AND workspace_kind = 'exploratory' AND workspace_path = ?").get(card.id, explorPath) as { n: number } | undefined)?.n ?? 0;
      } catch { /* count is advisory */ }
      return { ...blank, checkoutPath: explorPath, dirExists, sharedWith };
    }
    const workspace = await cardWorkspace(card);
    const checkout = workspace?.path ?? null;
    if (!checkout) return blank;
    const top = await runGitIn(checkout, ["rev-parse", "--show-toplevel"]);
    if (!top.ok || !top.stdout.trim()) return { ...blank, checkoutPath: checkout };
    const gitRoot = top.stdout.trim();
    const [branchR, upstreamR, statusR, unpushedR, stashR] = await Promise.all([
      runGitIn(gitRoot, ["branch", "--show-current"]),
      runGitIn(gitRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
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
    const unpushedCommits = unpushedR.ok ? Number.parseInt(unpushedR.stdout.trim(), 10) || 0 : 0;
    const stashCount = stashR.ok ? stashR.stdout.split("\n").filter(Boolean).length : 0;
    // Reset target: parent of the first commit made since the card started
    // (card-attributable work); no card-era commit means dirty-files-only.
    let resetTarget: string | null = null;
    try {
      const since = Math.floor(card.created_at / 1000);
      const first = await runGitIn(gitRoot, ["log", "--format=%H", "--reverse", `--since=${since}`, "HEAD", "--"]);
      const firstSha = first.ok ? first.stdout.split("\n").map((entry) => entry.trim()).filter(Boolean)[0] ?? null : null;
      if (firstSha) {
        const parent = await runGitIn(gitRoot, ["rev-parse", `${firstSha}^`]);
        resetTarget = parent.ok && parent.stdout.trim() ? parent.stdout.trim() : null;
      } else {
        const head = await runGitIn(gitRoot, ["rev-parse", "HEAD"]);
        resetTarget = head.ok && head.stdout.trim() ? head.stdout.trim() : null;
      }
    } catch { resetTarget = null; }
    let linkedWorktree = false;
    try { linkedWorktree = lstatSync(nodeJoin(gitRoot, ".git")).isFile(); } catch { linkedWorktree = false; }
    let sharedWith = 0;
    try {
      sharedWith = (db.prepare("SELECT COUNT(*) AS n FROM cards WHERE id != ? AND status != 'archived' AND project_id = ?").get(card.id, card.project_id) as { n: number } | undefined)?.n ?? 0;
    } catch { /* advisory */ }
    return { ...blank, checkoutPath: gitRoot, isGit: true, branch, hasUpstream: upstreamR.ok && Boolean(upstreamR.stdout.trim()), upstreamRef: upstreamR.ok && upstreamR.stdout.trim() ? upstreamR.stdout.trim() : null, changed, untracked, unpushedCommits, stashCount, resetTarget, linkedWorktree, sharedWith };
  }
  async function recoveryGitEvidence(path: string): Promise<RecoveryGitEvidence> {
    const root = await runGitIn(path, ["rev-parse", "--show-toplevel"]);
    if (!root.ok || !root.stdout.trim()) return { isGit: false, gitRoot: null, branch: null, headSha: null, changedFiles: 0 };
    const [branch, head, status] = await Promise.all([runGitIn(path, ["branch", "--show-current"]), runGitIn(path, ["rev-parse", "HEAD"]), runGitIn(path, ["status", "--porcelain=v1", "--untracked-files=all"])]);
    return { isGit: true, gitRoot: root.stdout.trim(), branch: branch.ok ? branch.stdout.trim() || null : null, headSha: head.ok ? head.stdout.trim() || null : null, changedFiles: status.ok ? status.stdout.split("\n").filter(Boolean).length : 0 };
  }

  // Stelow's own machinery never makes a plan stale: filter it from the
  // touched-paths a staleness notice names.
  const STALENESS_NOISE_PREFIXES = ["skills/", "data/", ".stelow/", "stelow.json"];
  // Files a checkout gained since an ask-time HEAD: what the human needs to
  // judge whether a waiting question's plan still matches the code.
  // Fail-soft — staleness is advisory, and an unreadable history must never
  // break cardDetail.
  async function gitTouchedSince(gitRoot: string, fromHead: string): Promise<{ commitCount: number; paths: string[] }> {
    const empty = { commitCount: 0, paths: [] as string[] };
    try {
      const [count, log] = await Promise.all([
        runGitIn(gitRoot, ["rev-list", "--count", `${fromHead}..HEAD`]),
        runGitIn(gitRoot, ["log", "--name-only", "--pretty=format:", `${fromHead}..HEAD`, "--"], 4 * 1024 * 1024),
      ]);
      if (!count.ok || !log.ok) return empty;
      const seen = new Set<string>();
      for (const line of log.stdout.split("\n")) {
        const path = line.trim();
        if (!path || seen.has(path) || STALENESS_NOISE_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))) continue;
        seen.add(path);
      }
      return { commitCount: Number(count.stdout.trim()) || 0, paths: [...seen].slice(0, 6) };
    } catch { return empty; }
  }

  async function sha256OfHostFile(path: string): Promise<string | null> {
    try {
      const file = await bb.sdk.files.read({ path }).catch(() => null) as { content?: unknown } | null;
      if (!file || typeof file.content !== "string") return null;
      return createHash("sha256").update(file.content, "utf8").digest("hex");
    } catch { return null; }
  }

  // Ask-time evidence baseline for staleness notices. Advisory and fail-soft:
  // a question must never fail because its baseline could not be recorded.
  // Keyed by (card, artifact path), latest wins — re-asking about a revised
  // document re-baselines it.
  async function snapshotQuestionEvidence(cardId: string, optionArtifacts: Array<{ artifact: { path: string } | null }>): Promise<void> {
    try {
      const card = getCard(cardId);
      if (!card) return;
      const resolved = await resolveAskOptions(card, optionArtifacts.map((entry) => ({ label: "", description: "", preview: null as string | null, artifact: entry.artifact })));
      const seen = new Set<string>();
      const workspace = await cardWorkspace(card).catch(() => null);
      const git = workspace?.path ? await recoveryGitEvidence(workspace.path).catch(() => null) : null;
      const askedAt = now();
      for (const option of resolved) {
        const absolute = option.artifact?.absolutePath;
        if (!absolute || seen.has(absolute)) continue;
        seen.add(absolute);
        const sha = await sha256OfHostFile(absolute);
        if (!sha) continue;
        db.prepare("INSERT OR REPLACE INTO question_evidence (card_id, artifact_path, artifact_sha256, git_root, head_sha, asked_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(cardId, absolute, sha, git?.gitRoot ?? null, git?.headSha ?? null, askedAt);
      }
    } catch { /* advisory only */ }
  }

  function testCommandForCheckout(path: string) {
    try {
      const entries = readdirSync(path);
      const packageJson = entries.includes("package.json") ? JSON.parse(readFileSync(nodeJoin(path, "package.json"), "utf8")) : null;
      return detectedTestCommand(entries, packageJson);
    } catch { return null; }
  }

  async function runHostTests(path: string, command: { command: string; args: string[]; display: string }) {
    return new Promise<{ exitCode: number; output: string }>((done) => {
      execFile(command.command, command.args, { cwd: path, timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : error ? 1 : 0;
        const output = `${typeof stdout === "string" ? stdout : ""}${typeof stderr === "string" ? `\n${stderr}` : ""}`.trim();
        done({ exitCode: code, output });
      });
    });
  }

  // Stelow seeds every workspace with `skills/`, `data/`, `.stelow/`, and
  // `stelow.json`. Treating that scaffolding as source made every exploratory
  // card look promotable, which hid the worker-reported-checkout path. The
  // rule (and its test) lives in lib/workspace-recovery.
  function exploratoryHasSource(path: string | null): boolean {
    if (!path) return false;
    try {
      return hasWorkspaceSource(readdirSync(path, { withFileTypes: true }).map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() })));
    } catch { return false; }
  }

  type RecoveryCandidate = { projectId: string; projectName: string; path: string; branch: string | null; headSha: string | null; changedFiles: number; evidence: string; gitRoot: string | null };
  async function recoverySnapshot(card: CardRow) {
    const attached = db.prepare("SELECT project_id, project_name, source_path, attached_at FROM workspace_recoveries WHERE card_id = ?").get(card.id) as { project_id: string; project_name: string; source_path: string; attached_at: number } | undefined;
    const audit = db.prepare("SELECT ra.audit_card_id, ra.created_at, COALESCE(c.display_name, c.name) AS card_name FROM recovery_audits ra JOIN cards c ON c.id = ra.audit_card_id WHERE ra.source_card_id = ?").get(card.id) as { audit_card_id: string; created_at: number; card_name: string } | undefined;
    const workspacePath = card.workspace_path;
    const workspace = workspacePath ? await recoveryGitEvidence(workspacePath) : { isGit: false, gitRoot: null, branch: null, headSha: null, changedFiles: 0 };
    // `last_assistant_text` may be blank on older cards after an idle sync.
    // The thread output is the durable fallback, read only for this explicit
    // recovery check (never searched across unrelated threads).
    const threadOutput = card.worker_thread_id
      ? await bb.sdk.threads.output({ threadId: card.worker_thread_id }).then((result) => result.output ?? "").catch(() => "")
      : "";
    const paths = reportedCheckoutPaths(card.last_assistant_text ?? "", threadOutput);
    const looseEvidence = reportedRecoveryEvidence(card.last_assistant_text ?? "", threadOutput)
      .filter((entry) => existsSync(entry.path) && !paths.includes(entry.path));
    const projects = await bb.sdk.projects.list().catch(() => []);
    const candidates: RecoveryCandidate[] = [];
    for (const project of projects) for (const source of project.sources ?? []) {
      if (!source.path || !paths.includes(source.path)) continue;
      if (card.workspace_host_id && source.hostId && source.hostId !== card.workspace_host_id) continue;
      const evidence = await recoveryGitEvidence(source.path);
      if (!evidence.isGit || evidence.changedFiles === 0) continue;
      candidates.push({ projectId: project.id, projectName: project.name, path: source.path, branch: evidence.branch, headSha: evidence.headSha, changedFiles: evidence.changedFiles, evidence: "Worker explicitly reported this registered checkout.", gitRoot: evidence.gitRoot });
    }
    const hasSource = exploratoryHasSource(workspacePath);
    const kind = recoveryDisposition({ workspaceIsGit: workspace.isGit, hasWorkspaceSource: hasSource, candidates, attached: Boolean(attached) });
    return { kind, message: recoveryMessage(kind), workspace: { path: workspacePath, isGit: workspace.isGit, hasSource }, candidates, looseEvidence, recovery: attached ? { projectId: attached.project_id, projectName: attached.project_name, path: attached.source_path, attachedAt: attached.attached_at } : null, audit: audit ? { cardId: audit.audit_card_id, cardName: audit.card_name, createdAt: audit.created_at } : null };
  }

  async function recoveredCheckoutIntegrity(card: CardRow, path: string): Promise<string | null> {
    if (card.workspace_kind !== "exploratory") return null;
    const recorded = db.prepare("SELECT git_root FROM workspace_recoveries WHERE card_id = ?").get(card.id) as { git_root: string | null } | undefined;
    if (!recorded?.git_root) return null;
    const live = await recoveryGitEvidence(path);
    return !live.isGit || live.gitRoot !== recorded.git_root
      ? "The attached recovery checkout no longer resolves to the Git root you reviewed. Re-check recovery evidence before viewing or acting on this diff."
      : null;
  }

  // --- Preview: one dev server per checkout. --------------------------------
  //
  // The lifecycle — which checkout owns a server, when it is ready, what to
  // clean up — lives in lib/preview-runtime with a node test, per AGENTS.md
  // (`lib/` owns state logic; never inline-only in server.ts handlers). What
  // stays here is only what the host must provide: reading files, listing a
  // directory, spawning the process, and asking Connect.

  function runCommand(command: string, args: string[], options: { cwd?: string } = {}): Promise<{ code: number | null; out: string }> {
    return new Promise((resolveRun) => {
      execFile(command, args, { cwd: options.cwd, env: { ...(process.env as Record<string, string>) }, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : error ? 1 : 0;
        resolveRun({ code, out: `${stdout ?? ""}${stderr ?? ""}` });
      });
    });
  }

  /**
   * `bb connect <args> --json`, parsed. Connect is the sanctioned surface for
   * exposing a port (`share-server-links`), so this is the whole client: null
   * means unpaired, unsupported, or unparseable, and every caller falls back to
   * the next rung rather than guessing at a shape it does not recognize.
   */
  async function runConnect(args: string[]): Promise<Record<string, unknown> | null> {
    const result = await runCommand(resolveLocalBin("bb"), ["connect", ...args, "--json"]).catch(() => null);
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
    readFile: (path) => bb.sdk.files.read({ path }).then((file) => file.content).catch(() => null),
    listDirs: (dir) => {
      try {
        return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      } catch {
        return [];
      }
    },
    joinPath: nodeJoin,
    spawnProcess: (command, options) => spawn("bash", ["-lc", command], { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] }),
    runConnect,
    now,
    baseEnv: process.env as Record<string, string>,
  });

  // A reload or disable must not leave a dev server running behind the user's
  // back: the processes are ours, so shutting them down is ours too.
  bb.onDispose(() => preview.dispose());

  type PreviewEnvironment = { id?: string | null; path?: string | null; hostId?: string | null; isWorktree?: boolean; workspaceProvisionType?: string | null; branchName?: string | null } | null;

  /** The environment backing the card's worker thread, while it still exists. */
  async function workerEnvironmentOf(card: CardRow): Promise<PreviewEnvironment> {
    if (!card.worker_thread_id) return null;
    try {
      const thread = await bb.sdk.threads.get({ threadId: card.worker_thread_id });
      const environmentId = (thread as { environmentId?: unknown }).environmentId;
      if (typeof environmentId !== "string" || !environmentId) return null;
      const environment = await bb.sdk.environments.get({ environmentId });
      return environment?.status === "ready" && environment.path ? environment : null;
    } catch {
      return null;
    }
  }

  /** Later stage workers stay in the checkout the card originally used. */
  async function continuingWorkerEnvironment(card: CardRow, fallback: ThreadEnvironment): Promise<ThreadEnvironment> {
    const environment = await workerEnvironmentOf(card);
    return environment?.id ? { type: "reuse", environmentId: environment.id } : fallback;
  }

  type CardCheckout = { path: string; hostId: string | null; environmentId: string | null; environment: PreviewEnvironment; source: string };

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
      const recovery = db.prepare("SELECT source_path FROM workspace_recoveries WHERE card_id = ?").get(card.id) as { source_path: string } | undefined;
      if (recovery?.source_path) return { path: recovery.source_path, hostId: card.workspace_host_id, environmentId: null, environment: null, source: "Recovered project checkout" };
    }
    const environment = await workerEnvironmentOf(card);
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
      ? { path: workspace.path, hostId: workspace.hostId, environmentId: null, environment: null, source: "Project source" }
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
      const dir = await workflowStateDir(bb, rootPath, card.id, card.dir_hash).catch(() => null);
      const blob = dir ? await bb.sdk.files.read({ path: join(dir, "state.md") }).then((file) => file.content).catch(() => null) : null;
      const stage = blob ? text(blob.match(/current_stage:\s*(\S+)/m)?.[1]) : "";
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
  async function askContractChecklist(cardId: string): Promise<Array<{ id: string; kind: string }> | null> {
    try {
      const card = getCard(cardId);
      if (!card) return null;
      const workspace = await cardWorkspace(card);
      if (!workspace?.path) return null;
      const stateDir = card.dir_hash ? await workflowStateDir(bb, workspace.path, card.id, card.dir_hash) : null;
      if (!stateDir) return null;
      const stateFile = await bb.sdk.files.read({ path: join(stateDir, "state.md") }).catch(() => null);
      const state = typeof stateFile?.content === "string" ? stateFile.content : null;
      if (!state) return null;
      const { appetite, reviewMode, reviewGates } = parseWorkflowConfig(state, { strict: true });
      if (!appetite || (!reviewMode && !reviewGates)) return null;
      const stage = text(state.match(/^current_stage:\s*(\S+)/m)?.[1]);
      if (!stage) return null;
      return requiredForStage({ stage, appetite, reviewMode: reviewGates ?? reviewMode ?? [] });
    } catch {
      return null;
    }
  }

  async function questionContractsGate(card: CardRow, stateDir: string | null): Promise<string | null> {    if (!stateDir) return null;
    const stateFile = await bb.sdk.files.read({ path: join(stateDir, "state.md") }).catch(() => null);
    const state = typeof stateFile?.content === "string" ? stateFile.content : null;
    if (!state) return null; // unreadable state fails open
    const stage = text(state.match(/^current_stage:\s*(\S+)/m)?.[1]);
    // Strict parse: missing keys yield nulls (never assumed defaults) — a
    // guard must not enforce against a mode the file never declared.
    // Gate-aware: an explicit set enforces directly, a ladder string
    // resolves through the compat map.
    const { appetite, reviewMode, reviewGates } = parseWorkflowConfig(state, { strict: true });
    if (!stage || !appetite || (!reviewMode && !reviewGates)) return null; // config is not trustworthy
    // A corrupt or unreadable contract source must never deadlock every
    // advance: fail open here, the pin test guards the source itself.
    let required;
    try {
      required = requiredForStage({ stage, appetite, reviewMode: reviewGates ?? reviewMode ?? [] }).filter((entry) => entry.kind !== "skip");
    } catch {
      return null;
    }
    if (required.length === 0) return null;
    const enteredAt = stageEnteredAt(state);
    if (!enteredAt) return null; // legacy history has no entry boundary
    const paths = await bb.sdk.files.listPaths({ path: stateDir, includeFiles: true, includeDirectories: false, limit: 500 }).catch(() => null);
    if (!paths) return null;
    const allPaths = array(record(paths).paths).map((entry) => typeof entry === "string" ? entry : text(record(entry).path)).filter(Boolean);
    const receipts = await Promise.all(allPaths.map(async (receiptPath) => {
      const receipt = await bb.sdk.files.read({ path: receiptPath }).catch(() => null);
      return {
        path: receiptPath.startsWith(`${stateDir}/`) ? receiptPath.slice(stateDir.length + 1) : receiptPath,
        content: typeof receipt?.content === "string" ? receipt.content : "",
        modifiedAtMs: typeof receipt?.modifiedAtMs === "number" && Number.isFinite(receipt.modifiedAtMs) ? receipt.modifiedAtMs : null,
      };
    }));
    // Synchronize the durable inbox before asking it for evidence. A provider
    // read failure remains fail-open inside the collector rather than becoming
    // proof that no answer exists.
    const synced = await syncOpenQuestionInbox(card);
    if (synced === null) return null;
    const answered = Boolean(db.prepare("SELECT 1 FROM inbox_events WHERE card_id = ? AND kind = 'question' AND resolved_reason = 'answered' AND resolved_at >= ? LIMIT 1").get(card.id, enteredAt));
    return checkAdvanceContracts({ stage, enteredAt, contracts: required, receipts, answered });
  }

  /**
   * Where a preview runs. The worker's own checkout wins, because that is the
   * directory the agent actually wrote to — a `new-worktree` preset runs in a
   * bb-managed worktree, not in the project source. The project source is the
   * fallback once that environment is gone, and the label travels with the
   * target so the panel always names the codebase the user is looking at.
   */
  async function previewTarget(card: CardRow) {
    const checkout = await cardCheckout(card);
    return checkout
      ? { checkout: checkout.path, hostId: checkout.hostId, slug: card.name, source: checkout.source }
      : null;
  }

  type PublicationSnapshot = z.infer<typeof publicationSnapshotSchema>;
  type PublicationAction = "commit" | "squash_merge" | "push_terminal" | "pull_request_ready" | "pull_request_draft" | "pull_request_merge";

  function unavailablePublication(message: string, events: PublicationSnapshot["events"] = []): PublicationSnapshot {
    const blocked = { available: false, reason: message };
    return {
      available: false, message, source: null, environmentId: null, isWorktree: false,
      branch: null, workingTree: null, mergeBase: null, pullRequest: null, pullRequestMessage: null,
      capabilities: { commit: blocked, squashMerge: blocked, markReady: blocked, markDraft: blocked, mergePullRequest: blocked }, events,
    };
  }

  function publicationEvents(cardId: string): PublicationSnapshot["events"] {
    return (db.prepare("SELECT id, action, message, commit_sha, pull_request_url, created_at FROM publication_events WHERE card_id = ? ORDER BY created_at DESC LIMIT 12").all(cardId) as Array<{ id: string; action: string; message: string; commit_sha: string | null; pull_request_url: string | null; created_at: number }>).map((event) => ({
      id: event.id, action: event.action, message: event.message, commitSha: event.commit_sha, pullRequestUrl: event.pull_request_url, createdAt: event.created_at,
    }));
  }

  function recordPublication(cardId: string, action: PublicationAction, message: string, commitSha: string | null = null, pullRequestUrl: string | null = null): void {
    db.prepare("INSERT INTO publication_events (id, card_id, action, message, commit_sha, pull_request_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(randomId("pub"), cardId, action, message, commitSha, pullRequestUrl, now());
  }

  async function publicationSnapshot(card: CardRow): Promise<PublicationSnapshot> {
    const events = publicationEvents(card.id);
    if (normalizeStatus(card.status) !== "completed") return unavailablePublication("Only completed cards can publish changes.", events);
    const checkout = await cardCheckout(card).catch(() => null);
    if (!checkout?.environmentId || !checkout.environment) return unavailablePublication("Publishing is available only while this card has a live BB workspace environment.", events);
    const [status, pullRequest] = await Promise.all([
      bb.sdk.environments.status({ environmentId: checkout.environmentId }).catch(() => null),
      bb.sdk.environments.pullRequest({ environmentId: checkout.environmentId }).catch(() => ({ outcome: "unavailable", message: "BB could not read pull-request status." })),
    ]);
    if (!status || status.outcome !== "available") return unavailablePublication(status?.outcome === "not_applicable" ? status.message : status?.failure?.message ?? "BB could not inspect this workspace.", events);
    const blocker = publicationBlocker(status);
    const commit = canCommitPublication(status);
    const squashMerge = canSquashMerge(status);
    const pr = pullRequest.outcome === "available" && "pullRequest" in pullRequest ? pullRequest.pullRequest : null;
    const capability = ({ ok, reason }: { ok: boolean; reason: string | null }) => ({ available: ok, reason });
    const markReady = capability(canMarkPullRequestReady(status, pullRequest));
    const markDraft = capability(canMarkPullRequestDraft(status, pullRequest));
    const merge = capability(canMergePullRequest(status, pullRequest));
    return {
      available: blocker === null,
      message: blocker,
      source: checkout.source,
      environmentId: checkout.environmentId,
      isWorktree: Boolean(checkout.environment.isWorktree),
      branch: { current: status.workspace.branch.currentBranch, default: status.workspace.branch.defaultBranch, headSha: status.workspace.checkout.kind === "branch" || status.workspace.checkout.kind === "detached" ? status.workspace.checkout.headSha : null },
      workingTree: { state: status.workspace.workingTree.state, hasUncommittedChanges: status.workspace.workingTree.hasUncommittedChanges, files: status.workspace.workingTree.files.length },
      mergeBase: status.workspace.mergeBase ? { branch: status.workspace.mergeBase.mergeBaseBranch, ahead: status.workspace.mergeBase.aheadCount, behind: status.workspace.mergeBase.behindCount, hasCommittedUnmergedChanges: status.workspace.mergeBase.hasCommittedUnmergedChanges } : null,
      pullRequest: pr ? { number: pr.number, title: pr.title, url: pr.url, state: pr.state, attention: pr.attention, review: pr.review.state, checks: pr.checks.state, mergeability: pr.mergeability.state } : null,
      pullRequestMessage: pullRequest.outcome === "unavailable" && "message" in pullRequest ? pullRequest.message : null,
      capabilities: {
        commit: capability(commit),
        squashMerge: capability(squashMerge),
        markReady,
        markDraft,
        mergePullRequest: merge,
      },
      events,
    };
  }

  async function publicationEnvironment(cardId: string): Promise<{ card: CardRow; environmentId: string; snapshot: PublicationSnapshot } | { error: string }> {
    const card = getCard(cardId);
    if (!card) return { error: ERR_CARD_NOT_FOUND };
    const snapshot = await publicationSnapshot(card);
    if (!snapshot.environmentId) return { error: snapshot.message ?? "Publishing is unavailable." };
    return { card, environmentId: snapshot.environmentId, snapshot };
  }

  type PushShellSession = { id: string; title: string; status: string; exitCode: number | null; createdAt: number };

  async function pushShellSessions(environmentId: string): Promise<PushShellSession[]> {
    const listed = await bb.sdk.terminals.list({ scope: { kind: "environment", environmentId } }).catch(() => null);
    const sessions = (listed as { sessions?: PushShellSession[] } | null)?.sessions ?? [];
    return sessions
      .filter((session) => session.title.startsWith("Stelow push"))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);
  }

  async function livePushShell(environmentId: string): Promise<PushShellSession | null> {
    const previous = await pushShellSessions(environmentId);
    for (const session of previous) {
      const read = await readPushShell(session);
      if (!read.unavailable && read.pushState === "running") return session;
    }
    return null;
  }

  async function retirePushShells(environmentId: string): Promise<void> {
    const previous = await pushShellSessions(environmentId);
    for (const session of previous) {
      await bb.sdk.terminals.close({ terminalId: session.id, mode: "if-clean" }).catch(() => null);
    }
    for (const session of previous) {
      const read = await readPushShell(session);
      // Force only shells that finished (marker), never ran (waiting),
      // or already ended — never a live run (blocked before this point).
      if (read.unavailable || read.pushState !== "running") {
        await bb.sdk.terminals.close({ terminalId: session.id, mode: "force" }).catch(() => null);
      }
    }
  }

  async function readPushShell(session: PushShellSession): Promise<{ text: string | null; unavailable: boolean; pushState: "waiting" | "running" | "succeeded" | "failed"; pushExit: number | null }> {
    try {
      const out = await bb.sdk.terminals.output({ terminalId: session.id, tailBytes: 8000 });
        const text = (out.chunks ?? [])
          .map((chunk) => Buffer.from(chunk.dataBase64, "base64").toString("utf8"))
          .join("")
          // Collapse carriage-return progress the way a real terminal renders
          // it: git rewrites one line via \r, so only the final segment is
          // visible. Drops hundreds of intermediate percentages, keeps errors.
          // eslint-disable-next-line no-control-regex
          .replace(/[^\n]*\r(?!\n)/g, "")
          // Strip ANSI escapes so the panel shows readable output.
          // eslint-disable-next-line no-control-regex
          .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
          // eslint-disable-next-line no-control-regex
          .replace(/\u001b\][^\u0007]*\u0007/g, "")
          .slice(-4000);
      // The exit marker names the outcome. Legacy shells (typed but
      // never submitted) carry no marker and end with the bare command.
      const marker = text.match(/STELOW_PUSH_EXIT:(\d+)/);
      const parsed = marker ? Number.parseInt(marker[1] ?? "", 10) : null;
      const pushExit = parsed !== null && Number.isNaN(parsed) ? null : parsed;
      const pushState = marker
        ? (pushExit === 0 ? "succeeded" as const : "failed" as const)
        : /git push\s*$/.test(text) ? "waiting" as const : "running" as const;
      return { text: text || null, unavailable: false, pushState, pushExit };
    } catch {
      // output() 409s once the shell exits: an ended shell is never
      // "running" — the panel renders it as Ended via outputUnavailable.
      return { text: null, unavailable: true, pushState: "failed" as const, pushExit: null };
    }
  }

  /**
   * The target for a card, or the one message that explains why there is none.
   * Resolving where the code lives is host work (a worker's environment, or the
   * project source), so it stays here; what to DO with that checkout is the
   * runtime's job.
   */
  async function previewTargetFor(cardId: string) {
    const card = getCard(cardId);
    if (!card) throw new Error(ERR_CARD_NOT_FOUND);
    return await previewTarget(card);
  }

  const NO_PREVIEW_WORKSPACE = "Workspace path is unavailable.";

  /** The view the panel and the CLI both render. */
  async function previewView(cardId: string, appOrigin: string | null = null) {
    const target = await previewTargetFor(cardId);
    if (!target) return previewShape({ error: NO_PREVIEW_WORKSPACE });
    return await preview.view(target, appOrigin);
  }

  async function previewStart(cardId: string) {
    const target = await previewTargetFor(cardId);
    if (!target) return { ok: false, error: NO_PREVIEW_WORKSPACE };
    return await preview.start(target);
  }

  async function previewStop(cardId: string) {
    const target = await previewTargetFor(cardId);
    if (!target) return { ok: false, error: NO_PREVIEW_WORKSPACE };
    return await preview.stop(target);
  }

  async function previewShare(cardId: string) {
    const target = await previewTargetFor(cardId);
    if (!target) return { ok: false, error: NO_PREVIEW_WORKSPACE };
    return await preview.share(target);
  }

  // Resolve a host binary: server-wide install at ~/.local/bin first
  // (non-interactive PATH lacks it), PATH fallback otherwise.
  const homeDir = typeof process.env.HOME === "string" ? process.env.HOME : "";
  const localBinDir = homeDir ? nodeJoin(homeDir, ".local", "bin") : "";
  function resolveLocalBin(name: string): string {
    const absolute = localBinDir ? nodeJoin(localBinDir, name) : "";
    return absolute && existsSync(absolute) ? absolute : name;
  }

  // Resolve the research index file for a card: always the card's own state
  // dir (never the project root, so many research cards can share one
  // project without colliding). Every refusal names its exit.
  // Round files for a research card, newest first. History entries carry
  // their exact file path (computed at spawn), so listing reads known
  // paths instead of guessing: ready when the file has content, pending
  // while the round's worker is alive, missing otherwise. Manifest
  // sub-step files join the round sharing their stamp; unregistered .md
  // files declared in the typed manifest join their recorded round. Never
  // surface arbitrary files from the state directory as user-facing results.
  // Fail-soft throughout.
  async function researchRoundFiles(workspacePath: string | null, hostId: string | null, stateDir: string | null, history: Array<{ id: string; at: string; file: string }>, live: boolean) {
    type RoundFile = { display: string; path: string; absolutePath: string; hostId: string; generatedAt: string };
    type Round = { n: number; strategyId: string; label: string; emoji: string; at: string; status: "ready" | "pending" | "missing"; missing: string[]; substeps: Array<{ slug: string; status: "ready" | "missing" | "invalid" | "needs-depth" }>; files: RoundFile[] };
    const rounds: Round[] = history.map((entry, index) => {
      const meta = researchStrategyById(entry.id);
      return { n: index + 1, strategyId: entry.id, label: meta?.label ?? entry.id, emoji: meta?.emoji ?? "", at: entry.at, status: "missing" as const, missing: [], substeps: [], files: [] };
    });
    const substepContents = new Map<number, Array<{ slug: string; content: string | null }>>();
    if (workspacePath && stateDir) {
      try {
        const stateBlob = await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((f) => f.content).catch(() => null);
        const manifest = stateBlob ? parseArtifactManifest(stateBlob).filter((fields) => fields.stage === "research" && typeof fields.path === "string") : [];
        // Sub-step extras join the round sharing strategy + stamp.
        // Contents ride along for per-substep quality (same predicates the
        // verify gate enforces, so card and gate never disagree).
        for (const round of rounds) {
          const stamp = parseRoundPath(history[round.n - 1].file, round.strategyId)?.stamp;
          if (!stamp || !hostId) continue;
          for (const fields of manifest) {
            if (!fields.path || fields.path === history[round.n - 1].file) continue;
            const parsed = parseRoundPath(fields.path, round.strategyId);
            if (!parsed || parsed.roundNo !== round.n || parsed.stamp !== stamp) continue;
            const full = resolveArtifactPath(workspacePath, fields.path);
            if (!full) continue;
            const artifact = await bb.sdk.files.read({ path: full }).catch(() => null);
            if (!artifact || !isPublishableArtifactContent(artifact.content)) continue;
            round.files.push({ display: fields.label ?? full.split("/").pop()!, path: fields.path, absolutePath: full, hostId, generatedAt: fileTimestamp(artifact, round.at) });
            if (parsed.subskill && typeof artifact.content === "string") {
              const list = substepContents.get(round.n) ?? [];
              list.push({ slug: parsed.subskill, content: artifact.content });
              substepContents.set(round.n, list);
            }
          }
          round.files.sort((a, b) => (a.display < b.display ? -1 : 1));
        }
      } catch { /* fail-soft: history-only rounds, no extras or orphans */ }
    }
    // Primary contents decide ready vs pending/missing (sequential reads over
    // a handful of small files; rounds are few by construction).
    // Validity is isValidRoundContent (lib/research-artifacts): non-empty,
    // substantive, and never a mirror of research-index.md. A round that
    // fails it renders as missing instead of surfacing the wrong artifact
    // as if it were the round's output.
    const indexBlob = rounds.length > 0 && stateDir ? await bb.sdk.files.read({ path: join(stateDir, "research-index.md") }).then((f) => (typeof f.content === "string" ? f.content : null)).catch(() => null) : null;
    for (const round of rounds) {
      const present = round.files
        .map((file) => parseRoundPath(file.path, round.strategyId)?.subskill)
        .filter((slug): slug is string => typeof slug === "string");
      round.missing = missingSubsteps(round.strategyId, present);
      round.substeps = substepQuality(
        expectedSubsteps(round.strategyId),
        substepContents.get(round.n) ?? [],
        indexBlob,
        (slug, content) => validateSubstep(slug, content).failures.map((failure) => failure.detail),
      );
      const full = workspacePath ? resolveArtifactPath(workspacePath, history[round.n - 1].file) : null;
      const primaryLabel = `Round ${round.n} — ${round.label}`;
      if (full && hostId) {
        const artifact = await bb.sdk.files.read({ path: full }).catch(() => null);
        const content = artifact?.content ?? null;
        if (isValidRoundContent(content, indexBlob)) {
          round.status = "ready";
          round.files.unshift({ display: primaryLabel, path: history[round.n - 1].file, absolutePath: full, hostId, generatedAt: fileTimestamp(artifact, round.at) });
        } else {
          round.status = round.n === rounds.length && live ? "pending" : "missing";
          // Pending work has no artifact affordance until it has real text.
          // A thin draft may still be useful to inspect, but an empty file or
          // an index mirror must never render as a reviewable document.
          if (round.status === "pending" && isPublishableArtifactContent(content) && !researchRoundMirrorsIndex(content, indexBlob)) round.files.unshift({ display: primaryLabel, path: history[round.n - 1].file, absolutePath: full, hostId, generatedAt: fileTimestamp(artifact, round.at) });
        }
      } else {
        round.status = round.n === rounds.length && live ? "pending" : "missing";
      }
    }
    return { rounds: rounds.reverse() };
  }

  // Deterministic artifact guarantee (enforced in code, not in prompt):
  // readiness requires a reviewable index AND every round's native file
  // valid AND every registered composite substep valid
  // (lib/research-artifacts + lib/research-rounds). A complete index with a
  // missing/mirrored/thin round or substep is NOT done — the card stays open
  // and each invalid item surfaces as an inbox error naming what to re-run.
  // The worker prompt states this contract; this function is what makes it true.
  async function researchRoundIntegrity(card: CardRow): Promise<Array<{ n: number; label: string; slug?: string; reason?: string; detail?: string }>> {
    const workspace = await cardWorkspace(card);
    if (!workspace?.path || !card.dir_hash) return [];
    const stateDir = await workflowStateDir(bb, workspace.path, card.id, card.dir_hash).catch(() => null);
    if (!stateDir) return [];
    const history = strategyRounds(card);
    if (history.length === 0) return [];
    const indexBlob = await bb.sdk.files.read({ path: join(stateDir, "research-index.md") }).then((f) => (typeof f.content === "string" ? f.content : null)).catch(() => null);
    const contents = new Map<string, string | null>();
    const readAndCache = async (relPath: string): Promise<string | null> => {
      if (contents.has(relPath)) return contents.get(relPath) ?? null;
      const full = resolveArtifactPath(workspace.path, relPath);
      const content = full ? await bb.sdk.files.read({ path: full }).then((f) => f.content).catch(() => null) : null;
      contents.set(relPath, content);
      return content;
    };
    for (const entry of history) {
      await readAndCache(entry.file);
    }
    const invalid = findInvalidRounds(
      history,
      (path) => contents.get(path) ?? null,
      indexBlob,
      (id) => researchStrategyById(id)?.label ?? null,
      (strategyId, content) => validateVariant(content, contractForStrategy(strategyId)).failures.map((failure) => failure.detail),
    );
    // Composite substeps join history primaries with state.md manifest paths
    // (same strategy + round + stamp). Unregistered substep files stay
    // visible via the card's unregistered-artifact path; only registered
    // substeps gate completion, so the manifest remains the source of truth.
    const stateBlob = await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((f) => f.content).catch(() => null);
    const manifestPaths = stateBlob
      ? parseArtifactManifest(stateBlob).filter((fields) => fields.stage === "research" && typeof fields.path === "string").map((fields) => fields.path as string)
      : [];
    const substeps: Array<{ n: number; label: string; slug: string; path: string }> = [];
    history.forEach((entry, index) => {
      const n = index + 1;
      const label = researchStrategyById(entry.id)?.label ?? entry.id;
      for (const subPath of substepPathsForRound(manifestPaths, entry.id, entry.file)) {
        const slug = parseRoundPath(subPath, entry.id)?.subskill ?? subPath.split("/").pop() ?? subPath;
        substeps.push({ n, label, slug, path: subPath });
      }
    });
    for (const sub of substeps) {
      await readAndCache(sub.path);
    }
    invalid.push(...findInvalidSubsteps(
      substeps,
      (path) => contents.get(path) ?? null,
      indexBlob,
      (slug, content) => validateSubstep(slug, content).failures.map((failure) => failure.detail),
    ));
    return invalid;
  }

  // Create only the destination directory. Artifact files themselves are
  // published by workers with content, never reserved as blank placeholders.
  async function ensureArtifactParent(workspacePath: string, relPath: string): Promise<void> {
    try {
      const full = resolveArtifactPath(workspacePath, relPath);
      if (!full) return;
      await bb.sdk.files.mkdir({ path: dirname(full), rootPath: workspacePath, recursive: true });
    } catch { /* workers can still create parents with their native writer */ }
  }

  // Recognized Build documents registered in state.md, validated against
  // their stage contracts (unknown files, audit.md, and receipts never
  // match). Shared by done (blocking) and verify --tests (warnings).
  async function buildDocDepthsForCard(card: CardRow): Promise<Array<{ path: string; label: string; failures: string[] }>> {
    const workspace = await cardWorkspace(card).catch(() => null);
    if (!workspace?.path || !card.dir_hash) return [];
    const stateDir = await workflowStateDir(bb, workspace.path, card.id, card.dir_hash).catch(() => null);
    if (!stateDir) return [];
    const stateBlob = await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((f) => f.content).catch(() => null);
    if (!stateBlob) return [];
    const contents = new Map<string, string | null>();
    for (const fields of parseArtifactManifest(stateBlob)) {
      if (typeof fields.path !== "string" || !fields.path.endsWith(".md")) continue;
      const full = resolveArtifactPath(workspace.path, fields.path);
      contents.set(fields.path, full ? await bb.sdk.files.read({ path: full }).then((f) => f.content).catch(() => null) : null);
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
    totals: { total: number; fixed: number; documented: number; escalated: number };
    escalated: Array<{ description: string }>;
    auditGapScopes: Array<{ id: string; name: string; status: string; gap: string | null }>;
  }> {
    const empty = { matched: false, failures: [] as string[], totals: { total: 0, fixed: 0, documented: 0, escalated: 0 }, escalated: [] as Array<{ description: string }>, auditGapScopes: [] as Array<{ id: string; name: string; status: string; gap: string | null }> };
    const workspace = await cardWorkspace(card).catch(() => null);
    if (!workspace?.path || !card.dir_hash) return empty;
    const stateDir = await workflowStateDir(bb, workspace.path, card.id, card.dir_hash).catch(() => null);
    if (!stateDir) return empty;
    const stateBlob = await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((f) => f.content).catch(() => null);
    if (!stateBlob) return empty;
    const failures: string[] = [];
    const totals = { total: 0, fixed: 0, documented: 0, escalated: 0 };
    const escalated: Array<{ description: string }> = [];
    let matched = false;
    for (const fields of parseArtifactManifest(stateBlob)) {
      if (typeof fields.path !== "string" || !fields.path.endsWith(".md")) continue;
      const full = resolveArtifactPath(workspace.path, fields.path);
      const content = full ? await bb.sdk.files.read({ path: full }).then((f) => f.content).catch(() => null) : null;
      if (typeof content !== "string" || !content.trim()) continue;
      if (contractForBuildArtifact(fields.path, content)?.id !== "execution-critique") continue;
      matched = true;
      for (const failure of validateGapRegistry(content)) failures.push(`FAIL ${fields.label ?? fields.path}: ${failure.detail}`);
      const summary = summarizeGaps(content);
      if (summary.found) {
        totals.total += summary.total;
        totals.fixed += summary.fixed;
        totals.documented += summary.documented;
        totals.escalated += summary.escalated;
      }
      for (const gap of escalatedGaps(content)) {
        const description = String(gap.description ?? "").trim();
        if (description && !escalated.some((entry) => entry.description === description)) escalated.push({ description });
      }
    }
    if (!matched) return empty;
    if (!matched) return empty;
    const auditGapScopes: Array<{ id: string; name: string; status: string; gap: string | null }> = [];
    try {
      for (const scope of loadCardScopes(workspace.path, card.id)) {
        const source = (scope as { source?: unknown }).source;
        if (source !== "audit-gap") continue;
        const gap = (scope as { gap?: unknown }).gap;
        auditGapScopes.push({ id: scope.id, name: scope.name, status: scope.status, gap: typeof gap === "string" ? gap : null });
      }
    } catch { /* stelow.json unreadable reads as no scopes; done names the fix */ }
    return { matched, failures, totals, escalated, auditGapScopes };
  }

  // Passing review covering this fingerprint (policy gate). Lists the
  // card's reviews/ dir newest-first; only a Status: pass file stamped
  // with the current fingerprint satisfies. Fail-soft: unreadable state
  // reads as uncovered, and done names the fix.
  async function passingReviewCovers(card: CardRow, fingerprint: string | null): Promise<boolean> {
    if (!fingerprint) return false;
    const workspace = await cardWorkspace(card).catch(() => null);
    if (!workspace?.path || !card.dir_hash) return false;
    const stateDir = await workflowStateDir(bb, workspace.path, card.id, card.dir_hash).catch(() => null);
    if (!stateDir) return false;
    try {
      const listed = await bb.sdk.files.listPaths({ path: join(stateDir, "reviews"), includeFiles: true, includeDirectories: false });
      const paths = array(record(listed).paths).map((entry) => text(record(entry).path)).filter((path) => path.endsWith(".md")).sort().reverse();
      const files: Array<{ name: string; content: string | null }> = [];
      for (const path of paths) {
        const content = await bb.sdk.files.read({ path }).then((f) => f.content).catch(() => null);
        files.push({ name: path.split("/").pop() ?? path, content });
      }
      return reviewCoversFingerprint(files, fingerprint);
    } catch {
      return false;
    }
  }

  // Workspace-relative round path inside the state dir's rounds/.
  function roundRelPath(stateDirAbs: string, workspacePath: string, base: string): string {
    return workspaceRelative(workspacePath, join(stateDirAbs, `${ROUNDS_DIR}/${base}`)) ?? `${ROUNDS_DIR}/${base}`;
  }

  async function readResearchIndex(card: CardRow): Promise<{ ok: false; error: string } | { ok: true; content: string; absolute: string; display: string }> {
    const workspace = await cardWorkspace(card);
    if (!workspace?.path) return { ok: false, error: ERR_WORKSPACE_UNAVAILABLE };
    if (!card.dir_hash) return { ok: false, error: "No workflow state for this research yet." };
    const stateDir = await workflowStateDir(bb, workspace.path, card.id, card.dir_hash).catch(() => null);
    if (!stateDir) return { ok: false, error: "No workflow state for this research yet." };
    const absolute = join(stateDir, "research-index.md");
    const content = await bb.sdk.files.read({ path: absolute }).then((file) => file.content).catch(() => null);
    if (content === null) return { ok: false, error: "Research results are still being prepared." };
    return { ok: true, content, absolute, display: workspaceRelative(workspace.path, absolute) ?? "research-index.md" };
  }

  // Research readiness in one place (convention over configuration): the
  // index ## Opportunities checkboxes the fan-out dialog already parses via
  // parseResearchIndex. The sync writer and both read-path attention flags
  // share this predicate so they cannot diverge into "paused" vs "ready"
  // again. Build keeps its own terminal convention (state.md audit stage)
  // — each track reuses its canonical artifact, never a second definition.
  async function researchReadiness(card: CardRow): Promise<{ ready: boolean; fingerprint: string | null; evidence: "verified" | "hypothesis-only"; invalid: Array<{ n: number; label: string; slug?: string; reason?: string; detail?: string }> }> {
    if (card.kind !== "research") return { ready: false, fingerprint: null, evidence: "verified", invalid: [] };
    const index = await readResearchIndex(card).catch(() => null);
    if (!index || index.ok !== true) return { ready: false, fingerprint: null, evidence: "verified", invalid: [] };
    const evidence = evidenceStatus(index.content);
    if (!isResearchReadyForReview(index.content)) return { ready: false, fingerprint: null, evidence, invalid: [] };
    // Upstream of completion, not after it: an index with invalid rounds is
    // not ready. The sync names each invalid round as an inbox error so the
    // failure is impossible to miss and the human knows what to re-run.
    const invalid = await researchRoundIntegrity(card).catch(() => []);
    if (invalid.length > 0) return { ready: false, fingerprint: null, evidence, invalid };
    return { ready: true, fingerprint: researchReadyFingerprint(index.content), evidence, invalid: [] };
  }

  // Failure cause for a dead worker with no output. thread.failed only
  // carries system/error text, so a provider-side death (e.g. a 400 on the
  // very first inference call) arrives with error=null and the card would sit
  // at Failed with a blank last_error. The latest provider/error detail names
  // the cause. Best-effort: never throws, never blocks the state write.
  async function workerFailureCause(threadId: string): Promise<string | null> {
    try {
      const events = await bb.sdk.threads.events.list({ threadId, types: ["provider/error"], order: "desc", limit: "5" });
      return failureCauseFromEvents(events ?? []);
    } catch { return null; }
  }

  // Total + split from one latest event: two readers of the same event
  // would double the thread-event calls on every detail load.
  async function workerTokenReport(threadId: string): Promise<{ total: number | null; breakdown: { input: number | null; output: number | null; cached: number | null; reasoning: number | null; total: number | null } | null }> {
    try {
      const events = await bb.sdk.threads.events.list({ threadId, types: ["thread/tokenUsage/updated"], order: "desc", limit: "1" });
      return { total: tokenUsageFromEvents(events), breakdown: tokenBreakdownFromEvents(events) };
    } catch { return { total: null, breakdown: null }; }
  }

  async function workerChildThreads(threadId: string): Promise<Array<{ threadId: string; title: string | null; status: string; providerId: string | null; tokenUsage: number | null; tokenBreakdown: { input: number | null; output: number | null; cached: number | null; reasoning: number | null; total: number | null } | null }>> {
    try {
      const list = await bb.sdk.threads.list({ parentThreadId: threadId, limit: 10 });
      const children = shapeChildThreads(list);
      if (children.length === 0) return [];
      // Per-child cost: token events live on each child thread. One latest
      // event per child, in parallel, fail-open — an unreadable child keeps
      // a null total (unknown, never zero). Runs only when children exist,
      // so the common childless detail load pays nothing extra.
      const usages = await Promise.all(children.map(async (child) => {
        try {
          const events = await bb.sdk.threads.events.list({ threadId: child.threadId, types: ["thread/tokenUsage/updated"], order: "desc", limit: "1" });
          return [child.threadId, tokenUsageFromEvents(events), tokenBreakdownFromEvents(events)] as const;
        } catch { return [child.threadId, null, null] as const; }
      }));
      const withTotals = attachChildTokenUsage(children, Object.fromEntries(usages.map(([id, total]) => [id, total])));
      return attachChildTokenBreakdown(withTotals, Object.fromEntries(usages.map(([id, , breakdown]) => [id, breakdown])));
    } catch { return []; }
  }

  // Automatic spawn retries (lib/spawn-retry). One retry in flight per
  // card: a retry spawns a whole worker, so duplicates would double burn
  // and race on state.md. The map holds cardId -> failed threadId.
  const pendingSpawnRetries = new Map<string, string>();
  const spawnRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Whether a dead worker earns an automatic respawn: start-phase only
  // (never produced output) with a transient infrastructure cause, budget
  // remaining for this thread, and no retry already in flight.
  function canAutoRetrySpawn(card: CardRow, cause: string): boolean {
    if (card.last_assistant_text != null) return false;
    if (!isRetryableSpawnError(cause)) return false;
    if (pendingSpawnRetries.get(card.id) === card.worker_thread_id) return false;
    const used = card.spawn_retry_thread === card.worker_thread_id ? (card.spawn_retry_count ?? 0) : 0;
    return used < MAX_SPAWN_RETRIES;
  }

  function scheduleSpawnRetry(cardId: string, threadId: string): boolean {
    if (pendingSpawnRetries.get(cardId) === threadId) return true;
    let attempt = 0;
    try {
      attempt = claimSpawnRetry(db, cardId, threadId, MAX_SPAWN_RETRIES);
    } catch {
      return false;
    }
    // Lost the race (or budget exhausted between check and claim): leave
    // the card to the normal error path instead of spawning uncounted.
    if (attempt < 1) return false;
    pendingSpawnRetries.set(cardId, threadId);
    const card = getCard(cardId);
    const short = truncateCause(card?.last_error) ?? "unknown error";
    updateCard(cardId, { activity: "running", last_error: `Worker failed to start (${short}) — automatic retry ${attempt}/${MAX_SPAWN_RETRIES}.` });
    const timer = setTimeout(() => {
      spawnRetryTimers.delete(cardId);
      void runSpawnRetryAttempt(cardId, threadId, attempt);
    }, spawnRetryDelayMs(attempt));
    spawnRetryTimers.set(cardId, timer);
    return true;
  }

  async function runSpawnRetryAttempt(cardId: string, threadId: string, attempt: number): Promise<void> {
    try {
      // Idempotency re-validation: abort unless the same dead worker still
      // owns a non-terminal card that never started working.
      const card = getCard(cardId);
      if (!card || card.status === "archived" || card.status === "completed" || card.status === "blocked") return;
      if (card.worker_thread_id !== threadId) return;
      if (card.last_assistant_text != null) return;
      const result = await spawnFreshWorker(cardId, "restart");
      if (result.ok) {
        // spawnFreshWorker clears the retry budget on success.
        logCardComment(cardId, "card", cardId, "agent", `Worker start recovered automatically (attempt ${attempt}/${MAX_SPAWN_RETRIES}).`);
        bb.realtime.publish("card-state", { cardId });
        return;
      }
      if (attempt < MAX_SPAWN_RETRIES && result.error && isRetryableSpawnError(result.error)) {
        pendingSpawnRetries.delete(cardId);
        scheduleSpawnRetry(cardId, threadId);
        return;
      }
      // Exhausted or non-transient: honest error — the updateCard transition
      // to error emits the single inbox event.
      updateCard(cardId, { activity: "error", last_error: `${result.error ?? "Worker failed to start."} (automatic spawn retries exhausted)` });
    } finally {
      if (pendingSpawnRetries.get(cardId) === threadId) pendingSpawnRetries.delete(cardId);
    }
  }

  // Single writer for "the worker thread died". Keeps a recorded cause (event
  // error or a previous last_error); otherwise resolves the provider detail
  // once and stores it, so the Failed pill, the detail hero, and the inbox
  // event all name the cause instead of going blank.
  async function applyWorkerFailed(cardId: string, threadId: string, eventError: string | null) {
    // A dead thread after Done is history, not a failure: never stain a
    // terminal card with an error.
    const current = getCard(cardId);
    if (current && (current.status === "completed" || current.status === "archived" || current.status === "blocked")) return;
    // A retry already in flight for this exact failure: leave its state
    // alone (the next poll would otherwise schedule a duplicate).
    if (current && pendingSpawnRetries.get(cardId) === threadId) return;
    const recorded = current?.last_error;
    const specific = typeof eventError === "string" && eventError.trim() ? eventError.trim()
      : typeof recorded === "string" && recorded.trim() ? recorded.trim()
      : await workerFailureCause(threadId);
    // Re-read after the await: a retry may have been scheduled (or the card
    // archived) while the cause resolved — never overwrite that verdict.
    const fresh = getCard(cardId);
    if (!fresh || fresh.status === "completed" || fresh.status === "archived" || fresh.status === "blocked") return;
    if (pendingSpawnRetries.get(cardId) === threadId) return;
    // Transient start-phase failure: respawn automatically (bounded) instead
    // of paging the human. The inbox stays quiet until retries exhaust. A
    // declined schedule falls through to the honest error below.
    if (specific && canAutoRetrySpawn(fresh, specific) && scheduleSpawnRetry(cardId, threadId)) return;
    if (specific) updateCard(cardId, { activity: "error", last_error: specific });
    else updateCard(cardId, { activity: "error" });
  }

  // Shared lightweight-track poll pieces (Research + Explore syncs both use
  // them — convention over configuration, one definition of each rule):
  // waiting is activity (never board position), and every agent output lands
  // as a card comment.
  async function markThreadRunning(card: CardRow, lastOutput: string | null): Promise<void> {
    const questionIds = await syncOpenQuestionInbox(card);
    if (questionIds === null) return;
    if (questionIds.length > 0) {
      // Waiting is activity, never board position: the card stays in its
      // column (Doing) while the question waits. See lib/card-question-state.
      updateCard(card.id, questionWaitUpdates(lastOutput));
    } else {
      const updates: Record<string, unknown> = { activity: "running" as const, last_assistant_text: lastOutput };
      if (card.status === "pending") updates.status = "in-progress";
      updateCard(card.id, updates);
    }
  }

  function noteAgentOutput(card: CardRow, lastOutput: string | null): void {
    if (lastOutput && lastOutput !== card.last_assistant_text) {
      logCardComment(card.id, "card", card.id, "agent", stripMessageDirectives(lastOutput));
    }
  }

  // Research cards have no stages: sync only worker activity and attention.
  // A freshly-spawned research worker moves To-Do (pending) to Doing
  // (in-progress) on its first active poll. A completed index moves directly
  // to Done; a later user comment reopens the card through addCardComment.
  async function syncResearchThreadState(card: CardRow): Promise<void> {
    // Terminal cards stay untouched: no failure, idle, or completion write
    // may land after Done.
    if (card.status === "completed" || card.status === "archived" || card.status === "blocked") return;
    try {
      const thread = await bb.sdk.threads.get({ threadId: card.worker_thread_id! });
      const status = thread.status as string;
      try {
        const threadBorn = (thread as { createdAt?: number }).createdAt;
        healPresetStaleness(db, card.id, threadBorn, card.preset_restart_pending);
      } catch { /* staleness stays best-effort */ }
      const lastOutput = (await bb.sdk.threads.output({ threadId: card.worker_thread_id! }).catch(() => null))?.output ?? null;
      if (status === "active" || status === "starting") {
        await markThreadRunning(card, lastOutput);
      } else if (status === "idle" || status === "stopping") {
        const questionIds = await syncOpenQuestionInbox(card);
        if (questionIds === null) return;
        if (questionIds.length > 0) {
          updateCard(card.id, questionWaitUpdates(lastOutput));
        } else {
          // Readiness already gates on artifact integrity: ready means the
          // index is reviewable AND every round file is valid. An index with
          // invalid rounds is not done — each invalid round is named as an
          // inbox error so the human knows exactly what to re-run.
          const readiness = await researchReadiness(card).catch(() => ({ ready: false as const, fingerprint: null as string | null, evidence: "verified" as const, invalid: [] as Array<{ n: number; label: string; slug?: string; reason?: string; detail?: string }> }));
          if (readiness.ready) {
            const readyIdleAt = (card.activity !== "idle" || !card.last_idle_at) ? now() : card.last_idle_at;
            updateCard(card.id, { status: "completed", activity: "idle", last_assistant_text: lastOutput, last_idle_at: readyIdleAt });
            // Quiet completions record the trail too: a Done-column card
            // without a done event is invisible to flow metrics.
            recordStageEvent(card.id, "done");
            resolveInboxEvents(card.id, now(), ["paused"], "completed");
            const readyCurrent = getCard(card.id);
            const hypothesisSuffix = readiness.evidence === "hypothesis-only" ? " Marked hypothesis-only: web research was unavailable — requires human validation." : "";
            if (readyCurrent) {
              recordInboxEvent(readyCurrent, "completed", `Research complete — results ready to review in Done.${hypothesisSuffix}`, `completed:${card.id}:index:${readiness.fingerprint ?? "ready"}`, now());
            }
          } else {
            const idleAt = (card.activity !== "idle" || !card.last_idle_at) ? now() : card.last_idle_at;
            updateCard(card.id, { activity: "idle", last_assistant_text: lastOutput, last_idle_at: idleAt });
            const current = getCard(card.id);
            if (current && current.status !== "archived" && current.status !== "completed") {
              for (const round of readiness.invalid) {
                const item = round.slug ? `${round.label} — ${round.slug}` : round.label;
                const why = round.reason === "needs-depth" && round.detail
                  ? `needs depth: ${round.detail}`
                  : round.reason === "missing"
                    ? "missing — write it"
                    : round.reason === "mirrors-index"
                      ? "mirrors the index — write the playbook output"
                      : round.reason === "thin"
                        ? "thin — write the full playbook output"
                        : "incomplete";
                const key = round.slug ? `round-invalid:${card.id}:${round.n}:${round.slug}` : `round-invalid:${card.id}:${round.n}`;
                recordInboxEvent(current, "error", `Round ${round.n} (${item}) ${why} — restart it to regenerate the result.`, key, now());
              }
              if (idleAt && now() - idleAt >= IDLE_ATTENTION_MS) {
                recordInboxEvent(current, "paused", "Idle with unfinished research — retry continues in place, restart begins fresh.", `paused:${card.id}:${idleAt}`, idleAt);
              }
            }
          }
        }
        noteAgentOutput(card, lastOutput);
      } else if (status === "failed" || status === "error") {
        await applyWorkerFailed(card.id, card.worker_thread_id!, null);
      }
    } catch (error) {
      updateCard(card.id, { activity: "error", last_error: error instanceof Error ? error.message : "Unable to read worker thread." });
    }
    escalateIfStalled(card.id);
  }

  // Stable content fingerprint for an explore artifact: identical content
  // across polls dedupes to one completion event, and a rewritten artifact
  // (restart) produces a fresh one.
  function shortFingerprint(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return hash.toString(36);
  }

  // Explore cards have no stages and no index: Done means the stage skill
  // produced its artifact (explore-<stage>.md with real content). Mirrors the
  // research sync minus the index contract.
  async function syncExploreThreadState(card: CardRow): Promise<void> {
    // Terminal cards stay untouched: no failure, idle, or completion write
    // may land after Done.
    if (card.status === "completed" || card.status === "archived" || card.status === "blocked") return;
    try {
      const thread = await bb.sdk.threads.get({ threadId: card.worker_thread_id! });
      const status = thread.status as string;
      try {
        const threadBorn = (thread as { createdAt?: number }).createdAt;
        healPresetStaleness(db, card.id, threadBorn, card.preset_restart_pending);
      } catch { /* staleness stays best-effort */ }
      const lastOutput = (await bb.sdk.threads.output({ threadId: card.worker_thread_id! }).catch(() => null))?.output ?? null;
      if (status === "active" || status === "starting") {
        await markThreadRunning(card, lastOutput);
      } else if (status === "idle" || status === "stopping") {
        const questionIds = await syncOpenQuestionInbox(card);
        if (questionIds === null) return;
        if (questionIds.length > 0) {
          updateCard(card.id, questionWaitUpdates(lastOutput));
        } else {
          const artifact = await exploreArtifact(card).catch(() => ({ ready: false as const, fingerprint: null as string | null, failures: [] as string[] }));
          const completing = artifact.ready && card.status !== "completed";
          if (completing) {
            const readyIdleAt = (card.activity !== "idle" || !card.last_idle_at) ? now() : card.last_idle_at;
            updateCard(card.id, { status: "completed", activity: "idle", last_assistant_text: lastOutput, last_idle_at: readyIdleAt });
            // Same trail contract as the research sweep above.
            recordStageEvent(card.id, "done");
            resolveInboxEvents(card.id, now(), ["paused"], "completed");
            const readyCurrent = getCard(card.id);
            if (readyCurrent) recordInboxEvent(readyCurrent, "completed", "Exploration complete — result ready to review in Done.", `explore-completed:${card.id}:${artifact.fingerprint ?? "ready"}`, now());
          } else if (!artifact.ready) {
            const idleAt = (card.activity !== "idle" || !card.last_idle_at) ? now() : card.last_idle_at;
            updateCard(card.id, { activity: "idle", last_assistant_text: lastOutput, last_idle_at: idleAt });
            const current = getCard(card.id);
            if (current && current.status !== "archived" && current.status !== "completed") {
              if (artifact.failures.length > 0) {
                recordInboxEvent(current, "error", `Explore ${card.explore_stage} needs depth — ${artifact.failures.join("; ")} — rewrite it, then run verify again.`, `explore-invalid:${card.id}`, now());
              }
              if (idleAt && now() - idleAt >= IDLE_ATTENTION_MS) {
                recordInboxEvent(current, "paused", "Idle with unfinished explore — retry continues in place, restart begins fresh.", `paused:${card.id}:${idleAt}`, idleAt);
              }
            }
          }
        }
        noteAgentOutput(card, lastOutput);
      } else if (status === "failed" || status === "error") {
        await applyWorkerFailed(card.id, card.worker_thread_id!, null);
      }
    } catch (error) {
      updateCard(card.id, { activity: "error", last_error: error instanceof Error ? error.message : "Unable to read worker thread." });
    }
    escalateIfStalled(card.id);
  }

  // The stage's artifact file with real content: the deterministic completion
  // signal for an explore card (lib/research-artifacts: same substance rule
  // as research rounds, minus the index mirror). A missing/thin file means
  // the stage skill has not produced its deliverable yet; a present file
  // must also meet its stage contract (lib/artifact-contracts).
  async function exploreArtifact(card: CardRow): Promise<{ ready: boolean; fingerprint: string | null; failures: string[] }> {
    const workspace = await cardWorkspace(card);
    if (!workspace?.path || !card.dir_hash || !card.explore_stage) return { ready: false, fingerprint: null, failures: [] };
    const stateDir = await workflowStateDir(bb, workspace.path, card.id, card.dir_hash).catch(() => null);
    if (!stateDir) return { ready: false, fingerprint: null, failures: [] };
    const full = join(stateDir, exploreArtifactFile(card.explore_stage));
    const content = await bb.sdk.files.read({ path: full }).then((f) => f.content).catch(() => null);
    if (!isValidExploreContent(content)) return { ready: false, fingerprint: null, failures: [] };
    const failures = validateExplore(card.explore_stage, content).failures.map((failure) => failure.detail).slice(0, 3);
    if (failures.length > 0) return { ready: false, fingerprint: null, failures };
    return { ready: true, fingerprint: shortFingerprint(content as string), failures: [] };
  }

  // Mirror the card_threads ledger into the workflow's own stelow.json
  // (upstream "Worker Lineage" contract): survives plugin database loss and
  // is readable by any host and by the worker itself. Best-effort — a failed
  // lineage write must never break a spawn, reseed, or restart.
  async function recordWorkflowLineage(rootPath: string, dirHash: string, threadId: string, presetId: string | null, endedReason: string): Promise<void> {
    try {
      const trackingPath = join(rootPath, "stelow.json");
      await writeMergedFile(bb.sdk.files, trackingPath, rootPath, (existing) => mergeLineageFile(existing, dirHash, { threadId, presetId, endedReason }));
    } catch { /* audit-only */ }
  }

  function getCard(cardId: string): CardRow | undefined {
    return db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId) as CardRow | undefined;
  }

  // Shared refusal copy: identical wording everywhere so the same failure
  // reads the same on every surface, fixed in one place.
  const ERR_CARD_NOT_FOUND = "Card not found.";
  const ERR_CARD_ARCHIVED = "This card is archived.";
  const ERR_WORKSPACE_UNAVAILABLE = "Workspace is unavailable.";
  const ERR_PRESET_NOT_FOUND = "Preset not found.";

  // Single writer for card conversation rows (agent trail, user notes,
  // worker transitions). Returns the comment id for callers that reference it.
  function logCardComment(cardId: string, target: string, targetId: string, author: "user" | "agent", body: string): string {
    const commentId = randomId("cmt");
    db.prepare("INSERT INTO comments (id, card_id, target, target_id, author, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(commentId, cardId, target, targetId, author, body, now());
    return commentId;
  }

  // ::name{...} directives are bb's thread renderer syntax (the worker emits
  // ::stelow-artifact chips per produced file). Card comments are rendered as
  // plain Markdown, so strip the directive syntax there — the file names it
  // carried are already present as natural text in the same message.
  function stripMessageDirectives(text: string | null): string {
    return String(text ?? "").replace(/::[a-zA-Z0-9_-]+\{[^}]*\}/g, " ").replace(/[ \t]{2,}/g, " ").trim();
  }

  // Ordered strategy history for a research card (first = primary).
  function strategyList(row: Pick<CardRow, "research_strategies" | "research_strategy">): string[] {
    return parseStrategyList(row.research_strategies);
  }

  // Round history with timestamps (newest bookkeeping, oldest first).
  function strategyRounds(row: Pick<CardRow, "research_strategies" | "research_strategy">): Array<{ id: string; at: string; file: string }> {
    return normalizeHistory(row.research_strategies);
  }

  function getCardByWorkerThread(threadId: string): CardRow | undefined {
    return db.prepare("SELECT * FROM cards WHERE worker_thread_id = ?").get(threadId) as CardRow | undefined;
  }
  function updateCard(cardId: string, fields: Partial<Omit<CardRow, "id" | "project_id" | "intent" | "prompt" | "name" | "created_at">>, opts?: { suppressCompletionEvent?: boolean }): void {
    // Hot-reload race: bb closes the plugin DB while syncThreadState callbacks
    // are still in flight; writing then crashes the whole server process.
    if (!(db as unknown as { open?: boolean }).open) return;
    const previous = getCard(cardId);
    // Archived is terminal: strip any status change that would resuscitate
    // the card (a stopping worker settling after Archive is the classic
    // case). Archiving itself always passes through.
    const effective = stripArchivedResuscitation(previous?.status, fields as Record<string, unknown>) as typeof fields;
    const keys = Object.keys(effective);
    if (keys.length === 0) return;
    // No-op guard: sync polls call updateCard every cycle, usually with
    // identical values. Writing anyway would bump updated_at (reshuffling
    // board order and "Idle since" labels) and publish card-state
    // (reloading every panel) for zero visual change.
    const asRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
    const changed = previous ? keys.filter((k) => asRecord(previous)[k] !== asRecord(effective)[k]) : keys;
    if (previous && changed.length === 0) return;
    const write: Record<string, unknown> = { updated_at: now() };
    for (const k of changed) write[k] = asRecord(effective)[k];
    // Write-time terminal re-check: async callers read the card, await
    // network, then write — Archive may have landed in between. Re-strip
    // against a fresh read so a pre-archive snapshot can never resuscitate.
    const latest = getCard(cardId);
    const finalWrite = stripArchivedResuscitation(latest?.status, write) as Record<string, unknown>;
    if (Object.keys(finalWrite).every((k) => k === "updated_at")) return;
    db.prepare(`UPDATE cards SET ${Object.keys(finalWrite).map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ id: cardId, ...finalWrite });
    const current = getCard(cardId);
    if (previous && current) {
      if (current.status === "archived" || current.status === "completed") resolveInboxEvents(cardId, current.updated_at, ["question", "error", "paused"], current.status === "archived" ? "archived" : "completed");
      else if (current.activity === "running") resolveInboxEvents(cardId, current.updated_at, ["error", "paused"], "resumed");
      // Research and Explore cards emit their own completion events and a
      // manual board move needs no "Completed" ping — the human just did it.
      // Only agent-driven build completions notify.
      // One completion event per card, whichever path finishes it. A drag to
      // Done is a board move, so it suppresses this; `bb stelow done` does not,
      // because there the completion IS the outcome. The copy names the thing
      // the human has to look at, since a finished Build card carries evidence
      // rather than a result to read.
      if (previous.status !== "completed" && current.status === "completed" && current.kind === "build" && !opts?.suppressCompletionEvent) recordInboxEvent(current, "completed", "Build complete — audit evidence is ready to review in Done.", `completed:${cardId}:${current.updated_at}`, current.updated_at);
      if (previous.activity !== "error" && current.activity === "error") {
        recordInboxEvent(current, "error", current.last_error || "Worker failed and needs attention.", `error:${cardId}:${current.updated_at}`, current.updated_at);
        // A fresh failure that lands while a specific question is already
        // open is context, not a second action: supersede it at birth so
        // one card never counts twice. The row survives in Resolved
        // history, and the open card shows the error text beside the
        // question it must answer.
        const openQuestion = db.prepare("SELECT 1 FROM inbox_events WHERE card_id = ? AND kind = 'question' AND resolved_at IS NULL AND archived_at IS NULL LIMIT 1").get(cardId);
        if (openQuestion) resolveInboxEvents(cardId, current.updated_at, ["error"], "superseded");
      }
    }
    bb.realtime.publish("card-state", { cardId });
  }

  function recordInboxEvent(card: CardRow, kind: InboxEventRow["kind"], summary: string, dedupeKey: string, occurredAt: number): void {
    if (insertInboxEvent(db, { id: randomId("evt"), cardId: card.id, kind, summary, dedupeKey, occurredAt })) {
      bb.realtime.publish("inbox-changed", { cardId: card.id });
    }
  }

  // Workspace claim coordination (lib/card-claims). A card that hits a file
  // held by another live card parks that scope, not the thread: the worker
  // gets a BB-LOCK-BLOCKED stderr, the user gets a paused inbox event naming
  // the holder and the automatic unlock condition (release or TTL expiry),
  // and the waiter row lets the host resume exactly the blocked cards when
  // the files free up. Advisory-plus-apology: a stale claim is stolen, and
  // the steal is trailed on the card instead of blocking work.
  function lockBlockedSummary(file: string, holderName: string, expiresAt: number): string {
    const when = new Date(expiresAt).toLocaleString();
    return `Waiting on ${file} (held by card "${holderName}"). Releases automatically when that card finishes the file or by ${when} — no action needed; the host resumes this card on release.`;
  }
  async function notifyClaimWaiters(workspacePath: string, files: string[]): Promise<void> {
    if (files.length === 0 || !workspacePath) return;
    const at = now();
    let waiterRows: Array<{ card_id: string; scope: string | null }>;
    try {
      waiterRows = waitersForFiles(db, { workspacePath, files });
    } catch { return; }
    const seen = new Set<string>();
    for (const waiter of waiterRows) {
      if (seen.has(waiter.card_id)) continue;
      seen.add(waiter.card_id);
      const waiting = getCard(waiter.card_id);
      if (!waiting || isClaimTerminal(waiting.status)) {
        try { clearClaimWaiters(db, { cardId: waiter.card_id }); } catch { /* advisory */ }
        continue;
      }
      resolveInboxEvents(waiter.card_id, at, ["paused"], "resumed");
      try { clearClaimWaiters(db, { cardId: waiter.card_id, workspacePath, files }); } catch { /* advisory */ }
      if (waiting.worker_thread_id) {
        const nudge = `Files you waited on are now free (${files.join(", ")}). Re-run \`bb stelow lock acquire --scope <id>\` for the files you still need, then continue the scope — do not re-claim files you no longer touch.`;
        try {
          await bb.sdk.threads.send({ threadId: waiting.worker_thread_id, mode: "auto", input: [{ type: "text", text: nudge, mentions: [], visibility: "agent-only" }] });
        } catch { /* a dead thread stays parked; the user resumes by hand */ }
      }
      bb.realtime.publish("card-state", { cardId: waiter.card_id });
    }
  }
  async function releaseCardClaimsAndNotify(cardId: string): Promise<void> {
    let released: Array<{ workspacePath: string; file: string }>;
    try {
      released = releaseAllCardClaims(db, cardId);
    } catch { return; }
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
      const touched = refreshStalledPaused(db, { cardId, nowMs: now() })
        + refreshEventSeverity(db, { cardId, nowMs: now() });
      if (touched > 0) bb.realtime.publish("inbox-changed", { cardId });
    } catch { /* advisory only */ }
  }

  // Worker shutdown shared by every path that parks a card: the Archive
  // One fresh-worker spawn for every start path (manual Start, drag to
  // Doing, preset restart): same state dir, same trail, same budget reset.
  // respawnWorkerForBand is null-thread safe, so first starts and restarts
  // share this body instead of pasting it twice.
  async function spawnFreshWorker(cardId: string, reason: "start" | "restart"): Promise<{ ok: boolean; error: string | null }> {
    const card = getCard(cardId);
    if (!card) return { ok: false, error: ERR_CARD_NOT_FOUND };
    if (card.status === "archived") return { ok: false, error: ERR_CARD_ARCHIVED };
    if (reason === "start" && card.worker_thread_id) return { ok: false, error: "This card already has a worker thread." };
    const effective = getReliablePresetForBand(card.kind === "research" ? "research" : card.kind === "explore" ? "explore" : STAGE_TO_BAND[card.stage] ?? "analysis", cardId);
    const previousThreadId = card.worker_thread_id;
    const result = await respawnWorkerForBand(cardId, effective.id, reason);
    if (!result.ok) return { ok: false, error: result.error ?? null };
    // Trail: which preset took over and where the previous worker's
    // history lives, so the switch is auditable from the card.
    const presetName = getPresetById(effective.id)?.name ?? effective.id;
    const continueText = card.kind === "research" ? "continuing the research" : card.kind === "explore" ? "continuing the explore run" : `continuing from the ${card.stage} stage`;
    logCardComment(cardId, "card", cardId, "agent", reason === "start"
      ? `Worker started on preset "${presetName}", ${continueText}.`
      : previousThreadId ? `Worker restarted on preset "${presetName}", ${continueText}. Previous worker thread: ${previousThreadId} (archived).` : `Worker started on preset "${presetName}", ${continueText}.`);
    // A fresh worker earns a fresh auto-continue budget: the previous
    // worker's stalls say nothing about this one.
    const reset = resetAutoContinue();
    updateCard(cardId, { auto_continue_count: reset.count, auto_continue_stage: reset.stage });
    // A live worker also clears the spawn-retry budget: the start phase
    // succeeded, so any future failure is a new episode.
    resetSpawnRetry(db, cardId);
    bb.realtime.publish("card-state", { cardId });
    return { ok: true, error: null };
  };

  // button, drag-to-archived, and hard delete. Archiving a card must never
  // leave its worker running (burning tokens on a hidden board).
  async function stopWorkerThread(threadId: string | null): Promise<void> {
    if (!threadId) return;
    try { await bb.sdk.threads.archive({ threadId }); } catch { /* already gone */ }
    try { await bb.sdk.threads.stop({ threadId }); } catch { /* already gone */ }
  }

  // Disposable spawns (draft bursts, independent reviews) die with their
  // worker through lifecycleOwnerThreadId (BB 0.43 dependent threads).
  // Hosts predating the field strip unknown keys and honor the spawn; a host
  // that rejects it instead gets one retry without the field, so drafts and
  // reviews never break on older daemons.
  type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];
  async function spawnDisposable(args: SpawnArgs, site: string): Promise<{ id: string }> {
    // Fail fast through the registry before any SDK call: unknown sites,
    // visible spawns, and full permission refuse here, not mid-flight.
    assertDisposableSpawn({ site, args });
    try {
      return await bb.sdk.threads.spawn(args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if ("lifecycleOwnerThreadId" in args && /lifecycleOwnerThreadId|unrecognized key/i.test(message)) {
        const { lifecycleOwnerThreadId: _dropped, ...rest } = args as SpawnArgs & Record<string, unknown>;
        return await bb.sdk.threads.spawn(rest as SpawnArgs);
      }
      throw error;
    }
  }

  // Resolution is per-kind, never blanket: a worker moving again clears
  // failure/pause signals, but a question stays until it is answered.
  // The reason travels with the timestamp so the Resolved filter can name
  // HOW each item cleared (answered, superseded, resumed, completed,
  // archived) instead of a bare date.
  type InboxResolutionReason = "answered" | "superseded" | "resumed" | "completed" | "archived";
  function resolveInboxEvents(cardId: string, resolvedAt: number, kinds: Array<"question" | "error" | "paused"> = ["question", "error", "paused"], reason: InboxResolutionReason | null = null): void {
    if (resolveActionInboxEvents(db, cardId, resolvedAt, kinds, reason) > 0) bb.realtime.publish("inbox-changed", { cardId });
  }

  function syncPendingQuestionInbox(card: CardRow, interactionIds: string[], occurredAt = now()): void {
    const result = syncQuestionInboxEvents(db, {
      cardId: card.id,
      interactionIds,
      occurredAt,
      createId: () => randomId("evt"),
      summary: "The agent is waiting for your answer to continue.",
    });
    if (result.inserted > 0 || result.resolved > 0 || result.reopened > 0 || result.pausedSuperseded > 0) bb.realtime.publish("inbox-changed", { cardId: card.id });
  }

  function openExpiredQuestionIds(cardId: string): string[] {
    return (db.prepare("SELECT id FROM expired_questions WHERE card_id = ? AND answered = 0 ORDER BY expired_at ASC").all(cardId) as Array<{ id: string }>)
      .map((row) => `expired:${row.id}`);
  }

  // Pending plugin interactions (stelow asks), narrowed so payload/title read.
  type PendingAsk = Extract<Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["list"]>>[number], { origin: { kind: "plugin" } }>;
  function pendingAsks(list: Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["list"]>>): PendingAsk[] {
    return list.filter((entry): entry is PendingAsk => entry.origin?.kind === "plugin" && entry.status === "pending");
  }

  async function fetchPendingAsks(threadId: string | null): Promise<PendingAsk[] | null> {
    if (!threadId) return [];
    try {
      return pendingAsks(await bb.sdk.threads.interactions.list({ threadId }));
    } catch {
      // A failed read is unknown, not proof that a question disappeared.
      // Callers must preserve the existing question state in this case.
      return null;
    }
  }

  async function syncOpenQuestionInbox(card: CardRow): Promise<string[] | null> {
    const active = await fetchPendingAsks(card.worker_thread_id);
    if (active === null) return null;
    const questionIds = [...active.map((entry) => entry.id), ...openExpiredQuestionIds(card.id)];
    syncPendingQuestionInbox(card, questionIds);
    return questionIds;
  }

  function hasOpenQuestions(cardId: string, questionIds: string[] | null): boolean {
    return questionIds !== null ? questionIds.length > 0 : openExpiredQuestionIds(cardId).length > 0;
  }

  // Resolve a worker-authored artifact path (workspace-relative) into the
  // viewer-ready shape. Fail-soft by design: an unresolvable path yields
  // null and the option stays fully answerable — a bad path never blocks
  // the question, it just offers no open affordance.
  async function resolveAskArtifact(card: CardRow, rawPath: unknown): Promise<{ path: string; display: string; absolutePath: string | null; hostId: string | null } | null> {
    const normalized = normalizeAskArtifactPath(rawPath);
    if (!normalized) return null;
    const workspace = await cardWorkspace(card).catch(() => null);
    const full = workspace?.path ? resolveArtifactPath(workspace.path, normalized.path) : null;
    if (!full || !workspace?.hostId) return null;
    const artifact = await bb.sdk.files.read({ path: full }).catch(() => null);
    if (!artifact || !isPublishableArtifactContent(artifact.content)) return null;
    return { ...normalized, absolutePath: full, hostId: workspace.hostId };
  }

  // Per-option artifacts for one rendered ask. A worker that attached
  // `--artifact` to a single option used to leave every other option —
  // including the approval — with nothing to open, because the evidence gate
  // only requires one option to carry evidence and the old manifest fallback
  // fired only when NO option had any. Every option now inherits the ask's
  // document (lib/question-batch inheritAskArtifact), and the manifest
  // recovery still covers asks that attached nothing at all.
  async function resolveAskOptions(card: CardRow | null, options: Array<{ label: string; description: string; preview: string | null; artifact: { path: string } | null }>) {
    const inherited = inheritAskArtifact(options);
    const noOptionCarriesDocument = inherited.every((artifact) => !artifact);
    const manifestArtifact = card && noOptionCarriesDocument ? await fallbackGateAskArtifact(card).catch(() => null) : null;
    const resolved = new Map<string, { path: string; display: string; absolutePath: string | null; hostId: string | null } | null>();
    const out = [];
    for (const [index, option] of options.entries()) {
      const source = inherited[index];
      if (!source || !card) {
        out.push({ ...option, artifact: manifestArtifact });
        continue;
      }
      if (!resolved.has(source.path)) {
        resolved.set(source.path, await resolveAskArtifact(card, source.path).catch(() => null));
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
  const GATE_ARTIFACT_STAGE: Record<string, string> = { gate: "shape", "int-gate": "interface", selection: "interface", "plan-gate": "planning" };
  async function fallbackGateAskArtifact(card: CardRow): Promise<{ path: string; display: string; absolutePath: string | null; hostId: string | null } | null> {
    const stage = await cardStageSlug(card);
    const artifactStage = stage ? GATE_ARTIFACT_STAGE[stage] : null;
    if (!artifactStage || !card.dir_hash) return null;
    const workspace = await cardWorkspace(card).catch(() => null);
    if (!workspace?.path) return null;
    const stateDir = await workflowStateDir(bb, workspace.path, card.id, card.dir_hash).catch(() => null);
    const stateBlob = stateDir ? await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((file) => file.content).catch(() => null) : null;
    const manifestEntry = stateBlob ? parseArtifactManifest(stateBlob).find((entry) => entry.stage === artifactStage && entry.path) : null;
    return manifestEntry ? resolveAskArtifact(card, manifestEntry.path) : null;
  }

  async function fetchPendingQuestions(threadId: string | null): Promise<Awaited<ReturnType<typeof rpcContract.cardDetail.output.parse>>["pendingQuestions"]> {
    if (!threadId) return [];
    const asks = await fetchPendingAsks(threadId);
    if (asks === null) return [];
    try {
      const card = getCardByWorkerThread(threadId);
      const out: Awaited<ReturnType<typeof rpcContract.cardDetail.output.parse>>["pendingQuestions"] = [];
      for (const entry of asks) {
        const expanded = expandInteractionQuestions({ id: entry.id, title: entry.payload?.title, payload: entry.payload });
        for (const question of expanded) {
          const options = await resolveAskOptions(card ?? null, question.options);
          out.push({
            id: question.questionId,
            title: question.title,
            question: question.question,
            multiple: question.multiple,
            kind: question.kind,
            options,
            expiresAt: typeof entry.expiresAt === "number" ? entry.expiresAt : null,
          });
        }
      }
      return out;
    } catch { return []; }
  }

  const INTENT_VALUES = ["new-product", "feature", "bugfix", "refactor", "investigate"] as const;

  async function syncThreadState(cardId: string): Promise<void> {
    const card = getCard(cardId);
    // Done is terminal for background sync too: a completed/blocked card must
    // never be re-errored (e.g. a cleaned-up state dir) after it finished.
    if (!card?.worker_thread_id || isArchivedCard(card) || card.status === "completed" || card.status === "blocked") return;
    if (card.kind === "research") {
      await syncResearchThreadState(card);
      return;
    }
    if (card.kind === "explore") {
      await syncExploreThreadState(card);
      return;
    }
    try {
      // Resolve this card's own per-workflow state file (not a shared root state.md).
      const workspace = await cardWorkspace(card);
      const projectPath = workspace?.path ?? null;
      const stateBlob = await (async () => {
        if (!projectPath) return null;
        if (card.dir_hash) {
          const stateDir = await workflowStateDir(bb, projectPath, card.id, card.dir_hash);
          if (stateDir) {
            return await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((f) => f.content).catch(() => null);
          }
          return null;
        }
        return await bb.sdk.files.read({ path: join(projectPath, "state.md") }).then((f) => f.content).catch(() => null);
      })();

      if (card.dir_hash && !stateBlob) {
        updateCard(cardId, { activity: "error", last_error: "Workflow state ownership cannot be verified. Reseed this card; project-root state is intentionally ignored." });
        return;
      }

      // Sync intent from state.md if the agent recorded a decision during triage.
      if (card.intent === "unknown" && stateBlob) {
        const stateName = text(stateBlob.match(/^name:\s*(\S+)/m)?.[1]);
        const stateIntent = text(stateBlob.match(/^intent:\s*(\S+)/m)?.[1]);
        // Only adopt the intent if this state.md belongs to this card.
        if (stateName === card.name && stateIntent && (INTENT_VALUES as readonly string[]).includes(stateIntent)) {
          const ts = now();
          db.prepare("UPDATE cards SET intent = ?, updated_at = ? WHERE id = ?").run(stateIntent, ts, cardId);
        }
      }
      const thread = await bb.sdk.threads.get({ threadId: card.worker_thread_id });
      const status = thread.status as string;
      // Self-heal stale preset flags: a thread spawned BEFORE the current
      // override was assigned provably predates it.
      // Never clears here — only spawn paths clear, so a flagged card keeps
      // offering Restart until it actually happens.
      try {
        const threadBorn = (thread as { createdAt?: number }).createdAt;
        healPresetStaleness(db, cardId, threadBorn, card.preset_restart_pending);
      } catch { /* staleness stays best-effort; id comparison below still applies */ }
      const lastOutput = (await bb.sdk.threads.output({ threadId: card.worker_thread_id }).catch(() => null))?.output ?? null;
      // Stage source of truth is state.md (the agent advances it via `bb stelow
      // advance`); the DB `stage` is a cache. Converge it on every sync —
      // including question-wait and idle polls — so pills, progress, preset
      // band, split eligibility, and the hero all read the real checkpoint
      // instead of the last manually-advanced one. This write carries stage
      // only: status/column movement stays with the explicit advance/moveCard
      // paths and the new-card guard below, and question waits keep their
      // activity-only contract (see lib/card-question-state).
      let currentStage = card.stage;
      if (stateBlob) {
        currentStage = text(stateBlob.match(/current_stage:\s*(\S+)/m)?.[1]) || card.stage;
      }
      if (currentStage && currentStage !== card.stage) {
        updateCard(cardId, { stage: currentStage });
      }
      if (status === "active" || status === "starting") {
        const questionIds = await syncOpenQuestionInbox(card);
        if (questionIds === null) return;
        if (questionIds.length > 0) {
          // Waiting is activity, never board position: the card stays in its
          // stage column while the question waits. See lib/card-question-state.
          updateCard(cardId, questionWaitUpdates(lastOutput));
        } else {
          // Keep freshly-created cards in the Triage column (draft) while the
          // workflow is still at the triage stage, even though the thread is
          // already active. Only move to Running (in-progress) once the agent
          // has advanced past triage (current_stage != triage).
          const nextStatus = statusForNewCardWork({ kind: card.kind, status: card.status, stage: currentStage }).status;
          const updates: Record<string, unknown> = { activity: "running" as const, last_assistant_text: lastOutput, status: nextStatus };
          if (currentStage !== card.stage) updates.stage = currentStage;
          updateCard(cardId, updates);
        }
      } else if (status === "idle" || status === "stopping") {
        const questionIds = await syncOpenQuestionInbox(card);
        if (questionIds === null) return;
        const transitioningIntoIdle = card.activity !== "idle";
        if (questionIds.length > 0) {
          // The worker stopped (likely a timed-out ask) but a question is
          // still unanswered. Keep the question surfaced via activity, but the
          // card stays in its real stage column (no Gate-pending column) —
          // the attention flag from listCards/cardDetail signals it. Answering
          // on the card resumes the thread.
          updateCard(cardId, questionWaitUpdates(lastOutput));
        } else if (currentStage === "audit") {
          // `audit` is the terminal stage, but reaching it is not completing:
          // completion is an explicit worker commit (`bb stelow done`),
          // verified in code. The old inference (audit + idle ⇒ completed)
          // is gone on purpose — it made a worker that narrated completion
          // and stopped indistinguishable from one that actually finished,
          // and left completed cards showing a lit "audit" with no next
          // step. Resume the worker with the done instruction instead
          // (lib/auto-continue budget); an exhausted budget pauses with the
          // instruction on the card, for the human.
          const doneDecision = shouldDoneNudge({
            status, cardStatus: card.status, questionPending: questionIds.length > 0, transitioningIntoIdle,
            autoCount: card.auto_continue_count ?? 0, autoStage: card.auto_continue_stage ?? null,
          });
          if (doneDecision.proceed) {
            // This is a host recovery instruction, not a card comment. Keep
            // workflow mechanics out of the user's Conversation timeline.
            const doneSent = await bb.sdk.threads.send({ threadId: card.worker_thread_id, mode: "auto", input: [{ type: "text", text: AUDIT_DONE_NUDGE, mentions: [], visibility: "agent-only" }] }).then(() => true).catch(() => false);
            if (doneSent) {
              const autoNext = nextAutoContinue({ stage: currentStage, autoCount: card.auto_continue_count ?? 0, autoStage: card.auto_continue_stage ?? null });
              const doneFields: Parameters<typeof updateCard>[1] = { activity: "running", last_idle_at: null, last_error: null, auto_continue_count: autoNext.count, auto_continue_stage: autoNext.stage };
              if (lastOutput != null) doneFields.last_assistant_text = lastOutput;
              updateCard(cardId, doneFields);
              return;
            }
          }
          if (card.status !== "completed" && transitioningIntoIdle) {
            // Once per idle period (transition edge only): the card says what
            // is actually missing — the done commit — instead of a generic
            // "paused". A human Resume hands the worker the same instruction.
            logCardComment(cardId, "card", cardId, "agent", "The workflow reached the audit stage, but the card completes only when the worker runs `bb stelow done` (verified in code — build at audit, never past a pending question). Resume continues the worker with that instruction; nothing is done until done runs.");
          }
          updateCard(cardId, { activity: "idle", last_assistant_text: lastOutput, last_idle_at: card.last_idle_at ?? now(), stage: currentStage });
          const auditCurrent = getCard(cardId);
          if (auditCurrent && auditCurrent.status !== "archived" && auditCurrent.status !== "completed" && auditCurrent.last_idle_at && now() - auditCurrent.last_idle_at >= IDLE_ATTENTION_MS) {
            recordInboxEvent(auditCurrent, "paused", "At audit, waiting for the worker to run `bb stelow done` — resume continues it with that instruction.", `paused:${cardId}:${auditCurrent.last_idle_at}`, auditCurrent.last_idle_at);
          }
        } else {
          // Auto-continue (lib/auto-continue): the provider ends a turn on
          // any final text, so a worker that narrates progress idles after
          // every stage with work remaining. Progress is fresh chat output
          // or a stage advance in the finished turn (tool-only turns move
          // the machine without narrating — detected via the turn's events,
          // scoped to the last turn so older advances and user-stopped
          // threads earn nothing). While progress exists, no question is
          // pending, and the per-stage budget remains, resume the worker in
          // place instead of waiting for a human Resume. Recording
          // last_assistant_text here consumes the text signal, and recording
          // the stage consumes the advance signal, so a still-idle thread
          // cannot trigger a second nudge on the next poll; an exhausted
          // budget falls through to the paused path below.
          const autoProgressed = lastOutput != null && lastOutput !== card.last_assistant_text;
          let autoAdvanced = false;
          if (!autoProgressed) {
            try {
              // Narrow to turn boundaries + completions: deltas and usage
              // events are noise for this scan, and a tool-heavy turn holds
              // more than a handful of completions.
              const recent = await bb.sdk.threads.events.list({ threadId: card.worker_thread_id, order: "desc", limit: "100", types: ["turn/completed", "turn/started", "item/completed"] });
              autoAdvanced = lastTurnAdvancedStages(recent);
            } catch { autoAdvanced = false; }
          }
          const autoDecision = shouldAutoContinue({
            status, stage: currentStage, questionPending: questionIds.length > 0,
            transitioningIntoIdle, progressed: autoProgressed || autoAdvanced,
            autoCount: card.auto_continue_count ?? 0, autoStage: card.auto_continue_stage ?? null,
          });
          let vetoedResume = false;
          if (autoDecision.proceed) {
            // Decision-API veto (auto-continue point): a confident "no real
            // progress" cancels the resume and the card falls through to the
            // paused path below. Every other outcome keeps the heuristic
            // standing — the veto spends nothing, it only saves turns.
            // Vetoes are named in the paused event (vetoedResume) so a pause
            // after fresh-looking output explains itself.
            const vetted = await vetAutoContinueNudge(lastOutput != null ? `Stage ${currentStage}. Worker output:\n${lastOutput}` : null);
            if (!vetted) {
              vetoedResume = true;
              // Fall through to the standard paused path below with no
              // writes of our own — identical to a heuristic refusal.
            } else {
            // Automatic continuations are private orchestration, unlike a
            // user-selected Retry or a card comment that deliberately resumes
            // the worker.
            const autoSent = await bb.sdk.threads.send({ threadId: card.worker_thread_id, mode: "auto", input: [{ type: "text", text: buildContinueNudge(), mentions: [], visibility: "agent-only" }] }).then(() => true).catch(() => false);
            if (autoSent) {
              const autoNext = nextAutoContinue({ stage: currentStage, autoCount: card.auto_continue_count ?? 0, autoStage: card.auto_continue_stage ?? null });
              const autoFields: Parameters<typeof updateCard>[1] = { activity: "running", last_idle_at: null, last_error: null, auto_continue_count: autoNext.count, auto_continue_stage: autoNext.stage };
              // A null read is "unknown", not progress: never blank the
              // card's last text on it, or the trail and the stall detector
              // below lose their reference point.
              if (lastOutput != null) autoFields.last_assistant_text = lastOutput;
              updateCard(cardId, autoFields);
              return;
            }
            }
          }
          // Backfill last_idle_at on the first poll that observes an already-idle
          // card missing it, so it starts its own idle-stuck clock instead
          // of falling through.
          // Suspicious idle: the worker just stopped (running -> idle) yet
          // produced no new output, no question, and no stage progress. That
          // is a manual stop or a stall — never a routine between-turn rest,
          // which always leaves fresh output behind. Skip the grace period so
          // the card signals paused immediately instead of saying "nothing
          // needs you" for 90s. Guarded to cards that have worked before, so
          // a brand-new worker still gets its grace.
          // A failed output read is "unknown", not "no progress": never backdate
          // on lastOutput == null or a flaky read would false-positive.
          const noProgress = transitioningIntoIdle
            && card.last_assistant_text != null
            && lastOutput != null
            && lastOutput === card.last_assistant_text;
          const backfillIdle = transitioningIntoIdle || !card.last_idle_at;
          const idleAt = noProgress ? now() - IDLE_ATTENTION_MS : backfillIdle ? now() : card.last_idle_at;
          if (noProgress) {
            // Once per idle period (transition edge only): leave a trail so
            // repeated silent stops are visible in Conversation, not just as
            // identical paused banners.
            logCardComment(cardId, "card", cardId, "agent", "Worker stopped with no new output — treated as paused. If this repeats, inspect the thread before retrying: a silent stop usually means the worker is waiting on input it never asked for.");
          }
          updateCard(cardId, { activity: "idle", last_assistant_text: lastOutput, last_idle_at: idleAt });
          // The Inbox must be driven by lifecycle transitions, never by a UI
          // read. The scheduled sync revisits idle cards after the grace
          // period, producing exactly one durable event per idle period.
          const current = getCard(cardId);
          if (current && current.status !== "archived" && current.status !== "completed" && idleAt && now() - idleAt >= IDLE_ATTENTION_MS) {
            recordInboxEvent(current, "paused", `Idle with unfinished work — retry continues in place, restart begins fresh.${vetoedResume ? " Auto-continue vetoed the resume: the last output showed no real progress." : ""}`, `paused:${cardId}:${idleAt}`, idleAt);
          }
        }
        if (lastOutput && lastOutput !== card.last_assistant_text) {
          logCardComment(cardId, "card", cardId, "agent", stripMessageDirectives(lastOutput));
        }
      } else if (status === "failed" || status === "error") {
        await applyWorkerFailed(cardId, card.worker_thread_id, null);
      }
    } catch (error) {
      updateCard(cardId, { activity: "error", last_error: error instanceof Error ? error.message : "Unable to read worker thread." });
    }
    escalateIfStalled(cardId);
  }

  bb.events.on("thread.idle", ({ thread }) => {
    const row = db.prepare("SELECT id FROM cards WHERE worker_thread_id = ? AND status != 'archived'").get(thread.id) as { id: string } | undefined;
    if (row) void syncThreadState(row.id);
  });
  bb.events.on("thread.active", ({ thread }) => {
    const row = db.prepare("SELECT id FROM cards WHERE worker_thread_id = ? AND status != 'archived'").get(thread.id) as { id: string } | undefined;
    if (row) void syncThreadState(row.id);
  });
  bb.events.on("thread.failed", ({ thread, error }) => {
    const row = db.prepare("SELECT id FROM cards WHERE worker_thread_id = ? AND status != 'archived'").get(thread.id) as { id: string } | undefined;
    if (!row) return;
    void applyWorkerFailed(row.id, thread.id, typeof error === "string" ? error : null);
  });
  // Reconcile card states with their worker threads after reloads (events only fire on transitions).
  const liveCards = db.prepare("SELECT id FROM cards WHERE worker_thread_id IS NOT NULL AND status != 'archived'").all() as Array<{ id: string }>;
  for (const row of liveCards) void syncThreadState(row.id);

  // Deterministic sweep (bb 0.40 removed system/thread/interrupted from the
  // plugin event API): periodically reconcile live cards so interrupts,
  // missed transitions and stale states self-heal without event delivery.
  const RECONCILE_MS = 45_000;
  // An idle card needs attention only after it has sat idle continuously for
  // this long (two reconcile cycles). A worker that just finished a turn is
  // idle for a few seconds before being resumed — not an attention item.
  const IDLE_ATTENTION_MS = 90_000;
  // Semantic severity bump (inbox-severity point): at most a few unjudged
  // routine items per tick get one yes/no — "does this block the worker?" —
  // and confident yeses promote to escalating with a model-judged chip.
  // Never demotes, never resolves, never re-judges a checked item; items
  // too fresh to have settled (under 5 minutes) wait for a later tick.
  // Everything else (mode, key, kill switch, failures) keeps deterministic
  // tiers standing. Advisory ordering only — the badge never moves on it.
  const SEVERITY_BUMP_PER_TICK = 3;
  const SEVERITY_BUMP_MIN_AGE_MS = 5 * 60 * 1000;
  async function maybeBumpSeverity(): Promise<void> {
    try {
      const point = db.prepare("SELECT mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points WHERE point = ?").get(DECISION_POINT_INBOX_SEVERITY) as { mode: string; thresholds: string; provider: string | null; endpoint: string | null; api_key: string | null; model: string | null; preset_id: string | null } | undefined;
      if (normalizePointMode(point?.mode, "rules") === "preset") bb.log.warn("inbox severity ignores preset mode: hot paths stay on rules/api so judgments never burn worker turns.");
      if (normalizePointMode(point?.mode, "rules") !== "api") return;
      if (isDecisionApiDisabled(process.env)) return;
      const cfg = db.prepare("SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1").get() as { endpoint: string; api_key: string; model: string; provider: string | null } | undefined;
      const route = pointRouteConfig(point, cfg);
      const provider = normalizeDecisionProvider(route.provider ?? "jev");
      const { key } = resolveDecisionApiKey({ storedKey: route.apiKey ?? null, env: process.env });
      if (!key && providerRequiresKey(provider)) return;
      let stored: unknown = null;
      try { stored = point ? JSON.parse(point.thresholds) : null; } catch { stored = null; }
      const thresholds = normalizeThresholds(stored, defaultThresholdsFor(DECISION_POINT_INBOX_SEVERITY));
      const cutoff = now() - SEVERITY_BUMP_MIN_AGE_MS;
      // Card context rides the state — a bare summary ("Idle…", "Round 3
      // failed…") judges poorly alone; name, kind, and stage disambiguate
      // without extra calls.
      const rows = db.prepare(
        "SELECT inbox_events.id, inbox_events.summary, inbox_events.severity_reasons, cards.display_name, cards.name, cards.kind AS card_kind, cards.stage FROM inbox_events JOIN cards ON cards.id = inbox_events.card_id WHERE inbox_events.resolved_at IS NULL AND inbox_events.archived_at IS NULL AND inbox_events.severity = 1 AND inbox_events.occurred_at <= ? AND inbox_events.severity_reasons NOT LIKE '%model-judged%' ORDER BY inbox_events.occurred_at ASC LIMIT 3",
      ).all(cutoff) as Array<{ id: string; summary: string; severity_reasons: string | null; display_name: string | null; name: string; card_kind: string | null; stage: string }>;
      const candidates = rows.slice(0, SEVERITY_BUMP_PER_TICK);
      let changed = 0;
      for (const row of candidates) {
        const state = `Card "${row.display_name ?? row.name}" (${row.card_kind ?? "build"}, stage ${row.stage}): ${row.summary}`;
        const result = await evaluateDecisionCall({
          provider,
          endpoint: route.endpoint ?? defaultEndpointFor(provider),
          apiKey: key ?? "",
          model: normalizeDecisionApiModel(route.model, defaultModelFor(provider)),
          state,
          questions: severityBumpQuestions(),
        }).catch(() => null);
        if (!result || !result.ok) continue;
        const answer = result.answers?.blocking ?? null;
        if (!answer || answer.type !== "noul" || typeof answer.noul !== "number") continue;
        const reasons = [...parseSeverityReasons(row.severity_reasons), "model-judged"];
        if (meetsDecisionThreshold(answer.noul, thresholds.routeAt)) {
          changed += db.prepare("UPDATE inbox_events SET severity = 2, severity_reasons = ? WHERE id = ? AND resolved_at IS NULL").run(JSON.stringify(reasons), row.id).changes;
        } else {
          changed += db.prepare("UPDATE inbox_events SET severity_reasons = ? WHERE id = ? AND resolved_at IS NULL").run(JSON.stringify(reasons), row.id).changes;
        }
      }
      if (changed > 0) bb.realtime.publish("inbox-changed", { bumped: changed });
    } catch { /* advisory only — tiers stand without the bump */ }
  }
  // Last-seen scope prints per live card. Module-closure lifetime is
  // correct: a reload re-baselines silently instead of inheriting stale
  // hashes across a restart.
  const scopePrints = new Map<string, string>();
  async function syncScopeProgress(cardId: string): Promise<void> {
    try {
      const card = getCard(cardId);
      if (!card) { scopePrints.delete(cardId); return; }
      const workspace = await cardWorkspace(card);
      const print = workspace?.path ? scopeFingerprint(loadCardScopes(workspace.path, card.id)) : "";
      const prev = scopePrints.get(cardId);
      scopePrints.set(cardId, print);
      if (prev !== undefined && prev !== print) bb.realtime.publish("card-state", { cardId });
    } catch { /* advisory; next tick retries */ }
  }
  const reconcileTimer = setInterval(() => {
    if (!(db as unknown as { open?: boolean }).open) return;
    try {
      const rows = db.prepare("SELECT id FROM cards WHERE worker_thread_id IS NOT NULL AND status != 'archived'").all() as Array<{ id: string }>;
      for (const row of rows) void syncThreadState(row.id);
      const liveIds = new Set(rows.map((row) => row.id));
      // Scope-progress watch: silent worker edits (status flips with no host
      // action) publish card-state within one tick instead of waiting for
      // the next host-driven reload. First sight sets the baseline silently
      // — a restart must not publish-storm every live card — and dead cards
      // prune out so the map cannot grow past the live set.
      for (const row of rows) void syncScopeProgress(row.id);
      for (const id of scopePrints.keys()) if (!liveIds.has(id)) scopePrints.delete(id);
    } catch { /* db closed during reload; next tick retries */ }
    void maybeBumpSeverity();
    // Expired workspace claims are crashed workers that never released:
    // reap them here and wake exactly the cards that waited on each file.
    // Claims held by terminal-status cards are dead weight too (a terminal
    // card must hold nothing): reap them on the same path so legacy rows
    // and future terminal writes never park files hostage.
    try {
      const reaped = sweepExpiredClaims(db, Date.now());
      if (reaped.length > 0) {
        const byWorkspace = new Map<string, string[]>();
        for (const row of reaped) {
          const list = byWorkspace.get(row.workspacePath) ?? [];
          list.push(row.file);
          byWorkspace.set(row.workspacePath, list);
        }
        for (const [workspacePath, files] of byWorkspace) void notifyClaimWaiters(workspacePath, files);
      }
    } catch { /* advisory; next tick retries */ }
    try {
      const holders = db.prepare("SELECT id, status FROM cards").all() as Array<{ id: string; status: string }>;
      for (const holder of holders) {
        if (!isClaimTerminal(holder.status)) continue;
        let released: Array<{ workspacePath: string; file: string }> = [];
        try { released = releaseAllCardClaims(db, holder.id); } catch { continue; }
        try { clearClaimWaiters(db, { cardId: holder.id }); } catch { /* advisory */ }
        if (released.length === 0) continue;
        const byWorkspace = new Map<string, string[]>();
        for (const row of released) {
          const list = byWorkspace.get(row.workspacePath) ?? [];
          list.push(row.file);
          byWorkspace.set(row.workspacePath, list);
        }
        for (const [workspacePath, files] of byWorkspace) void notifyClaimWaiters(workspacePath, files);
      }
    } catch { /* advisory; next tick retries */ }
  }, RECONCILE_MS);
  bb.onDispose(async () => {
    clearInterval(reconcileTimer);
    // Pending spawn retries must not fire after reload: the next poll
    // re-drives them from the persisted claim ledger instead.
    for (const timer of spawnRetryTimers.values()) clearTimeout(timer);
    spawnRetryTimers.clear();
  });

  // Workflow mechanics are private to workers created by the Build panel.
  // Manifest skills are static registrations in BB, so configure() is the
  // boundary that keeps them out of every other thread/session.
  bb.agents.configure((context) => ({
    tools: [],
    skills: context.thread.title?.startsWith("Stelow: ") ? [...WORKFLOW_SKILLS] : [],
  }));

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
  const AUDIT_DONE_NUDGE = "The workflow is at the audit stage. If audit work remains, finish it first. Then commit completion with `bb stelow done` — it verifies in code and refuses with the fix when something is missing. Never just announce completion and stop: only done completes the card.";
  function buildContinueNudge(): string {
    return `Continue the Stelow workflow now from the current stage. Re-read your state.md and transitions.md first, then keep working. Only a visible structured form on the card counts as a pending question — a prior chat message or split-proposal record does not. If the user cannot see a form and the stage needs input, submit the same bb stelow ask once; the host refuses duplicates when a real form is open. Never claim to be waiting based on memory alone. ${INTERFACE_PICK} Unselected gates approve and advance themselves; selected gates use a structured ask. If a bb stelow command fails, read its stderr once and continue — do not spend the turn debugging the CLI.`;
  }

  // GitHub issues live decoupled in server/github-issues.ts: tables,
  // backfills, matcher wiring, scheduler, and RPCs. One seam in, one out.
  const github = createGithubAutomation({
    db,
    bb,
    now,
    randomId,
    cards: {
      get: (cardId) => getCard(cardId),
      create: (args) => createCardInternal(args),
      comment: (cardId, target, targetId, author, body) => logCardComment(cardId, target, targetId, author, body),
      workspace: (card) => cardWorkspace(card as CardRow),
      scopes: (card, rootPath) => (rootPath ? loadCardScopes(rootPath, card.id) : []),
      normalizeStatus: (value) => normalizeStatus(value),
      statusLabel: (status) => statusLabelForSummary(status),
    },
  });

  // The scheduler lives with the feature it drives: disabling the module
  // (STELOW_GITHUB_ISSUES=0) stops the ticks along with the RPCs.
  bb.background.schedule("stelow-automation-rules", "*/5 * * * *", () => github.runAutomationRules());

  bb.rpc.register(rpcContract, {
    ...github.handlers,
    board: async ({ projectId }) => {
      const board = await loadBoard(bb, projectId);
      const githubStatus = await github.githubStatus().catch(() => ({ ok: false, pluginAvailable: false, ghOk: false, repos: [] }));
      return { ...board, githubStatus, githubAutomationEnabled: githubIssuesEnabled() };
    },
    projects: async () => {
      const list = await bb.sdk.projects.list();
      return { projects: list.map((project) => ({ id: project.id, name: project.name })) };
    },
    async flowMetrics({ projectId, since, until }) {
      // Board-level flow reading over finished cards only: active cards
      // have age, not lead. One query per dimension (cards, done events),
      // then pure math — no per-card round trips.
      const rows = (projectId
        ? db.prepare("SELECT id, kind, name, created_at FROM cards WHERE status = 'completed' AND project_id = ?").all(projectId)
        : db.prepare("SELECT id, kind, name, created_at FROM cards WHERE status = 'completed'").all()) as Array<{ id: string; kind: string; name: string; created_at: number }>;
      const ids = rows.map((row) => row.id);
      const doneByCard = new Map<string, number>();
      const eventsByCard = new Map<string, Array<{ stage: string; entered_at: number }>>();
      if (ids.length > 0) {
        const placeholders = ids.map(() => "?").join(",");
        const doneRows = db.prepare(`SELECT card_id, MAX(entered_at) AS done_at FROM card_stage_events WHERE stage = 'done' AND card_id IN (${placeholders}) GROUP BY card_id`).all(...ids) as Array<{ card_id: string; done_at: number }>;
        for (const row of doneRows) doneByCard.set(row.card_id, row.done_at);
        const eventRows = db.prepare(`SELECT card_id, stage, entered_at FROM card_stage_events WHERE card_id IN (${placeholders}) ORDER BY card_id ASC, entered_at ASC, id ASC`).all(...ids) as Array<{ card_id: string; stage: string; entered_at: number }>;
        for (const row of eventRows) {
          const list = eventsByCard.get(row.card_id) ?? [];
          list.push({ stage: row.stage, entered_at: row.entered_at });
          eventsByCard.set(row.card_id, list);
        }
      }
      const cards: Array<{ cardId: string; kind: "build" | "research" | "explore"; name: string; leadMs: number | null; cycleMs: number | null; doneAt: number | null }> = [];
      for (const row of rows) {
        const doneAt = doneByCard.get(row.id) ?? null;
        if (doneAt === null) continue;
        if (since != null && doneAt < since) continue;
        if (until != null && doneAt > until) continue;
        const timeline = summarizeTimeline(eventsByCard.get(row.id) ?? [], { createdAt: row.created_at, endAt: doneAt });
        cards.push({ cardId: row.id, kind: normalizeKind(row.kind), name: row.name, leadMs: timeline.leadMs, cycleMs: timeline.cycleMs, doneAt });
      }
      const leads = summarizeDurations(cards.map((card) => card.leadMs));
      const cycles = summarizeDurations(cards.map((card) => card.cycleMs));
      // Present-state attention rides the same pass: stuck (blocked status
      // or errored worker — explicit signals, never heuristics) and
      // review-awaiting dones. Window-independent by design: attention is
      // about right now, and the UI labels it as such.
      const openRows = (projectId
        ? db.prepare("SELECT id, kind, display_name, name, status, activity FROM cards WHERE status != 'archived' AND project_id = ?").all(projectId)
        : db.prepare("SELECT id, kind, display_name, name, status, activity FROM cards WHERE status != 'archived'").all()) as Array<{ id: string; kind: string; display_name: string | null; name: string; status: string; activity: string }>;
      const attention: Array<{ cardId: string; kind: "build" | "research" | "explore"; name: string; reason: "stuck" | "review" }> = [];
      for (const row of openRows) {
        const name = row.display_name ?? row.name;
        if (row.status === "blocked" || row.activity === "error") {
          attention.push({ cardId: row.id, kind: normalizeKind(row.kind), name, reason: "stuck" });
        } else if (row.status === "completed" && hasPendingReview(db, row.id)) {
          attention.push({ cardId: row.id, kind: normalizeKind(row.kind), name, reason: "review" });
        }
      }
      return {
        items: cards,
        summary: { count: cards.length, leadP50Ms: leads.p50, leadP90Ms: leads.p90, cycleP50Ms: cycles.p50, cycleP90Ms: cycles.p90 },
        attention,
      };
    },
    async boardWorkflowDefaults() {
      const stored = await bb.storage.kv.get<unknown>("board-workflow-defaults");
      const parsed = boardWorkflowDefaultsSchema.safeParse(stored);
      if (!parsed.success) return { appetite: "Lean" as const, reviewMode: "Auto" as const, reviewGates: [] as Array<"spec" | "interface" | "scope" | "tech" | "diff"> };
      // Explicit migration, never a silent safeParse fallback: a stored
      // ladder string maps to its set, so a saved "Tech Review" default
      // survives instead of degrading to Auto.
      const record = stored as { reviewMode?: unknown; reviewGates?: unknown };
      const reviewGates = normalizeReviewGates(record.reviewGates ?? record.reviewMode ?? []) as Array<"spec" | "interface" | "scope" | "tech" | "diff">;
      return { appetite: parsed.data.appetite, reviewMode: legacyLabelForGates(reviewGates) ?? "Auto", reviewGates };
    },

    async approveGate({ projectId, workflowId, gate }) {
      // Resolve via the owning card first: the project-root board has no
      // stelow.json for exploratory work, so board-only lookup fails there.
      // dir_hash is unique per card, hence a reliable key for both modes.
      const owner = db.prepare("SELECT * FROM cards WHERE dir_hash = ?").get(workflowId) as CardRow | undefined;
      const board = owner
        ? await (async () => {
          const workspace = await cardWorkspace(owner);
          if (!workspace?.path) return { rootPath: null as string | null, workflows: [] as Workflow[], error: "Workspace is unavailable for this card." };
          return boardFromRoot(bb, workspace.path, owner.dir_hash);
        })()
        : await loadBoard(bb, projectId);
      const workflow = board.workflows.find((item) => item.id === workflowId);
      if (!board.rootPath || !workflow?.dirHash) return { approved: false, receiptPath: null, error: "Workflow directory metadata is unavailable." };
      const spec = GATES[gate];
      if (gate !== "diff-gate" && !workflow.artifacts.some((artifact) => artifact.kind === spec.artifact)) {
        return { approved: false, receiptPath: null, error: "The gate artifact does not exist yet." };
      }
      const receiptPath = `.stelow/approvals/${workflow.dirHash}/${spec.receipt}`;
      const absolute = join(board.rootPath, receiptPath);
      await bb.sdk.files.mkdir({ path: join(board.rootPath, `.stelow/approvals/${workflow.dirHash}`), rootPath: board.rootPath, recursive: true });
      const now = new Date().toISOString();
      const result = await bb.sdk.files.write({
        path: absolute,
        rootPath: board.rootPath,
        expectedSha256: null,
        content: `---\napproved: true\napproved_at: ${now}\napproved_via: bb-plugin-stelow\ngate: ${gate}\nworkflow: ${workflow.name}\n---\n`,
      });
      if (result.outcome === "conflict") return { approved: true, receiptPath, error: null };
      bb.realtime.publish("board-changed", { workflowId, gate });
      return { approved: true, receiptPath, error: null };
    },

    async answerQuestions({ cardId, answers }) {
      // Atomic batch answer: one worker continuation and one Inbox
      // reconciliation — no fragmented pings.
      const card = getCard(cardId);
      if (!card?.worker_thread_id) return { ok: false as const, answered: 0, error: "This card has no worker thread." };
      if (isArchivedCard(card)) return { ok: false as const, answered: 0, error: ERR_CARD_ARCHIVED };
      try {
        const list = await bb.sdk.threads.interactions.list({ threadId: card.worker_thread_id });
        const pendingById = new Map(pendingAsks(list).map((entry) => [entry.id, entry]));
        const questionText = new Map<string, string>();
        for (const entry of pendingById.values()) {
          for (const item of expandInteractionQuestions({ id: entry.id, title: entry.payload?.title, payload: entry.payload })) {
            questionText.set(item.questionId, item.question);
          }
        }
        const grouped = groupBatchAnswers(answers);
        const decisions: Array<{ question: string; answers: string[] }> = [];
        const answeredInteractionIds = new Set<string>();
        for (const [interactionId, value] of grouped) {
          if (!pendingById.has(interactionId)) continue;
          await bb.sdk.threads.interactions.respond({ threadId: card.worker_thread_id, interactionId, value: { answers: value.answers } });
          answeredInteractionIds.add(interactionId);
          if (value.kind === "single") {
            decisions.push({ question: questionText.get(interactionId) ?? "", answers: value.answers });
          } else {
            value.answers.forEach((slot, index) => {
              decisions.push({ question: questionText.get(`${interactionId}#${index}`) ?? "", answers: slot });
            });
          }
        }
        if (decisions.length === 0) return { ok: false as const, answered: 0, error: "No open question awaits an answer on this card." };
        // Split proposals answered on the card land here instead of the
        // blocking call above — one shared recording (lib/split-proposal).
        recordSplitAnswer(db, cardId, decisions);
        // A structured interaction resumes the waiting command but not a new
        // agent turn. Exactly one continuation for the whole batch.
        await bb.sdk.threads.send({ threadId: card.worker_thread_id, mode: "auto", input: [{ type: "text", text: formatBatchContinuation(decisions), mentions: [] }] });
        const unansweredIds = [...pendingById.keys()].filter((id) => !answeredInteractionIds.has(id));
        const openQuestionIds = [...unansweredIds, ...openExpiredQuestionIds(cardId)];
        // Name the answered ones BEFORE the sync: disappearance alone would
        // mislabel them superseded.
        markQuestionsAnswered(db, { cardId, interactionIds: [...answeredInteractionIds], occurredAt: now() });
        syncPendingQuestionInbox(card, openQuestionIds);
        // Contract provenance: answers that match a declared contract id
        // name it in the trail. Undeclared answers behave exactly as before.
        const contractNotes: string[] = [];
        for (const decision of decisions) {
          const matched = decision.question ? consumeAskContract(db, cardId, decision.question) : null;
          if (matched) contractNotes.push(`Q: ${decision.question}\nA: ${decision.answers.join(", ")} [contract: ${matched}]`);
        }
        if (contractNotes.length > 0) {
          logCardComment(cardId, "card", cardId, "user", `Answer to a pending question:\n\n${contractNotes.join("\n\n")}`);
        }
        // A fresh human answer resumes the worker: a stale provider error
        // from the interrupted turn must not linger as "Failed" beside the
        // recovery path. Failure history stays in the event log.
        updateCard(cardId, { activity: openQuestionIds.length > 0 ? "awaiting-answer" : "running", status: "in-progress", last_error: null });
        return { ok: true as const, answered: decisions.length, error: null };
      } catch (error) {
        return { ok: false as const, answered: 0, error: error instanceof Error ? error.message : "Unable to answer the questions." };
      }
    },

    async startWorkflow({ projectId, prompt }) {
      // delegation-site: worker-spawn
      const thread = await bb.sdk.threads.spawn({
        projectId,
        environment: { type: "project-default" },
        title: `Stelow: ${prompt.slice(0, 70)}`,
        prompt: `Use the stelow workflow to shape and execute this request. The Stelow workflow skills (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-*) are provided by bb-plugin-stelow — load them first. The product strategy playbooks (stelow-product-*) are also provided by this plugin \u2014 check \`bb skill list\` first, and only fetch via \`npx skills add calionauta/stelow\` if one is missing. Use \`bb stelow advance <stage>\` to change stages; do NOT hand-write stage transitions. Preserve every gate (product, interface, tech plan, diff). ${CLI_EQUIVALENTS}\n\nRequest:\n${prompt}`,
      });
      return { threadId: thread.id };
    },

    async ensureWorkflow({ projectId, name, intent }) {
      const rootPath = await projectRoot(bb, projectId);
      if (!rootPath) return { rootPath: null, statePath: null, error: "Project workspace path is unavailable." };
      const result = await seedWorkflow(bb, rootPath, workflowIdForName(name), name, intent);
      if (result.error) return { rootPath, statePath: null, error: result.error };
      bb.realtime.publish("board-changed", { reason: "seeded" });
      return { rootPath, statePath: result.statePath, error: null };
    },

    async listCards({ projectId, kind }) {
      const stmt = projectId && kind
        ? db.prepare("SELECT * FROM cards WHERE project_id = ? AND kind = ? ORDER BY updated_at DESC")
        : projectId
          ? db.prepare("SELECT * FROM cards WHERE project_id = ? ORDER BY updated_at DESC")
          : kind
            ? db.prepare("SELECT * FROM cards WHERE kind = ? ORDER BY updated_at DESC")
            : db.prepare("SELECT * FROM cards ORDER BY updated_at DESC");
      const rows = (projectId && kind ? stmt.all(projectId, kind) : projectId ? stmt.all(projectId) : kind ? stmt.all(kind) : stmt.all()) as CardRow[];
      const projectsList = await bb.sdk.projects.list();
      const projectMap = new Map(projectsList.map((project) => [project.id, project.name]));
      // One parse per card: stelow.json parsing is pure local IO, but a shared
      // workspace must never mean a shared summary.
      const scopeCache = new Map<string, { scopesTotal: number; scopesDone: number; tasksTotal: number; tasksDone: number; doingNow: string[] }>();
      const emptySummary = { scopesTotal: 0, scopesDone: 0, tasksTotal: 0, tasksDone: 0, doingNow: [] as string[] };
      async function scopeSummary(row: CardRow): Promise<typeof emptySummary> {
        try {
          const workspace = await cardWorkspace(row);
          if (!workspace?.path) return emptySummary;
          const cached = scopeCache.get(row.id);
          if (cached) return cached;
          const done = (status: string): boolean => ["done", "completed"].includes(status);
          const scopes = loadCardScopes(workspace.path, row.id);
          const summary = {
            scopesTotal: scopes.length,
            scopesDone: scopes.filter((scope) => done(scope.status)).length,
            tasksTotal: scopes.reduce((total, scope) => total + scope.tasks.length, 0),
            tasksDone: scopes.reduce((total, scope) => total + scope.tasks.filter((task) => done(task.status)).length, 0),
            doingNow: doingNowNames(scopes),
          };
          scopeCache.set(row.id, summary);
          return summary;
        } catch {
          return emptySummary;
        }
      }
      const enriched = await Promise.all(rows.map(async (row) => {
        let activity = row.activity as "idle" | "running" | "awaiting-answer" | "error";        if (activity !== "error" && row.worker_thread_id) {
          // A pending stelow ask interaction must surface regardless of whether
          // the thread currently reports running or idle: an ask parks the card
          // until answered, and idle (vs "waiting") is indistinguishable from a
          // prompt otherwise. Promote to awaiting-answer so the question shows.
          const pending = await fetchPendingQuestions(row.worker_thread_id);
          if (pending.length > 0 || openExpiredQuestionIds(row.id).length > 0) activity = "awaiting-answer";
        }
        // Unified attention signal: ONE flag answering "does this card need a
        // human right now?", plus the reason (kind) that decides the primary
        // action (answer / inspect / retake). A terminal completion is not a
        // request for human action; idle-stuck, question and error are.
        const termStatus = isClaimTerminal(row.status);
        // Idle-stuck uses last_idle_at when present (set on transition into
        // idle), falling back to updated_at as the idle-onset proxy so cards
        // without the timestamp still surface instead of staying invisible.
        const idleAt = (row.last_idle_at && row.last_idle_at > 0) ? row.last_idle_at : row.updated_at;
        const idleCandidate = activity === "idle"
          && row.worker_thread_id !== null
          && !termStatus
          && now() - idleAt >= IDLE_ATTENTION_MS;
        const idleStuck = idleCandidate;
        const questionPending = activity === "awaiting-answer";
        // A stale last_error on a terminal card is residue, not a request:
        // Done never asks for attention because of it.
        const errorPending = errorNeedsAttention(row.status, row.last_error, activity);
        const attentionKind = (idleStuck ? "idle" : questionPending ? "question" : errorPending ? "error" : null) as "question" | "error" | "idle" | null;
        const needsAttention = attentionKind !== null;
        const preset = getReliablePresetForBand(STAGE_TO_BAND[row.stage] ?? "analysis", row.id);
        return {
          id: row.id,
          name: row.name,
          displayName: row.display_name ?? row.name,
          prompt: row.prompt,
          intent: row.intent,
          projectId: row.project_id,
          projectName: row.workspace_kind === "exploratory" ? "Exploratory work" : (projectMap.get(row.project_id) ?? row.project_id),
          workspaceKind: row.workspace_kind,
          workspacePath: row.workspace_path,
          environmentLabel: row.environment_label ?? null,
          kind: normalizeKind(row.kind),
          researchStrategy: row.research_strategy,
          researchStrategies: strategyList(row),
          exploreStage: row.explore_stage ?? null,
          status: normalizeStatus(row.status),
          stage: row.stage,
          workerThreadId: row.worker_thread_id,
          activity,
          lastError: row.last_error,
          needsAttention,
          hasPendingReview: hasPendingReview(db, row.id),
          presetName: preset.name,
          presetProviderId: preset.provider_id,
          presetModelId: preset.model_id,
          updatedAt: row.updated_at,
          stallCount: stallCount(db, row.id),
          ...(await (async () => {
            const summary = await scopeSummary(row);
            return { scopeSummary: { scopesTotal: summary.scopesTotal, scopesDone: summary.scopesDone, tasksTotal: summary.tasksTotal, tasksDone: summary.tasksDone }, doingNow: summary.doingNow };
          })()),
        };
      }));
      return { cards: enriched };
    },

    async listNotifications({ includeArchived }) {
      const rows = listInboxEvents(db, includeArchived) as Array<InboxEventRow & { display_name: string | null; name: string; project_id: string; card_kind: string | null; resolved_at: number | null }>;
      const projects = await bb.sdk.projects.list();
      const projectNames = new Map(projects.map((project) => [project.id, project.name]));
      return {
        notifications: rows.map((row) => ({ id: row.id, cardId: row.card_id, cardName: row.display_name ?? row.name, projectName: projectNames.get(row.project_id) ?? row.project_id, cardKind: normalizeKind(row.card_kind), kind: row.kind, summary: row.summary, occurredAt: row.occurred_at, readAt: row.read_at, resolvedAt: row.resolved_at ?? null, resolvedReason: (["answered", "superseded", "resumed", "completed", "archived"] as const).includes(row.resolved_reason as never) ? row.resolved_reason as "answered" | "superseded" | "resumed" | "completed" | "archived" : null, archivedAt: row.archived_at, severity: row.severity ?? 1, severityReasons: parseSeverityReasons(row.severity_reasons) })),
      };
    },

    async markNotificationRead({ notificationId }) {
      const result = db.prepare("UPDATE inbox_events SET read_at = ? WHERE id = ? AND read_at IS NULL").run(now(), notificationId);
      if (result.changes > 0) bb.realtime.publish("inbox-changed", { notificationId });
      return { ok: result.changes > 0 };
    },

    async markCardNotificationsRead({ cardId, kind }) {
      // Viewing marks informational state seen (read), never resolved.
      // Only completions use this today: opening a Done card clears its
      // "new" badge while the entry stays in Recent updates. Action kinds
      // (question/error/paused) keep counting until resolved, no matter
      // how often the card is opened.
      if (kind !== "completed") return { marked: false };
      const result = db.prepare("UPDATE inbox_events SET read_at = ? WHERE card_id = ? AND kind = 'completed' AND read_at IS NULL AND archived_at IS NULL").run(now(), cardId);
      if (result.changes > 0) bb.realtime.publish("inbox-changed", { cardId });
      return { marked: result.changes > 0 };
    },

    async archiveNotification({ notificationId }) {
      const result = db.prepare("UPDATE inbox_events SET archived_at = ? WHERE id = ? AND archived_at IS NULL").run(now(), notificationId);
      if (result.changes > 0) bb.realtime.publish("inbox-changed", { notificationId });
      return { ok: result.changes > 0 };
    },

    async restoreNotification({ notificationId }) {
      const result = db.prepare("UPDATE inbox_events SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL").run(notificationId);
      if (result.changes > 0) bb.realtime.publish("inbox-changed", { notificationId });
      return { ok: result.changes > 0 };
    },

    async cardByWorkerThread({ threadId }) {
      const row = getCardByWorkerThread(threadId);
      if (!row) return { cardId: null, kind: null };
      // The thread→card relation outlives archiving: a stopped thread on an
      // archived card still answers "which card was this", so the thread
      // header keeps its way back. Card detail renders archived cards.
      return { cardId: row.id, kind: normalizeKind(row.kind) };
    },

    async getNotification({ notificationId, cardId }) {
      const row = db.prepare("SELECT id, kind, summary, occurred_at, resolved_at, resolved_reason, archived_at, severity, severity_reasons FROM inbox_events WHERE id = ? AND card_id = ?").get(notificationId, cardId) as Pick<InboxEventRow, "id" | "kind" | "summary" | "occurred_at" | "resolved_at" | "resolved_reason" | "archived_at" | "severity" | "severity_reasons"> | undefined;
      return { notification: row ? { id: row.id, kind: row.kind, summary: row.summary, occurredAt: row.occurred_at, resolvedAt: row.resolved_at, resolvedReason: (["answered", "superseded", "resumed", "completed", "archived"] as const).includes(row.resolved_reason as never) ? row.resolved_reason as "answered" | "superseded" | "resumed" | "completed" | "archived" : null, archivedAt: row.archived_at, severity: row.severity ?? 1, severityReasons: parseSeverityReasons(row.severity_reasons) } : null };
    },

    async readCardFile({ cardId, path }) {
      // Read-only artifact viewer backing: resolve strictly inside the card
      // workspace (never absolute escapes), cap output, refuse binaries.
      const card = getCard(cardId);
      if (!card) return { content: null, truncated: false, error: ERR_CARD_NOT_FOUND };
      const workspace = await cardWorkspace(card);
      if (!workspace?.path) return { content: null, truncated: false, error: ERR_WORKSPACE_UNAVAILABLE };
      const full = resolveArtifactPath(workspace.path, path)
        ?? (isAbsolute(path) && !path.split(/[\\/]+/).some((segment) => segment === "..") && relative(workspace.path, resolve(path)).split(/[\\/]+/)[0] !== ".." ? resolve(path) : null);
      if (!full) return { content: null, truncated: false, error: "Path escapes the workspace." };
      try {
        const file = await bb.sdk.files.read({ path: full });
        const text = typeof file.content === "string" ? file.content : null;
        if (text === null || text.includes("\0")) return { content: null, truncated: false, error: "Not a readable text file." };
        const LIMIT = 200_000;
        return { content: text.slice(0, LIMIT), truncated: text.length > LIMIT, error: null };
      } catch {
        return { content: null, truncated: false, error: "Could not read the file." };
      }
    },

    async createCard({ projectId, environment, prompt, attachments, intent, appetite, reviewMode, presetId, start, execution }) {
      return createCardInternal({ projectId, environment, prompt, attachments, intent, appetite, reviewMode, presetId, start, execution: execution ?? null });
    },

    async gapSummary({ cardId }) {
      // Build gap panel backing: resolved live from the matched execution
      // critique plus the stage-event ledger — counts, per-escalation
      // scope linkage, and lead/cycle time. No matched critique reads as
      // matched:false, never as zero gaps.
      const card = getCard(cardId);
      const empty = { matched: false, total: 0, fixed: 0, documented: 0, escalated: 0, items: [] as Array<{ description: string; scopeStatus: string | null }>, pendingScopes: 0, unscoped: 0, leadMs: null as number | null, cycleMs: null as number | null, done: false };
      if (!card) return empty;
      const events = stageEvents(cardId);
      const doneEvent = [...events].reverse().find((event) => event.stage === "done") ?? null;
      const endAt = doneEvent ? doneEvent.entered_at : now();
      const timeline = summarizeTimeline(events, { createdAt: card.created_at, endAt });
      const gapState = await critiqueGapState(card).catch(() => null);
      if (!gapState?.matched) {
        return { ...empty, leadMs: timeline.leadMs, cycleMs: timeline.cycleMs, done: card.status === "completed" };
      }
      const totals = gapState.totals;
      const items = gapState.escalated.map((gap) => {
        const scope = gapState.auditGapScopes.find((entry) => entry.gap === gap.description) ?? null;
        return { description: gap.description, scopeStatus: scope ? scope.status : null };
      });
      return {
        matched: true,
        total: totals.total,
        fixed: totals.fixed,
        documented: totals.documented,
        escalated: totals.escalated,
        items,
        pendingScopes: gapState.auditGapScopes.filter((scope) => !["done", "completed"].includes(scope.status)).length,
        unscoped: gapState.escalated.filter((gap) => !gapState.auditGapScopes.some((scope) => scope.gap === gap.description)).length,
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
      const unverified = { status: "unverified" as const, failures: [] as string[], evidence: null as string | null, label: null as string | null };
      const card = (cardId ? getCard(cardId) : null) ?? (threadId ? getCardByWorkerThread(threadId) ?? null : null);
      if (!card) return unverified;
      const workspace = await cardWorkspace(card).catch(() => null);
      if (!workspace?.path) return unverified;
      const full = resolveArtifactPath(workspace.path, path);
      const content = full ? await bb.sdk.files.read({ path: full }).then((f) => f.content).catch(() => null) : null;
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
          const result = validateVariant(content, contractForStrategy(primary.id));
          failures = result.pass ? [] : result.failures.map((failure) => failure.detail).slice(0, 3);
        } else {
          for (const entry of history) {
            const parsed = parseRoundPath(path, entry.id);
            if (parsed?.subskill) {
              matched = true;
              label = `${researchStrategyById(entry.id)?.label ?? entry.id} — ${parsed.subskill}`;
              const index = await readResearchIndex(card).catch(() => null);
              const indexBlob = index && index.ok === true && typeof index.content === "string" ? index.content : null;
              if (!isValidRoundContent(content, indexBlob)) {
                failures = ["missing, thin, or mirrors the index — rewrite it"];
              } else {
                failures = validateSubstep(parsed.subskill, content).failures.map((failure) => failure.detail).slice(0, 3);
              }
              break;
            }
          }
        }
        const index = await readResearchIndex(card).catch(() => null);
        if (index && index.ok === true && typeof index.content === "string") evidence = evidenceStatus(index.content);
      } else if (card.kind === "explore") {
        if (path.endsWith(exploreArtifactFile(card.explore_stage ?? ""))) {
          matched = true;
          label = techniqueById(card.explore_stage ?? "")?.label ?? card.explore_stage;
          if (!isValidExploreContent(content)) {
            failures = ["missing or thin — write the stage deliverable"];
          } else {
            failures = validateExplore(card.explore_stage ?? "", content).failures.map((failure) => failure.detail).slice(0, 3);
          }
        }
      } else {
        const contract = contractForBuildArtifact(path, content);
        if (contract) {
          matched = true;
          label = contract.id;
          const result = validateArtifact(content, contract);
          failures = result.pass ? [] : result.failures.map((failure) => failure.detail).slice(0, 3);
        }
      }
      if (!matched) return unverified;
      return { status: sealStatus(failures.length === 0 ? { pass: true } : { pass: false }, evidence ?? "verified"), failures, evidence, label };
    },

    async cardDetail({ cardId }) {
      const initial = getCard(cardId);
      if (!initial) throw new Error(ERR_CARD_NOT_FOUND);
      // Reconcile with the live thread before reading: a worker stopped from
      // outside (or a missed transition) would otherwise render stale until
      // the next reconcile sweep.
      if (initial.worker_thread_id) await syncThreadState(cardId).catch(() => undefined);
      const card = getCard(cardId);
      if (!card) throw new Error(ERR_CARD_NOT_FOUND);
      const comments = db.prepare("SELECT * FROM comments WHERE card_id = ? ORDER BY created_at ASC").all(cardId) as CommentRow[];
      const pending = await fetchPendingQuestions(card.worker_thread_id);
      const expiredRows = db.prepare("SELECT * FROM expired_questions WHERE card_id = ? AND answered = 0 ORDER BY expired_at DESC").all(cardId) as Array<{ id: string; question: string; multiple: number; kind: string; locale: string | null; options: string; expired_at: number }>;
      const expiredQuestions: Awaited<ReturnType<typeof rpcContract.cardDetail.output.parse>>["expiredQuestions"] = [];
      for (const row of expiredRows) {
        let parsed: unknown = null;
        try { parsed = JSON.parse(row.options); } catch { parsed = null; }
        const storedOptions = cleanOptions(parsed);
        const options = await resolveAskOptions(card, storedOptions);
        expiredQuestions.push({ id: row.id, question: row.question, multiple: Boolean(row.multiple), kind: row.kind === "split" ? "split" : "standard", options, expiredAt: row.expired_at });
      }
      let projectName = card.project_id;
      const workspace = await cardWorkspace(card);
      let sourcePath: string | null = workspace?.path ?? null;
      let sourceHostId: string | null = workspace?.hostId ?? null;
      if (card.workspace_kind === "project") {
        try { projectName = (await bb.sdk.projects.get({ projectId: card.project_id })).name; } catch { /* project removed; keep card viewable */ }
      }
      const mentionedFiles = (await detectMentionedFiles(bb, sourcePath, card.prompt)).flatMap((file) => sourceHostId ? [{ ...file, hostId: sourceHostId, relPath: sourcePath ? workspaceRelative(sourcePath, file.absolutePath) ?? (isAbsolute(file.path) ? null : file.path) : null }] : []);
      const attachments = cardAttachments(card.attachments).map((attachment) => {
        const absolute = sourcePath ? (isAbsolute(attachment.path) ? attachment.path : join(sourcePath, attachment.path)) : attachment.path;
        return {
          ...attachment,
          display: workspaceRelative(sourcePath ?? "", attachment.path) ?? basename(attachment.path),
          relPath: sourcePath ? workspaceRelative(sourcePath, absolute) : null,
          absolutePath: absolute,
          hostId: sourceHostId,
        };
      });
      // Environment backing the worker thread's worktree. A recovered
      // exploratory card is the exception: its original worker environment
      // can be gone while its user-confirmed checkout remains readable on the
      // host. Do not send the client to that stale environment (which yields a
      // 404 for an otherwise listed artifact); host links are the honest
      // read-only target until the card has a live BB workspace again.
      const hasRecoveryCheckout = card.workspace_kind === "exploratory" && Boolean(
        db.prepare("SELECT 1 FROM workspace_recoveries WHERE card_id = ?").get(cardId),
      );
      const fileEnvironmentId = !hasRecoveryCheckout && card.worker_thread_id
        ? await bb.sdk.threads.get({ threadId: card.worker_thread_id }).then((thread) => {
          const environmentId = (thread as { environmentId?: unknown }).environmentId;
          return typeof environmentId === "string" && environmentId ? environmentId : null;
        }).catch(() => null)
        : null;
      const nextStages = parseNextStages(sourcePath, card.stage);
      const scopes = loadCardScopes(sourcePath, card.id);
      const preset = getReliablePresetForBand(card.kind === "research" ? "research" : card.kind === "explore" ? "explore" : STAGE_TO_BAND[card.stage] ?? "analysis", card.id);
      // The helper owns the typed artifact manifest. Its stage is the durable
      // producer attribution rendered beside the workflow timeline.
      const artifacts = await (async () => {
        if (!sourcePath) return [];
        let stateDir: string | null = null;
        const stateBlob = await (async () => {
          if (card.dir_hash) {
            stateDir = await workflowStateDir(bb, sourcePath, card.id, card.dir_hash);
            if (stateDir) return await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((f) => f.content).catch(() => null);
            return null;
          }
          return await bb.sdk.files.read({ path: join(sourcePath, "state.md") }).then((f) => f.content).catch(() => null);
        })();
        if (!stateBlob) return [];
        const list: Array<{ stage: string; kind: string; path: string; display: string; generatedAt: string; absolutePath: string; hostId: string; note: string | null }> = [];
        const seen = new Set<string>();
        for (const fields of parseArtifactManifest(stateBlob)) {
          const stage = fields.stage;
          const relPath = fields.path;
          if (!stage || !relPath) continue;
          // Artifact manifests are agent-produced input. Resolve only a strict
          // project-relative path; absolute paths and traversal are rejected.
          const full = resolveArtifactPath(sourcePath, relPath);
          if (!full) continue;
          const artifact = await bb.sdk.files.read({ path: full }).catch(() => null);
          if (artifact && isPublishableArtifactContent(artifact.content) && sourceHostId) list.push({ stage, kind: fields.kind ?? "document", path: relPath, display: fields.label ?? basename(full), generatedAt: fileTimestamp(artifact, new Date(card.updated_at).toISOString()), absolutePath: full, hostId: sourceHostId, note: auditReceiptNote(full) });
          if (full) seen.add(full);
        }
        // The audit trail must not depend on an agent remembering to declare
        // its own output. Every other document the workflow wrote is listed
        // too, in its own group, so a produced artifact can never be invisible
        // just because it was never registered. Precedent for `.md` is
        // findArtifacts (the board); the workflow's own state is not an
        // artifact and stays out.
        const stateRoot = stateDir;
        if (stateRoot && sourceHostId) {
          // Explicit, generous limit: the default is small and a truncated
          // listing would hide produced documents, which is the one thing this
          // listing exists to prevent.
          const listing = await bb.sdk.files.listPaths({ path: stateRoot, includeFiles: true, includeDirectories: false, limit: 500 }).catch(() => null);
          // The listing's path shape is not contractual: it may come back
          // absolute (under the project or the state dir) or relative to the
          // state dir, with or without a leading slash. Resolve every shape
          // before reading, so a produced document is never dropped because of
          // a path form we failed to recognize.
          const absolutePaths = array(record(listing).paths)
            .map((entry) => (typeof entry === "string" ? entry : text(record(entry).path)))
            .filter(Boolean)
            .map((raw) => raw === stateRoot || raw.startsWith(`${stateRoot}/`)
              ? raw
              : raw === sourcePath || raw.startsWith(`${sourcePath}/`)
                ? raw
                : join(stateRoot, raw.replace(/^\/+/, "")));
          for (const absolute of unregisteredArtifactPaths(absolutePaths, [...seen])) {
            const relPath = workspaceRelative(sourcePath, absolute);
            if (!relPath) continue;
            const artifact = await bb.sdk.files.read({ path: absolute }).catch(() => null);
            if (!artifact || !isPublishableArtifactContent(artifact.content)) continue;
            // The portable receipt is Audit evidence, not stray output: it is
            // listed under the stage whose audit produced it.
            const isTrail = basename(absolute) === AUDIT_TRAIL_FILE;
            list.push({ stage: isTrail ? "audit" : "unregistered", kind: isTrail ? "audit-trail" : "unregistered", path: relPath, display: basename(absolute), generatedAt: fileTimestamp(artifact, new Date(card.updated_at).toISOString()), absolutePath: absolute, hostId: sourceHostId, note: auditReceiptNote(absolute) });
            seen.add(absolute);
          }
        }
        return list;
      })();
      // Surface pending stelow ask interactions regardless of the stored activity:
      // an ask parks the card awaiting an answer even when the thread is idle.
      const effectiveActivity = (card.activity === "error" ? "error" : pending.length > 0 || expiredQuestions.length > 0 ? "awaiting-answer" : card.activity as "idle" | "running" | "awaiting-answer" | "error");
      const termStatus = isClaimTerminal(card.status);
      const idleAt = (card.last_idle_at && card.last_idle_at > 0) ? card.last_idle_at : card.updated_at;
      const idleCandidate = effectiveActivity === "idle"
        && card.worker_thread_id !== null
        && !termStatus
        && now() - idleAt >= IDLE_ATTENTION_MS;
      const idleStuck = idleCandidate;
      const attentionKind = (idleStuck ? "idle"
        : effectiveActivity === "awaiting-answer" ? "question"
        : errorNeedsAttention(card.status, card.last_error, effectiveActivity) ? "error"
        : null) as "question" | "error" | "idle" | null;
      // Worker ledger, newest first. The open row (endedAt null) is the live
      // worker; older rows are archived threads replaced along the way.
      const workerRows = db.prepare("SELECT card_threads.thread_id, card_threads.preset_id, presets.name AS preset_name, card_threads.started_at, card_threads.ended_at, card_threads.ended_reason FROM card_threads LEFT JOIN presets ON presets.id = card_threads.preset_id WHERE card_threads.card_id = ? ORDER BY card_threads.started_at DESC LIMIT 6").all(cardId) as Array<{ thread_id: string; preset_id: string | null; preset_name: string | null; started_at: number; ended_at: number | null; ended_reason: string | null }>;
      const workerHistory = await Promise.all(workerRows.map(async (row) => {
        const report = await workerTokenReport(row.thread_id);
        return {
          threadId: row.thread_id, presetName: row.preset_name, startedAt: row.started_at,
          endedAt: row.ended_at, endedReason: row.ended_reason,
          tokenUsage: report.total,
          tokenBreakdown: report.breakdown,
          children: await workerChildThreads(row.thread_id),
        };
      }));
      // Imported-issue link for the Done-card write-back affordance. The URL
      // is deterministic (github.com/<repo>/issues/<number>), so no extra
      // GitHub round-trip is needed to render it.
      const githubRow = db.prepare("SELECT repo, number, commented_at FROM github_imports WHERE card_id = ?").get(cardId) as { repo: string; number: number; commented_at: number | null } | undefined;
      const githubLink = githubRow ? { repo: githubRow.repo, number: githubRow.number, url: `https://github.com/${githubRow.repo}/issues/${githubRow.number}`, postedAt: githubRow.commented_at ?? null } : null;
      // Workflow config for the skip model: review gates/appetite live in
      // the card's own state.md (seeded at creation, same source the
      // worker reads). Parsed through the shared helper (indented
      // `config:` block, no truncation) — missing state or fields fail
      // open to Lean/Auto, and unknown modes/intents yield no skips,
      // never invented ones. Skips resolve from the explicit set.
      const workflowConfig = await (async () => {
        const fallback = { appetite: "Lean", reviewMode: "Auto", reviewGates: [] as string[] };
        try {
          if (!sourcePath || !card.dir_hash) return fallback;
          const stateDir = await workflowStateDir(bb, sourcePath, card.id, card.dir_hash).catch(() => null);
          if (!stateDir) return fallback;
          const content = await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((f) => f.content).catch(() => null);
          if (typeof content !== "string") return fallback;
          return parseWorkflowConfig(content);
        } catch { return fallback; }
      })();
      const stageSkips = skippedStages({ kind: normalizeKind(card.kind), intent: card.intent, reviewMode: workflowConfig.reviewMode, reviewGates: workflowConfig.reviewGates, sequence: STAGE_SEQUENCE });
      // Split affordance from the shared rule. Stage is the DB value, just
      // converged with state.md by syncThreadState above — the trigger RPC
      // re-resolves the slug itself before acting, so this flag never moves
      // a card, it only decides whether to offer the button.
      const splitOpen = db.prepare("SELECT 1 FROM split_proposals WHERE card_id = ? AND selected IS NULL").get(cardId);
      const splitAction = splitActionState({
        kind: normalizeKind(card.kind),
        stage: card.stage,
        status: normalizeStatus(card.status),
        archived: isArchivedCard(card),
        openProposal: Boolean(splitOpen),
        openQuestions: pending.length + expiredQuestions.length,
        hasWorker: card.worker_thread_id !== null,
      });
      // Staleness notices, computed on read: each questioned document against
      // its ask-time baseline. Advisory only — questions stay answerable.
      const questionStaleness = await stalenessForQuestions(cardId, [...pending, ...expiredQuestions]);
      const withStaleness = <T extends { id: string }>(questions: T[]): (T & { staleness: { docRevised: boolean; docRemoved: boolean; checkoutMoved: boolean; commitCount: number; touchedPaths: string[] } | null })[] =>
        questions.map((question) => ({ ...question, staleness: questionStaleness.get(question.id) ?? null }));
      return {
        card: { id: card.id, name: card.name, displayName: card.display_name ?? card.name, prompt: card.prompt, intent: card.intent, projectId: card.project_id, projectName: card.workspace_kind === "exploratory" ? "Exploratory work" : projectName, workspaceKind: card.workspace_kind, workspacePath: card.workspace_path, environmentLabel: card.environment_label ?? null, kind: normalizeKind(card.kind), researchStrategy: card.research_strategy, researchStrategies: strategyList(card), exploreStage: card.explore_stage ?? null, status: normalizeStatus(card.status), stage: card.stage, workerThreadId: card.worker_thread_id, activity: effectiveActivity, lastError: card.last_error, needsAttention: attentionKind !== null, hasPendingReview: hasPendingReview(db, cardId), presetName: preset.name, presetProviderId: preset.provider_id, presetModelId: preset.model_id, presetOverridden: (db.prepare("SELECT preset_id FROM card_presets WHERE card_id = ?").get(cardId) as { preset_id: string } | undefined)?.preset_id != null, updatedAt: card.updated_at, stallCount: stallCount(db, cardId), scopeSummary: { scopesTotal: scopes.length, scopesDone: scopes.filter((scope) => ["done", "completed"].includes(scope.status)).length, tasksTotal: scopes.reduce((total, scope) => total + scope.tasks.length, 0), tasksDone: scopes.reduce((total, scope) => total + scope.tasks.filter((task) => ["done", "completed"].includes(task.status)).length, 0) }, presetId: preset.id, workerPresetId: card.worker_preset_id, presetRestartPending: (card.preset_restart_pending ?? 0) === 1, leadMs: flowTimesForCard(card).leadMs, cycleMs: flowTimesForCard(card).cycleMs, doingNow: doingNowNames(scopes) },
        attachments,
        mentionedFiles,
        scopes,
        comments: comments.map(({ id, target, target_id, author, body, created_at }) => ({ id, target: target as "card" | "scope" | "task", targetId: target_id, author: author as "user" | "agent", body, createdAt: created_at })),
        pendingQuestions: withStaleness(pending),
        expiredQuestions: withStaleness(expiredQuestions),
        splitAction,
        stageSkips,
        artifacts,
        workerHistory,
        fileEnvironmentId,
        nextStages,
        githubLink,
      };
    },

    async updateCardIntent({ cardId, intent }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, error: ERR_CARD_NOT_FOUND };
      if (!canEditWorkflowIntent(card)) return { ok: false, error: card.kind !== "build" ? "Only Build cards use a workflow type." : "This workflow has already left triage. Reclassify it from Card actions to restart from triage." };
      const ts = now();
      db.prepare("UPDATE cards SET intent = ?, updated_at = ? WHERE id = ?").run(intent, ts, cardId);
      // Keep state.md intent in sync so the agent sees the corrected intent.
      try {
        const workspace = await cardWorkspace(card);
        if (workspace?.path) {
          const stateDir = card.dir_hash ? await workflowStateDir(bb, workspace.path, card.id, card.dir_hash) : null;
          if (card.dir_hash && !stateDir) return { ok: false, error: "Workflow state ownership cannot be verified. Reseed this card before changing its workflow type." };
          const statePath = stateDir ? join(stateDir, "state.md") : join(workspace.path, "state.md");
          const existing = await bb.sdk.files.read({ path: statePath }).catch(() => null);
          if (existing) {
            await bb.sdk.files.write({ path: statePath, content: existing.content.replace(/^intent:.*$/m, `intent: ${intent}`) });
          }
        }
      } catch { /* state.md sync is best-effort */ }
      bb.realtime.publish("card-state", { cardId });
      return { ok: true, error: null };
    },

    async renameCard({ cardId, name }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, error: ERR_CARD_NOT_FOUND };
      // Blank restores the prompt-derived heuristic instead of refusing —
      // a title must always resolve to something readable.
      const next = name.trim().slice(0, 120) || heuristicDisplayName(card.prompt, card.name);
      const ts = now();
      db.prepare("UPDATE cards SET display_name = ?, updated_at = ? WHERE id = ?").run(next, ts, cardId);
      bb.realtime.publish("card-state", { cardId });
      return { ok: true, error: null };
    },

    async addCardComment({ cardId, target, targetId, body }) {
      const card = getCard(cardId);
      if (!card) return { commentId: "", error: ERR_CARD_NOT_FOUND };
      if (isArchivedCard(card)) return { commentId: "", error: ERR_CARD_ARCHIVED };
      const commentId = logCardComment(cardId, target, targetId, "user", body);
      if (target === "card" && card.worker_thread_id) {
        try {
          await bb.sdk.threads.send({ threadId: card.worker_thread_id, mode: "auto", input: [{ type: "text", text: `User comment on card "${card.name}":\n\n${body}`, mentions: [] }] });
          const resume = statusForNewCardWork({ kind: card.kind, status: card.status, stage: card.stage });
          updateCard(cardId, { activity: "running", status: resume.status as CardRow["status"] });
        } catch (error) {
          return { commentId, error: error instanceof Error ? error.message : "Failed to route comment to worker thread." };
        }
      }
      bb.realtime.publish("card-state", { cardId });
      return { commentId, error: null };
    },

    async cancelCard({ cardId }) {
      const card = getCard(cardId);
      if (!card) return { archived: false };
      await stopWorkerThread(card.worker_thread_id);
      updateCard(cardId, { status: "archived", activity: "idle" });
      await releaseCardClaimsAndNotify(cardId);
      bb.realtime.publish("card-state", { cardId });
      bb.realtime.publish("board-changed", { cardId });
      return { archived: true };
    },

    async deleteCard({ cardId }) {
      // Hard delete is terminal hygiene, not a workflow move: only archived
      // cards qualify (archive stays the reversible exit; delete is the
      // deliberate erasure). Foreign keys are declared but not enforced by
      // the driver, so child rows are removed explicitly.
      const card = getCard(cardId);
      if (!card) return { deleted: false, error: ERR_CARD_NOT_FOUND };
      if (card.status !== "archived") return { deleted: false, error: "Only archived cards can be deleted. Archive it first." };
      await stopWorkerThread(card.worker_thread_id);
      await releaseCardClaimsAndNotify(cardId);
      // Files follow the row: the card's workflow state dir (.stelow run
      // artifacts) is removed too, or orphaned runs pile up on disk.
      // Git checkouts are never touched — committed and uncommitted code
      // changes survive the delete; only Stelow's own bookkeeping goes.
      // workflowStateDir returns a path only for state this card owns.
      try {
        const workspace = await cardWorkspace(card).catch(() => null);
        const stateDir = workspace?.path && card.dir_hash
          ? await workflowStateDir(bb, workspace.path, card.id, card.dir_hash).catch(() => null)
          : null;
        if (stateDir) rmSync(stateDir, { recursive: true, force: true });
      } catch { /* bookkeeping rows below still delete */ }
      db.prepare("DELETE FROM comments WHERE card_id = ?").run(cardId);
      db.prepare("DELETE FROM card_presets WHERE card_id = ?").run(cardId);
      db.prepare("DELETE FROM expired_questions WHERE card_id = ?").run(cardId);
      db.prepare("DELETE FROM ask_contracts WHERE card_id = ?").run(cardId);
      db.prepare("DELETE FROM inbox_events WHERE card_id = ?").run(cardId);
      db.prepare("DELETE FROM card_threads WHERE card_id = ?").run(cardId);
      db.prepare("UPDATE github_imports SET card_id = NULL WHERE card_id = ?").run(cardId);
      db.prepare("DELETE FROM cards WHERE id = ?").run(cardId);
      bb.realtime.publish("card-state", { cardId });
      bb.realtime.publish("board-changed", { cardId });
      return { deleted: true, error: null };
    },

    async discardPreview({ cardId }) {
      const empty = { eligible: false, action: null as "worktree-drop" | "branch-reset" | "dir-delete" | null, reason: null as string | null, branch: null as string | null, files: [] as string[], fileCount: 0, commitCount: 0, sharedWith: 0, confirmTitle: null as string | null, confirmBody: null as string | null, error: null as string | null };
      const card = getCard(cardId);
      if (!card) return { ...empty, error: ERR_CARD_NOT_FOUND };
      const evidence = await discardEvidence(card);
      const decision = discardEligibility(evidence);
      if (!decision.eligible || !decision.action) return { ...empty, reason: decision.reason, branch: evidence.branch };
      const copy = discardConfirm(evidence, decision.action);
      const files = [...evidence.changed, ...evidence.untracked];
      return { eligible: true, action: decision.action, reason: null, branch: evidence.branch, files: files.slice(0, 50), fileCount: files.length, commitCount: evidence.unpushedCommits, sharedWith: evidence.sharedWith, confirmTitle: copy.title, confirmBody: copy.body, error: null };
    },
    async discardCardChanges({ cardId }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, summary: null, error: ERR_CARD_NOT_FOUND };
      if (card.status === "completed" || card.status === "blocked") return { ok: false, summary: null, error: "Completed work is history — reset it by hand." };
      const evidence = await discardEvidence(card);
      const decision = discardEligibility(evidence);
      if (!decision.eligible || !decision.action) return { ok: false, summary: null, error: decision.reason ?? "Nothing safe to discard." };
      // Stop first: discarding under a live worker races its next write.
      await stopWorkerThread(card.worker_thread_id);
      // Re-validate after the stop landed: a push, a cleanup, or a delete
      // may have changed the checkout under this discard.
      const live = getCard(cardId);
      if (!live) return { ok: false, summary: null, error: ERR_CARD_NOT_FOUND };
      const fresh = await discardEvidence(live);
      const confirm = discardEligibility(fresh);
      if (!confirm.eligible || confirm.action !== decision.action) {
        return { ok: false, summary: null, error: confirm.reason ?? "The checkout changed under this discard — review it again." };
      }
      if ((decision.action === "worktree-drop" || decision.action === "branch-reset") && !fresh.branch) {
        return { ok: false, summary: null, error: "The checkout lost its branch mid-discard — review it by hand." };
      }
      if (decision.action === "branch-reset" && !fresh.resetTarget) {
        return { ok: false, summary: null, error: "No safe reset point could be determined — reset it by hand." };
      }
      try {
        if (decision.action === "dir-delete") {
          const target = fresh.checkoutPath ?? "";
          if (target !== EXPLORATORY_SCOPE && !target.startsWith(`${EXPLORATORY_SCOPE}/`)) {
            throw new Error("Refusing to delete outside the exploratory scope.");
          }
          rmSync(target, { recursive: true, force: true });
          if (existsSync(target)) throw new Error("The folder survived deletion.");
        } else if (decision.action === "worktree-drop") {
          const common = await runGitIn(fresh.checkoutPath ?? "", ["rev-parse", "--git-common-dir"]);
          const mainDir = common.ok && common.stdout.trim() ? common.stdout.trim() : "";
          const mainAbs = mainDir ? (isAbsolute(mainDir) ? mainDir : nodeJoin(fresh.checkoutPath ?? "", mainDir)) : "";
          if (!mainAbs) throw new Error("Cannot locate the main checkout.");
          // Best-effort: a locked worktree refuses removal until unlocked.
          await runGitIn(mainAbs, ["worktree", "unlock", fresh.checkoutPath ?? ""]);
          const removed = await runGitIn(mainAbs, ["worktree", "remove", "--force", fresh.checkoutPath ?? ""]);
          if (!removed.ok) throw new Error("Could not remove the worktree.");
          const pruned = await runGitIn(mainAbs, ["branch", "-D", fresh.branch ?? ""]);
          if (!pruned.ok) throw new Error("Worktree removed, but the branch survived — delete it by hand.");
          if (fresh.checkoutPath && existsSync(fresh.checkoutPath)) throw new Error("The worktree folder survived removal.");
        } else {
          const reset = await runGitIn(fresh.checkoutPath ?? "", ["reset", "--hard", fresh.resetTarget ?? ""]);
          if (!reset.ok) throw new Error("Could not reset the branch.");
          const cleaned = await runGitIn(fresh.checkoutPath ?? "", ["clean", "-fd"]);
          if (!cleaned.ok) throw new Error("Branch reset, but untracked files survived — remove them by hand.");
          const verify = await runGitIn(fresh.checkoutPath ?? "", ["status", "--porcelain=v1", "--untracked-files=all"]);
          if (!verify.ok || verify.stdout.trim()) throw new Error("The checkout is not clean after discard — review it by hand.");
        }
      } catch (error) {
        return { ok: false, summary: null, error: error instanceof Error ? error.message : "Discard failed midway — review the checkout by hand." };
      }
      const summary = discardTrail(decision.action, fresh);
      logCardComment(cardId, "card", cardId, "agent", summary);
      if (!isArchivedCard(live)) updateCard(cardId, { status: "archived", activity: "idle" });
      bb.realtime.publish("card-state", { cardId });
      bb.realtime.publish("board-changed", { cardId });
      return { ok: true, summary, error: null };
    },

    async retryWorker({ cardId }) {
      // First-line recovery for stuck workers (error OR idle with nothing
      // pending): the plugin SDK exposes no thread-retry, but delivering a
      // message starts a new turn — exactly what typing into the thread does.
      // Non-destructive: same worker, same state dir. Reseed stays available
      // for cases where the worker itself is broken.
      const card = getCard(cardId);
      if (!card?.worker_thread_id) return { ok: false, error: "This card has no worker thread." };
      if (card.status === "archived") return { ok: false, error: ERR_CARD_ARCHIVED };
      // Done is terminal for Retry too: reopening happens through a card
      // comment (statusForNewCardWork) or a fresh restart, never by nudging
      // the finished worker back to running behind Done's back.
      if (card.status === "completed" || card.status === "blocked") return { ok: false, error: "This card is completed — comment on it to reopen, or restart fresh." };
      // Research workers never advance stages: a build-flavored nudge
      // would instruct them to run a machine that does not exist here.
      const nudge = card.kind === "research"
        ? `Continue the Stelow research now. Re-read your research-index.md first, then keep researching with the strategy playbook. If a question is already pending on the card, do NOT re-ask it — the answer arrives here on its own. But if you genuinely need NEW input from the user that was never asked, ask it now via bb stelow ask; silence is not progress. NEVER run \`bb stelow advance\` — research has no stages. When the index is complete with ranked opportunities, STOP and end your turn. If a \`bb stelow\` command fails, read its stderr once and continue — do NOT spend the turn debugging the CLI; report the exact error and move on.`
        : card.kind === "explore"
          ? `Continue the Stelow explore task now. Re-read your explore artifact and the stage skill, then keep working on the stage deliverable. If a question is already pending on the card, do NOT re-ask it — the answer arrives here on its own. But if the stage genuinely needs NEW input from the user that was never asked, ask it now via bb stelow ask; silence is not progress. NEVER run \`bb stelow advance\` — explore has no stages. When the stage deliverable is complete, STOP and end your turn. If a \`bb stelow\` command fails, read its stderr once and continue — do NOT spend the turn debugging the CLI; report the exact error and move on.`
          : buildContinueNudge();
      try {
        await bb.sdk.threads.send({ threadId: card.worker_thread_id, mode: "auto", input: [{ type: "text", text: nudge, mentions: [] }] });
        // A manual resume is a fresh human verdict that the worker should be
        // working: reset the auto-continue budget with it, or the next fresh
        // stop would fall straight through to paused on an exhausted budget.
        const retryReset = resetAutoContinue();
        updateCard(cardId, { activity: "running", last_error: null, auto_continue_count: retryReset.count, auto_continue_stage: retryReset.stage });
        bb.realtime.publish("card-state", { cardId });
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Could not reach the worker thread." };
      }
    },

    async startWorker({ cardId }) {
      return spawnFreshWorker(cardId, "start");
    },

    async restartWorker({ cardId }) {
      // Applies a pending preset change (or escapes a broken worker) by
      // spawning a FRESH worker on the same state dir that CONTINUES from the
      // current stage — unlike reseed (restarts triage) and retry (same
      // thread, same model: provider/model are fixed at spawn and can never
      // change on a live thread). Uses the override-aware effective preset.
      return spawnFreshWorker(cardId, "restart");
    },

    async requestSplitProposal({ cardId }) {
      // Human trigger for the split protocol: the user, not the worker,
      // decides a proposal is wanted. Decided by the shared splitActionState
      // (lib/split-proposal) — the same rule the card UI reads — so the
      // button can never promise what `bb stelow split` would refuse. Stage
      // is slug truth (state.md), never the DB cache.
      const card = getCard(cardId);
      if (!card) return { ok: false, error: ERR_CARD_NOT_FOUND };
      if (isArchivedCard(card)) return { ok: false, error: ERR_CARD_ARCHIVED };
      if (!card.worker_thread_id) return { ok: false, error: "This card has no worker thread." };
      const open = db.prepare("SELECT 1 FROM split_proposals WHERE card_id = ? AND selected IS NULL").get(cardId);
      // Live read returns null on failure (unknown, not proof of absence):
      // fail open here, the ask-time questionGuard stays the backstop.
      const live = await fetchPendingAsks(card.worker_thread_id) ?? [];
      const action = splitActionState({
        kind: card.kind,
        stage: await cardStageSlug(card),
        status: card.status,
        archived: false,
        openProposal: Boolean(open),
        openQuestions: live.length + openExpiredQuestionIds(cardId).length,
        hasWorker: card.worker_thread_id !== null,
      });
      if (!action.ok) return { ok: false, error: action.reason ?? "A split cannot be proposed on this card right now." };
      try {
        await bb.sdk.threads.send({ threadId: card.worker_thread_id, mode: "auto", input: [{ type: "text", text: SPLIT_REQUEST_NUDGE, mentions: [] }] });
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Could not reach the worker thread." };
      }
      logCardComment(cardId, "card", cardId, "agent", "Split proposal requested — the worker will ask with --tag split.");
      bb.realtime.publish("card-state", { cardId });
      return { ok: true, error: null };
    },

    async reseedCard({ cardId, presetId, intent: requestedIntent }) {
      const card = getCard(cardId);
      if (!card) return { reseeded: false, error: ERR_CARD_NOT_FOUND, reclassified: false };
      if (isArchivedCard(card)) return { reseeded: false, error: ERR_CARD_ARCHIVED, reclassified: false };
      const intentDecision = resolveReseedIntent(card, requestedIntent);
      if (!intentDecision) return { reseeded: false, error: "Only Build cards use a workflow type.", reclassified: false };
      const { intent, reclassified } = intentDecision;
      const workspace = await cardWorkspace(card);
      const source = workspace?.hostId && workspace.path ? { path: workspace.path, hostId: workspace.hostId } : null;
      if (!source) return { reseeded: false, error: `${ERR_WORKSPACE_UNAVAILABLE} Archive this card to remove it.`, reclassified: false };
      // Re-seed into a fresh per-workflow dir so the card gets a clean state file.
      // A reseed restarts the workflow, not the human's review choices: the
      // card's current appetite and gate set carry over instead of the
      // hardcoded Core/Auto.
      const currentConfig = await (async () => {
        try {
          if (!card.dir_hash) return null;
          const stateDir = await workflowStateDir(bb, source.path, card.id, card.dir_hash).catch(() => null);
          if (!stateDir) return null;
          const content = await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((f) => f.content).catch(() => null);
          if (typeof content !== "string") return null;
          return parseWorkflowConfig(content);
        } catch { return null; }
      })();
      const seed = await seedWorkflow(bb, source.path, card.id, card.name, intent, currentConfig?.appetite ?? "Core", currentConfig?.reviewGates ?? [], true);
      if (seed.error) return { reseeded: false, error: seed.error, reclassified: false };
      if (seed.dirHash) {
        db.prepare("UPDATE cards SET dir_hash = ?, updated_at = ? WHERE id = ?").run(seed.dirHash, now(), cardId);
        // A fresh workflow is a fresh episode: stale declarations must not
        // attribute future answers to the previous attempt's contracts.
        db.prepare("DELETE FROM ask_contracts WHERE card_id = ?").run(cardId);
      }
      let preset: PresetRow;
      if (presetId) {
        const found = getPresetById(presetId);
        if (!found) return { reseeded: false, error: ERR_PRESET_NOT_FOUND, reclassified: false };
        preset = found;
        db.prepare("INSERT OR REPLACE INTO card_presets (card_id, preset_id, assigned_at) VALUES (?, ?, ?)").run(cardId, preset.id, now());
      } else {
        // No explicit preset: reseed resolves the reliable-tier preset like
        // any fresh start (card pin, reliable override, band, default) —
        // never the bare card default under an active band policy.
        preset = getReliablePresetForBand(bandForCardKindStage(card.kind, card.stage), cardId);
      }
      const previousThreadId = card.worker_thread_id;
      const params = presetAttachmentParams(preset);
      const researchStrategy = card.kind === "research" ? researchStrategyById(card.research_strategy ?? "") : null;
      if (card.kind === "research" && !researchStrategy) return { reseeded: false, error: "This research has no known strategy. Archive it and start a new one.", reclassified: false };
      const exploreStage = card.kind === "explore" ? techniqueById(card.explore_stage ?? "") : null;
      if (card.kind === "explore" && !exploreStage) return { reseeded: false, error: "This explore card has no known technique. Archive it and start a new one.", reclassified: false };
      // Reseed wipes the state dir: reuse the round's own file path so the
      // re-run recreates exactly what the rounds list expects.
      const reseedRoundNo = Math.max(1, strategyList(card).length);
      const reseedStamp = roundTimestamp();
      let reseedFile = "";
      if (researchStrategy) {
        reseedFile = [...strategyRounds(card)].reverse().find((entry) => entry.id === researchStrategy.id)?.file
          ?? (seed.stateDir ? roundRelPath(seed.stateDir, source.path, roundFileName(researchStrategy.id, reseedRoundNo, reseedStamp)) : "");
        if (reseedFile) await ensureArtifactParent(source.path, reseedFile);
      }
      // The stage path stays deterministic after reseed; workers create it
      // only once they have reviewable content.
      const researchReseed = researchStrategy ? researchWorkerPrompt({
        displayName: card.display_name ?? card.name,
        prompt: card.prompt,
        strategyLabel: researchStrategy.label,
        strategyId: researchStrategy.id,
        strategySkill: researchStrategy.skill,
        stateDirText: text(seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>"),
        workspaceRoot: source.path,
        instructions: params.instructions,
        flavor: "reseed",
        previousThreadId,
        roundNo: reseedRoundNo,
        roundStamp: reseedStamp,
        roundFile: reseedFile,
      }) : null;
      const exploreReseed = exploreStage ? exploreWorkerPrompt({
        displayName: card.display_name ?? card.name,
        prompt: card.prompt,
        stage: exploreStage,
        stateDirText: text(seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>"),
        workspaceRoot: source.path,
        instructions: params.instructions,
        flavor: "reseed",
        previousThreadId,
      }) : null;
      const nextEnvironment = await continuingWorkerEnvironment(card, workerEnvironment(source, params, card.workspace_kind === "exploratory"));
      // delegation-site: worker-spawn
      const newThread = await bb.sdk.threads.spawn({
        projectId: card.project_id,
        environment: nextEnvironment,
        visibility: "hidden",
        title: `Stelow: ${card.display_name ?? card.name}`,
        providerId: params.providerId,
        model: params.modelId,
        reasoningLevel: params.reasoningLevel as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
        permissionMode: params.permissionMode as "accept-edits" | "auto" | "full",
        executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
        input: [{ type: "text", mentions: [], text: researchReseed ?? exploreReseed ?? `You are running a Stelow workflow inside the bb-plugin-stelow panel. The host re-seeded your per-workflow state, transitions.md, and stelow.json. Your workflow owns its own state dir (${text(seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>")}) — its state.md holds name, intent, current_stage, status. ${CARD_OWNER_RULES} The Stelow workflow skills (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-*) are provided by this plugin — start by loading them (they live under the plugin's skills directory; \`bb skill list\` shows them). The product strategy playbooks (stelow-product-*) are also provided by this plugin \u2014 check \`bb skill list\` first, and only fetch via \`npx skills add calionauta/stelow\` if one is missing. Use \`bb stelow advance <stage>\` to change stages (do NOT hand-edit current_stage). ${NEVER_SEED} Preserve every gate (product, interface, tech plan, diff). ${CLI_EQUIVALENTS} ${RECON_PROTOCOL} ${DRAFT_PROTOCOL}

${TURN_DISCIPLINE}

${COMMIT_STYLE}

Intent is currently \`${intent}\` in the re-seeded state.md. ${intent === "unknown" ? "It is still unknown, so your FIRST job is triage: classify it (new-product, feature, bugfix, refactor, or investigate), write it to state.md immediately, and only then continue — ask via the form below only if genuinely ambiguous." : "Use it — do NOT ask the user to pick or confirm intent again."} Order of work, always: (1) settle intent; (2) load the workflow skills; (3) advance stages and do the work. If a \`bb stelow\` command fails, read its stderr once and continue — do NOT spend the turn debugging the CLI; report the exact error and move on.

CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form:

    bb stelow ask --thread "$BB_THREAD_ID" \\
      --question "<a single clear question>" \\
      --option "<label 1>" --option "<label 2>" [--option "<label 3>" ...] [--multiple]

Batch independent questions into ONE ask call by repeating --question groups (each with its own --option labels) — the user answers them together instead of being pinged one by one. Ask dependent questions (where Q2 needs Q1's answer) one at a time. When the human must compare artifacts to decide (interface picks, plan reviews), attach each option's evidence: --desc for trade-offs, --preview for the inline glance, --artifact for the workspace-relative file they can open.

Before asking a question, first summarize what you read (files, plan, codebase) so the user can answer with context — never dump a raw file list as the only content of a question. Do not skip the triage stage. Each bb stelow ask call blocks until the user submits; the card stays in its column and signals it is waiting for an answer. If an ask returns "No response after Ns" (timeout), STOP and wait: do NOT proceed with the workflow. The question stays pending on the card and remains answerable; when the user answers it on the card, the answer is delivered to you as a message and you continue from there. Never re-ask the same question — wait for the card answer. ${INTERFACE_PICK} For unselected gates, write the approval receipt yourself (.stelow/approvals/{dirHash}/{file}.approved.md) and advance; for selected gates, open a structured ask instead. Stop when the user archives the card or the workflow reaches \`audit\`.

${DONE_PROTOCOL}

${SPLIT_PROTOCOL}

${params.instructions ? `Preset instructions:\n${params.instructions}\n` : ""}Request:
${card.prompt}` }, ...cardAttachments(card.attachments)],
      });
      if (previousThreadId) {
        try { await bb.sdk.threads.archive({ threadId: previousThreadId }); } catch { /* ignore */ }
        try { await bb.sdk.threads.stop({ threadId: previousThreadId }); } catch { /* ignore */ }
      }
      db.prepare("UPDATE cards SET intent = ?, updated_at = ? WHERE id = ?").run(intent, now(), cardId);
      const reseedReset = resetAutoContinue();
      updateCard(cardId, { stage: card.kind === "research" ? "research" : card.kind === "explore" ? "explore" : "triage", status: freshStatusForReseed(card, reclassified), activity: "running", last_error: null, worker_thread_id: newThread.id, worker_preset_id: preset.id, preset_restart_pending: 0, last_assistant_text: null, auto_continue_count: reseedReset.count, auto_continue_stage: reseedReset.stage });
      recordWorkerThread(db, cardId, newThread.id, preset.id, "reseed");
      if (seed.dirHash) void recordWorkflowLineage(source.path, seed.dirHash, newThread.id, preset.id, "reseed");
      bb.realtime.publish("card-state", { cardId });
      return { reseeded: true, error: null, reclassified };
    },

    async moveCard({ cardId, status }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, error: ERR_CARD_NOT_FOUND };
      if (isArchivedCard(card)) return { ok: false, error: ERR_CARD_ARCHIVED };
      // Track routing lives in lib/card-move (unit-tested): research moves
      // statuses, build moves phases + terminals, each side refuses the
      // other's columns with the valid exit named.
      const decision = resolveCardMove(card.kind, status, { hasWorker: Boolean(card.worker_thread_id) });
      if (!decision.ok) return { ok: false, error: decision.error };
      if (decision.move.type === "status") {
        // User-initiated moves never ping the inbox with a completion: the
        // human performed the action and already knows. Open action items
        // still resolve (the card's state changed). Drag-to-archived stops
        // the worker exactly like the Archive button — parking a card must
        // never orphan a running worker.
        if (decision.move.status === "archived") await stopWorkerThread(card.worker_thread_id);
        // Drag-to-Doing on a threadless card starts it: Doing means working,
        // so the move spawns through the shared starter instead of parking
        // a lie on the board. A failed start blocks the move, not silently.
        // (Only lightweight tracks reach this status branch; build moves
        // phases, never bare statuses.)
        if (decision.move.status === "in-progress" && !card.worker_thread_id) {
          const started = await spawnFreshWorker(cardId, "start");
          if (!started.ok) return { ok: false, error: started.error };
        }
        updateCard(cardId, { status: decision.move.status as "draft" | "pending" | "in-progress" | "completed" | "archived" }, { suppressCompletionEvent: true });
        // A manual move into Done is a completion like any other: without
        // the trail event the card sits in Done invisible to flow metrics.
        if (decision.move.status === "completed") recordStageEvent(cardId, "done");
        // Terminal columns release workspace claims so parked cards never
        // hold files hostage; waiters are notified on the same path.
        if (isClaimTerminal(decision.move.status)) await releaseCardClaimsAndNotify(cardId);
        return { ok: true, error: null };
      }
      // A phase move sets the card's stage to that phase's entry stage
      // (stage drives the column). Terminals already returned above.
      const entry = PHASE_ENTRY_STAGES[decision.move.phase as keyof typeof PHASE_ENTRY_STAGES];
      if (!entry) return { ok: false, error: "Unknown phase." };
      const previous = { stage: card.stage, status: card.status };
      updateCard(cardId, { stage: entry, status: entry === "triage" ? "draft" : "in-progress" });
      // A parked card has no worker, so leaving the Inbox is what starts it.
      // The phase is written first so the fresh worker continues from the
      // right checkpoint, and reverted if the spawn fails — a card must never
      // be left parked in a phase with nothing running behind it.
      if (!card.worker_thread_id) {
        const started = await spawnFreshWorker(cardId, "start");
        if (!started.ok) {
          updateCard(cardId, previous);
          return { ok: false, error: started.error };
        }
        bb.realtime.publish("card-state", { cardId });
      }
      return { ok: true, error: null };
    },

    async promoteCard({ cardId, name }) {
      // Promotion is a worker handoff, not only a workspace relabel. Files
      // remain in place, but the old exploratory worker is replaced by a new
      // worker belonging to the new project. That makes Open thread truthful
      // and prevents two workers from writing the same workflow state.
      const card = getCard(cardId);
      if (!card) return { ok: false, projectId: null, projectName: null, threadId: null, error: ERR_CARD_NOT_FOUND };
      if (card.workspace_kind !== "exploratory") {
        const projectName = await bb.sdk.projects.get({ projectId: card.project_id }).then((p) => p.name).catch(() => card.project_id);
        return { ok: false, projectId: null, projectName: null, threadId: null, error: `This card already lives in project "${projectName}" — nothing to promote.` };
      }
      if (card.status === "archived") return { ok: false, projectId: null, projectName: null, threadId: null, error: ERR_CARD_ARCHIVED };
      const workspace = await cardWorkspace(card);
      if (!workspace?.path) return { ok: false, projectId: null, projectName: null, threadId: null, error: ERR_WORKSPACE_UNAVAILABLE };
      if (!workspace.hostId) return { ok: false, projectId: null, projectName: null, threadId: null, error: "Workspace host is unavailable." };
      const recovery = await recoverySnapshot(card);
      if (recovery.kind !== "promote") {
        // Every refusal names the exit, so a refusal is never a deadlock.
        const refusal: Record<typeof recovery.kind, string> = {
          attached: "This card already has a reviewed checkout attached. Use that checkout to review, test, and commit.",
          "external-project": "This card has an evidenced external project checkout. Review and attach that checkout instead of promoting the empty exploratory folder.",
          ambiguous: "Several registered checkouts match the worker's report. Review them in Workspace recovery and attach the right one.",
          "documents-only": "This exploratory workspace holds workflow documents only — there is no source material to turn into a project.",
        };
        return { ok: false, projectId: null, projectName: null, threadId: null, error: refusal[recovery.kind] };
      }
      const projectName = normalizePromoteName(name, card.display_name ?? card.name);
      const projects = await bb.sdk.projects.list().catch(() => []);
      const decision = findAdoptableProject(projects, projectName, workspace.path);
      if (decision.action === "conflict") {
        return { ok: false, projectId: null, projectName: null, threadId: null, error: `A project named "${projectName}" already exists — pick another name.` };
      }
      let projectId: string;
      try {
        projectId = decision.action === "adopt" && decision.project
          ? decision.project.id
          : (await bb.sdk.projects.create({ name: projectName, source: { type: "local_path", hostId: workspace.hostId, path: workspace.path } })).id;
      } catch (error) {
        return { ok: false, projectId: null, projectName: null, threadId: null, error: error instanceof Error ? error.message : "Could not create the project." };
      }
      // Temporarily bind the card to the target project so the common respawn
      // helper uses the exact project source and projectId. If that spawn
      // fails, revert this ownership change: the old worker was never stopped
      // and the card stays coherent in its exploratory workspace.
      db.prepare("UPDATE cards SET project_id = ?, workspace_kind = 'project', workspace_path = NULL, workspace_host_id = NULL, updated_at = ? WHERE id = ?").run(projectId, now(), cardId);
      const preset = card.kind === "build"
        ? getReliablePresetForBand(STAGE_TO_BAND[card.stage] ?? "analysis", cardId)
        : getPresetForCard(cardId);
      const handoff = await respawnWorkerForBand(cardId, preset.id, "project-promotion", { previousProjectId: card.project_id });
      if (!handoff.ok || !handoff.threadId) {
        db.prepare("UPDATE cards SET project_id = ?, workspace_kind = 'exploratory', workspace_path = ?, workspace_host_id = ?, activity = ?, last_error = ?, updated_at = ? WHERE id = ?").run(card.project_id, workspace.path, workspace.hostId, card.activity, card.last_error, now(), cardId);
        bb.realtime.publish("card-state", { cardId });
        bb.realtime.publish("board-changed", { cardId });
        return { ok: false, projectId: null, projectName: null, threadId: null, error: `Could not start the project worker. The card remains exploratory; its existing worker is still active. ${handoff.error ?? "Try again."}` };
      }
      logCardComment(cardId, "card", cardId, "agent", `Moved into project "${projectName}". Files stayed in place; a new project worker continues from the current stage. The exploratory worker is archived in Worker history.`);
      bb.realtime.publish("card-state", { cardId });
      bb.realtime.publish("board-changed", { cardId });
      return { ok: true, projectId, projectName, threadId: handoff.threadId, error: null };
    },

    async workspaceRecovery({ cardId }) {
      const card = getCard(cardId);
      if (!card) return { kind: "documents-only" as const, message: "Card not found.", workspace: { path: null, isGit: false, hasSource: false }, candidates: [], looseEvidence: [], recovery: null, audit: null, error: ERR_CARD_NOT_FOUND };
      if (card.workspace_kind !== "exploratory") return { kind: "attached" as const, message: "This card already belongs to a project workspace.", workspace: { path: null, isGit: true, hasSource: true }, candidates: [], looseEvidence: [], recovery: null, audit: null, error: null };
      return { ...(await recoverySnapshot(card)), error: null };
    },

    async attachRecoveryCheckout({ cardId, projectId }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, error: ERR_CARD_NOT_FOUND };
      if (card.workspace_kind !== "exploratory") return { ok: false, error: "This card already belongs to a project workspace." };
      if (isArchivedCard(card)) return { ok: false, error: ERR_CARD_ARCHIVED };
      const snapshot = await recoverySnapshot(card);
      const candidate = snapshot.candidates.find((entry) => entry.projectId === projectId);
      if (!candidate) return { ok: false, error: "That checkout no longer has the exact reported, registered Git evidence. Refresh and review again." };
      db.prepare("INSERT OR REPLACE INTO workspace_recoveries (card_id, project_id, project_name, source_path, original_workspace_path, evidence, git_root, branch, head_sha, changed_files, attached_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(cardId, candidate.projectId, candidate.projectName, candidate.path, card.workspace_path, candidate.evidence, candidate.gitRoot, candidate.branch, candidate.headSha, candidate.changedFiles, now());
      logCardComment(cardId, "card", cardId, "agent", `Recovery attached after user review: registered project "${candidate.projectName}" at ${candidate.path}; ${candidate.changedFiles} uncommitted files, branch ${candidate.branch ?? "detached"}, HEAD ${candidate.headSha?.slice(0, 12) ?? "unknown"}. Original exploratory workspace remains preserved.`);
      bb.realtime.publish("card-state", { cardId });
      bb.realtime.publish("board-changed", { cardId });
      return { ok: true, error: null };
    },

    async createRecoveryAudit({ cardId }) {
      const sourceCard = getCard(cardId);
      if (!sourceCard) return { ok: false, auditCardId: null, auditCardName: null, error: ERR_CARD_NOT_FOUND };
      if (sourceCard.workspace_kind !== "exploratory") return { ok: false, auditCardId: null, auditCardName: null, error: "Recovery audits only apply to the preserved exploratory card." };
      const existing = db.prepare("SELECT audit_card_id FROM recovery_audits WHERE source_card_id = ?").get(cardId) as { audit_card_id: string } | undefined;
      if (existing) {
        const auditCard = getCard(existing.audit_card_id);
        return { ok: true, auditCardId: existing.audit_card_id, auditCardName: auditCard?.display_name ?? auditCard?.name ?? "Recovery audit", error: null };
      }
      const recovery = db.prepare("SELECT project_id, project_name, source_path, evidence, git_root, branch, head_sha, changed_files FROM workspace_recoveries WHERE card_id = ?").get(cardId) as { project_id: string; project_name: string; source_path: string; evidence: string; git_root: string | null; branch: string | null; head_sha: string | null; changed_files: number } | undefined;
      if (!recovery) return { ok: false, auditCardId: null, auditCardName: null, error: "Attach the exact registered checkout first. Recovery never guesses a project or changes files before that review." };
      const project = await bb.sdk.projects.get({ projectId: recovery.project_id }).catch(() => null);
      const source = project?.sources.find((entry) => entry.path === recovery.source_path) ?? project?.sources.find((entry) => entry.isDefault) ?? project?.sources[0];
      if (!source?.path || source.path !== recovery.source_path) return { ok: false, auditCardId: null, auditCardName: null, error: "The attached project source changed. Re-check recovery evidence before creating its audit card." };
      const auditPrompt = [
        `Recovery audit for the preserved exploratory card “${sourceCard.display_name ?? sourceCard.name}”.`,
        `Evidence source: ${recovery.source_path}`,
        `Recorded Git root: ${recovery.git_root ?? "unknown"}; branch: ${recovery.branch ?? "detached"}; HEAD: ${recovery.head_sha ?? "unknown"}; changed files at review: ${recovery.changed_files}.`,
        "Inspect the existing uncommitted changes and the original card's artifacts before editing. Do not rewrite or complete the original exploratory card. Establish what is recoverable, make only justified fixes in this real project workspace, run the host-recorded test check, and use the normal Git changes / PR workflow for any publication.",
      ].join("\n\n");
      try {
        const created = await createCardInternal({
          projectId: recovery.project_id,
          environment: { type: "host", hostId: source.hostId, workspace: { type: "unmanaged", path: source.path } },
          prompt: auditPrompt,
          attachments: [],
          intent: "investigate",
          appetite: "Complete",
          reviewMode: "Product Spec + Interface + Tech Review + Code Diff",
          kind: "build",
          start: true,
        });
        const auditCard = getCard(created.cardId);
        const createdAt = now();
        db.prepare("INSERT INTO recovery_audits (source_card_id, audit_card_id, created_at) VALUES (?, ?, ?)").run(cardId, created.cardId, createdAt);
        logCardComment(cardId, "card", cardId, "agent", `Recovery mismatch recorded. Original exploratory work remains immutable; recovery audit card ${created.cardId} now owns review, tests, commits, and PRs for ${recovery.project_name}.`);
        logCardComment(created.cardId, "card", created.cardId, "agent", `Recovery audit created from preserved card ${cardId}. Evidence checkout: ${recovery.source_path}; recorded HEAD ${recovery.head_sha ?? "unknown"}.`);
        bb.realtime.publish("card-state", { cardId });
        bb.realtime.publish("card-state", { cardId: created.cardId });
        bb.realtime.publish("board-changed", { cardId: created.cardId });
        return { ok: true, auditCardId: created.cardId, auditCardName: auditCard?.display_name ?? auditCard?.name ?? "Recovery audit", error: null };
      } catch (error) {
        return { ok: false, auditCardId: null, auditCardName: null, error: error instanceof Error ? error.message : "Could not create the recovery audit card." };
      }
    },

    async researchStrategies() {
      return { strategies: RESEARCH_STRATEGIES };
    },

    async createResearchCard({ projectId, environment, prompt, attachments, strategy, presetId, start, execution }) {
      const picked = researchStrategyById(strategy);
      if (!picked) {
        throw new Error(`Unknown research strategy "${strategy}". Pick one of: ${RESEARCH_STRATEGIES.map((entry) => entry.id).join(", ")}.`);
      }
      return createCardInternal({ projectId, environment, prompt, attachments, intent: "investigate", appetite: "Lean", reviewMode: "Auto", kind: "research", strategy: picked.id, presetId: presetId ?? null, start, execution: execution ?? null });
    },

    async createExploreCard({ projectId, environment, prompt, attachments, stageId, presetId, start, execution }) {
      const picked = techniqueById(stageId);
      if (!picked) {
        throw new Error(`Unknown explore technique "${stageId}". Pick one of: ${TECHNIQUE_CATALOG.map((entry) => entry.id).join(", ")}.`);
      }
      return createCardInternal({ projectId, environment, prompt, attachments, intent: "explore", appetite: "Complete", reviewMode: "Product Spec + Interface + Tech Review + Code Diff", kind: "explore", stageId: picked.id, presetId: presetId ?? null, start, execution: execution ?? null });
    },

    async stageCatalog() {
      return { stages: TECHNIQUE_CATALOG.map(({ id, label, skill, emoji, blurb, keywords }) => ({ id, label, skill, emoji, blurb, keywords })) };
    },

    // Resolve the research index file for a card. Shared by researchIndex
    // (read) and fanOutResearch (read + flip). Returns the error instead of
    // throwing so every refusal names its exit.
    async researchIndex({ cardId }) {
      const card = getCard(cardId);
      const empty = { found: false, indexPath: null, content: null, truncated: false, opportunities: [], rounds: [], error: "" };
      if (!card) return { ...empty, error: ERR_CARD_NOT_FOUND };
      if (card.kind !== "research") return { ...empty, error: "Only research cards have results to review. Build cards track scopes instead." };
      const resolved = await readResearchIndex(card);
      if (!resolved.ok) return { ...empty, error: resolved.error };
      const history = strategyRounds(card);
      const live = ["running", "awaiting-answer"].includes(card.activity);
      const workspace = await cardWorkspace(card).catch(() => null);
      const stateDir = card.dir_hash && workspace?.path ? await workflowStateDir(bb, workspace.path, card.id, card.dir_hash).catch(() => null) : null;
      const { rounds } = await researchRoundFiles(workspace?.path ?? null, workspace?.hostId ?? null, stateDir, history, live);
      const parsed = parseResearchIndex(resolved.content);
      if (!parsed.found) return { ...empty, indexPath: resolved.display, rounds, error: "Research results are still being prepared." };
      const LIMIT = 100_000;
      return {
        found: true,
        indexPath: resolved.display,
        content: resolved.content.slice(0, LIMIT),
        truncated: resolved.content.length > LIMIT,
        opportunities: parsed.opportunities.map(({ id, title, checked, group }) => ({ id, title, checked, group })),
        rounds,
        error: null,
      };
    },

    async fanOutResearch({ cardId, opportunityIds }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, created: [], error: ERR_CARD_NOT_FOUND };
      if (card.kind !== "research") return { ok: false, created: [], error: "Only research cards fan out. This is already a build card." };
      if (card.status === "archived") return { ok: false, created: [], error: ERR_CARD_ARCHIVED };
      const resolved = await readResearchIndex(card);
      if (!resolved.ok) return { ok: false, created: [], error: resolved.error };
      const parsed = parseResearchIndex(resolved.content);
      if (!parsed.found) return { ok: false, created: [], error: "Research results are still being prepared." };
      const wanted = new Set(opportunityIds);
      const matched = parsed.opportunities.filter((item) => wanted.has(item.id) && !item.checked);
      if (matched.length === 0) return { ok: false, created: [], error: "None of the selected opportunities are still available — reopen the index; they may already have been fanned out." };
      const strategyLabel = researchStrategyById(card.research_strategy ?? "")?.label ?? "research";
      // Exploratory research fans out into fresh exploratory build cards (each
      // owns its isolated workspace) instead of piling every card's state
      // into the shared container directory. Project research stays in its
      // project.
      const targetProjectId = card.workspace_kind === "exploratory" ? "proj_personal" : card.project_id;
      const created: Array<{ cardId: string; title: string }> = [];
      const createdOpportunityIds: string[] = [];
      let failure: string | null = null;
      for (const item of matched) {
        try {
          const spawned = await createCardInternal({
            projectId: targetProjectId,
            prompt: `Spawned from research "${card.display_name ?? card.name}" (${strategyLabel}).\n\nOpportunity: ${item.title}\n\nResearch context: full index at ${resolved.absolute} — read its ## Summary before triage. Treat the opportunity above as the request; classify intent first, then work it through the normal build workflow.`,
            attachments: [],
            intent: "unknown",
            appetite: "Lean",
            reviewMode: "Auto",
            kind: "build",
          });
          const spawnedCard = getCard(spawned.cardId);
          created.push({ cardId: spawned.cardId, title: spawnedCard?.display_name ?? spawnedCard?.name ?? item.title });
          createdOpportunityIds.push(item.id);
        } catch (error) {
          failure = error instanceof Error ? error.message : "Could not spawn a build card.";
          break;
        }
      }
      // Persist exactly the successfully spawned opportunities before
      // reporting a partial failure, so retrying does not duplicate them.
      const flipped = checkIndexItems(resolved.content, createdOpportunityIds);
      if (flipped.checked.length > 0) {
        try {
          await bb.sdk.files.write({ path: resolved.absolute, content: flipped.updated });
        } catch { /* boxes stay unchecked; the comment below still trails */ }
      }
      if (created.length > 0) {
        logCardComment(cardId, "card", cardId, "agent", `Fanned out ${created.length} ${created.length === 1 ? "opportunity" : "opportunities"} into build: ${created.map((entry) => entry.title).join("; ")}.`);
      }
      bb.realtime.publish("card-state", { cardId });
      bb.realtime.publish("board-changed", { cardId });
      if (failure) {
        const prefix = created.length > 0 ? `Created ${created.length} ${created.length === 1 ? "build card" : "build cards"} before the remaining opportunities could not be created. ` : "";
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
      const empty = { found: false, isRepo: false, files: [], truncated: false, entitySummary: null as ReturnType<typeof summarizeSemDiff>, changedSymbols: null as ReturnType<typeof summarizeCymbalChanged>, error: null as string | null };
      const card = getCard(cardId);
      if (!card) return { ...empty, error: ERR_CARD_NOT_FOUND };
      const workspace = await cardCheckout(card).catch(() => null);
      if (!workspace?.path) return { ...empty, error: ERR_WORKSPACE_UNAVAILABLE };
      // A recovered checkout is a read-only audit target, never a fuzzy path
      // alias. If its Git root changed since the human attached it, stop here
      // rather than showing a convincing diff from a different repository.
      const recoveryError = await recoveredCheckoutIntegrity(card, workspace.path);
      if (recoveryError) return { ...empty, found: true, error: recoveryError };
      const runGit = (args: string[], cwd?: string): Promise<{ ok: boolean; stdout: string }> =>
        new Promise((resolve) => {
          execFile("git", args, { cwd: cwd ?? workspace.path, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
            resolve({ ok: !error, stdout: typeof stdout === "string" ? stdout : "" });
          });
        });
      const top = await runGit(["rev-parse", "--show-toplevel"]);
      if (!top.ok || !top.stdout.trim()) return { ...empty, found: true, error: "Not a git repository." };
      const toplevel = top.stdout.trim();
      const hostId = workspace.hostId ?? "";
      const files: Array<{ path: string; display: string; patch: string | null; isNew: boolean; absolutePath: string; hostId: string }> = [];
      let truncated = false;
      // HEAD (not bare `diff`) so staged changes review too. Fresh repos
      // without HEAD fail here — untracked listing below still covers them.
      // cwd=toplevel so every path resolves root-relative.
      const diff = await runGit(["diff", "HEAD", "--no-color", "--no-ext-diff", "--unified=3", "--"], toplevel);
      if (diff.ok && diff.stdout.trim()) {
        const split = splitDiffByFile(diff.stdout);
        truncated = truncated || split.truncated;
        for (const entry of split.files) {
          const absolute = resolveArtifactPath(toplevel, entry.path);
          if (!absolute) continue;
          files.push({ path: entry.path, display: entry.path.split("/").pop() || entry.path, patch: entry.patch, isNew: false, absolutePath: absolute, hostId });
        }
      }
      if (files.length < MAX_DIFF_FILES) {
        // -uall expands collapsed dirs (normal lists `skills/` — unopenable)
        // into individual files; quotepath=false avoids octal escapes the
        // JSON.parse fallback below could misread.
        const status = await runGit(["-c", "core.quotepath=false", "-c", "status.relativePaths=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"], toplevel);
        if (status.ok && status.stdout) {
          for (const line of status.stdout.split("\0")) {
            if (files.length >= MAX_DIFF_FILES) { truncated = true; break; }
            const match = /^\?\? (.+)$/.exec(line);
            if (!match) continue;
            let rel = match[1].trim().replace(/^\.\//, "");
            if (rel.startsWith('"') && rel.endsWith('"')) {
              try { rel = JSON.parse(rel); } catch { rel = rel.slice(1, -1); }
            }
            if (!rel || typeof rel !== "string") continue;
            const absolute = resolveArtifactPath(toplevel, rel);
            if (!absolute) continue;
            if (files.some((f) => f.path === rel)) continue;
            files.push({ path: rel, display: rel.split("/").pop() || rel, patch: null, isNew: true, absolutePath: absolute, hostId });
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
          execFile(resolveLocalBin("sem"), ["diff", "-C", toplevel, "HEAD", "--format", "json", "--color", "never"], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
            resolve(!error && typeof stdout === "string" ? stdout : null);
          });
        });
        if (semOut) {
          try { entitySummary = summarizeSemDiff(JSON.parse(semOut)); } catch { entitySummary = null; }
        }
      } catch { entitySummary = null; }
      // Changed symbols with caller impact via `cymbal` when installed.
      // Same HEAD baseline; cwd=toplevel (cymbal only operates on the
      // current worktree). Strictly additive like the sem summary above.
      let changedSymbols: ReturnType<typeof summarizeCymbalChanged> = null;
      try {
        const cymOut = await new Promise<string | null>((resolve) => {
          execFile(resolveLocalBin("cymbal"), ["changed", "--base", "HEAD", "--json", "--max-symbols", "20", "--max-impact", "100"], { cwd: toplevel, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
            resolve(!error && typeof stdout === "string" ? stdout : null);
          });
        });
        if (cymOut) {
          try { changedSymbols = summarizeCymbalChanged(JSON.parse(cymOut)); } catch { changedSymbols = null; }
        }
      } catch { changedSymbols = null; }
      return { found: true, isRepo: true, files, truncated, entitySummary, changedSymbols, error: null };
    },

    async auditTrailStatus({ cardId }) {
      // Freshness of Stelow's portable receipt, asked for on demand instead of
      // computed on every board read: `check` re-derives the whole projection,
      // which reads the workflow state and samples the worktree, so it is a
      // deliberate request rather than a listing cost. The answer is the
      // helper's own classification — this RPC never decides staleness itself,
      // and the path is the CLI's fixed contract, not a second lookup.
      const card = getCard(cardId);
      if (!card) return { state: "unavailable" as const, detail: ERR_CARD_NOT_FOUND, head: null, path: null, contract: null, recon: null };
      if (card.kind !== "build") return { state: "unavailable" as const, detail: "Only Build cards carry an audit trail.", head: null, path: null, contract: null, recon: null };
      const workspace = await cardWorkspace(card).catch(() => null);
      const projectPath = workspace?.path ?? null;
      if (!projectPath) return { state: "unavailable" as const, detail: ERR_WORKSPACE_UNAVAILABLE, head: null, path: null, contract: null, recon: null };
      const stateDir = card.dir_hash ? await workflowStateDir(bb, projectPath, card.id, card.dir_hash).catch(() => null) : null;
      if (!stateDir) return { state: "unavailable" as const, detail: "Workflow state ownership cannot be verified. Reseed this card; project-root state is intentionally ignored.", head: null, path: null, contract: null, recon: null };
      // This is the same completion contract, not a softer display-only
      // verdict: a trail with any unregistered durable output is refused.
      const run = await runHelper(["audit-trail", "check", "--strict", "--json"], projectPath, stateDir);
      const outcome = auditTrailOutcome(run);
      return {
        state: outcome.state,
        detail: outcome.detail,
        head: typeof outcome.result?.snapshot?.head === "string" ? outcome.result.snapshot.head : null,
        path: nodeJoin(stateDir, AUDIT_TRAIL_FILE),
        contract: typeof outcome.result?.contract === "string" ? outcome.result.contract : null,
        recon: reconReceiptStatus(await bb.sdk.files.read({ path: join(stateDir, RECON_RECEIPT_FILE) }).then((file) => file.content).catch(() => null), stateDir),
      };
    },

    async publicationStatus({ cardId }) {
      const card = getCard(cardId);
      return card ? await publicationSnapshot(card) : unavailablePublication(ERR_CARD_NOT_FOUND);
    },

    // Publication history is an audit trail, not an arbitrary Git browser:
    // a caller can inspect only commits Stelow itself recorded for this card.
    // BB supplies the diff from the selected environment, so this remains
    // useful for local-only commits and never shells out to Git on the plugin.
    async publicationCommitDiff({ cardId, commitSha }) {
      const empty = { found: false, commitSha: null, shortstat: null, files: [], truncated: false, error: null as string | null };
      const recorded = db.prepare("SELECT 1 FROM publication_events WHERE card_id = ? AND commit_sha = ? LIMIT 1").get(cardId, commitSha);
      if (!recorded) return { ...empty, error: "This commit is not recorded in this card's publication history." };
      const prepared = await publicationEnvironment(cardId);
      if ("error" in prepared) return { ...empty, error: prepared.error };
      try {
        const result = await bb.sdk.environments.diffFiles({ environmentId: prepared.environmentId, target: "commit", sha: commitSha });
        if (result.outcome !== "available") {
          const error = result.outcome === "not_applicable" ? result.message : result.failure.message;
          return { ...empty, error };
        }
        const patches = new Map(result.initialPatches.map((patch) => [patch.path, patch]));
        // Commit targets carry no inline patches (initialPatches is empty even
        // with loadMode auto): every file patch needs an explicit diffPatch
        // fetch. Only too_large is genuinely unrenderable. Fetch bounded and
        // fail-soft so one bad file never breaks the whole commit view.
        const missingPaths = result.files
          .filter((file) => !file.binary && file.loadMode !== "too_large" && !patches.has(file.path))
          .map((file) => file.path);
        const MAX_MISSING_PATCHES = 25;
        let patchesTruncated = false;
        if (missingPaths.length > 0) {
          try {
            const demanded = await bb.sdk.environments.diffPatch({
              environmentId: prepared.environmentId,
              paths: missingPaths.slice(0, MAX_MISSING_PATCHES),
              target: { type: "commit", sha: commitSha },
            });
            if (demanded.outcome === "available") {
              for (const patch of demanded.patches) patches.set(patch.path, patch);
            } else {
              const reason = demanded.outcome === "not_applicable" ? demanded.message : demanded.failure.message;
              bb.log.warn(`stelow commit diff: diffPatch unavailable for ${commitSha} (${missingPaths.length} files): ${reason}`);
            }
            patchesTruncated = missingPaths.length > MAX_MISSING_PATCHES;
          } catch (error) {
            // Keep the initial patches; the UI states per-file availability.
            bb.log.warn(`stelow commit diff: diffPatch failed for ${commitSha}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        return {
          found: true,
          commitSha,
          shortstat: result.shortstat,
          files: result.files.map((file) => {
            const patch = patches.get(file.path);
            return {
              path: file.path,
              display: file.path.split("/").pop() || file.path,
              patch: patch?.patch ?? null,
              binary: file.binary,
              changeKind: file.changeKind,
              additions: file.additions,
              deletions: file.deletions,
              truncated: patch?.truncated ?? file.loadMode !== "auto",
              loadMode: file.loadMode,
            };
          }),
          truncated: result.truncated || patchesTruncated,
          error: null,
        };
      } catch (error) {
        return { ...empty, error: error instanceof Error ? error.message : "BB could not load this commit diff." };
      }
    },

    async publicationCommit({ cardId }) {
      const prepared = await publicationEnvironment(cardId);
      if ("error" in prepared) return { ok: false, message: prepared.error, commitSha: null };
      if (!prepared.snapshot.capabilities.commit.available) return { ok: false, message: prepared.snapshot.capabilities.commit.reason ?? "Commit is unavailable.", commitSha: null };
      try {
        // BB executes this on the environment host and owns staging, identity,
        // hooks, and commit formatting. Do not substitute a local shell call.
        const result = await bb.sdk.environments.commit({ environmentId: prepared.environmentId });
        recordPublication(cardId, "commit", result.message, result.commitSha);
        return { ok: true, message: result.message, commitSha: result.commitSha };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "BB could not commit this workspace.", commitSha: null };
      }
    },

    async publicationSquashMerge({ cardId }) {
      const prepared = await publicationEnvironment(cardId);
      if ("error" in prepared) return { ok: false, message: prepared.error, commitSha: null };
      if (!prepared.snapshot.capabilities.squashMerge.available) return { ok: false, message: prepared.snapshot.capabilities.squashMerge.reason ?? "Local squash merge is unavailable.", commitSha: null };
      const base = prepared.snapshot.mergeBase?.branch;
      const branch = prepared.snapshot.branch?.current;
      if (!base) return { ok: false, message: "BB could not determine the merge-base branch.", commitSha: null };
      if (!branch) return { ok: false, message: "BB could not determine this checkout's branch.", commitSha: null };
      // BB exposes no local squash action (only PR squash-merge), so the
      // panel runs `git merge --squash` in the card's own environment shell —
      // the same visible-terminal pattern as push/sync. The script
      // aborts/resets before restoring the branch, so a conflict never
      // strands the checkout mid-merge (lib/squash-merge.mjs).
      let script: string;
      try {
        script = buildSquashScript({ base, branch, message: `Squash merge ${branch} into ${base} (Stelow)` });
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Squash refused the branch names.", commitSha: null };
      }
      try {
        const terminal = await bb.sdk.terminals.create({
          cols: 120,
          rows: 30,
          scope: { kind: "environment", environmentId: prepared.environmentId },
          start: { mode: "shell" },
          title: `Stelow squash ${branch}`,
        });
        for (let attempt = 0; attempt < 5; attempt++) {
          const live = await bb.sdk.terminals.get({ terminalId: terminal.id }).catch(() => null);
          if (live?.status === "running") break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        try {
          await bb.sdk.terminals.input({ terminalId: terminal.id, dataBase64: Buffer.from(`${script}\r`).toString("base64") });
        } catch (error) {
          await bb.sdk.terminals.close({ terminalId: terminal.id, mode: "force" }).catch(() => null);
          return { ok: false, message: error instanceof Error ? `Squash shell opened (${terminal.id}) but the command could not be sent: ${error.message}` : `Squash shell opened (${terminal.id}) but the command could not be sent.`, commitSha: null };
        }
        const deadline = Date.now() + 60_000;
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const out = await bb.sdk.terminals.output({ terminalId: terminal.id, tailBytes: 8000 }).catch(() => null);
          const tail = ((out?.chunks ?? []) as Array<{ dataBase64: string }>)
            .map((chunk) => Buffer.from(chunk.dataBase64, "base64").toString("utf8"))
            .join("")
            .slice(-4000);
          const verdict = parseSquashOutput(tail);
          if (verdict.finished) {
            await bb.sdk.terminals.close({ terminalId: terminal.id, mode: "force" }).catch(() => null);
            if (verdict.exit === 0 && verdict.sha) {
              const message = `Squashed ${branch} into ${base} as ${verdict.sha}.`;
              recordPublication(cardId, "squash_merge", message, verdict.sha);
              return { ok: true, message, commitSha: verdict.sha };
            }
            return { ok: false, message: squashExitMessage(verdict.exit, branch, base), commitSha: null };
          }
          if (Date.now() > deadline) {
            return { ok: false, message: `Squash is still running in shell ${terminal.id} — finish it in BB's terminal panel, then squash again.`, commitSha: null };
          }
        }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "BB could not squash merge this workspace.", commitSha: null };
      }
    },

    async publicationPushTerminal({ cardId }) {
      const prepared = await publicationEnvironment(cardId);
      if ("error" in prepared) return { ok: false, message: prepared.error, terminalId: null as string | null };
      const branch = prepared.snapshot.branch?.current;
      if (!branch) return { ok: false, message: "BB could not determine this checkout's branch.", terminalId: null as string | null };
      try {
        // BB never auto-reveals a new shell, so "open a terminal" was a
        // promise the panel could not keep — and typed-but-unsent input left
        // users unsure whether anything ran. Instead the confirmed action
        // RUNS git push in the card's own environment (correct host and
        // checkout by construction) and streams the result into Push shells
        // below via publicationPushTerminals. The exit marker makes
        // completion explicit: no marker yet means still running or waiting
        // on interactive auth (finish it in BB's terminal panel).
        // Single-active strategy: one push shell per card at a time. A push
        // already in flight blocks a duplicate; retired predecessors are
        // closed so runs never accumulate into an unreadable list.
        const live = await livePushShell(prepared.environmentId);
        if (live) {
          return { ok: false, message: `A push is already running in shell ${live.id} — Check result instead of starting another.`, terminalId: live.id };
        }
        await retirePushShells(prepared.environmentId);
        const terminal = await bb.sdk.terminals.create({
          cols: 120,
          rows: 30,
          scope: { kind: "environment", environmentId: prepared.environmentId },
          start: { mode: "shell" },
          title: `Stelow push — ${branch}`,
        });
        for (let attempt = 0; attempt < 5; attempt++) {
          const live = await bb.sdk.terminals.get({ terminalId: terminal.id }).catch(() => null);
          if (live?.status === "running") break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        // A swallowed input failure used to report success with an empty
        // shell. Fail loudly instead: no history entry, no success toast.
        // \r submits the line (verified against the terminal daemon); the
        // marker reports the push exit so the panel can name the outcome.
        try {
          await bb.sdk.terminals.input({ terminalId: terminal.id, dataBase64: Buffer.from("git push; echo \"STELOW_PUSH_EXIT:$?\"\r").toString("base64") });
        } catch (error) {
          return { ok: false, message: error instanceof Error ? `Push shell opened (${terminal.id}) but git push could not be sent: ${error.message}` : `Push shell opened (${terminal.id}) but git push could not be sent.`, terminalId: terminal.id };
        }
        recordPublication(cardId, "push_terminal", `Ran git push in shell ${terminal.id} on ${branch}.`, null);
        return { ok: true, message: `Push running in shell ${terminal.id} — watch Push shells below for the result.`, terminalId: terminal.id };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "BB could not open a push terminal.", terminalId: null as string | null };
      }
    },

    async publicationPullPush({ cardId }) {
      const prepared = await publicationEnvironment(cardId);
      if ("error" in prepared) return { ok: false, message: prepared.error, terminalId: null as string | null };
      const branch = prepared.snapshot.branch?.current;
      if (!branch) return { ok: false, message: "BB could not determine this checkout's branch.", terminalId: null as string | null };
      try {
        // The decided Git workflow for rejected pushes: pull with rebase
        // (linear history, no merge commits for lay users), then push — one
        // confirmed click. A conflicted pull aborts itself (REBASE_HEAD
        // present): the checkout returns to its pre-pull state, nothing is
        // lost, and the panel names the manual exit. BB exposes no pull
        // action, so this runs shell-mediated like push, with sentinels for
        // each step.
        const live = await livePushShell(prepared.environmentId);
        if (live) {
          return { ok: false, message: `A push is already running in shell ${live.id} — Check result instead of starting another.`, terminalId: live.id };
        }
        await retirePushShells(prepared.environmentId);
        const terminal = await bb.sdk.terminals.create({
          cols: 120,
          rows: 30,
          scope: { kind: "environment", environmentId: prepared.environmentId },
          start: { mode: "shell" },
          title: `Stelow push — ${branch}`,
        });
        for (let attempt = 0; attempt < 5; attempt++) {
          const liveTerminal = await bb.sdk.terminals.get({ terminalId: terminal.id }).catch(() => null);
          if (liveTerminal?.status === "running") break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        try {
          await bb.sdk.terminals.input({ terminalId: terminal.id, dataBase64: Buffer.from("git pull --rebase; echo \"STELOW_SYNC_EXIT:$?\"; if git rev-parse --verify REBASE_HEAD >/dev/null 2>&1; then git rebase --abort; echo \"STELOW_SYNC_ABORTED:1\"; fi; git push; echo \"STELOW_PUSH_EXIT:$?\"\r").toString("base64") });
        } catch (error) {
          return { ok: false, message: error instanceof Error ? `Sync shell opened (${terminal.id}) but the command could not be sent: ${error.message}` : `Sync shell opened (${terminal.id}) but the command could not be sent.`, terminalId: terminal.id };
        }
        recordPublication(cardId, "push_terminal", `Ran pull --rebase + push in shell ${terminal.id} on ${branch}.`, null);
        return { ok: true, message: `Sync & push running in shell ${terminal.id} — watch Push shells below for the result.`, terminalId: terminal.id };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "BB could not open a sync shell.", terminalId: null as string | null };
      }
    },

    async publicationPushTerminals({ cardId }) {
      const prepared = await publicationEnvironment(cardId);
      if ("error" in prepared) return { ok: false, error: prepared.error, remote: null, terminals: [] };
      try {
        const pushSessions = await pushShellSessions(prepared.environmentId);
        const terminals = await Promise.all(pushSessions.map(async (session) => {
          const read = await readPushShell(session);
          return { id: session.id, title: session.title, status: session.status, exitCode: session.exitCode, createdAt: session.createdAt, pushState: read.pushState, pushExit: read.pushExit, outputTail: read.text, outputUnavailable: read.unavailable };
        }));
        // The remote lives in git's own `To <url>` line: newest shell first,
        // first parseable wins. Absent until a push actually ran — links wait.
        let remote: { owner: string; repo: string; webUrl: string } | null = null;
        for (const terminal of terminals) {
          remote = parsePushRemoteUrl(terminal.outputTail);
          if (remote) break;
        }
        return { ok: true, error: null, remote, terminals };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "BB could not list push shells.", remote: null, terminals: [] };
      }
    },

    async publicationPullRequestAction({ cardId, operation, method }) {      const prepared = await publicationEnvironment(cardId);
      if ("error" in prepared) return { ok: false, message: prepared.error, pullRequestUrl: null };
      const url = prepared.snapshot.pullRequest?.url ?? null;
      const capability = operation === "merge"
        ? prepared.snapshot.capabilities.mergePullRequest
        : operation === "ready"
          ? prepared.snapshot.capabilities.markReady
          : prepared.snapshot.capabilities.markDraft;
      if (!capability.available) return { ok: false, message: capability.reason ?? "This pull-request action is unavailable.", pullRequestUrl: url };
      try {
        if (operation === "ready") {
          const result = await bb.sdk.environments.markPullRequestReady({ environmentId: prepared.environmentId });
          recordPublication(cardId, "pull_request_ready", result.message, null, url);
          return { ok: true, message: result.message, pullRequestUrl: url };
        }
        if (operation === "draft") {
          const result = await bb.sdk.environments.markPullRequestDraft({ environmentId: prepared.environmentId });
          recordPublication(cardId, "pull_request_draft", result.message, null, url);
          return { ok: true, message: result.message, pullRequestUrl: url };
        }
        const result = await bb.sdk.environments.mergePullRequest({ environmentId: prepared.environmentId, method: method ?? "squash" });
        recordPublication(cardId, "pull_request_merge", result.message, null, url);
        return { ok: true, message: result.message, pullRequestUrl: url };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "BB could not apply this pull-request action.", pullRequestUrl: url };
      }
    },

    async runResearchStrategy({ cardId, strategy }) {
      // Composite research: run another strategy round on the same card.
      // Spawns a fresh worker on the new playbook that APPENDS a new ###
      // section to the index — existing items are never rewritten. The
      // previous worker retires only after the new one is live (same safe
      // order as every respawn).
      const card = getCard(cardId);
      if (!card) return { ok: false, strategy: null, error: ERR_CARD_NOT_FOUND };
      if (card.kind !== "research") return { ok: false, strategy: null, error: "Only research cards run strategies. Build cards advance stages instead." };
      if (card.status === "archived") return { ok: false, strategy: null, error: ERR_CARD_ARCHIVED };
      const picked = researchStrategyById(strategy);
      if (!picked) {
        return { ok: false, strategy: null, error: `Unknown research strategy "${strategy}". Pick one of: ${RESEARCH_STRATEGIES.map((entry) => entry.id).join(", ")}.` };
      }
      const effective = getReliablePresetForBand("research", cardId);
      const roundNo = strategyList(card).length + 1;
      const roundStamp = roundTimestamp();
      const roundAt = new Date(now()).toISOString();
      const fanoutWorkspace = await cardWorkspace(card).catch(() => null);
      const fanoutStateDir = card.dir_hash && fanoutWorkspace?.path ? await workflowStateDir(bb, fanoutWorkspace.path, card.id, card.dir_hash).catch(() => null) : null;
      const roundFile = fanoutStateDir && fanoutWorkspace?.path
        ? roundRelPath(fanoutStateDir, fanoutWorkspace.path, roundFileName(picked.id, roundNo, roundStamp))
        : "";
      if (roundFile && fanoutWorkspace?.path) await ensureArtifactParent(fanoutWorkspace.path, roundFile);
      const result = await respawnWorkerForBand(cardId, effective.id, "strategy-add", { strategyId: picked.id, flavor: "append", roundNo, roundStamp, roundFile });
      if (!result.ok) return { ok: false, strategy: null, error: result.error ?? "Could not start the strategy round." };
      const history = [...strategyRounds(card), { id: picked.id, at: roundAt, file: roundFile }];
      db.prepare("UPDATE cards SET research_strategies = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(history), now(), cardId);
      const presetName = getPresetById(effective.id)?.name ?? effective.id;
      logCardComment(cardId, "card", cardId, "agent", `Started a ${picked.label} research round on preset "${presetName}". Results will be added to this card. Previous worker archived.`);
      bb.realtime.publish("card-state", { cardId });
      return { ok: true, strategy: picked.id, error: null };
    },

    async answerExpiredQuestions({ cardId, answers }) {
      // Timed-out questions remain one atomic blocking decision. Never resume
      // the worker with a subset: later answers may reverse its direction.
      const card = getCard(cardId);
      if (!card) return { ok: false as const, answered: 0, error: ERR_CARD_NOT_FOUND };
      if (isArchivedCard(card)) return { ok: false as const, answered: 0, error: ERR_CARD_ARCHIVED };
      const openRows = db.prepare("SELECT id, thread_id, question FROM expired_questions WHERE card_id = ? AND answered = 0").all(cardId) as Array<{ id: string; thread_id: string; question: string }>;
      const openIds = new Set(openRows.map((row) => row.id));
      const rows = new Map<string, { thread_id: string; question: string; answers: string[] }>();
      for (const item of answers) {
        const row = openRows.find((entry) => entry.id === item.questionId);
        const cleanAnswers = cleanAnswerList(item.answers);
        if (row && !rows.has(item.questionId) && cleanAnswers.length > 0) rows.set(item.questionId, { thread_id: row.thread_id, question: row.question, answers: cleanAnswers });
      }
      if (openIds.size === 0) return { ok: false as const, answered: 0, error: "Questions not found or already answered." };
      if (rows.size !== openIds.size) return { ok: false as const, answered: 0, error: "Answer every pending question before submitting." };
      const decisions: Array<{ question: string; answers: string[] }> = [];
      // Resume the CURRENT worker: the row's thread may be stale (restart /
      // reseed archives the thread but keeps its expired questions).
      const threadId = card.worker_thread_id ?? rows.values().next().value?.thread_id ?? null;
      db.transaction(() => {
        for (const [questionId, row] of rows) {
          const matched = consumeAskContract(db, cardId, row.question);
          logCardComment(cardId, "card", cardId, "user", `Answer to a pending question${matched ? ` (contract: ${matched})` : ""}:\n\nQ: ${row.question}\nA: ${row.answers.join(", ")}`);
          db.prepare("UPDATE expired_questions SET answered = 1 WHERE id = ?").run(questionId);
          decisions.push({ question: row.question, answers: row.answers });
        }
      })();
      // Recovered split asks record through the same shared helper as live
      // asks; otherwise a valid response would resume the worker but make
      // `bb stelow split` refuse as unanswered.
      recordSplitAnswer(db, cardId, decisions);
      markQuestionsAnswered(db, { cardId, interactionIds: [...rows.keys()].map((questionId) => `expired:${questionId}`), occurredAt: now() });
      const openQuestionIds = await syncOpenQuestionInbox(card);
      // Same stale-error rule as live answers: answering clears the
      // interrupted turn's failure so the recovered card reads coherent.
      updateCard(cardId, { activity: hasOpenQuestions(cardId, openQuestionIds) ? "awaiting-answer" : "running", status: "in-progress", last_error: null });
      bb.realtime.publish("card-state", { cardId });
      if (threadId) {
        try {
          await bb.sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text: formatBatchContinuation(decisions), mentions: [] }] });
        } catch {
          // Thread may be stopped; the comments still record the answers.
        }
      }
      return { ok: true as const, answered: decisions.length, error: null };
    },

    async advanceCard({ cardId, stage }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, stdout: "", error: ERR_CARD_NOT_FOUND };
      if (isArchivedCard(card)) return { ok: false, stdout: "", error: ERR_CARD_ARCHIVED };
      if (card.kind === "research") return { ok: false, stdout: "", error: "Research cards don't use stages — a completed index moves them to Done automatically." };
      if (card.kind === "explore") return { ok: false, stdout: "", error: "Explore cards don't use stages — a completed artifact moves them to Done automatically." };
      const workspace = await cardWorkspace(card);
      if (!workspace?.path) return { ok: false, stdout: "", error: ERR_WORKSPACE_UNAVAILABLE };
      const stateDir = card.dir_hash ? await workflowStateDir(bb, workspace.path, card.id, card.dir_hash) : null;
      const source = { path: workspace.path, hostId: workspace.hostId };
      const guard = await ensureProjectArtifacts(bb, source.path, stateDir, Boolean(card.dir_hash));
      if (guard) return { ok: false, stdout: "", error: guard };
      // Check the stage being left before the helper mutates state.md. The
      // workflow file is slug truth, so a refusal leaves both it and the DB
      // card at the same stage.
      const questionGuard = await questionContractsGate(card, stateDir);
      if (questionGuard) return { ok: false, stdout: "", error: questionGuard };
      const result = await runHelper(["advance", stage], source.path, stateDir ?? undefined);
      if (result.code !== 0) return { ok: false, stdout: result.stdout, error: result.stderr || "stelow advance failed" };
      // Band-preset swap, mirroring the CLI advance path: if the phase of the
      // stage just advanced to defines a preset different from this worker's,
      // respawn with the phase preset on the same state dir.
      const band = STAGE_TO_BAND[stage];
      const bandPreset = band ? getReliablePresetForBand(band, card.id) : null;
      const currentPresetId = card.worker_preset_id ?? getPresetForCard(card.id).id;
      if (band && bandPreset && bandPreset.id !== currentPresetId) {
        await respawnWorkerForBand(card.id, bandPreset.id);
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
      if (!rootPath) return { stage: "", stdout: "", error: "Project workspace path is unavailable." };
      const guard = await ensureProjectArtifacts(bb, rootPath);
      if (guard) return { stage, stdout: "", error: guard };
      const result = await runHelper(["advance", stage], rootPath);
      if (result.code !== 0) return { stage, stdout: result.stdout, error: result.stderr || "stelow advance failed" };
      bb.realtime.publish("board-changed", { stage });
      return { stage, stdout: result.stdout, error: null };
    },

    async listPresets() {
      // Per-card override rows (card-override-*) are implementation detail of
      // a single card's custom provider/model choice — not reusable presets.
      // Hide them so neither the board manager nor the card dialog is polluted.
      const rows = db.prepare("SELECT * FROM presets WHERE id NOT LIKE 'card-override-%' ORDER BY is_default DESC, name COLLATE NOCASE ASC").all() as PresetRow[];
      return {
        presets: rows.map((row) => ({
          id: row.id,
          name: row.name,
          providerId: row.provider_id,
          modelId: row.model_id,
          reasoningLevel: row.reasoning_level,
          permissionMode: row.permission_mode,
          environmentKind: row.environment_kind,
          baseBranch: row.base_branch,
          machineId: row.machine_id,
          instructions: row.instructions,
          isDefault: row.is_default === 1,
          builtIn: row.built_in === 1,
        })),
      };
    },

    async upsertPreset({ id, name, providerId, modelId, reasoningLevel, permissionMode, environmentKind, baseBranch, machineId, instructions }) {
      const trimmed = name.trim();
      if (!trimmed) return { preset: { id: "", name: "" } };
      // Empty-string ids must never reach the database (SQLite accepts "" as
      // a primary key, but the UI cannot distinguish editing it from creating
      // a new one). Any falsey id mints a fresh one.
      const effectiveId = id || `preset_${Math.random().toString(36).slice(2, 10)}`;
      const collision = db.prepare("SELECT id FROM presets WHERE LOWER(name) = LOWER(?) AND id != ?").get(trimmed, effectiveId) as { id: string } | undefined;
      if (collision) throw new Error(`A preset named "${trimmed}" already exists.`);
      const existing = db.prepare("SELECT id, built_in FROM presets WHERE id = ?").get(effectiveId) as { id: string; built_in: number } | undefined;
      if (existing?.built_in === 1 && (!id || id !== effectiveId)) {
        throw new Error("Built-in presets cannot be renamed or duplicated; create a new one instead.");
      }
      const ts = now();
      if (existing) {
        db.prepare("UPDATE presets SET name = ?, provider_id = ?, model_id = ?, reasoning_level = ?, permission_mode = ?, environment_kind = ?, base_branch = ?, machine_id = ?, instructions = ?, updated_at = ? WHERE id = ?").run(
          trimmed, providerId, modelId, reasoningLevel, permissionMode, environmentKind, baseBranch ?? null, machineId ?? null, instructions, ts, effectiveId,
        );
      } else {
        db.prepare("INSERT INTO presets (id, name, provider_id, model_id, reasoning_level, permission_mode, environment_kind, base_branch, machine_id, instructions, is_default, built_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)").run(
          effectiveId, trimmed, providerId, modelId, reasoningLevel, permissionMode, environmentKind, baseBranch ?? null, machineId ?? null, instructions, ts, ts,
        );
      }
      return { preset: { id: effectiveId, name: trimmed } };
    },

    async deletePreset({ id }) {
      const row = db.prepare("SELECT built_in FROM presets WHERE id = ?").get(id) as { built_in: number } | undefined;
      if (!row) return { deleted: false, error: ERR_PRESET_NOT_FOUND };
      if (row.built_in === 1) return { deleted: false, error: "Built-in presets cannot be deleted." };
      const inUse = db.prepare("SELECT COUNT(*) AS count FROM card_presets WHERE preset_id = ?").get(id) as { count: number };
      if (inUse.count > 0) return { deleted: false, error: `Preset is assigned to ${inUse.count} card(s). Unassign first.` };
      db.prepare("DELETE FROM presets WHERE id = ?").run(id);
      // Band/reliable/reviewer rows cascade silently, so live workers running
      // under the deleted preset re-evaluate against their new fallback.
      for (const card of liveWorkerCards(db, null)) {
        const band = bandForCardKindStage(card.kind, card.stage);
        refreshRestartPending(db, card.id, card.worker_thread_id, card.worker_preset_id, getReliablePresetForBand(band, card.id).id);
      }
      return { deleted: true, error: null };
    },

    async listBandPresets() {
      const rows = db.prepare("SELECT band, preset_id FROM stage_presets").all() as Array<{ band: string; preset_id: string }>;
      const map: Record<string, string> = {};
      for (const row of rows) map[row.band] = row.preset_id;
      return { bands: Object.keys(STAGE_BANDS).map((band) => ({ band, presetId: map[band] ?? null, stages: STAGE_BANDS[band] })) };
    },

    async setBandPreset({ band, presetId }) {
      if (!STAGE_BANDS[band]) return { ok: false, error: `Unknown band: ${band}` };
      if (presetId) {
        if (!getPresetById(presetId)) return { ok: false, error: ERR_PRESET_NOT_FOUND };
        db.prepare("INSERT OR REPLACE INTO stage_presets (band, preset_id, assigned_at) VALUES (?, ?, ?)").run(band, presetId, now());
      } else {
        db.prepare("DELETE FROM stage_presets WHERE band = ?").run(band);
      }
      // Provider/model are fixed at spawn: only this band's live workers can
      // run stale after the change, so only they re-evaluate restart-pending.
      for (const card of liveWorkerCards(db, [band])) {
        refreshRestartPending(db, card.id, card.worker_thread_id, card.worker_preset_id, getReliablePresetForBand(band, card.id).id);
      }
      return { ok: true, error: null };
    },

    async getReviewPreset() {
      const row = db.prepare("SELECT preset_id FROM review_preset WHERE id = 1").get() as { preset_id: string } | undefined;
      const preset = row ? getPresetById(row.preset_id) : null;
      return {
        preset: preset ? { id: preset.id, name: preset.name, providerId: preset.provider_id, modelId: preset.model_id, reasoningLevel: preset.reasoning_level, permissionMode: preset.permission_mode } : null,
      };
    },

    async assignReviewPreset({ presetId }) {
      if (presetId) {
        if (!getPresetById(presetId)) return { ok: false, error: ERR_PRESET_NOT_FOUND };
        db.prepare("INSERT OR REPLACE INTO review_preset (id, preset_id, assigned_at) VALUES (1, ?, ?)").run(presetId, now());
      } else {
        db.prepare("DELETE FROM review_preset WHERE id = 1").run();
      }
      bb.realtime.publish("board-changed", { presetId });
      return { ok: true, error: null };
    },

    async getGenerationPreset() {
      const row = db.prepare("SELECT preset_id FROM generation_preset WHERE id = 1").get() as { preset_id: string } | undefined;
      const preset = row ? getPresetById(row.preset_id) : null;
      return {
        preset: preset ? { id: preset.id, name: preset.name, providerId: preset.provider_id, modelId: preset.model_id, reasoningLevel: preset.reasoning_level, permissionMode: preset.permission_mode } : null,
      };
    },

    async assignGenerationPreset({ presetId }) {
      if (presetId) {
        if (!getPresetById(presetId)) return { ok: false, error: ERR_PRESET_NOT_FOUND };
        db.prepare("INSERT OR REPLACE INTO generation_preset (id, preset_id, assigned_at) VALUES (1, ?, ?)").run(presetId, now());
      } else {
        db.prepare("DELETE FROM generation_preset WHERE id = 1").run();
      }
      bb.realtime.publish("board-changed", { presetId });
      return { ok: true, error: null };
    },

    async getReliablePreset() {
      const row = db.prepare("SELECT preset_id FROM reliable_preset WHERE id = 1").get() as { preset_id: string } | undefined;
      const preset = row ? getPresetById(row.preset_id) : null;
      return {
        preset: preset ? { id: preset.id, name: preset.name, providerId: preset.provider_id, modelId: preset.model_id, reasoningLevel: preset.reasoning_level, permissionMode: preset.permission_mode } : null,
      };
    },

    async assignReliablePreset({ presetId }) {
      if (presetId) {
        if (!getPresetById(presetId)) return { ok: false, error: ERR_PRESET_NOT_FOUND };
        db.prepare("INSERT OR REPLACE INTO reliable_preset (id, preset_id, assigned_at) VALUES (1, ?, ?)").run(presetId, now());
      } else {
        db.prepare("DELETE FROM reliable_preset WHERE id = 1").run();
      }
      // Provider/model are fixed at spawn: every live worker whose effective
      // preset changed under it offers Restart instead of a Resume that
      // changes nothing. Cards with a per-card pin are unaffected (the pin
      // still wins) — refreshRestartPending recomputes their flag harmlessly.
      for (const card of liveWorkerCards(db, null)) {
        const band = bandForCardKindStage(card.kind, card.stage);
        refreshRestartPending(db, card.id, card.worker_thread_id, card.worker_preset_id, getReliablePresetForBand(band, card.id).id);
      }
      bb.realtime.publish("board-changed", { presetId });
      return { ok: true, error: null };
    },

    // The key itself never leaves the host: reads report presence + source
    // only, so panels and logs cannot leak it.
    async getDecisionApiConfig() {
      const row = db.prepare("SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1").get() as { endpoint: string; api_key: string; model: string; provider: string | null } | undefined;
      const { key, source } = resolveDecisionApiKey({ storedKey: row?.api_key ?? null, env: process.env });
      const provider = normalizeDecisionProvider(row?.provider ?? "jev");
      return {
        endpoint: row?.endpoint ?? defaultEndpointFor(provider),
        model: normalizeDecisionApiModel(row?.model, defaultModelFor(provider)),
        hasKey: key !== null,
        keySource: source,
        keyRequired: providerRequiresKey(provider),
        disabled: isDecisionApiDisabled(process.env),
        provider,
        configured: row !== undefined,
      };
    },

    async setDecisionApiConfig({ endpoint, apiKey, model, provider }) {
      const current = db.prepare("SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1").get() as { endpoint: string; api_key: string; model: string; provider: string | null } | undefined;
      const nextProvider = provider === undefined ? normalizeDecisionProvider(current?.provider ?? "jev") : normalizeDecisionProvider(provider, "");
      if (!nextProvider) return { ok: false, error: `Unknown provider "${provider}". Available: ${DECISION_PROVIDERS.map((entry) => entry.id).join(", ")}.` };
      const nextEndpoint = endpoint === undefined ? (current?.endpoint ?? defaultEndpointFor(nextProvider)) : (endpoint ?? defaultEndpointFor(nextProvider));
      if (!isDecisionApiEndpointValid(nextEndpoint)) return { ok: false, error: "Endpoint must be an http(s) URL (e.g. https://api.typesafe.ai/v1/systemone)." };
      const nextModel = model === undefined ? (current?.model ?? defaultModelFor(nextProvider)) : normalizeDecisionApiModel(model, defaultModelFor(nextProvider));
      if (!nextModel) return { ok: false, error: "Model must name a version (e.g. jev-latest)." };
      const nextKey = apiKey === undefined ? (current?.api_key ?? "") : (apiKey ?? "");
      db.prepare("INSERT OR REPLACE INTO decision_api_config (id, endpoint, api_key, model, provider, updated_at) VALUES (1, ?, ?, ?, ?, ?)").run(nextEndpoint.trim(), nextKey, nextModel, nextProvider, now());
      return { ok: true, error: null };
    },

    // Explicit probe: one fixed Noul question, reported with latency. The
    // only place the host spends Decision API budget on demand — background
    // paths fail soft to built-in rules instead.
    async testDecisionApi() {
      if (isDecisionApiDisabled(process.env)) return { ok: false, latencyMs: null, model: null, error: "Decision API is disabled on this host (STELOW_DECISION_API=0)." };
      const row = db.prepare("SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1").get() as { endpoint: string; api_key: string; model: string; provider: string | null } | undefined;
      const provider = normalizeDecisionProvider(row?.provider ?? "jev");
      const { key } = resolveDecisionApiKey({ storedKey: row?.api_key ?? null, env: process.env });
      if (!key && providerRequiresKey(provider)) return { ok: false, latencyMs: null, model: null, error: "No key: set one in Decision API settings or export DECISION_API_KEY." };
      const probe = buildProbeCall(provider);
      const result = await evaluateDecisionCall({
        provider,
        endpoint: row?.endpoint ?? defaultEndpointFor(provider),
        apiKey: key ?? "",
        model: normalizeDecisionApiModel(row?.model, defaultModelFor(provider)),
        state: probe.state,
        questions: probe.questions,
      });
      if (!result.ok) return { ok: false, latencyMs: null, model: null, error: result.error ?? "the Decision API call failed" };
      return { ok: true, latencyMs: result.latencyMs ?? null, model: result.model ?? null, error: null };
    },

    async getDecisionPoint({ point }) {
      const def = getDecisionPointDef(point);
      const row = db.prepare("SELECT mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points WHERE point = ?").get(point) as { mode: string; thresholds: string; provider: string | null; endpoint: string | null; api_key: string | null; model: string | null; preset_id: string | null } | undefined;
      const fallback = def?.defaultThresholds ?? { routeAt: 0.6 };
      let stored: unknown = null;
      try { stored = row ? JSON.parse(row.thresholds) : null; } catch { stored = null; }
      const route = row ? normalizePointRoute({ provider: row.provider, endpoint: row.endpoint, apiKey: row.api_key, model: row.model }) : null;
      return {
        point,
        mode: normalizePointMode(row?.mode, def?.defaultMode ?? "rules"),
        thresholds: normalizeThresholds(stored, fallback),
        route: route && (route.provider ?? route.endpoint ?? route.apiKey ?? route.model) ? route : null,
        presetId: row?.preset_id ?? null,
      };
    },

    async listDecisionPoints() {
      const rows = db.prepare("SELECT point, mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points").all() as Array<{ point: string; mode: string; thresholds: string; provider: string | null; endpoint: string | null; api_key: string | null; model: string | null; preset_id: string | null }>;
      const byId = new Map(rows.map((row) => [row.point, row]));
      return {
        points: DECISION_POINTS.map((def) => {
          const row = byId.get(def.id);
          let stored: unknown = null;
          try { stored = row ? JSON.parse(row.thresholds) : null; } catch { stored = null; }
          const route = row ? normalizePointRoute({ provider: row.provider, endpoint: row.endpoint, apiKey: row.api_key, model: row.model }) : null;
          return {
            id: def.id,
            label: def.label,
            description: def.description,
            rules: def.rules,
            requires: def.requires ?? null,
            modes: [...def.modes],
            mode: normalizePointMode(row?.mode, def.defaultMode),
            thresholds: normalizeThresholds(stored, def.defaultThresholds),
            route: route && (route.provider ?? route.endpoint ?? route.apiKey ?? route.model) ? route : null,
            presetId: row?.preset_id ?? null,
          };
        }),
      };
    },

    async setDecisionPoint({ point, mode, thresholds, route, presetId }) {
      const def = getDecisionPointDef(point);
      if (!def) return { ok: false, error: `Unknown decision point "${point}". Available: ${DECISION_POINTS.map((entry) => entry.id).join(", ")}.` };
      if (!def.modes.includes(mode)) return { ok: false, error: `Unknown mode "${mode}" for ${point}. Available: ${def.modes.join(", ")}.` };
      if (mode === "api" && isDecisionApiDisabled(process.env)) return { ok: false, error: "Decision API is disabled on this host (STELOW_DECISION_API=0)." };
      const existing = db.prepare("SELECT provider, endpoint, api_key, model, preset_id FROM decision_points WHERE point = ?").get(point) as { provider: string | null; endpoint: string | null; api_key: string | null; model: string | null; preset_id: string | null } | undefined;
      // Absent params preserve the stored row; explicit null clears. Flipping
      // modes never silently drops a configured route or preset.
      const nextRoute = route === undefined
        ? normalizePointRoute({ provider: existing?.provider ?? null, endpoint: existing?.endpoint ?? null, apiKey: existing?.api_key ?? null, model: existing?.model ?? null })
        : normalizePointRoute(route);
      let presetRow: string | null = presetId === undefined ? (existing?.preset_id ?? null) : presetId;
      // Preset judging burns a full provider turn per judgment: only points
      // that allow it accept the mode, and only with a preset that exists.
      // Anything else refuses at save time — a misconfigured point never
      // silently degrades at use time.
      if (mode === "preset") {
        if (!pointSupportsPresetJudge(point)) return { ok: false, error: `"${point}" cannot judge via preset: hot paths stay on rules/api so judgments never burn worker turns.` };
        if (typeof presetRow !== "string" || presetRow.length === 0) return { ok: false, error: `Preset mode needs a judge preset — pick any preset, including one no stage uses.` };
        if (!getPresetById(presetRow)) return { ok: false, error: `Unknown preset "${presetRow}".` };
      }
      const next = normalizeThresholds(thresholds ?? null, def.defaultThresholds);
      db.prepare("INSERT OR REPLACE INTO decision_points (point, mode, thresholds, provider, endpoint, api_key, model, preset_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(point, mode, JSON.stringify(next), nextRoute.provider, nextRoute.endpoint, nextRoute.apiKey, nextRoute.model, presetRow, now());
      bb.realtime.publish("board-changed", { point });
      return { ok: true, error: null };
    },

    async getReviewPolicy() {
      const row = db.prepare("SELECT mode FROM review_policy WHERE id = 1").get() as { mode: string } | undefined;
      return { mode: row?.mode === "required" ? "required" as const : "off" as const };
    },

    async setReviewPolicy({ mode }) {
      db.prepare("INSERT OR REPLACE INTO review_policy (id, mode, assigned_at) VALUES (1, ?, ?)").run(mode, now());
      bb.realtime.publish("board-changed", { reviewPolicy: mode });
      return { ok: true, error: null };
    },

    async assignPreset({ cardId, presetId }) {
      const card = getCard(cardId);
      if (!card) return { ok: false, error: ERR_CARD_NOT_FOUND };
      if (presetId === null) {
        db.prepare("DELETE FROM card_presets WHERE card_id = ?").run(cardId);
        // Drop this card's private override row (if any) so custom choices
        // don't accumulate dead rows; it is unreferenced after the reset.
        db.prepare("DELETE FROM presets WHERE id = ?").run(`card-override-${cardId}`);
      } else {
        const preset = getPresetById(presetId);
        if (!preset) return { ok: false, error: ERR_PRESET_NOT_FOUND };
        db.prepare("INSERT OR REPLACE INTO card_presets (card_id, preset_id, assigned_at) VALUES (?, ?, ?)").run(cardId, presetId, now());
        // A live worker predating the new preset will never pick it up
        // (provider/model are fixed at spawn): flag it so the card offers
        // Restart instead of a Resume that changes nothing.
        refreshRestartPending(db, cardId, card.worker_thread_id, card.worker_preset_id, presetId);
      }
      bb.realtime.publish("card-state", { cardId });
      return { ok: true, error: null };
    },

    async setDefaultPreset({ id }) {
      const preset = getPresetById(id);
      if (!preset) return { ok: false, error: ERR_PRESET_NOT_FOUND };
      db.prepare("UPDATE presets SET is_default = 0").run();
      db.prepare("UPDATE presets SET is_default = 1 WHERE id = ?").run(id);
      bb.realtime.publish("board-changed", { presetId: id });
      return { ok: true, error: null };
    },

    async listProviderModels() {
      const providers = await bb.sdk.providers.list().catch(() => []);
      const models: Array<{ providerId: string; model: string; displayName: string }> = [];
      const availability = new Map<string, boolean>();
      for (const provider of providers) {
        const result = await bb.sdk.providers.models({ providerId: provider.id }).catch(() => null);
        availability.set(provider.id, result !== null);
        if (provider.id === "pi") {
          const catalog = new Map((result?.models ?? []).map((model) => [model.model, model.displayName]));
          for (const model of PI_BIFROST_PRESET_MODELS) {
            models.push({ providerId: "pi", model: model.model, displayName: catalog.get(model.model) ?? model.displayName });
          }
          continue;
        }
        for (const model of result?.models ?? []) {
          models.push({ providerId: provider.id, model: model.model, displayName: model.displayName });
        }
      }
      return { providers: providers.map((provider) => ({ id: provider.id, displayName: provider.displayName, modelsAvailable: availability.get(provider.id) ?? false })), models };
    },

    async buildInfo() {
      // The About panel and sidebar each issue one read on mount.  Do the
      // lightweight BB-owned check as part of that read, rather than handing
      // them an initial "checking" cache value that has no later push event.
      // refreshPluginUpdate is fail-soft, so this never makes the panel fail.
      await refreshPluginUpdate();
      let skills: string[] = [];
      try {
        skills = readdirSync(PLUGIN_SKILLS_DIR, { withFileTypes: true })
          .filter((e) => e.isDirectory() && e.name.startsWith("stelow-"))
          .map((e) => e.name)
          .sort();
      } catch { /* panel shows an empty list */ }
      return { version: BUILD_INFO.version, builtAt: BUILD_INFO.builtAt, stelowVersion: readPinnedStelowVersion(), skills, pluginUpdate, githubRelease };
    },
    async applyPluginUpdate() {
      try {
        const result = await bb.sdk.plugins.applyUpdate({ pluginId: bb.pluginId });
        await refreshPluginUpdate(true);
        return { applied: result.applied, outcome: result.outcome, detail: result.detail ?? null, from: result.from.version, to: result.to?.version ?? null };
      } catch (error) {
        return { applied: false, outcome: "unavailable" as const, detail: error instanceof Error ? error.message : String(error), from: null, to: null };
      }
    },
    async checkPluginUpdate() {
      await refreshPluginUpdate(true);
      return { pluginUpdate, githubRelease };
    },

    // About identity mark. Served as a data URI (never a static file URL —
    // see lib/about-logo.mjs), read once from the source root and memoized.
    // Missing asset yields null and the tab falls back to text, never a
    // broken image.
    async aboutLogo() {
      if (aboutLogoCache === undefined) aboutLogoCache = loadAboutLogo(pluginDir);
      return { dataUri: aboutLogoCache ?? null };
    },

    // Presence probe for the optional host binaries the workflow knows how
    // to use (About tab). Read-only `--version` calls, 8s each, parallel;
    // anything missing/slow yields present:false — never a throw. One id
    // per tool; bins are tried in order, first success wins.
    async toolStatus() {
      const candidates: Array<{ id: string; bins: string[] }> = [
        { id: "sem", bins: [resolveLocalBin("sem")] },
        { id: "ast-grep", bins: [resolveLocalBin("ast-grep"), resolveLocalBin("sg")] },
        { id: "cymbal", bins: [resolveLocalBin("cymbal")] },
        { id: "ripwire", bins: [resolveLocalBin("ripwire")] },
      ];
      const probe = (bins: string[]): Promise<{ present: boolean; version: string | null }> => {
        const [bin, ...rest] = bins;
        if (!bin) return Promise.resolve({ present: false, version: null });
        return new Promise((resolve) => {
          execFile(bin, ["--version"], { timeout: 8000, maxBuffer: 64 * 1024 }, (error, stdout) => {
            if (!error && typeof stdout === "string" && stdout.trim()) {
              resolve({ present: true, version: stdout.trim().split("\n")[0]?.slice(0, 60) ?? null });
              return;
            }
            void probe(rest).then(resolve);
          });
        });
      };
      const tools = await Promise.all(candidates.map(async ({ id, bins }) => ({ id, ...(await probe(bins)) })));
      return { tools };
    },

    // Install one optional tool on explicit user request (About tab button).
    // Static command map — no user input reaches a shell. Everything lands
    // in ~/.local/bin (what resolveLocalBin probes); never sudo, never
    // outside HOME. Success is verified by re-probing, not by exit code
    // alone; the log tail explains failures inline in the UI.
    async installTool({ id }) {
      const tailLines = (text: string) => text.split("\n").slice(-25).join("\n").slice(-2000);
      const run = (cmd: string, args: string[], extraEnv: Record<string, string> = {}): Promise<{ code: number; out: string }> =>
        new Promise((resolve) => {
          execFile(cmd, args, { timeout: 300000, maxBuffer: 1024 * 1024, env: { ...process.env, ...extraEnv } }, (error, stdout, stderr) => {
            const out = `${typeof stdout === "string" ? stdout : ""}\n${typeof stderr === "string" ? stderr : ""}`.trim();
            resolve({ code: error ? 1 : 0, out });
          });
        });
      const tmpScript = `.stelow-tool-install-${id}-${process.pid}-${Date.now()}.sh`;
      const tmpPath = nodeJoin(tmpdir(), tmpScript);
      let log = "";
      try {
        if (id === "sem" || id === "ripwire") {
          const scripts: Record<string, { url: string; args: string[]; env: Record<string, string> }> = {
            sem: { url: "https://raw.githubusercontent.com/Ataraxy-Labs/sem/main/install.sh", args: [], env: {} },
            ripwire: { url: "https://raw.githubusercontent.com/redhat-et/ripwire/main/scripts/install.sh", args: [], env: { RIPWIRE_REPO: "redhat-et/ripwire", RIPWIRE_INSTALL_YES: "1", RIPWIRE_NO_ACTIVATE: "1" } },
          };
          const spec = scripts[id]!;
          const download = await run("curl", ["-fsSL", "--max-time", "120", spec.url, "-o", tmpPath]);
          log += download.out;
          if (download.code !== 0) return { ok: false, version: null, log: tailLines(log) || "Download failed." };
          const install = await run("bash", [tmpPath, ...spec.args], spec.env);
          log += `\n${install.out}`;
          if (install.code !== 0) return { ok: false, version: null, log: tailLines(log) || "Installer failed." };
        } else if (id === "ast-grep") {
          // --prefix keeps it in ~/.local (default global prefix is
          // root-owned on servers); bins land in ~/.local/bin.
          const prefix = localBinDir ? nodeJoin(homeDir, ".local") : "";
          const install = await run("npm", ["install", "-g", ...(prefix ? ["--prefix", prefix] : []), "@ast-grep/cli"]);
          log += install.out;
          if (install.code !== 0) return { ok: false, version: null, log: tailLines(log) || "npm install failed." };
        } else {
          // cymbal via go install (CGO per upstream README); GOBIN pins the
          // binary into ~/.local/bin instead of ~/go/bin.
          const install = await run("go", ["install", "github.com/1broseidon/cymbal@latest"], {
            ...(localBinDir ? { GOBIN: localBinDir } : {}),
            CGO_CFLAGS: "-DSQLITE_ENABLE_FTS5",
          });
          log += install.out;
          if (install.code !== 0) return { ok: false, version: null, log: tailLines(log) || "go install failed." };
        }
      } finally {
        try { unlinkSync(tmpPath); } catch { /* best-effort */ }
      }
      const bins: Record<string, string[]> = {
        sem: [resolveLocalBin("sem")],
        "ast-grep": [resolveLocalBin("ast-grep"), resolveLocalBin("sg")],
        cymbal: [resolveLocalBin("cymbal")],
        ripwire: [resolveLocalBin("ripwire")],
      };
      for (const bin of bins[id] ?? []) {
        const check = await run(bin, ["--version"]);
        if (check.code === 0 && check.out.trim()) {
          return { ok: true, version: check.out.trim().split("\n")[0]?.slice(0, 60) ?? null, log: tailLines(log) || "Installed." };
        }
      }
      return { ok: false, version: null, log: tailLines(log) || "Installed but the binary did not respond." };
    },

    async previewState({ cardId, appOrigin }) {
      return await previewView(cardId, appOrigin ?? null);
    },

    async previewStart({ cardId }) {
      return await previewStart(cardId);
    },

    async previewStop({ cardId }) {
      return await previewStop(cardId);
    },

    async previewShare({ cardId }) {
      return await previewShare(cardId);
    },
  },
  // Opt into BB 0.43 RPC discovery so the described methods are listed.
  { experimental_discoverable: true });

  // One command table feeds registration, fallthrough usage, and help text:
  // a new subcommand updates all three by editing this list only.
  const STELOW_CLI_COMMANDS = [
      { name: "status", summary: "Show Stelow workflows", usage: "bb stelow status [--project <proj_id>] [--json]" },
      { name: "ask", summary: "Ask blocking structured questions", usage: "bb stelow ask --thread <thr_id> --question <text> [--multiple] --option <label> [--desc <text>] [--preview <text>] [--artifact <path>]... (repeat --question groups to ask several at once; write all content in English)" },
      { name: "seed", summary: "Seed state.md, transitions.md, stelow.json", usage: "bb stelow seed --project <proj_id> --name <name> --intent <new-product|feature|bugfix|refactor|investigate>" },
      { name: "preview", summary: "Run and inspect a card workspace's dev server", usage: "bb stelow preview [status|start|stop] [--card <card_id>] [--json]" },
      { name: "advance", summary: "Advance to the next Stelow stage", usage: "bb stelow advance [--project <proj_id>] [--dry-run] [--json] <stage>" },
      { name: "done", summary: "Commit workflow completion (verified in code)", usage: "bb stelow done [--card <card_id>]" },
      { name: "split", summary: "Execute the approved card-split proposal (no content args)", usage: "bb stelow split [--card <card_id>]" },
      { name: "playbook", summary: "Print this card's exact state and playbook paths", usage: "bb stelow playbook [--card <card_id>]" },
      { name: "doctor", summary: "Detect workflow drift (locks, intent, state vs transitions)", usage: "bb stelow doctor [--project <proj_id>] [--json]" },
      { name: "schema", summary: "Show machine-readable subcommand contracts", usage: "bb stelow schema [command]" },
      { name: "sync-scopes", summary: "Parse spec-tech scopes into tracking (idempotent)", usage: "bb stelow sync-scopes [--project <proj_id>] [--name <workflow>] [--json]" },
      { name: "lock", summary: "File-reservation locks for parallel scopes", usage: "bb stelow lock <acquire|release|check> [--project <proj_id>] --scope <id> [--file <f>...] [--ttl N] [--json]" },
      { name: "config", summary: "Read workflow config from tracking", usage: "bb stelow config get <field> [default] [--project <proj_id>]" },
      { name: "fan-out", summary: "Fan out index opportunities into build cards", usage: "bb stelow fan-out --opportunity <id> [--opportunity ...] [--card <card_id>] [--project <proj_id>]" },
      { name: "verify", summary: "Verify artifacts, or run the Build card's host-recorded tests", usage: "bb stelow verify [--card <card_id>] [--tests] [--json]" },
      { name: "gap-scopes", summary: "Convert escalated gaps into rework scopes (idempotent)", usage: "bb stelow gap-scopes [--card <card_id>]" },
      { name: "metrics", summary: "Lead/cycle time and gap rates per card, or fleet-wide without --card (read-only)", usage: "bb stelow metrics [--json] [--card <card_id>]" },
      { name: "manifest", summary: "Paste-ready Stelow-Artifacts trailer block for commit messages (read-only)", usage: "bb stelow manifest [--json] [--card <card_id>]" },
      { name: "export", summary: "Refresh docs/runs/<card> plus manifest.md (idempotent, also automatic at done); --check reports content drift and uncommitted state without writing", usage: "bb stelow export [--json] [--check] [--card <card_id>] [--dir <relpath>]" },
      { name: "draft", summary: "Disposable Tier G draft burst on the generation preset (text-in/text-out)", usage: "bb stelow draft --prompt <brief> [--json] [--card <card_id>]" },
      { name: "review", summary: "Independent artifact review by the designated reviewer preset (opt-in, read-only)", usage: "bb stelow review [--card <card_id>] [--artifact <path>]" },
      { name: "criteria", summary: "Score an artifact against its skill's semantic criteria (advisory, read-only)", usage: "bb stelow criteria --skill <skill-id> --artifact <path> [--card <card_id>] [--json]" },
      { name: "verify-tasks", summary: "Judge completed tasks against the working diff (advisory, read-only)", usage: "bb stelow verify-tasks [--card <card_id>] [--json]" },
      { name: "preset", summary: "Manage agent presets", usage: "bb stelow preset list|add|remove|assign" },
      { name: "help", summary: "Show help for a subcommand", usage: "bb stelow help [command]" },
    ];
  bb.cli.register({
    name: "stelow",
    summary: "Inspect and interact with Stelow workflows",
    commands: STELOW_CLI_COMMANDS,
    async run(argv, ctx) {
      if (argv[0] === "help") {
        const text = cliHelpText(STELOW_CLI_COMMANDS, argv[1]);
        if (text === null) {
          const suggestion = argv[1] ? nearestCommand(argv[1], STELOW_CLI_COMMANDS.map((entry) => entry.name)) : null;
          return { exitCode: 2, stderr: `Unknown command "${argv[1] ?? ""}".${suggestion ? ` Did you mean "${suggestion}"?` : ""}\n${cliUsageLine(STELOW_CLI_COMMANDS)}` };
        }
        return { exitCode: 0, stdout: text };
      }
      if (argv[0] === "status") {
        const projectFlag = argv.indexOf("--project");
        const projectId = projectFlag >= 0 ? argv[projectFlag + 1] : ctx.projectId;
        // A card worker's project source root holds no stelow.json (each
        // exploratory card owns its own file), so resolve the owning card
        // first — same pattern as the advance command.
        const cliCard = ctx.threadId ? getCardByWorkerThread(ctx.threadId) : undefined;
        if (cliCard) {
          const workspace = await cardWorkspace(cliCard);
          if (!workspace?.path) return { exitCode: 1, stderr: "Workspace path is unavailable for this card." };
          const board = await boardFromRoot(bb, workspace.path, cliCard.dir_hash);
          if (argv.includes("--json")) return { exitCode: 0, stdout: JSON.stringify(board, null, 2) };
          if (board.error) return { exitCode: 1, stderr: board.error };
          return { exitCode: 0, stdout: board.workflows.map((workflow) => `${workflow.name}\t${workflow.status}\t${workflow.stage}`).join("\n") };
        }
        const board = await loadBoard(bb, projectId ?? null);
        if (argv.includes("--json")) return { exitCode: 0, stdout: JSON.stringify(board, null, 2) };
        if (board.error) return { exitCode: 1, stderr: board.error };
        return { exitCode: 0, stdout: board.workflows.map((workflow) => `${workflow.name}\t${workflow.status}\t${workflow.stage}`).join("\n") };
      }
      if (argv[0] === "ask") {
        const flag = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
        const threadId = flag("--thread") ?? ctx.threadId;
        // --tag marks a machine-readable ask kind. Question content and the
        // surrounding card UI are English-only, so locale is not a choice.
        const tagValues: string[] = [];
        const askArgv: string[] = [];
        for (let i = 1; i < argv.length; i++) {
          if (argv[i] === "--tag") { tagValues.push(argv[i + 1] ?? ""); i++; continue; }
          if (argv[i] === "--locale") return { exitCode: 2, stderr: "Questions are English-only; do not pass --locale." };
          askArgv.push(argv[i]!);
        }
        const tag = tagValues.length > 0 ? tagValues[tagValues.length - 1]! : null;
        if (tag !== null && tag !== "split") return { exitCode: 2, stderr: "Unknown --tag. The only worker ask tag is --tag split (card-split proposals at triage)." };
        // Repeated --question groups ask several questions in ONE blocking
        // call: the human answers them together instead of being pinged N
        // times. Options/--multiple attach to the most recent --question.
        const parsed = parseAskGroups(askArgv);
        if (!threadId) return { exitCode: 2, stderr: "Missing --thread <thr_id>." };
        if (parsed.error || !parsed.groups) return { exitCode: 2, stderr: parsed.error ?? "Usage: bb stelow ask --thread <thr_id> --question <text> [--multiple] --option <label> [--desc <text>] [--preview <text>] [--artifact <path>]..." };
        const groups = parsed.groups.map((group) => ({ question: group.question, multiple: group.multiple, kind: tag === "split" ? "split" as const : "standard" as const, options: group.options.map((o) => ({ label: o.label, description: o.description, preview: o.preview, artifact: o.artifact })), contract: group.contract ?? null }));
        for (const group of groups) {
          const languageError = englishQuestionContentError(group.question, group.options);
          if (languageError) return { exitCode: 2, stderr: languageError };
        }
        const batched = groups.length > 1;
        // The thread must own a card: otherwise the question would surface
        // nowhere and the persist below would silently skip. Refuse fast
        // with the fix (this is almost always a provider session id passed
        // where the bb worker thread id belongs) instead of blaming storage.
        const cardRow = db.prepare("SELECT id, status FROM cards WHERE worker_thread_id = ?").get(threadId) as { id: string; status: string } | undefined;
        if (!cardRow) return { exitCode: 2, stderr: `No card owns thread "${threadId}". Pass your bb worker thread id ($BB_THREAD_ID, a thr_* id — confirm with: echo $BB_THREAD_ID), never a provider session id nor a workflow dirHash (sw-*).` };
        if (cardRow.status === "archived") return { exitCode: 2, stderr: "This card is archived." };
        // A question may be open through the host interaction service or
        // through the durable recovery fallback. Do this preflight before
        // recording split intent: a proposal row alone is never evidence that
        // the person has a visible form to answer.
        const liveAsks = await fetchPendingAsks(threadId);
        if (liveAsks === null) {
          return { exitCode: 1, stderr: "Could not verify whether a card question is already open. Retry this same ask once; do not assume a prior question is visible." };
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
          if (!questionDecision.allowed) return { exitCode: questionDecision.code, stderr: questionDecision.reason! };
        }
        // Optional contract declaration (lib/ask-contracts): links this ask
        // to a question contract for later matching. Validated, never
        // enforced here — unknown ids with a readable checklist refuse with
        // the valid list; without one the ask records raw (fail-open).
        // Split asks carry none (their own mechanics own the semantics).
        const declared = groups.filter((group) => typeof group.contract === "string" && group.contract);
        if (tag === "split" && declared.length > 0) {
          return { exitCode: 2, stderr: "Split asks carry no contract id — remove --contract." };
        }
        if (declared.length > 0) {
          const checklist = await askContractChecklist(cardRow.id);
          const verdict = validateAskContracts(declared.map((group) => ({ contractId: group.contract })), checklist);
          if (!verdict.ok) return { exitCode: 2, stderr: verdict.error! };
          recordAskContracts(db, declared.map((group) => ({ id: randomId("askc"), cardId: cardRow.id, question: group.question, contractId: group.contract, askedAt: Date.now() })));
        }
        // A split proposal ask (lib/split-proposal): options are proposed
        // child cards, recorded by the host and executed by `bb stelow
        // split` after approval. Validated and stored BEFORE the blocking
        // call — a refused shape never pings the human.
        if (tag === "split") {
          if (groups.length !== 1) return { exitCode: 2, stderr: "A split ask carries exactly one question: the proposed cards as its options, plus one \"Keep as one card\" option." };
          if (!groups[0]!.multiple) return { exitCode: 2, stderr: "A split ask must use --multiple so the user can approve more than one substantial deliverable (or choose Keep as one card)." };
          const splitCard = getCard(cardRow.id);
          if (!splitCard) return { exitCode: 2, stderr: `Unknown card "${cardRow.id}".` };
          // Single-source split gate (lib/split-proposal): state.md is truth,
          // never the DB cache.
          const splitGate = splitEligibility({ kind: splitCard.kind, stage: await cardStageSlug(splitCard) });
          if (!splitGate.ok) return { exitCode: 2, stderr: splitGate.error! };
          const splitOptions = groups[0]!.options;
          const keepCount = splitOptions.filter((o) => o.label.trim().toLowerCase() === SPLIT_KEEP_LABEL.toLowerCase()).length;
          if (keepCount !== 1) return { exitCode: 2, stderr: `A split ask needs exactly one "${SPLIT_KEEP_LABEL}" option (exact label) so the user can veto.` };
          const slices = splitOptions
            .filter((o) => o.label.trim().toLowerCase() !== SPLIT_KEEP_LABEL.toLowerCase())
            .map((o) => ({ title: o.label, desc: o.description }));
          const invalid = validateSplitSlices(slices);
          if (invalid) return { exitCode: 2, stderr: invalid };
          // The worker supplies the candidate slices, but the host owns the
          // irreversible semantics. State each consequence once: candidates
          // are a multi-select, while the keep option is an exclusive
          // alternative handled by the renderer and the split executor.
          groups[0]!.question = splitQuestionText(groups[0]!.question);
          db.prepare("INSERT OR REPLACE INTO split_proposals (card_id, question, slices, selected, asked_at, answered_at, consumed_at, created) VALUES (?, ?, ?, NULL, ?, NULL, NULL, '[]')")
            .run(cardRow.id, groups[0]!.question, JSON.stringify(slices), Date.now());
        }
        // Standard questions at the split point read like split decisions
        // but execute nothing: host-append the consequence disclosure to
        // every group (live form and persisted expired rows carry it alike),
        // decided through the same shared gate on slug truth.
        if (tag !== "split") {
          const stdCard = getCard(cardRow.id);
          const stdStage = stdCard ? await cardStageSlug(stdCard) : null;
          if (stdCard && splitEligibility({ kind: stdCard.kind, stage: stdStage }).ok) {
            for (const group of groups) group.question = withStandardSplitDisclosure(group.question);
          }
        }
        updateCard(cardRow.id, { activity: "awaiting-answer" });
        // Baseline the questioned documents for staleness notices: what each
        // file contains and where its checkout stands, right now, before the
        // blocking wait begins. Advisory and fail-soft — never blocks asking.
        void snapshotQuestionEvidence(cardRow.id, groups.flatMap((group) => group.options));
        let result: Awaited<ReturnType<typeof bb.ui.requestInput>>;
        let requestFailed = false;
        const askedAt = Date.now();
        // Single-question calls keep the single-question payload shape;
        // batches carry `questions`.
        const askInput = {
          threadId,
          rendererId: "stelow-question",
          title: batched ? `Stelow questions (${groups.length})` : "Stelow question",
          timeoutMs: Number(process.env.STELOW_ASK_TIMEOUT_MS ?? 60 * 60 * 1000),
          // BB 0.43 timeline rows: the pending label names the wait while the
          // form is open, and describeSubmission decides what the transcript
          // keeps (decisions only — BB never stores the payload or raw value).
          // Hosts that predate the fields ignore them; the wait is unchanged.
          presentation: { label: askTimelineLabels({ batched, count: groups.length }) },
          describeSubmission: (value: unknown) => describeAskSubmission(value),
        } as const;
        const first = groups[0]!;
        try {
          // Contract ids are host bookkeeping, not renderer input: strip
          // them so the interaction payload keeps its exact BB shape.
          const payloadGroups = groups.map((group) => ({ question: group.question, multiple: group.multiple, kind: group.kind, options: group.options }));
          result = batched
            ? await bb.ui.requestInput({ ...askInput, payload: { questions: payloadGroups } }, { signal: ctx.signal })
            : await bb.ui.requestInput({ ...askInput, payload: { question: first.question, multiple: first.multiple, kind: first.kind, options: first.options } }, { signal: ctx.signal });
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
        }        // Cancellation without an answer falls into two buckets. Transient
        // infrastructure reasons (timeout, plugin reload/restart, aborted
        // request) mean the user simply never answered: persist the question
        // exactly like a timeout so it stays answerable on the card and the
        // worker stops to wait. Explicit end states (user dismissed, thread
        // stopped/deleted) are returned as-is for the worker to interpret.
        const cancelReason = result.outcome === "cancelled" ? result.reason : null;
        const transientCancel = requestFailed || classifyAskCancel(result.outcome, cancelReason) === "persist";
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
              const expiredAt = askedAt + Number(process.env.STELOW_ASK_TIMEOUT_MS ?? 60 * 60 * 1000);
              const insert = db.prepare("INSERT OR REPLACE INTO expired_questions (id, card_id, thread_id, question, multiple, kind, locale, options, expired_at, answered) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
              db.transaction(() => {
                for (const group of groups) {
                  insert.run(randomId("qexp"), cardRow.id, threadId, group.question, group.multiple ? 1 : 0, group.kind, "en", JSON.stringify(group.options), expiredAt, 0);
                }
              })();
              updateCard(cardRow.id, { activity: "awaiting-answer" });
              bb.realtime.publish("card-state", { cardId: cardRow.id });
              persisted = true;
            } catch (err) {
              persistError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
              bb.log.warn(`stelow ask persist attempt ${attempt}/2 failed (card ${cardRow.id}, thread ${threadId}): ${persistError}`);
              if (isRetryablePersistError(persistError) && attempt === 1) {
                await new Promise((resolve) => setTimeout(resolve, 250));
              } else {
                break;
              }
            }
          }
          const elapsed = Math.round((Date.now() - askedAt) / 1e3);
          if (!persisted) {
            const whyPersistFailed = requestFailed ? "request failure" : `cancel reason "${cancelReason ?? "unknown"}"`;
            return { exitCode: 1, stdout: `The question could not be recorded (interrupted storage after ${whyPersistFailed}). STOP and wait: do NOT proceed with the workflow. On your next turn, if no pending question exists on the card, ask it ONCE more via bb stelow ask.` };
          }
          const why = interruptionWhy(cancelReason, requestFailed, elapsed);
          return { exitCode: 1, stdout: `${why} STOP and wait: do NOT proceed with the workflow. The question is still pending on the card (same column, marked as waiting for your answer) and remains answerable. When the user answers it on the card, the answer is delivered here as a message and you may continue. If you are re-asked about this same question later, do not re-ask the user again — wait for the card answer.` };
        }
        // The host records what the human approved on a split proposal — right
        // here for the blocking call, and in answerQuestions for card-side
        // answers. `bb stelow split` trusts this row, never a worker claim.
        if (tag === "split" && result.outcome === "submitted") {
          const value = record(result.value);
          const picked = array(value.answers).filter((answer): answer is string => typeof answer === "string");
          db.prepare("UPDATE split_proposals SET selected = ?, answered_at = ? WHERE card_id = ? AND selected IS NULL")
            .run(JSON.stringify(picked), Date.now(), cardRow.id);
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
          if (askCard && splitEligibility({ kind: askCard.kind, stage: askStage }).ok) {
            return { exitCode: 0, stdout: `${JSON.stringify(result)}\nSplit check: recorded as STANDARD — its answer is text only and executes nothing. If this question proposes splitting the card, re-ask it now with --tag split --multiple plus exactly one --option "Keep as one card", then run bb stelow split after the answer (still at ${askStage}, still in time).` };
          }
        }
        return { exitCode: result.outcome === "submitted" ? 0 : 1, stdout: JSON.stringify(result) };
      }
      if (argv[0] === "seed") {
        const flag = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
        const projectId = flag("--project") ?? ctx.projectId;
        const name = flag("--name");
        const intent = flag("--intent");
        if (!projectId || !name || !intent) return { exitCode: 2, stderr: "Usage: bb stelow seed --project <proj_id> --name <name> --intent <intent>" };
        // Card workers are pre-seeded at spawn with the card id as owner. A
        // seed from inside a card thread would mint a name-derived owner at
        // the project root — an orphan no card resolves back — so refuse with
        // the card's own state dir as the redirect (lib/card-seed-guard).
        const seedCard = ctx.threadId ? getCardByWorkerThread(ctx.threadId) : undefined;
        if (seedCard) {
          const seedWorkspace = await cardWorkspace(seedCard);
          const seedRoot = seedWorkspace?.path ?? await projectRoot(bb, projectId);
          let seedStateDir: string | null = null;
          if (seedRoot && seedCard.dir_hash) {
            seedStateDir = await workflowStateDir(bb, seedRoot, seedCard.id, seedCard.dir_hash);
          }
          return { exitCode: 1, stderr: cardWorkerSeedRefusal({ cardName: seedCard.name, stateDirText: seedStateDir }) };
        }
        const rootPath = await projectRoot(bb, projectId);
        if (!rootPath) return { exitCode: 1, stderr: "Project workspace path is unavailable." };
        const result = await seedWorkflow(bb, rootPath, workflowIdForName(name), name, intent);
        return result.error ? { exitCode: 1, stderr: result.error } : { exitCode: 0, stdout: result.statePath ?? "" };
      }
      if (argv[0] === "advance") {
        const args = argv.slice(1);
        const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
        const projectId = flag("--project") ?? ctx.projectId;
        const dryRun = args.includes("--dry-run");
        const json = args.includes("--json");
        const stage = flag("--stage") ?? args.find((arg) => !arg.startsWith("--") && arg !== projectId);
        if (!projectId || !stage) return { exitCode: 2, stderr: "Usage: bb stelow advance [--project <proj_id>] [--dry-run] [--json] <stage>" };
        // The agent runs this from within its worker thread; resolve the owning
        // card first so Personal/exploratory work uses its own workspace.
        const cliCard = ctx.threadId ? getCardByWorkerThread(ctx.threadId) : undefined;
        const workspace = cliCard ? await cardWorkspace(cliCard) : null;
        const rootPath = workspace?.path ?? await projectRoot(bb, projectId);
        if (!rootPath) return { exitCode: 1, stderr: "Workspace path is unavailable." };
        const stateDir = cliCard?.dir_hash ? await workflowStateDir(bb, rootPath, cliCard.id, cliCard.dir_hash) : null;
        const guard = await ensureProjectArtifacts(bb, rootPath, stateDir, Boolean(cliCard?.dir_hash));
        if (guard) return { exitCode: 1, stderr: guard };
        if (!dryRun && cliCard) {
          const questionGuard = await questionContractsGate(cliCard, stateDir);
          if (questionGuard) return { exitCode: 1, stderr: questionGuard };
        }
        const helperArgs = ["advance", stage, ...(dryRun ? ["--dry-run"] : []), ...(json ? ["--json"] : [])];
        const result = await runHelper(helperArgs, rootPath, stateDir ?? undefined);
        // Helper exit codes are meaningful (2 = usage, 1 = invalid transition):
        // pass through instead of collapsing.
        if (result.code !== 0) return { exitCode: result.code ?? 1, stderr: result.stderr || "advance failed", stdout: result.stdout };
        // --dry-run validates only: no card writes, no band swap, no auto-sync.
        if (dryRun) return { exitCode: 0, stdout: result.stdout };
        if (cliCard) updateCard(cliCard.id, { stage, status: "in-progress", activity: "running", last_error: null });
        if (cliCard) recordStageEvent(cliCard.id, stage);
        // Band-preset swap: if the band of the stage just advanced to defines a
        // preset different from the one this worker was spawned with, respawn the
        // worker with that band preset on the same state dir. Deferred (setTimeout)
        // so the current handle returns its output before the worker is replaced.
        if (cliCard) {
          const band = STAGE_TO_BAND[stage];
          if (band) {
            const bandPreset = getReliablePresetForBand(band, cliCard.id);
            const currentPresetId = cliCard.worker_preset_id ?? getPresetForCard(cliCard.id).id;
            if (bandPreset.id !== currentPresetId) {
              const targetId = cliCard.id;
              setTimeout(() => { respawnWorkerForBand(targetId, bandPreset.id).catch(() => {}); }, 10);
            }
          }
        }
        // Entering execution seeds scope tracking best-effort: the vendored
        // Step 2e (`scripts/stelow sync-scopes`) has no binary in a bb
        // workspace, so the host performs the same call here. Explicit worker
        // calls remain canonical; failures never block the advance.
        if (stage === "execution") {
          // Loop-back transparency: audit → execution is the rework loop,
          // so the advance names the open rework it picks up (or its
          // absence) instead of moving silently. cliCard is a pre-write
          // snapshot, so its stage is still the stage we came from.
          let loopNote = "";
          if (cliCard && cliCard.stage === "audit") {
            const gapState = await critiqueGapState(cliCard).catch(() => null);
            if (gapState?.matched) {
              const open = gapState.auditGapScopes.filter((scope) => !["done", "completed"].includes(scope.status));
              loopNote = open.length > 0
                ? `\n(rework loop: back to execution from audit — picking up ${open.length} open audit-gap scope(s): ${open.map((scope) => scope.id).join(", ")})`
                : "\n(rework loop: back to execution from audit — no open audit-gap scopes)";
            }
          }
          try {
            const sync = await runHelper(["sync-scopes", "--json"], rootPath, stateDir ?? undefined);
            const parsed = JSON.parse(sync.stdout || "{}") as { synced?: unknown };
            if (typeof parsed.synced === "number" && parsed.synced > 0) {
              return { exitCode: 0, stdout: result.stdout + `\n(sync-scopes: synced ${parsed.synced} scopes)` + loopNote };
            }
          } catch { /* best-effort only */ }
          if (loopNote) return { exitCode: 0, stdout: result.stdout + loopNote };
        }
        // Independent pre-review on gate entry (advisory, never blocking):
        // when a build card advances into gate/int-gate/plan-gate with a
        // reviewer designated, a hidden reviewer thread judges the gate's
        // registered artifact and posts findings as a card comment for the
        // human (and the worker) to read before approval. Fire-and-forget —
        // advance never waits (this return is past the dry-run exit).
        // Silent skip on every miss: no designation, no workflow, no
        // artifact, thin artifact. diff-gate stays out (no single file;
        // deterministic diff checks already run there).
        if (cliCard) void requestGatePreReview(cliCard.id, stage).catch(() => undefined);
        return { exitCode: 0, stdout: result.stdout };
      }
      if (argv[0] === "gap-scopes") {
        // Deterministic ESCALATED → scopes conversion (upstream criteria 9).
        // The worker classifies gaps; code creates the rework scopes so the
        // loop cannot be skipped by prose. Idempotent: gaps already linked
        // to an audit-gap scope are skipped. Refuses on registry failures —
        // creating scopes from misclassified rows would launder them.
        const args = argv.slice(1);
        let cardId = ctx.threadId ? getCardByWorkerThread(ctx.threadId)?.id : undefined;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--card") { cardId = args[i + 1]; i++; continue; }
          return { exitCode: 2, stderr: "Usage: bb stelow gap-scopes [--card <card_id>]" };
        }
        if (!cardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
        const card = getCard(cardId);
        if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
        if (isArchivedCard(card)) return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
        if (card.kind !== "build") return { exitCode: 1, stderr: "gap-scopes runs on Build cards — research and explore have no scopes." };
        const gapState = await critiqueGapState(card).catch(() => null);
        if (!gapState?.matched) return { exitCode: 1, stderr: "No execution critique found — write it first, then run gap-scopes." };
        if (gapState.failures.length > 0) return { exitCode: 1, stderr: gapState.failures.join("\n") };
        if (gapState.escalated.length === 0) return { exitCode: 0, stdout: "No escalated gaps — nothing to convert." };
        const workspace = await cardWorkspace(card).catch(() => null);
        const rootPath = workspace?.path ?? null;
        if (!rootPath) return { exitCode: 1, stderr: "Workspace path is unavailable." };
        const trackingPath = join(rootPath, "stelow.json");
        let trackingData: LooseRecord;
        try {
          trackingData = JSON.parse(readFileSync(trackingPath, "utf8")) as LooseRecord;
        } catch {
          return { exitCode: 1, stderr: "stelow.json is missing for the Stelow workflow. Reseed the workflow." };
        }
        const workflows = array(trackingData.workflows);
        const entry = workflowEntryForOwner(workflows, card.id) as LooseRecord | null;
        if (!entry) return { exitCode: 1, stderr: "No workflow entry owns this card. Reseed the workflow." };
        const scopes = array(entry.scopes);
        const linked = new Set(gapState.auditGapScopes.map((scope) => scope.gap).filter((gap): gap is string => typeof gap === "string"));
        let maxId = 0;
        for (const scope of scopes) {
          const num = parseInt(String(record(scope).id ?? "").replace("scope-", ""), 10);
          if (Number.isFinite(num) && num > maxId) maxId = num;
        }
        const created: string[] = [];
        for (const gap of gapState.escalated) {
          if (linked.has(gap.description)) continue;
          maxId++;
          scopes.push({ id: `scope-${maxId}`, name: gap.description.slice(0, 80), type: "feature", status: "pending", source: "audit-gap", gap: gap.description, tasks: [] });
          created.push(`scope-${maxId}: ${gap.description.slice(0, 80)}`);
        }
        if (created.length === 0) return { exitCode: 0, stdout: "Every escalated gap already links a rework scope — nothing to convert." };
        entry.scopes = scopes;
        entry.updated = new Date().toISOString();
        try {
          writeFileSync(trackingPath, JSON.stringify(trackingData, null, 2), "utf8");
        } catch {
          return { exitCode: 1, stderr: "Could not write stelow.json — retry gap-scopes." };
        }
        logCardComment(cardId, "card", cardId, "agent", `Gap-to-scope decision: ${gapState.totals.fixed} fixed inline, ${gapState.totals.documented} documented for next cycle, ${gapState.escalated.length} escalated — ${created.length} new rework scope(s):\n${created.map((line) => `- ${line}`).join("\n")}\nThe card loops back: advance to execution, execute the rework scopes, re-run the critique, then run done again.`);
        return { exitCode: 0, stdout: `Decision recorded: ${gapState.totals.fixed} fixed, ${gapState.totals.documented} documented, ${gapState.escalated.length} escalated.\nCreated ${created.length} rework scope(s):\n${created.map((line) => `- ${line}`).join("\n")}\nLoop back now: bb stelow advance execution — execute the new scopes, re-run the critique, then run done again.` };
      }
      if (argv[0] === "metrics") {
        // Lead/cycle-time and gap-rate readout from the stage-event ledger
        // plus the live gap registry. Read-only: never writes, never blocks.
        // No --card means the fleet: every non-archived Build card aggregated.
        const args = argv.slice(1);
        const json = args.includes("--json");
        let cardId = ctx.threadId ? getCardByWorkerThread(ctx.threadId)?.id : undefined;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--card") { cardId = args[i + 1]; i++; continue; }
          if (args[i] === "--json") continue;
          return { exitCode: 2, stderr: "Usage: bb stelow metrics [--json] [--card <card_id>]" };
        }
        if (!cardId && !args.includes("--card")) {
          const rows = db.prepare("SELECT * FROM cards WHERE kind = 'build' AND status != 'archived'").all() as CardRow[];
          if (rows.length === 0) return { exitCode: 0, stdout: "No Build cards to aggregate." };
          let gaps = 0;
          let escalated = 0;
          let leadSum = 0;
          let leadCount = 0;
          let cycleSum = 0;
          let cycleCount = 0;
          let doneCount = 0;
          const perCard: Array<{ card: string; name: string; done: boolean; gaps: number; escalated: number }> = [];
          for (const row of rows) {
            try {
              const events = stageEvents(row.id);
              const doneEvent = [...events].reverse().find((event) => event.stage === "done") ?? null;
              const timeline = summarizeTimeline(events, { createdAt: row.created_at, endAt: doneEvent ? doneEvent.entered_at : now() });
              leadSum += timeline.leadMs;
              leadCount++;
              if (timeline.cycleMs !== null) {
                cycleSum += timeline.cycleMs;
                cycleCount++;
              }
              if (row.status === "completed") doneCount++;
              const gapState = await critiqueGapState(row).catch(() => null);
              const cardGaps = gapState?.matched ? gapState.totals.total : 0;
              const cardEscalated = gapState?.matched ? gapState.totals.escalated : 0;
              gaps += cardGaps;
              escalated += cardEscalated;
              perCard.push({ card: row.id, name: row.name, done: row.status === "completed", gaps: cardGaps, escalated: cardEscalated });
            } catch { /* one unreadable card never breaks the fleet readout */ }
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
          if (json) return { exitCode: 0, stdout: JSON.stringify(payload, null, 2) };
          const rate = payload.escalatedRate === null ? "n/a" : `${Math.round(payload.escalatedRate * 100)}%`;
          const lines = [
            `Fleet: ${rows.length} Build cards (${doneCount} done)`,
            `Avg lead time: ${payload.avgLeadMs === null ? "n/a" : formatDuration(payload.avgLeadMs)} · avg cycle time: ${payload.avgCycleMs === null ? "n/a" : formatDuration(payload.avgCycleMs)}`,
            `Gaps: ${gaps} total · ${escalated} escalated (${rate} escalated)`,
            ...perCard.map((entry) => `- ${entry.name}: ${entry.gaps} gaps · ${entry.escalated} escalated${entry.done ? " · done" : ""}`),
          ];
          return { exitCode: 0, stdout: lines.join("\n") };
        }
        if (!cardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
        const card = getCard(cardId);
        if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
        const events = stageEvents(cardId);
        const doneEvent = [...events].reverse().find((event) => event.stage === "done") ?? null;
        const endAt = doneEvent ? doneEvent.entered_at : now();
        const timeline = summarizeTimeline(events, { createdAt: card.created_at, endAt });
        const gapState = card.kind === "build" ? await critiqueGapState(card).catch(() => null) : null;
        const totals = gapState?.matched ? gapState.totals : { total: 0, fixed: 0, documented: 0, escalated: 0 };
        const payload = {
          card: cardId,
          name: card.name,
          done: card.status === "completed",
          leadMs: timeline.leadMs,
          cycleMs: timeline.cycleMs,
          byStage: timeline.byStage,
          gaps: totals,
          escalatedRate: totals.total > 0 ? totals.escalated / totals.total : null,
          reworkScopes: gapState?.matched ? gapState.auditGapScopes.map((scope) => ({ id: scope.id, name: scope.name, status: scope.status })) : [],
        };
        if (json) return { exitCode: 0, stdout: JSON.stringify(payload, null, 2) };
        const lines = [
          `Card ${card.name} (${cardId})${payload.done ? " — done" : ""}`,
          `Lead time: ${formatDuration(timeline.leadMs)} (created → ${doneEvent ? "done" : "now"})`,
          `Cycle time: ${timeline.cycleMs === null ? "not started (never left triage)" : `${formatDuration(timeline.cycleMs)} (first advance → ${doneEvent ? "done" : "now"})`}`,
        ];
        if (timeline.byStage.length > 0) {
          lines.push("Stages:");
          for (const entry of timeline.byStage) lines.push(`- ${entry.stage}: ${formatDuration(entry.ms)}`);
        }
        if (gapState?.matched) {
          const rate = payload.escalatedRate === null ? "n/a" : `${Math.round(payload.escalatedRate * 100)}%`;
          lines.push(`Gaps: ${totals.total} total · ${totals.fixed} fixed · ${totals.documented} documented · ${totals.escalated} escalated (${rate} escalated)`);
          lines.push(payload.reworkScopes.length > 0
            ? `Rework scopes: ${payload.reworkScopes.map((scope) => `${scope.id} (${scope.status})`).join(", ")}`
            : "Rework scopes: none");
        }
        return { exitCode: 0, stdout: lines.join("\n") };
      }
      if (argv[0] === "manifest") {
        // Commit-message trailer source, not a file attachment: git commits
        // cannot carry files and GitHub shows no git-notes, so the durable
        // audit link is a paste-ready Stelow-Artifacts trailer naming the
        // registered artifacts. Read-only: never writes, never blocks.
        const args = argv.slice(1);
        const json = args.includes("--json");
        let cardId = ctx.threadId ? getCardByWorkerThread(ctx.threadId)?.id : undefined;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--card") { cardId = args[i + 1]; i++; continue; }
          if (args[i] === "--json") continue;
          return { exitCode: 2, stderr: "Usage: bb stelow manifest [--json] [--card <card_id>]" };
        }
        if (!cardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
        const card = getCard(cardId);
        if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
        const workspace = await cardWorkspace(card).catch(() => null);
        const stateDir = workspace?.path && card.dir_hash
          ? await workflowStateDir(bb, workspace.path, card.id, card.dir_hash).catch(() => null)
          : null;
        const stateBlob = stateDir
          ? await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((file) => file.content).catch(() => null)
          : null;
        const artifacts = stateBlob
          ? parseArtifactManifest(stateBlob)
            .filter((fields) => typeof fields.path === "string" && fields.path.length > 0)
            .map((fields) => ({ stage: fields.stage ?? null, kind: fields.kind ?? null, label: fields.label ?? null, path: fields.path }))
          : [];
        const gapState = card.kind === "build" ? await critiqueGapState(card).catch(() => null) : null;
        const trailer = buildArtifactTrailer(cardId, artifacts, gapState?.matched ? gapState.totals : null);
        const payload = { card: cardId, name: card.name, stage: card.stage, artifacts, trailer };
        if (json) return { exitCode: 0, stdout: JSON.stringify(payload, null, 2) };
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
      type BundleCheck = { ok: true; check: true; dir: string; fresh: boolean; stale: Array<{ name: string; stage: string | null; sha8: string; sourcePath: string; reason: string }>; added: string[]; missing: string[]; committed: boolean | null };
      type BundleWrite = { ok: true; check: false; dir: string; files: Array<{ name: string; stage: string | null; sha8: string; sourcePath: string }>; missing: string[]; trailer: string[]; wrote: boolean };
      type BundleFailure = { ok: false; error: string };
      async function exportRunBundle(card: CardRow, opts: { checkOnly: true; dirRel?: string }): Promise<BundleCheck | BundleFailure>;
      async function exportRunBundle(card: CardRow, opts?: { checkOnly?: false; dirRel?: string }): Promise<BundleWrite | BundleFailure>;
      async function exportRunBundle(card: CardRow, opts?: { checkOnly?: boolean; dirRel?: string }): Promise<BundleCheck | BundleWrite | BundleFailure> {
        const workspace = await cardWorkspace(card).catch(() => null);
        if (!workspace?.path) return { ok: false as const, error: "The card has no workspace to export into." };
        const stateDir = card.dir_hash
          ? await workflowStateDir(bb, workspace.path, card.id, card.dir_hash).catch(() => null)
          : null;
        const stateBlob = stateDir
          ? await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((file) => file.content).catch(() => null)
          : null;
        const registered = stateBlob
          ? parseArtifactManifest(stateBlob).filter((fields) => typeof fields.path === "string" && fields.path.length > 0)
          : [];
        const targetRel = opts?.dirRel ?? `docs/runs/${card.id}`;
        const targetAbs = resolveArtifactPath(workspace.path, targetRel);
        if (!targetAbs) return { ok: false as const, error: `Refusing export dir "${targetRel}": relative path inside the workspace only.` };
        const shaOf = (content: string) => createHash("sha256").update(content).digest("hex").slice(0, 8);
        // Read current sources once: check and write both need content + SHA.
        const readable: Array<{ stage: string | null; sourcePath: string; content: string; sha8: string }> = [];
        const unreadable: string[] = [];
        for (const fields of registered) {
          const sourcePath = fields.path as string;
          const full = resolveArtifactPath(workspace.path, sourcePath);
          const content = full ? await bb.sdk.files.read({ path: full }).then((file) => file.content).catch(() => null) : null;
          if (typeof content !== "string" || !content.trim()) { unreadable.push(sourcePath); continue; }
          readable.push({ stage: fields.stage ?? null, sourcePath, content, sha8: shaOf(content) });
        }
        if (opts?.checkOnly) {
          const manifestContent = await bb.sdk.files.read({ path: join(targetAbs, "manifest.md") }).then((file) => file.content).catch(() => null);
          const bundled = manifestContent === null ? [] : parseBundleManifest(manifestContent);
          const shaBySource = new Map(readable.map((entry) => [entry.sourcePath, entry.sha8]));
          const stale = staleBundleEntries(bundled, shaBySource);
          const added = unbundledSources(registered, bundled);
          const drifted = stale.length > 0 || added.length > 0 || unreadable.length > 0;
          // Commit dimension (read-only): does the bundle dir match HEAD, or
          // is it sitting uncommitted? Null when there is nothing to compare
          // (no bundle yet) or no git repo to compare against — the bundle
          // then lives in the workspace only, and the report says so.
          let committed: boolean | null = null;
          if (manifestContent !== null) {
            const status = await runGitIn(workspace.path, ["status", "--porcelain", "--", targetRel]).catch(() => null);
            committed = status && status.ok ? status.stdout.trim().length === 0 : null;
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
          const priorManifest = await bb.sdk.files.read({ path: join(targetAbs, "manifest.md") }).then((file) => file.content).catch(() => null);
          if (priorManifest === null) {
            return { ok: true as const, check: false as const, dir: targetRel, files: [], missing: [...unreadable], trailer: [], wrote: false as const };
          }
        }
        try {
          await bb.sdk.files.mkdir({ path: targetAbs, rootPath: workspace.path, recursive: true });
        } catch {
          return { ok: false as const, error: `Could not create ${targetRel} — retry export.` };
        }
        const planned = assignBundleNames(readable);
        const files: Array<{ name: string; stage: string | null; sha8: string; sourcePath: string }> = [];
        const missing = [...unreadable];
        for (const plan of planned) {
          const source = readable.find((entry) => entry.sourcePath === plan.sourcePath);
          if (!source) continue;
          try {
            await bb.sdk.files.write({ path: join(targetAbs, plan.name), rootPath: workspace.path, expectedSha256: null, content: source.content });
          } catch { missing.push(plan.sourcePath); continue; }
          files.push({ name: plan.name, stage: plan.stage, sha8: source.sha8, sourcePath: plan.sourcePath });
        }
        const gapState = card.kind === "build" ? await critiqueGapState(card).catch(() => null) : null;
        const gapTotals = gapState?.matched ? gapState.totals : null;
        // Token evidence joins the bundle: provider-reported splits across
        // the card's threads, summed once, committed with the run. Bounded
        // (20 latest threads) and fail-open — export never blocks on it.
        let exportTokens = null;
        try {
          const threadRows = db.prepare("SELECT thread_id FROM card_threads WHERE card_id = ? ORDER BY started_at DESC LIMIT 20").all(card.id) as Array<{ thread_id: string }>;
          const reports = await Promise.all(threadRows.map(async (row) => {
            try {
              const events = await bb.sdk.threads.events.list({ threadId: row.thread_id, types: ["thread/tokenUsage/updated"], order: "desc", limit: "1" });
              return tokenBreakdownFromEvents(events);
            } catch { return null; }
          }));
          exportTokens = sumTokenBreakdowns(reports);
        } catch { exportTokens = null; }
        const manifest = renderBundleManifest({
          cardId: card.id, cardName: card.name, stage: card.stage, generatedAt: new Date().toISOString(), files, missing, gapTotals, tokens: exportTokens,
        });
        try {
          await bb.sdk.files.write({ path: join(targetAbs, "manifest.md"), rootPath: workspace.path, expectedSha256: null, content: manifest });
        } catch {
          return { ok: false as const, error: `Exported ${files.length} file(s) but could not write manifest.md — retry export.` };
        }
        const trailer = buildArtifactTrailer(card.id, files.map((file) => ({ stage: file.stage, path: file.sourcePath })), gapTotals);
        return { ok: true as const, check: false as const, dir: targetRel, files, missing, trailer, wrote: true as const };
      }
      if (argv[0] === "export") {
        // On-demand bundle refresh plus drift check. `done` refreshes the
        // bundle automatically on every completion; --check reports
        // changed/missing/new sources without writing anything.
        // Idempotent: stable basenames, overwrite-in-place.
        const args = argv.slice(1);
        const json = args.includes("--json");
        const checkOnly = args.includes("--check");
        let cardId = ctx.threadId ? getCardByWorkerThread(ctx.threadId)?.id : undefined;
        let dirFlag: string | undefined;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--card") { cardId = args[i + 1]; i++; continue; }
          if (args[i] === "--dir") { dirFlag = args[i + 1]; i++; continue; }
          if (args[i] === "--json" || args[i] === "--check") continue;
          return { exitCode: 2, stderr: "Usage: bb stelow export [--json] [--check] [--card <card_id>] [--dir <relpath>]" };
        }
        if (!cardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
        const card = getCard(cardId);
        if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
        const bundle = checkOnly
          ? await exportRunBundle(card, { checkOnly: true, dirRel: dirFlag })
          : await exportRunBundle(card, { dirRel: dirFlag });
        if (!bundle.ok) return { exitCode: 1, stderr: bundle.error };
        if (bundle.check) {
          const drift = [
            ...bundle.stale.map((entry) => `${entry.sourcePath} (${entry.reason})`),
            ...bundle.added.map((sourcePath) => `${sourcePath} (new)`),
            ...bundle.missing.map((sourcePath) => `${sourcePath} (unreadable)`),
          ];
          const settled = bundle.fresh && bundle.committed !== false;
          if (bundle.committed === false) drift.push(`${bundle.dir}/ differs from HEAD — commit it with the work`);
          if (json) return { exitCode: settled ? 0 : 1, stdout: JSON.stringify({ fresh: bundle.fresh, committed: bundle.committed, stale: bundle.stale, added: bundle.added, missing: bundle.missing }, null, 2) };
          if (settled) return { exitCode: 0, stdout: `Bundle fresh: docs/runs matches every registered artifact.${bundle.committed === null ? " (no git repo — bundle lives in the workspace only)" : " (committed)"}` };
          return { exitCode: 1, stderr: [`Bundle not settled — run \`bb stelow export\`, then commit:`, ...drift.map((line) => `- ${line}`)].join("\n") };
        }
        if (!bundle.wrote) return { exitCode: 0, stdout: `No registered artifacts — nothing to bundle.${bundle.missing.length > 0 ? ` (${bundle.missing.length} registered but unreadable: ${bundle.missing.join(", ")})` : ""}` };
        const payload = { card: card.id, dir: bundle.dir, files: bundle.files, missing: bundle.missing, trailer: bundle.trailer };
        if (json) return { exitCode: 0, stdout: JSON.stringify(payload, null, 2) };
        const lines = [
          `Exported ${bundle.files.length} artifact(s) to ${bundle.dir}/ (+ manifest.md)${bundle.missing.length > 0 ? ` — ${bundle.missing.length} registered but unreadable: ${bundle.missing.join(", ")}` : ""}.`,
          `Commit the directory with the work, then paste below the commit subject:`,
          ...bundle.trailer,
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
        let cardId = ctx.threadId ? getCardByWorkerThread(ctx.threadId)?.id : undefined;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--card") { cardId = args[i + 1]; i++; continue; }
          return { exitCode: 2, stderr: "Usage: bb stelow done [--card <card_id>]" };
        }
        if (!cardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
        const card = getCard(cardId);
        if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
        if (isArchivedCard(card)) return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
        const pending = await fetchPendingQuestions(card.worker_thread_id).catch(() => []);
        if (card.kind === "build") {
          if (card.workspace_kind === "exploratory") {
            return { exitCode: 1, stderr: "Build completion is blocked: this card runs in an exploratory workspace with no code project or Git history. Restart the work in the intended BB project; this card's state artifacts remain readable for reference." };
          }
          const workspace = await cardWorkspace(card);
          const projectPath = workspace?.path ?? null;
          let currentStage = card.stage;
          let stateBlob: string | null = null;
          let doneStateDir: string | null = null;
          if (projectPath && card.dir_hash) {
            doneStateDir = await workflowStateDir(bb, projectPath, card.id, card.dir_hash);
            stateBlob = doneStateDir ? await bb.sdk.files.read({ path: join(doneStateDir, "state.md") }).then((f) => f.content).catch(() => null) : null;
            if (!stateBlob) return { exitCode: 1, stderr: "Workflow state ownership cannot be verified. Reseed this card; project-root state is intentionally ignored." };
            currentStage = text(stateBlob.match(/current_stage:\s*(\S+)/m)?.[1]) || card.stage;
          }
          const refusal = doneEligibility({ kind: "build", stage: currentStage, questionPending: pending.length > 0, scopesOpen: projectPath ? loadCardScopes(projectPath, card.id) : [] });
          if (refusal) return { exitCode: 1, stderr: refusal };
          const receiptContent = doneStateDir ? await bb.sdk.files.read({ path: join(doneStateDir, AUDIT_RECEIPT_FILE) }).then((file) => file.content).catch(() => null) : null;
          const checkout = await cardCheckout(card);
          const gitEvidence = checkout?.path ? await recoveryGitEvidence(checkout.path) : null;
          if (checkout?.path && (!gitEvidence?.isGit || !gitEvidence.gitRoot || !gitEvidence.headSha)) {
            return { exitCode: 1, stderr: "Build completion is blocked: the execution checkout no longer has verifiable Git root and HEAD evidence. Restore the intended checkout, re-run audit, then run done." };
          }
          // Recognized workflow documents (spec-product, spec-tech, interfaces,
          // testing-strategy, critique reports) must meet their stage contract
          // (lib/artifact-contracts): unknown files, audit.md, and receipts
          // never block — only a matched document that fails depth does.
          const shallow = await buildDocDepthsForCard(card).catch(() => []);
          if (shallow.length > 0) {
            return {
              exitCode: 1,
              stderr: shallow.map((doc) => `FAIL ${doc.label} (${doc.path}): needs depth — ${doc.failures.join("; ")} — rewrite it, then run done again.`).join("\n"),
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
            const unscoped = gapState.escalated.filter((gap) => !gapState.auditGapScopes.some((scope) => scope.gap === gap.description));
            if (unscoped.length > 0) {
              return { exitCode: 1, stderr: `Build completion is blocked: ${unscoped.length} escalated gap(s) have no rework scope — this card is not done, it loops back: run \`bb stelow gap-scopes\`, \`bb stelow advance execution\`, execute the new scopes, re-run the critique, then run done again:\n${unscoped.map((gap) => `- ${gap.description}`).join("\n")}` };
            }
            const pendingRework = gapState.auditGapScopes.filter((scope) => !["done", "completed"].includes(scope.status));
            if (pendingRework.length > 0) {
              return { exitCode: 1, stderr: `Build completion is blocked: ${pendingRework.length} audit-gap rework scope(s) still open — finish them, then run done again:\n${pendingRework.map((scope) => `- ${scope.name} (${scope.status})`).join("\n")}` };
            }
          }
          const verificationRun = db.prepare("SELECT command, git_root, head_sha, exit_code FROM verification_runs WHERE card_id = ? ORDER BY created_at DESC LIMIT 1").get(cardId) as { command: string; git_root: string; head_sha: string; exit_code: number } | undefined;
          const verification = verificationReadiness(verificationRun, gitEvidence);
          if (!verification.ready) return { exitCode: 1, stderr: verification.error };
          const receipt = auditReceiptReadiness(receiptContent, stateBlob ? parseArtifactManifest(stateBlob) : [], checkout?.path ?? null, gitEvidence, verificationRun);
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
          const trail = await runHelper(["audit-trail", "build", "--strict", "--json"], projectPath!, doneStateDir ?? undefined);
          const trailCheck = trail.code === 0 ? await runHelper(["audit-trail", "check", "--strict", "--json"], projectPath!, doneStateDir ?? undefined) : null;
          const trailGate = auditTrailGate({ build: trail, check: trailCheck, verifiedGit: gitEvidence });
          if (!trailGate.ready) return { exitCode: 1, stderr: trailGate.error ?? "Audit trail validation failed." };
          // The audit receipt, portable trail, and final Done transition all
          // name one checkout. Sample once more immediately before the state
          // write so an external checkout or commit between `check` and Done
          // cannot leave a completed card pointing at stale evidence.
          const postTrailGitEvidence = checkout?.path ? await recoveryGitEvidence(checkout.path) : null;
          if (checkout?.path && !sameGitEvidence(gitEvidence, postTrailGitEvidence)) {
            return { exitCode: 1, stderr: "The checkout moved while the portable audit trail was being finalized. Re-run audit, then done." };
          }
          const bundle = await exportRunBundle(card, {});
          if (!bundle.ok) return { exitCode: 1, stderr: `Build completion is blocked: run-bundle export failed (${bundle.error}) — retry done.` };
          const reset = resetAutoContinue();
          updateCard(cardId, { status: "completed", activity: "idle", last_error: null, stage: currentStage, auto_continue_count: reset.count, auto_continue_stage: reset.stage });
          recordStageEvent(cardId, "done");
          await releaseCardClaimsAndNotify(cardId);
          return { exitCode: 0, stdout: bundle.wrote ? [`Done. Workflow "${card.name}" completed at audit.`, `Run bundle refreshed at ${bundle.dir}/ — commit it with the work, then paste below the commit subject:`, ...bundle.trailer].join("\n") : `Done. Workflow "${card.name}" completed at audit. No registered artifacts — nothing to bundle.` };
        }
        if (card.kind === "research") {
          const refusal = doneEligibility({ kind: "research", stage: null, questionPending: pending.length > 0 });
          if (refusal) return { exitCode: 1, stderr: refusal };
          const readiness = await researchReadiness(card).catch(() => null);
          if (!readiness) return { exitCode: 1, stderr: "Unable to read card state — retry done." };
          const report = researchVerifyReport(cardId, strategyRounds(card).length, readiness.ready || readiness.invalid.length > 0, readiness.invalid, readiness.evidence);
          if (!report.pass) {
            const textOut = researchVerifyText(report);
            return { exitCode: 1, stdout: textOut.stdout, stderr: textOut.stderr || "verify failed — fix the rounds above, then run done again." };
          }
          const policyRow = db.prepare("SELECT mode FROM review_policy WHERE id = 1").get() as { mode: string } | undefined;
          if (policyRow?.mode === "required" && !(await passingReviewCovers(card, readiness.fingerprint).catch(() => false))) {
            return { exitCode: 1, stderr: "Review policy is required: no passing review covers the current index — run `bb stelow review`, then run done again. (Enable only with a reviewer you trust on adversarial spot-checks; see docs/phase6-independent-review-plan.md.)" };
          }
          const researchBundle = await exportRunBundle(card, {});
          if (!researchBundle.ok) return { exitCode: 1, stderr: `Research completion is blocked: run-bundle export failed (${researchBundle.error}) — retry done.` };
          const reset = resetAutoContinue();
          updateCard(cardId, { status: "completed", activity: "idle", last_error: null, auto_continue_count: reset.count, auto_continue_stage: reset.stage });
          recordStageEvent(cardId, "done");
          await releaseCardClaimsAndNotify(cardId);
          const doneCurrent = getCard(cardId);
          const doneHypothesisSuffix = readiness.evidence === "hypothesis-only" ? " Marked hypothesis-only: web research was unavailable — requires human validation." : "";
          if (doneCurrent) recordInboxEvent(doneCurrent, "completed", `Research complete — results ready to review in Done.${doneHypothesisSuffix}`, `completed:${cardId}:index:${readiness.fingerprint ?? "ready"}`, now());
          return { exitCode: 0, stdout: researchBundle.wrote ? [`Done. Research "${card.name}" completed.`, `Run bundle refreshed at ${researchBundle.dir}/ — commit it with the work, then paste below the commit subject:`, ...researchBundle.trailer].join("\n") : `Done. Research "${card.name}" completed. No registered artifacts — nothing to bundle.` };
        }
        if (card.kind === "explore") {
          const refusal = doneEligibility({ kind: "explore", stage: null, questionPending: pending.length > 0 });
          if (refusal) return { exitCode: 1, stderr: refusal };
          const artifact = await exploreArtifact(card).catch(() => ({ ready: false as const, fingerprint: null as string | null, failures: [] as string[] }));
          const report = exploreVerifyReport(cardId, card.explore_stage, artifact.ready, artifact.failures);
          if (!report.pass) {
            const textOut = exploreVerifyText(report);
            return { exitCode: 1, stdout: textOut.stdout, stderr: textOut.stderr || "verify failed — fix the artifact above, then run done again." };
          }
          const explorePolicyRow = db.prepare("SELECT mode FROM review_policy WHERE id = 1").get() as { mode: string } | undefined;
          if (explorePolicyRow?.mode === "required" && !(await passingReviewCovers(card, artifact.fingerprint).catch(() => false))) {
            return { exitCode: 1, stderr: "Review policy is required: no passing review covers the current artifact — run `bb stelow review`, then run done again. (Enable only with a reviewer you trust on adversarial spot-checks; see docs/phase6-independent-review-plan.md.)" };
          }
          const exploreBundle = await exportRunBundle(card, {});
          if (!exploreBundle.ok) return { exitCode: 1, stderr: `Exploration completion is blocked: run-bundle export failed (${exploreBundle.error}) — retry done.` };
          const reset = resetAutoContinue();
          updateCard(cardId, { status: "completed", activity: "idle", last_error: null, auto_continue_count: reset.count, auto_continue_stage: reset.stage });
          recordStageEvent(cardId, "done");
          await releaseCardClaimsAndNotify(cardId);
          const doneCurrent = getCard(cardId);
          if (doneCurrent) recordInboxEvent(doneCurrent, "completed", "Exploration complete — result ready to review in Done.", `explore-completed:${cardId}:${artifact.fingerprint ?? "ready"}`, now());
          return { exitCode: 0, stdout: exploreBundle.wrote ? [`Done. Exploration "${card.name}" completed.`, `Run bundle refreshed at ${exploreBundle.dir}/ — commit it with the work, then paste below the commit subject:`, ...exploreBundle.trailer].join("\n") : `Done. Exploration "${card.name}" completed. No registered artifacts — nothing to bundle.` };
        }
        return { exitCode: 1, stderr: `Unknown card kind "${card.kind}". Archive this card and start a new one.` };
      }
      if (argv[0] === "playbook") {
        // Host-served reading list (lib/playbook): the exact state file,
        // transitions, and stage playbook paths for this card. Workers read
        // what they are given instead of discovering skills through shell
        // pipelines over content-hashed ids.
        const args = argv.slice(1);
        let cardId = ctx.threadId ? getCardByWorkerThread(ctx.threadId)?.id : undefined;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--card") { cardId = args[i + 1]; i++; continue; }
          return { exitCode: 2, stderr: "Usage: bb stelow playbook [--card <card_id>]" };
        }
        if (!cardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
        const card = getCard(cardId);
        if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
        if (isArchivedCard(card)) return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
        const workspace = await cardWorkspace(card);
        const rootPath = workspace?.path ?? null;
        if (!rootPath) return { exitCode: 1, stderr: ERR_WORKSPACE_UNAVAILABLE };
        let stateDir: string | null = null;
        if (card.dir_hash) {
          stateDir = await workflowStateDir(bb, rootPath, card.id, card.dir_hash);
          if (!stateDir) return { exitCode: 1, stderr: "Workflow state ownership cannot be verified. Reseed this card; project-root state is intentionally ignored." };
        }
        const statePath = stateDir ? join(stateDir, "state.md") : join(rootPath, "state.md");
        let stage: string | null = card.stage;
        if (card.kind === "build") {
          const blob = await bb.sdk.files.read({ path: statePath }).then((f) => f.content).catch(() => null);
          if (blob) stage = text(blob.match(/current_stage:\s*(\S+)/m)?.[1]) || card.stage;
        }
        let strategySkill: string | null = null;
        let researchIndexPath: string | null = null;
        if (card.kind === "research") {
          strategySkill = researchStrategyById(card.research_strategy ?? "")?.skill ?? null;
          if (stateDir) researchIndexPath = join(stateDir, "research-index.md");
        }
        let exploreSkill: string | null = null;
        let exploreArtifactPath: string | null = null;
        if (card.kind === "explore") {
          const technique = techniqueById(card.explore_stage ?? "");
          exploreSkill = technique?.skill ?? null;
          if (stateDir && technique) exploreArtifactPath = join(stateDir, exploreArtifactFile(technique.id));
        }
        const entries = playbookEntries({
          kind: card.kind, stage,
          statePath, transitionsPath: join(rootPath, "skills/stelow-workflow-orchestrator/references/transitions.md"),
          skillsDir: PLUGIN_SKILLS_DIR, strategySkill, exploreSkill, researchIndexPath, exploreArtifactPath,
        }, existsSync);
        return { exitCode: 0, stdout: renderPlaybook(entries) };
      }
      if (argv[0] === "split") {
        // No content args by design (lib/split-proposal): the host executes
        // the recorded, human-approved proposal from `ask --tag split`. A
        // worker-supplied slice list would be self-dealing — creation is a
        // host act behind a human gate, so the only input is which card.
        const args = argv.slice(1);
        let cardId = ctx.threadId ? getCardByWorkerThread(ctx.threadId)?.id : undefined;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--card") { cardId = args[i + 1]; i++; continue; }
          return { exitCode: 2, stderr: "Usage: bb stelow split [--card <card_id>]" };
        }
        if (!cardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
        const card = getCard(cardId);
        if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
        if (isArchivedCard(card)) return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
        // Same single-source gate as the ask path: slug truth, one error copy.
        const splitGate = splitEligibility({ kind: card.kind, stage: await cardStageSlug(card) });
        if (!splitGate.ok) return { exitCode: 1, stderr: splitGate.error! };
        const proposal = db.prepare("SELECT slices, selected, asked_at, consumed_at, created FROM split_proposals WHERE card_id = ?").get(cardId) as
          { slices: string; selected: string | null; asked_at: number; consumed_at: number | null; created: string } | undefined;
        if (!proposal) return { exitCode: 1, stderr: "No split proposal on this card. Open one first at triage: `bb stelow ask --tag split --multiple --question <text> --option <card> --desc <slice>...` plus exactly one `--option \"Keep as one card\"`." };
        if (proposal.consumed_at) return { exitCode: 1, stderr: "This card already split — see its comments for the children. Splitting twice would duplicate them." };
        const existingChildren = db.prepare("SELECT id FROM cards WHERE split_from = ?").all(cardId) as Array<{ id: string }>;
        if (existingChildren.length > 0) return { exitCode: 1, stderr: `This card already split into ${existingChildren.length} ${existingChildren.length === 1 ? "card" : "cards"} — see its comments. Splitting twice would duplicate them.` };
        if (!proposal.selected) return { exitCode: 1, stderr: "The split proposal is not answered yet. Wait for the card answer, then run split again." };
        if (Date.now() - proposal.asked_at > SPLIT_PROPOSAL_TTL_MS) return { exitCode: 1, stderr: "The split approval is older than 24h — re-ask at the current stage instead of executing a stale one." };
        const slices = JSON.parse(proposal.slices) as Array<{ title: string; desc: string }>;
        const selected = JSON.parse(proposal.selected) as string[];
        const outcome = splitOutcome(slices, selected);
        if (outcome.action === "keep") return { exitCode: 1, stderr: "The user chose to keep one card — no split. Continue this workflow normally past triage." };
        if (outcome.action === "refuse") return { exitCode: 1, stderr: outcome.reason };
        // Retry after a partial failure skips slices already created (recorded
        // below before reporting), so a retry never duplicates a child.
        const createdSoFar = JSON.parse(proposal.created || "[]") as Array<{ slice: string; cardId: string }>;
        const createdKeys = new Set(createdSoFar.map((entry) => entry.slice.trim().toLowerCase()));
        const todo = outcome.approved.filter((slice) => !createdKeys.has(text(slice.title).trim().toLowerCase()));
        const created: Array<{ slice: string; cardId: string }> = [...createdSoFar];
        let failure: string | null = null;
        // A Build split needs the same codebase as its parent. An exploratory
        // workspace contains only Stelow state, so fanning out there creates
        // cards that can claim a refactor without ever seeing the repository.
        // Refuse before creating even one child; Research/Explore are the
        // deliberate tracks for personal, document-only work.
        if (card.workspace_kind === "exploratory") {
          return { exitCode: 1, stderr: "Cannot split a Build workflow from an exploratory workspace: it has no code project or Git history. Turn the work into a BB project (or restart it in the intended project), then propose the split again." };
        }
        // Children inherit the parent's project and appetite — the user chose
        // them for this work and they must share its source workspace.
        const targetProjectId = card.project_id;
        const parentStateDir = card.dir_hash
          ? await cardWorkspace(card).then((workspace) => workspace?.path ? workflowStateDir(bb, workspace.path, card.id, card.dir_hash!) : null).catch(() => null)
          : null;
        const parentStateAbs = parentStateDir ? join(parentStateDir, "state.md") : null;
        let parentAppetite = "Lean";
        let parentReviewGates: string[] = [];
        if (parentStateAbs) {
          const blob = await bb.sdk.files.read({ path: parentStateAbs }).then((file) => file.content).catch(() => null);
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
              prompt: `${title}\n\nSplit from "${card.display_name ?? card.name}" (triage proposed ${slices.length}, approved ${outcome.approved.length}). This card owns ONLY this slice — ignore everything else from the parent request:\n${desc}\n\nParent triage context: ${parentStateAbs ?? "unavailable"} — read its triage notes, nothing else. Classify intent first, then work it through the normal build workflow.`,
              attachments: cardAttachments(card.attachments).map((attachment) => ({ type: attachment.type, path: attachment.path })),
              intent: "unknown",
              appetite: parentAppetite,
              reviewMode: parentReviewGates,
              kind: "build",
            });
            db.prepare("UPDATE cards SET split_from = ? WHERE id = ?").run(cardId, spawned.cardId);
            logCardComment(spawned.cardId, "card", spawned.cardId, "agent", `Split from "${card.display_name ?? card.name}" (${cardId}): this card owns "${title}".`);
            created.push({ slice: title, cardId: spawned.cardId });
          } catch (error) {
            failure = error instanceof Error ? error.message : "Could not spawn a build card.";
            break;
          }
        }
        // Persist exactly the successfully spawned children before reporting
        // a partial failure, so retrying skips them instead of duplicating.
        db.prepare("UPDATE split_proposals SET created = ? WHERE card_id = ?").run(JSON.stringify(created), cardId);
        if (created.length > 0) {
          logCardComment(cardId, "card", cardId, "agent", `Split into ${created.length} ${created.length === 1 ? "build card" : "build cards"}: ${created.map((entry) => entry.slice).join("; ")}.`);
        }
        bb.realtime.publish("card-state", { cardId });
        bb.realtime.publish("board-changed", { cardId });
        if (failure) {
          const prefix = created.length > 0 ? `Created ${created.length} ${created.length === 1 ? "build card" : "build cards"} before the remaining slices could not be created. ` : "";
          return { exitCode: 1, stdout: `${prefix}Run split again to retry the rest.`, stderr: `${prefix}${failure}` };
        }
        // Full approval consumes the proposal; a remainder keeps the parent
        // alive narrowed to it, otherwise the parent's whole content moved
        // and it archives with the trail above.
        db.prepare("UPDATE split_proposals SET consumed_at = ? WHERE card_id = ?").run(Date.now(), cardId);
        const { remaining, archiveParent } = splitRemainder(slices, outcome.approved);
        if (archiveParent) {
          // Full split parks the parent just like an Archive button or a
          // drag to Archived. The command's stdout is guidance, not a
          // lifecycle guarantee: end its worker here so it cannot consume a
          // turn after its card has disappeared from active work.
          await stopWorkerThread(card.worker_thread_id);
          updateCard(cardId, { status: "archived", activity: "idle" });
          return { exitCode: 0, stdout: `Split into ${created.length} build ${created.length === 1 ? "card" : "cards"}: ${created.map((entry) => entry.slice).join("; ")}. The parent card is archived — stop: your workflow ends here.` };
        }
        return { exitCode: 0, stdout: `Split into ${created.length} build ${created.length === 1 ? "card" : "cards"}: ${created.map((entry) => entry.slice).join("; ")}. The parent keeps the remainder (${remaining.map((slice) => text(slice.title)).join("; ")}) — continue it narrowed to that.` };
      }
      if (argv[0] === "doctor") {
        const args = argv.slice(1);
        const json = args.includes("--json");
        const projectId = args[args.indexOf("--project") + 1] ?? ctx.projectId;
        const stray = args.find((arg) => !arg.startsWith("--") && arg !== projectId);
        if (stray) return { exitCode: 2, stderr: "Usage: bb stelow doctor [--project <proj_id>] [--json]" };
        const cliCard = ctx.threadId ? getCardByWorkerThread(ctx.threadId) : undefined;
        const workspace = cliCard ? await cardWorkspace(cliCard) : null;
        const rootPath = workspace?.path ?? await projectRoot(bb, projectId);
        if (!rootPath) return { exitCode: 1, stderr: "Workspace path is unavailable." };
        const stateDir = cliCard?.dir_hash ? await workflowStateDir(bb, rootPath, cliCard.id, cliCard.dir_hash) : null;
        const guard = await ensureProjectArtifacts(bb, rootPath, stateDir, Boolean(cliCard?.dir_hash));
        if (guard) return { exitCode: 1, stderr: guard };
        const result = await runHelper(json ? ["doctor", "--json"] : ["doctor"], rootPath, stateDir ?? undefined);
        if (result.code !== 0) return { exitCode: result.code ?? 1, stderr: result.stderr || "doctor found drift", stdout: result.stdout };
        return { exitCode: 0, stdout: result.stdout };
      }
      if (argv[0] === "schema") {
        const sub = argv[1];
        if (sub && sub.startsWith("--")) return { exitCode: 2, stderr: "Usage: bb stelow schema [command]" };
        const rootPath = await projectRoot(bb, ctx.projectId ?? null);
        if (!rootPath) return { exitCode: 1, stderr: "Workspace path is unavailable." };
        const result = await runHelper(sub ? ["schema", sub] : ["schema"], rootPath);
        return { exitCode: result.code ?? 1, stdout: result.stdout, stderr: result.stderr };
      }
      if (argv[0] === "sync-scopes") {
        const args = argv.slice(1);
        const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
        const projectId = flag("--project") ?? ctx.projectId;
        const passthrough: string[] = [];
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--project") { i++; continue; }
          if (args[i] === "--name" || args[i] === "--json") { passthrough.push(args[i]!); if (args[i] === "--name") { passthrough.push(args[i + 1] ?? ""); i++; } continue; }
          return { exitCode: 2, stderr: "Usage: bb stelow sync-scopes [--project <proj_id>] [--name <workflow>] [--json]" };
        }
        const cliCard = ctx.threadId ? getCardByWorkerThread(ctx.threadId) : undefined;
        const workspace = cliCard ? await cardWorkspace(cliCard) : null;
        const rootPath = workspace?.path ?? await projectRoot(bb, projectId ?? null);
        if (!rootPath) return { exitCode: 1, stderr: "Workspace path is unavailable." };
        const stateDir = cliCard?.dir_hash ? await workflowStateDir(bb, rootPath, cliCard.id, cliCard.dir_hash) : null;
        const guard = await ensureProjectArtifacts(bb, rootPath, stateDir, Boolean(cliCard?.dir_hash));
        if (guard) return { exitCode: 1, stderr: guard };
        const result = await runHelper(["sync-scopes", ...passthrough], rootPath, stateDir ?? undefined);
        if (result.code !== 0) return { exitCode: 1, stderr: result.stderr || "sync-scopes failed", stdout: result.stdout };
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
      if (argv[0] === "lock") {
        const args = argv.slice(1);
        const op = args[0];
        if (op !== "acquire" && op !== "release" && op !== "check") {
          return { exitCode: 2, stderr: "Usage: bb stelow lock <acquire|release|check> [--project <proj_id>] --scope <id> [--file <f>...] [--ttl N] [--json]" };
        }
        const rest: string[] = [];
        let projectId: string | null = ctx.projectId ?? null;
        for (let i = 1; i < args.length; i++) {
          if (args[i] === "--project") { projectId = args[i + 1] ?? null; i++; continue; }
          if (args[i] === "--scope" || args[i] === "--file" || args[i] === "--ttl" || args[i] === "--json") {
            rest.push(args[i]!);
            if (args[i] !== "--json") { rest.push(args[i + 1] ?? ""); i++; }
            continue;
          }
          if (!args[i]!.startsWith("--")) { rest.push(args[i]!); continue; }
          return { exitCode: 2, stderr: "Usage: bb stelow lock <acquire|release|check> [--project <proj_id>] --scope <id> [--file <f>...] [--ttl N] [--json]" };
        }
        const cliCard = ctx.threadId ? getCardByWorkerThread(ctx.threadId) : undefined;
        const workspace = cliCard ? await cardWorkspace(cliCard) : null;
        const rootPath = workspace?.path ?? await projectRoot(bb, projectId);
        if (!rootPath) return { exitCode: 1, stderr: "Workspace path is unavailable." };
        const stateDir = cliCard?.dir_hash ? await workflowStateDir(bb, rootPath, cliCard.id, cliCard.dir_hash) : null;
        const guard = await ensureProjectArtifacts(bb, rootPath, stateDir, Boolean(cliCard?.dir_hash));
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
        const claimRoot = cliCard && rootPath
          ? (resolveClaimKey({ checkoutPath: (await cardCheckout(cliCard).catch(() => null))?.path ?? null, sourcePath: rootPath }) ?? rootPath)
          : rootPath;
        if (cliCard && claimRoot) {
          const scopeIndex = rest.indexOf("--scope");
          const claimScope = scopeIndex >= 0 ? (rest[scopeIndex + 1] ?? null) : null;
          const claimFiles: string[] = [];
          for (let i = 0; i < rest.length; i++) {
            if (rest[i] === "--file" && rest[i + 1]) { claimFiles.push(rest[i + 1]!); i++; }
            else if (!rest[i]!.startsWith("--") && rest[i - 1] !== "--scope" && rest[i - 1] !== "--ttl") claimFiles.push(rest[i]!);
          }
          const at = now();
          if (op === "acquire") {
            let outcome: { acquired: Array<{ file: string; fencing: number }>; renewed: Array<{ file: string }>; stolen: Array<{ file: string; previousHolder: string; fencing: number }>; conflicts: Array<{ file: string; heldBy: string; heldScope: string | null; expiresAt: number }> } | null = null;
            try {
              outcome = acquireWorkspaceClaims(db, { cardId: cliCard.id, workspacePath: claimRoot, files: claimFiles, scope: claimScope, ttlMs: CLAIM_TTL_MS, nowMs: at });
            } catch { /* advisory: helper lock already decided */ }
            if (outcome) {
              for (const steal of outcome.stolen) {
                logCardComment(cliCard.id, "card", cliCard.id, "agent", `Stole expired workspace claim on ${steal.file} (previous holder card ${steal.previousHolder}) — its lease lapsed, so work continues; the previous holder re-acquires if still live.`);
              }
              // Claims left by terminal/gone cards are dead weight: reap and
              // re-acquire instead of parking a live card behind a ghost.
              const dead = outcome.conflicts.filter((entry) => {
                const holder = getCard(entry.heldBy);
                return !holder || isClaimTerminal(holder.status);
              });
              if (dead.length > 0) {
                try {
                  const del = db.prepare("DELETE FROM card_claims WHERE workspace_path = ? AND file_path = ? AND card_id = ?");
                  for (const entry of dead) del.run(claimRoot, entry.file, entry.heldBy);
                  outcome = acquireWorkspaceClaims(db, { cardId: cliCard.id, workspacePath: claimRoot, files: claimFiles, scope: claimScope, ttlMs: CLAIM_TTL_MS, nowMs: at });
                } catch { /* advisory */ }
              }
              const live = outcome.conflicts.filter((entry) => {
                const holder = getCard(entry.heldBy);
                return holder !== undefined && !isClaimTerminal(holder.status);
              });
              if (live.length > 0) {
                try { addClaimWaiters(db, { cardId: cliCard.id, workspacePath: claimRoot, files: live.map((entry) => entry.file), scope: claimScope, nowMs: at }); } catch { /* advisory */ }
                for (const entry of live) {
                  const holder = getCard(entry.heldBy);
                  recordInboxEvent(cliCard, "paused", lockBlockedSummary(entry.file, holder?.display_name ?? holder?.name ?? entry.heldBy, entry.expiresAt), `lock-blocked:${cliCard.id}:${entry.file}`, at);
                }
                const lines = live.map((entry) => {
                  const holder = getCard(entry.heldBy);
                  return `BB-LOCK-BLOCKED file=${entry.file} heldBy=${holder?.display_name ?? holder?.name ?? entry.heldBy} expiresAt=${new Date(entry.expiresAt).toISOString()}`;
                });
                const stderr = `${lines.join("\n")}\nPark this scope and work an independent one (or wait for the host nudge) — do not retry in a loop. The host resumes this card when the file frees.${result.stderr ? `\n${result.stderr}` : ""}`;
                return { exitCode: 1, stdout: result.stdout, stderr };
              }
            }
          } else if (op === "release") {
            let released: Array<{ workspacePath: string; file: string }> = [];
            try { released = releaseWorkspaceClaims(db, { cardId: cliCard.id, workspacePath: claimRoot, files: claimFiles }); } catch { /* advisory */ }
            if (released.length > 0) await notifyClaimWaiters(claimRoot, released.map((row) => row.file));
          } else {
            // check doubles as a lease heartbeat for the caller's own
            // claims; cross-card walls ride on stderr so --json stdout
            // stays parseable.
            let seen: { free: string[]; conflicts: Array<{ file: string; heldBy: string; expiresAt: number }> } | null = null;
            try { seen = checkWorkspaceClaims(db, { cardId: cliCard.id, workspacePath: claimRoot, files: claimFiles, ttlMs: CLAIM_TTL_MS, nowMs: at }); } catch { /* advisory */ }
            const liveWalls = (seen?.conflicts ?? []).filter((entry) => {
              const holder = getCard(entry.heldBy);
              return holder !== undefined && !isClaimTerminal(holder.status);
            });
            if (liveWalls.length > 0) {
              const lines = liveWalls.map((entry) => `BB-LOCK-WALL file=${entry.file} heldBy=${entry.heldBy} expiresAt=${new Date(entry.expiresAt).toISOString()}`);
              return { exitCode: result.code ?? 1, stdout: result.stdout, stderr: `${lines.join("\n")}${result.stderr ? `\n${result.stderr}` : ""}` };
            }
          }
        }
        return { exitCode: result.code ?? 1, stdout: result.stdout, stderr: result.stderr };
      }
      if (argv[0] === "config") {
        const args = argv.slice(1);
        if (args[0] !== "get" || !args[1]) {
          return { exitCode: 2, stderr: "Usage: bb stelow config get <field> [default] [--project <proj_id>]" };
        }
        const rest: string[] = ["get", args[1]];
        if (args[2] && !args[2].startsWith("--")) rest.push(args[2]);
        let projectId: string | null = ctx.projectId ?? null;
        for (let i = 2; i < args.length; i++) {
          if (args[i] === "--project") { projectId = args[i + 1] ?? null; i++; continue; }
          if (args[i] === "--json") continue;
          if (args[i]!.startsWith("--") && args[i] !== args[2]) {
            return { exitCode: 2, stderr: "Usage: bb stelow config get <field> [default] [--project <proj_id>]" };
          }
        }
        const cliCard = ctx.threadId ? getCardByWorkerThread(ctx.threadId) : undefined;
        const workspace = cliCard ? await cardWorkspace(cliCard) : null;
        const rootPath = workspace?.path ?? await projectRoot(bb, projectId);
        if (!rootPath) return { exitCode: 1, stderr: "Workspace path is unavailable." };
        const stateDir = cliCard?.dir_hash ? await workflowStateDir(bb, rootPath, cliCard.id, cliCard.dir_hash) : null;
        const guard = await ensureProjectArtifacts(bb, rootPath, stateDir, Boolean(cliCard?.dir_hash));
        if (guard) return { exitCode: 1, stderr: guard };
        const result = await runHelper(["config", ...rest], rootPath, stateDir ?? undefined);
        if (result.code !== 0) return { exitCode: 1, stderr: result.stderr || "config failed", stdout: result.stdout };
        return { exitCode: 0, stdout: result.stdout };
      }
      if (argv[0] === "preview") {
        // Worker-facing preview control: the same decisions the panel uses, so a
        // worker can start, inspect, and stop the dev server it just built. The
        // checkout is the identity, so two cards on one workspace share it.
        const args = argv.slice(1);
        const action = ["status", "start", "stop"].includes(args[0] ?? "") ? args[0]! : "status";
        const json = args.includes("--json");
        let cardId: string | null = null;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--card") { cardId = args[i + 1] ?? null; i++; continue; }
          if (args[i]!.startsWith("--")) {
            return { exitCode: 2, stderr: "Usage: bb stelow preview [status|start|stop] [--card <card_id>] [--json]" };
          }
        }
        const card = cardId ? getCard(cardId) : ctx.threadId ? getCardByWorkerThread(ctx.threadId) : undefined;
        if (!card) return { exitCode: 1, stderr: "No card found. Pass --card <card_id>, or run this from a card's worker thread." };
        if (action === "start" || action === "stop") {
          const result = action === "start" ? await previewStart(card.id) : await previewStop(card.id);
          const view = await previewView(card.id);
          if (json) return { exitCode: result.ok ? 0 : 1, stdout: `${JSON.stringify(view)}\n` };
          if (!result.ok) return { exitCode: 1, stderr: `${result.error ?? `${action} failed`}\n` };
          return { exitCode: 0, stdout: previewText(view) };
        }
        const view = await previewView(card.id);
        if (json) return { exitCode: 0, stdout: `${JSON.stringify(view)}\n` };
        if (!view.available) return { exitCode: 1, stderr: `${view.error ?? "No web app detected in this workspace."}\n` };
        return { exitCode: 0, stdout: previewText(view) };
      }
      if (argv[0] === "fan-out") {
        // Worker-facing entry to the fanOutResearch RPC: opportunity IDs only,
        // never prose. Confirmation happens beforehand via bb stelow ask —
        // this command trusts IDs because the RPC re-validates them against
        // the parsed index (unknown/already-checked ids refuse loudly).
        const args = argv.slice(1);
        const ids: string[] = [];
        let cardId = ctx.threadId ? getCardByWorkerThread(ctx.threadId)?.id : undefined;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--opportunity") { if (args[i + 1]) ids.push(args[i + 1]!); i++; continue; }
          if (args[i] === "--card") { cardId = args[i + 1]; i++; continue; }
          if (args[i] === "--project") { i++; continue; }
          return { exitCode: 2, stderr: "Usage: bb stelow fan-out --opportunity <id> [--opportunity ...] [--card <card_id>]" };
        }
        if (!cardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
        if (ids.length === 0) return { exitCode: 2, stderr: "Pass at least one --opportunity <id> (opportunity ids from the research index, never prose)." };
        const result = await bb.sdk.plugins.callRpc<{ ok: boolean; created: Array<{ cardId: string; title: string }>; error: string | null }>({
          pluginId: "stelow",
          method: "fanOutResearch",
          input: { cardId, opportunityIds: ids },
          outputSchema: z.any(),
        });
        if (!result.ok) return { exitCode: 1, stderr: result.error ?? "fan-out failed" };
        return { exitCode: 0, stdout: `Fanned out ${result.created.length}: ${result.created.map((c) => `${c.title} (${c.cardId})`).join("; ")}` };
      }
      if (argv[0] === "verify") {
        // Deterministic worker self-check: the same predicates the sync gate
        // enforces (lib/research-artifacts), runnable BEFORE finishing so a
        // worker fixes its own artifacts instead of the inbox flagging them
        // after. Prompts require this; the sync stays the backstop.
        const args = argv.slice(1);
        let cardId = ctx.threadId ? getCardByWorkerThread(ctx.threadId)?.id : undefined;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--card") { cardId = args[i + 1]; i++; continue; }
          if (args[i] === "--tests") continue;
          if (args[i] === "--json") continue;
          return { exitCode: 2, stderr: "Usage: bb stelow verify [--card <card_id>] [--tests] [--json]" };
        }
        if (!cardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
        const card = getCard(cardId);
        if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
        const asJson = args.includes("--json");
        const runTests = args.includes("--tests");
        if (runTests) {
          if (card.kind !== "build") return { exitCode: 2, stderr: "--tests applies to Build cards only; research and explore use their artifact verification." };
          if (card.workspace_kind === "exploratory") return { exitCode: 1, stderr: "Build test verification needs a real project checkout. Create or open the recovery audit card instead of testing this preserved exploratory card." };
          const checkout = await cardCheckout(card);
          const evidence = checkout?.path ? await recoveryGitEvidence(checkout.path) : null;
          if (!checkout?.path || !evidence?.isGit || !evidence.gitRoot || !evidence.headSha) return { exitCode: 1, stderr: "The Build checkout has no verifiable Git root and HEAD. Restore its project workspace, then retry." };
          const command = testCommandForCheckout(checkout.path);
          if (!command) return { exitCode: 1, stderr: "No safe conventional test command was found (package.json test script, go.mod, Cargo.toml, or pytest project). Add a project test command; Stelow will not execute arbitrary shell text from a receipt." };
          const result = await runHostTests(checkout.path, command);
          const run = { id: randomId("verify"), cardId, command: command.display, gitRoot: evidence.gitRoot, headSha: evidence.headSha, exitCode: result.exitCode, outputSha256: createHash("sha256").update(result.output).digest("hex"), createdAt: now() };
          db.prepare("INSERT INTO verification_runs (id, card_id, command, git_root, head_sha, exit_code, output_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(run.id, run.cardId, run.command, run.gitRoot, run.headSha, run.exitCode, run.outputSha256, run.createdAt);
          const report = { pass: result.exitCode === 0, command: command.display, gitRoot: evidence.gitRoot, headSha: evidence.headSha, outputSha256: run.outputSha256, output: result.output.slice(-8000) };
          // Same stage contracts done enforces, surfaced early as warnings:
          // fix them before done refuses with the same lines.
          const docDepths = await buildDocDepthsForCard(card).catch(() => []);
          const docWarning = docDepths.length > 0
            ? `\nWARNING: workflow documents need depth (done will refuse):\n${docDepths.map((doc) => `FAIL ${doc.label} (${doc.path}): ${doc.failures.join("; ")}`).join("\n")}`
            : "";
          // Same rework loop done enforces, surfaced early: escalations
          // without scopes and open rework warn here instead of ambushing
          // at done. Read-only — creating scopes stays a gap-scopes call.
          const gapState = await critiqueGapState(card).catch(() => null);
          const unscoped = gapState?.matched ? gapState.escalated.filter((gap) => !gapState.auditGapScopes.some((scope) => scope.gap === gap.description)) : [];
          const openRework = (gapState?.auditGapScopes ?? []).filter((scope) => !["done", "completed"].includes(scope.status));
          const gapLoop = { unscoped: unscoped.map((gap) => gap.description), openRework: openRework.map((scope) => `${scope.id} (${scope.status})`) };
          const gapWarning = unscoped.length > 0 || openRework.length > 0
            ? `\nWARNING: rework loop open (done will refuse):\n${[...unscoped.map((gap) => `UNSCOPED ${gap.description} — run bb stelow gap-scopes`), ...openRework.map((scope) => `OPEN ${scope.id} (${scope.status}) — finish it, then re-run the critique`)].join("\n")}`
            : "";
          if (asJson) return { exitCode: result.exitCode, stdout: JSON.stringify({ ...report, docDepths, gapLoop }, null, 2) };
          return result.exitCode === 0
            ? { exitCode: 0, stdout: `PASS: ${command.display} recorded at ${evidence.headSha}.\n${report.output}${docWarning}${gapWarning}` }
            : { exitCode: result.exitCode, stderr: `FAIL: ${command.display} recorded at ${evidence.headSha}.\n${report.output}${docWarning}${gapWarning}` };
        }
        if (card.kind === "research") {
          const readiness = await researchReadiness(card).catch(() => null);
          if (!readiness) return { exitCode: 1, stderr: "Unable to read card state — retry verify." };
          const report = researchVerifyReport(cardId, strategyRounds(card).length, readiness.ready || readiness.invalid.length > 0, readiness.invalid, readiness.evidence);
          if (asJson) return { exitCode: report.pass ? 0 : 1, stdout: JSON.stringify(report, null, 2) };
          const text = researchVerifyText(report);
          return { exitCode: text.exitCode, ...(text.stdout ? { stdout: text.stdout } : {}), ...(text.stderr ? { stderr: text.stderr } : {}) };
        }
        if (card.kind === "explore") {
          const artifact = await exploreArtifact(card).catch(() => ({ ready: false as const, fingerprint: null as string | null, failures: [] as string[] }));
          const report = exploreVerifyReport(cardId, card.explore_stage, artifact.ready, artifact.failures);
          if (asJson) return { exitCode: report.pass ? 0 : 1, stdout: JSON.stringify(report, null, 2) };
          const text = exploreVerifyText(report);
          return { exitCode: text.exitCode, ...(text.stdout ? { stdout: text.stdout } : {}), ...(text.stderr ? { stderr: text.stderr } : {}) };
        }
        return { exitCode: 2, stderr: `Build verification requires --tests: run \`bb stelow verify --tests\` before its audit receipt and done.` };
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
        let cardId = ctx.threadId ? getCardByWorkerThread(ctx.threadId)?.id : undefined;
        let artifactArg: string | null = null;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--card") { cardId = args[i + 1]; i++; continue; }
          if (args[i] === "--artifact") { artifactArg = args[i + 1] ?? null; i++; continue; }
          return { exitCode: 2, stderr: "Usage: bb stelow review [--card <card_id>] [--artifact <path>]" };
        }
        if (!cardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
        const card = getCard(cardId);
        if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
        if (isArchivedCard(card)) return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
        if (!artifactArg && card.kind === "build") return { exitCode: 2, stderr: "Card review covers research and explore cards; for build documents pass --artifact <registered path> (e.g. a spec-product or spec-tech file)." };
        if (card.kind !== "research" && card.kind !== "explore" && card.kind !== "build") return { exitCode: 2, stderr: `Unknown card kind "${card.kind}". Archive this card and start a new one.` };
        const designated = db.prepare("SELECT preset_id FROM review_preset WHERE id = 1").get() as { preset_id: string } | undefined;
        const reviewPreset = designated ? getPresetById(designated.preset_id) : null;
        if (!reviewPreset) {
          return { exitCode: 2, stderr: "No artifact-reviewer preset designated. In Manage presets, mark one preset as the reviewer (a different model family from your workers, low reasoning, restrictive permission) — review never falls back to the worker preset." };
        }
        const params = presetAttachmentParams(reviewPreset);
        const permissionNote = params.permissionMode === "full"
          ? " (preset permission coerced full → accept-edits: reviewers read, never write)"
          : "";
        // Deterministic precondition: review only sees verify-PASS artifacts.
        let artifactText = "";
        let contractLabel = "";
        let evidence: "verified" | "hypothesis-only" = "verified";
        let reviewFingerprint: string | null = null;
        if (artifactArg) {
          const workspace = await cardWorkspace(card);
          if (!workspace?.path || !card.dir_hash) return { exitCode: 1, stderr: "No workflow state for this card yet." };
          const stateDir = await workflowStateDir(bb, workspace.path, card.id, card.dir_hash).catch(() => null);
          if (!stateDir) return { exitCode: 1, stderr: "No workflow state for this card yet." };
          const stateBlob = await bb.sdk.files.read({ path: join(stateDir, "state.md") }).then((f) => f.content).catch(() => null);
          const registered = stateBlob ? parseArtifactManifest(stateBlob).some((fields) => fields.path === artifactArg) : false;
          if (!registered) return { exitCode: 2, stderr: `Unknown artifact "${artifactArg}" — review only registered manifest documents (see the card Artifacts).` };
          const full = resolveArtifactPath(workspace.path, artifactArg);
          const content = full ? await bb.sdk.files.read({ path: full }).then((f) => f.content).catch(() => null) : null;
          if (typeof content !== "string" || !content.trim()) return { exitCode: 1, stderr: `Artifact "${artifactArg}" is missing or empty — write it first, then review.` };
          const contract = contractForBuildArtifact(artifactArg, content);
          if (!contract) return { exitCode: 2, stderr: `Artifact "${artifactArg}" matches no known stage contract — review covers spec-product, spec-tech, interfaces, testing-strategy, and critique reports.` };
          const depth = validateArtifact(content, contract);
          if (!depth.pass) {
            return { exitCode: 1, stderr: `Review refused: deterministic depth fails — fix first, then review (review budget is never spent on thin files).\nFAIL ${artifactArg}: ${depth.failures.map((failure) => failure.detail).slice(0, 3).join("; ")}` };
          }
          contractLabel = `build document (${contract.id})`;
          artifactText = content;
        } else if (card.kind === "research") {
          const readiness = await researchReadiness(card).catch(() => null);
          if (!readiness) return { exitCode: 1, stderr: "Unable to read card state — retry review." };
          if (!readiness.ready || readiness.invalid.length > 0) {
            const report = researchVerifyReport(cardId, strategyRounds(card).length, readiness.ready || readiness.invalid.length > 0, readiness.invalid, readiness.evidence);
            const textOut = researchVerifyText(report);
            return { exitCode: 1, stderr: `Review refused: deterministic verify fails — fix first, then review (review budget is never spent on thin files).\n${textOut.stderr ?? textOut.stdout ?? ""}` };
          }
          evidence = readiness.evidence;
          reviewFingerprint = readiness.fingerprint;
          const history = strategyRounds(card);
          const latest = history[history.length - 1];
          const strategyLabel = researchStrategyById(latest?.id ?? "")?.label ?? latest?.id ?? "research";
          contractLabel = `${strategyLabel} primary round`;
          const workspace = await cardWorkspace(card);
          const index = await readResearchIndex(card).catch(() => null);
          const indexText = index && index.ok === true ? index.content : "";
          const primary = workspace?.path && latest?.file
            ? await bb.sdk.files.read({ path: resolveArtifactPath(workspace.path, latest.file) ?? "" }).then((f) => f.content).catch(() => null)
            : null;
          artifactText = `Research index:\n${typeof indexText === "string" ? indexText : ""}\n\nPrimary round:\n${typeof primary === "string" ? primary : ""}`;
        } else {
          const artifact = await exploreArtifact(card).catch(() => ({ ready: false as const, fingerprint: null as string | null, failures: [] as string[] }));
          if (!artifact.ready) {
            const report = exploreVerifyReport(cardId, card.explore_stage, artifact.ready, artifact.failures);
            const textOut = exploreVerifyText(report);
            return { exitCode: 1, stderr: `Review refused: deterministic verify fails — fix first, then review (review budget is never spent on thin files).\n${textOut.stderr ?? textOut.stdout ?? ""}` };
          }
          reviewFingerprint = artifact.fingerprint;
          const techniqueLabel = techniqueById(card.explore_stage ?? "")?.label ?? card.explore_stage ?? "explore";
          contractLabel = `${techniqueLabel} stage deliverable`;
          const workspace = await cardWorkspace(card);
          const stateDir = card.dir_hash && workspace?.path ? await workflowStateDir(bb, workspace.path, card.id, card.dir_hash).catch(() => null) : null;
          const content = stateDir ? await bb.sdk.files.read({ path: join(stateDir, exploreArtifactFile(card.explore_stage ?? "")) }).then((f) => f.content).catch(() => null) : null;
          artifactText = typeof content === "string" ? content : "";
        }
        const reviewWorkspace = await cardWorkspace(card);
        if (!reviewWorkspace?.path) return { exitCode: 1, stderr: ERR_WORKSPACE_UNAVAILABLE };
        const reviewSource = reviewWorkspace.hostId ? { path: reviewWorkspace.path, hostId: reviewWorkspace.hostId } : null;
        const reviewEnvironment = await continuingWorkerEnvironment(card, reviewSource ? workerEnvironment(reviewSource, params, card.workspace_kind === "exploratory") : { type: "project-default" });
        const prompt = buildReviewPrompt({ cardName: card.display_name ?? card.name, request: card.prompt, contractLabel, artifactContent: artifactText, deterministicFailures: [], evidence });
        let reviewThread: { id: string };
        try {
          reviewThread = await spawnDisposable({
            projectId: card.project_id,
            environment: reviewEnvironment,
            visibility: "hidden",
            // Disposable reviewer: archiving the worker archives the review
            // with it (BB 0.43 dependent threads). Lifecycle only — the
            // verdict still travels through files, never thread history.
            ...(card.worker_thread_id ? { lifecycleOwnerThreadId: card.worker_thread_id } : {}),
            title: `Stelow review: ${card.display_name ?? card.name}`,
            providerId: params.providerId,
            model: params.modelId,
            reasoningLevel: params.reasoningLevel as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
            permissionMode: (params.permissionMode === "full" ? "accept-edits" : params.permissionMode) as "accept-edits" | "auto" | "full",
            executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
            prompt,
          }, "review");
        } catch (error) {
          return { exitCode: 1, stderr: `Review spawn failed: ${error instanceof Error ? error.message : "unknown error"}.${permissionNote}` };
        }
        logCardComment(cardId, "card", cardId, "agent", `Review requested — reviewer thread ${reviewThread.id} (${reviewPreset.name}).${permissionNote}`);
        const POLL_MS = 10000;
        const POLL_MAX = 60;
        for (let poll = 0; poll < POLL_MAX; poll++) {
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          const thread = await bb.sdk.threads.get({ threadId: reviewThread.id }).catch(() => null);
          const status = (thread as { status?: unknown } | null)?.status;
          if (status === "idle" || status === "stopping") break;
          // The worker may be archived mid-review (dependent lifecycle above):
          // stop polling and let the verdict read below report the miss.
          if (status === "archived" || status === "deleted") break;
          if (status === "failed" || status === "error") {
            return { exitCode: 1, stderr: `Reviewer thread ${reviewThread.id} ended with status ${String(status)} — open it to inspect, then rerun review.` };
          }
          if (poll === POLL_MAX - 1) {
            return { exitCode: 1, stderr: `Reviewer thread ${reviewThread.id} still running after 10 minutes — open it to follow along; the verdict lands as reviews/review-<stamp>.md on this card when it finishes.` };
          }
        }
        const output = await bb.sdk.threads.output({ threadId: reviewThread.id }).then((result) => result.output ?? "").catch(() => "");
        const parsed = parseReviewOutput(output, artifactText);
        const stamp = roundTimestamp();
        const reviewStateDir = card.dir_hash ? await workflowStateDir(bb, reviewWorkspace.path, card.id, card.dir_hash).catch(() => null) : null;
        let reviewPath: string | null = null;
        if (reviewStateDir) {
          const full = join(reviewStateDir, `reviews/review-${stamp}.md`);
          try {
            await bb.sdk.files.mkdir({ path: dirname(full), rootPath: reviewWorkspace.path, recursive: true });
            await bb.sdk.files.write({
              path: full,
              content: `# Review ${stamp}\n\nCard: ${card.display_name ?? card.name}\nReviewer thread: ${reviewThread.id}\nPreset: ${reviewPreset.name}\nStatus: ${parsed.status}\nFingerprint: ${reviewFingerprint ?? "none"}\n\n${reviewSummary(parsed)}\n\n## Verdict\n\n\`\`\`json\n${JSON.stringify({ status: parsed.status, findings: parsed.findings }, null, 2)}\n\`\`\`\n`,
            });
            reviewPath = workspaceRelative(reviewWorkspace.path, full) ?? `reviews/review-${stamp}.md`;
          } catch { /* verdict still reported via comment + stdout */ }
        }
        const summary = `${reviewSummary(parsed)}${reviewPath ? ` Record: ${reviewPath}.` : ""}${permissionNote}`;
        logCardComment(cardId, "card", cardId, "agent", summary);
        return { exitCode: 0, stdout: `${summary}\nReviewer thread: ${reviewThread.id}` };
      }
      if (argv[0] === "criteria") {
        // Advisory semantic criteria check: score an artifact against its
        // skill's semantic criteria through the Decision API. Read-only —
        // writes no rows, publishes nothing, blocks nothing. Runs only in
        // api mode with a configured provider; everything else refuses
        // with the fix named.
        const args = argv.slice(1);
        let cardId = ctx.threadId ? getCardByWorkerThread(ctx.threadId)?.id : undefined;
        let skillArg: string | null = null;
        let artifactArg: string | null = null;
        const asJson = args.includes("--json");
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--card") { cardId = args[i + 1]; i++; continue; }
          if (args[i] === "--skill") { skillArg = args[i + 1] ?? null; i++; continue; }
          if (args[i] === "--artifact") { artifactArg = args[i + 1] ?? null; i++; continue; }
          if (args[i] === "--json") continue;
          return { exitCode: 2, stderr: "Usage: bb stelow criteria --skill <skill-id> --artifact <path> [--card <card_id>] [--json]" };
        }
        if (!cardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
        const card = getCard(cardId);
        if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
        if (!skillArg) return { exitCode: 2, stderr: "Pass --skill <skill-id> (e.g. stelow-workflow-shape-up) or a path under skills/." };
        if (!artifactArg) return { exitCode: 2, stderr: "Pass --artifact <workspace-relative path>." };
        if (isDecisionApiDisabled(process.env)) return { exitCode: 1, stderr: "Decision API is disabled on this host (STELOW_DECISION_API=0)." };
        const criteriaPoint = db.prepare("SELECT mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points WHERE point = ?").get(DECISION_POINT_ARTIFACT_CRITERIA) as { mode: string; thresholds: string; provider: string | null; endpoint: string | null; api_key: string | null; model: string | null; preset_id: string | null } | undefined;
        const criteriaMode = normalizePointMode(criteriaPoint?.mode, "rules");
        if (criteriaMode !== "api" && criteriaMode !== "preset") {
          return { exitCode: 1, stderr: "Artifact criteria runs in Built-in rules mode. Set it to Decision API or preset judging in Manage agent presets → Decision routers." };
        }
        const skillRel = skillArg.includes("/") ? skillArg : `${skillArg}/SKILL.md`;
        const skillFull = resolveArtifactPath(PLUGIN_SKILLS_DIR, skillRel);
        let skillText: string | null = null;
        try { skillText = skillFull ? readFileSync(skillFull, "utf8") : null; } catch { skillText = null; }
        if (!skillText) return { exitCode: 2, stderr: `Unknown skill "${skillArg}" — skills live under the plugin's skills/ directory (stelow-*).` };
        const workspace = await cardWorkspace(card);
        if (!workspace?.path) return { exitCode: 1, stderr: ERR_WORKSPACE_UNAVAILABLE };
        const full = resolveArtifactPath(workspace.path, artifactArg);
        const content = full ? await bb.sdk.files.read({ path: full }).then((f) => f.content).catch(() => null) : null;
        if (typeof content !== "string" || !content.trim()) return { exitCode: 1, stderr: `Artifact "${artifactArg}" is missing or empty — write it first, then judge.` };
        const criteriaCfg = db.prepare("SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1").get() as { endpoint: string; api_key: string; model: string; provider: string | null } | undefined;
        const criteriaRoute = pointRouteConfig(criteriaPoint, criteriaCfg);
        const criteriaProvider = normalizeDecisionProvider(criteriaRoute.provider ?? "jev");
        const { key: criteriaKey } = resolveDecisionApiKey({ storedKey: criteriaRoute.apiKey ?? null, env: process.env });
        if (!criteriaKey && providerRequiresKey(criteriaProvider)) return { exitCode: 1, stderr: "No key: set one in Decision API settings or export DECISION_API_KEY." };
        let criteriaStored: unknown = null;
        try { criteriaStored = criteriaPoint ? JSON.parse(criteriaPoint.thresholds) : null; } catch { criteriaStored = null; }
        const criteriaThresholds = normalizeThresholds(criteriaStored, defaultThresholdsFor(DECISION_POINT_ARTIFACT_CRITERIA));
        const criteriaSemantic = groupCriteriaByKind(parseCriteriaBlock(skillText)).semantic;
        const criteriaJudge = criteriaMode === "preset" ? (criteriaPoint?.preset_id ?? null) : null;
        if (criteriaMode === "preset" && !criteriaJudge) return { exitCode: 1, stderr: "Preset judging needs a judge preset — pick any preset in Decision routers, including one no stage uses." };
        const judgment = criteriaMode === "preset" && criteriaJudge
          ? await judgePresetCriteria({ presetId: criteriaJudge, projectId: card.project_id, skillText, artifactText: content, routeAt: criteriaThresholds.routeAt })
          : await judgeArtifactCriteria({
            provider: criteriaProvider,
            endpoint: criteriaRoute.endpoint ?? defaultEndpointFor(criteriaProvider),
            apiKey: criteriaKey ?? "",
            model: normalizeDecisionApiModel(criteriaRoute.model, defaultModelFor(criteriaProvider)),
            skillText,
            artifactText: content,
            routeAt: criteriaThresholds.routeAt,
          });
        if (!judgment.ok) return { exitCode: 1, stderr: `Criteria judging failed: ${judgment.error ?? "call failed"} — built-in rules still apply; retry or check the provider.` };
        const criteriaJudgeLabel = criteriaMode === "preset" && criteriaJudge ? `preset ${criteriaJudge}` : criteriaProvider;
        const met = judgment.findings.filter((finding) => finding.verdict === "met").length;
        const unmet = judgment.findings.filter((finding) => finding.verdict === "unmet").length;
        const unverifiable = judgment.findings.length - met - unmet;
        if (asJson) {
          return { exitCode: 0, stdout: JSON.stringify({ skill: skillArg, artifact: artifactArg, provider: criteriaProvider, presetId: criteriaMode === "preset" ? criteriaJudge : null, findings: judgment.findings, summary: { met, unmet, unverifiable } }, null, 2) };
        }
        const mark = (verdict: string) => (verdict === "met" ? "✓" : verdict === "unmet" ? "✗" : "?");
        const lines = judgment.findings.map((finding) => `${mark(finding.verdict)} ${finding.id} — ${finding.verdict}${finding.score !== null ? ` (score ${finding.score}, confidence ${finding.confidence ?? "n/a"})` : ""}: ${finding.text}`);
        return { exitCode: 0, stdout: [`Artifact criteria: ${skillArg} × ${artifactArg} (${criteriaJudgeLabel}, ${judgment.findings.length} criteria)`, ...lines, `Summary: ${met} met, ${unmet} unmet, ${unverifiable} unverifiable — advisory only, never blocking.`].join("\n") };
      }
      if (argv[0] === "verify-tasks") {
        // Advisory task-evidence check: completed statuses are worker
        // assertions — this asks a judge, per task, whether the working
        // diff shows evidence, through the artifact-criteria point (rules
        // reports everything unverifiable without calling out). Read-only,
        // never a gate: findings guide the worker, done decides separately.
        const args = argv.slice(1);
        let taskCardId = ctx.threadId ? getCardByWorkerThread(ctx.threadId)?.id : undefined;
        const asJson = args.includes("--json");
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--card") { taskCardId = args[i + 1]; i++; continue; }
          if (args[i] === "--json") continue;
          return { exitCode: 2, stderr: "Usage: bb stelow verify-tasks [--card <card_id>] [--json]" };
        }
        if (!taskCardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
        const taskCard = getCard(taskCardId);
        if (!taskCard) return { exitCode: 2, stderr: `Unknown card "${taskCardId}".` };
        if (isDecisionApiDisabled(process.env)) return { exitCode: 1, stderr: "Decision API is disabled on this host (STELOW_DECISION_API=0)." };
        const taskPoint = db.prepare("SELECT mode, thresholds, provider, endpoint, api_key, model, preset_id FROM decision_points WHERE point = ?").get(DECISION_POINT_ARTIFACT_CRITERIA) as { mode: string; thresholds: string; provider: string | null; endpoint: string | null; api_key: string | null; model: string | null; preset_id: string | null } | undefined;
        const taskMode = normalizePointMode(taskPoint?.mode, "rules");
        if (taskMode !== "api" && taskMode !== "preset") {
          return { exitCode: 1, stderr: "Task evidence needs the Artifact criteria router in Decision API or preset mode. Set it in Manage agent presets → Decision routers." };
        }
        const taskWorkspace = await cardWorkspace(taskCard).catch(() => null);
        if (!taskWorkspace?.path) return { exitCode: 1, stderr: ERR_WORKSPACE_UNAVAILABLE };
        const taskScopes = loadCardScopes(taskWorkspace.path, taskCard.id);
        const doneTasks = taskScopes.flatMap((scope) => (Array.isArray(scope.tasks) ? scope.tasks : []).filter((task) => ["done", "completed"].includes(task.status)).map((task) => ({ id: task.id, name: task.name, scope: scope.name })));
        if (doneTasks.length === 0) return { exitCode: 0, stdout: "No completed tasks to evidence — pending tasks are openly pending, nothing to judge." };
        const taskCfg = db.prepare("SELECT endpoint, api_key, model, provider FROM decision_api_config WHERE id = 1").get() as { endpoint: string; api_key: string; model: string; provider: string | null } | undefined;
        const taskRoute = pointRouteConfig(taskPoint, taskCfg);
        const taskProvider = normalizeDecisionProvider(taskRoute.provider ?? "jev");
        const { key: taskKey } = resolveDecisionApiKey({ storedKey: taskRoute.apiKey ?? null, env: process.env });
        if (!taskKey && providerRequiresKey(taskProvider)) return { exitCode: 1, stderr: "No key: set one in Decision API settings or export DECISION_API_KEY." };
        let taskStored: unknown = null;
        try { taskStored = taskPoint ? JSON.parse(taskPoint.thresholds) : null; } catch { taskStored = null; }
        const taskThresholds = normalizeThresholds(taskStored, defaultThresholdsFor(DECISION_POINT_ARTIFACT_CRITERIA));
        // Evidence is the working-tree diff, capped: the cardDiff RPC owns
        // the rich version; this needs only raw patch text to judge against.
        const taskDiff = await new Promise<string>((resolveDiff) => {
          execFile("git", ["diff", "HEAD", "--no-color", "--unified=1", "--", "."], { cwd: taskWorkspace.path, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
            resolveDiff(!error && typeof stdout === "string" ? stdout.slice(0, TASK_EVIDENCE_DIFF_CHARS) : "");
          });
        });
        const taskQuestions = tasksToScoreQuestions(doneTasks);
        let taskFindings: Array<{ id: string; name: string; score: number | null; confidence: number | null; verdict: string; error: string | null }>;
        if (taskMode === "preset") {
          const taskJudge = taskPoint?.preset_id ?? null;
          if (!taskJudge) return { exitCode: 1, stderr: "Preset judging needs a judge preset — pick any preset in Decision routers, including one no stage uses." };
          const judged = await judgeViaPreset({ presetId: taskJudge, projectId: taskCard.project_id, title: "Stelow judge: task evidence", prompt: buildPresetJudgePrompt({ kind: "criteria", state: taskDiff, questions: doneTasks.map((task) => ({ id: task.id, text: `${task.name} (scope: ${task.scope})` })) }) });
          if (!judged.ok || !judged.text) return { exitCode: 1, stderr: `Task judging failed: ${judged.error ?? "judge failed"} — retry or check the preset.` };
          const parsed = parsePresetJudgeOutput({ kind: "criteria", text: judged.text });
          if (!parsed.ok || !("verdicts" in parsed)) return { exitCode: 1, stderr: `Task judging failed: ${parsed.ok ? "verdict shape mismatch" : parsed.error} — retry or check the preset.` };
          const byId: Record<string, { status: string; confidence: number | null }> = {};
          for (const verdict of parsed.verdicts) byId[verdict.id] = { status: verdict.status, confidence: verdict.confidence };
          taskFindings = resolveTaskVerdicts({ tasks: doneTasks, verdicts: byId, routeAt: taskThresholds.routeAt });
        } else {
          const judged = await Promise.all(doneTasks.map(async (task) => {
            const single: Record<string, unknown> = {};
            single[`task:${task.id}`] = (taskQuestions as Record<string, unknown>)[`task:${task.id}`];
            const result = await evaluateDecisionCall({ provider: taskProvider, endpoint: taskRoute.endpoint ?? defaultEndpointFor(taskProvider), apiKey: taskKey ?? "", model: normalizeDecisionApiModel(taskRoute.model, defaultModelFor(taskProvider)), state: taskDiff, questions: single as never });
            return { task, result };
          }));
          const answers: Record<string, { type?: string; score?: number; confidence?: number } | null> = {};
          for (const { task, result } of judged) answers[`task:${task.id}`] = (result.ok ? result.answers?.[`task:${task.id}`] ?? null : null) as { type?: string; score?: number; confidence?: number } | null;
          taskFindings = resolveTaskVerdicts({ tasks: doneTasks, answers, routeAt: taskThresholds.routeAt });
        }
        const taskMet = taskFindings.filter((finding) => finding.verdict === "met").length;
        const taskUnmet = taskFindings.filter((finding) => finding.verdict === "unmet").length;
        const taskUnverifiable = taskFindings.length - taskMet - taskUnmet;
        if (asJson) {
          return { exitCode: 0, stdout: JSON.stringify({ card: taskCardId, provider: taskProvider, findings: taskFindings, summary: { met: taskMet, unmet: taskUnmet, unverifiable: taskUnverifiable } }, null, 2) };
        }
        const taskMark = (verdict: string) => (verdict === "met" ? "✓" : verdict === "unmet" ? "✗" : "?");
        const taskLines = taskFindings.map((finding) => `${taskMark(finding.verdict)} ${finding.name} — ${finding.verdict}${finding.confidence !== null ? ` (confidence ${finding.confidence})` : ""}`);
        return { exitCode: 0, stdout: [`Task evidence (${doneTasks.length} completed tasks judged against the working diff):`, ...taskLines, `Summary: ${taskMet} met, ${taskUnmet} unmet, ${taskUnverifiable} unverifiable — advisory only, never blocking.`].join("\n") };
      }
      if (argv[0] === "draft") {
        // Disposable Tier G burst: text-in/text-out on the generation
        // preset, judged 100% by the caller. The draft thread writes
        // nothing, asks nothing, advances nothing — a cheap model is safe
        // exactly because the leash is short. Anything needing tools,
        // exact shapes, or multi-step work stays Tier R (do it yourself
        // on your band preset, never here).
        const args = argv.slice(1);
        const json = args.includes("--json");
        let cardId = ctx.threadId ? getCardByWorkerThread(ctx.threadId)?.id : undefined;
        let brief: string | null = null;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--prompt") { brief = args[i + 1] ?? null; i++; continue; }
          if (args[i] === "--card") { cardId = args[i + 1]; i++; continue; }
          if (args[i] === "--json") continue;
          return { exitCode: 2, stderr: "Usage: bb stelow draft --prompt <brief> [--json] [--card <card_id>]" };
        }
        if (!cardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
        if (!brief || !brief.trim()) return { exitCode: 2, stderr: "Pass --prompt <brief>: one disposable draft request (prose only, never protocol work)." };
        const card = getCard(cardId);
        if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
        if (isArchivedCard(card)) return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
        const band = card.kind === "research" ? "research" : card.kind === "explore" ? "explore" : STAGE_TO_BAND[card.stage] ?? "analysis";
        const designated = db.prepare("SELECT preset_id FROM generation_preset WHERE id = 1").get() as { preset_id: string } | undefined;
        const boardDefault = designated ? getPresetById(designated.preset_id) : null;
        const bandPreset = getPresetForBand(band, cardId);
        const resolved = resolveDraftPreset({ cardPin: null, boardDefault: boardDefault?.id ?? null, bandFallback: bandPreset?.id ?? null });
        const draftPreset = resolved.presetId ? getPresetById(resolved.presetId) : null;
        if (!draftPreset) return { exitCode: 1, stderr: "No preset available for the draft burst (no generation preset, no band preset). Assign presets first." };
        const params = presetAttachmentParams(draftPreset);
        const permissionNote = params.permissionMode === "full"
          ? " (preset permission coerced full → accept-edits: drafts read, never write)"
          : "";
        const fallbackNote = resolved.source === "band" ? " (generation preset unset — ran on the band preset)" : "";
        const draftWorkspace = await cardWorkspace(card);
        if (!draftWorkspace?.path) return { exitCode: 1, stderr: ERR_WORKSPACE_UNAVAILABLE };
        const draftSource = draftWorkspace.hostId ? { path: draftWorkspace.path, hostId: draftWorkspace.hostId } : null;
        const draftEnvironment = await continuingWorkerEnvironment(card, draftSource ? workerEnvironment(draftSource, params, card.workspace_kind === "exploratory") : { type: "project-default" });
        const prompt = buildDraftPrompt({ cardName: card.display_name ?? card.name, brief });
        let draftThread: { id: string };
        try {
          draftThread = await spawnDisposable({
            projectId: card.project_id,
            environment: draftEnvironment,
            visibility: "hidden",
            // Disposable draft: archiving the worker archives the draft with
            // it (BB 0.43 dependent threads). Lifecycle only — the text still
            // travels through the draft record, never thread history.
            ...(card.worker_thread_id ? { lifecycleOwnerThreadId: card.worker_thread_id } : {}),
            title: `Stelow draft: ${card.display_name ?? card.name}`,
            providerId: params.providerId,
            model: params.modelId,
            reasoningLevel: params.reasoningLevel as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
            permissionMode: (params.permissionMode === "full" ? "accept-edits" : params.permissionMode) as "accept-edits" | "auto" | "full",
            executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
            prompt,
          }, "draft-burst");
        } catch (error) {
          return { exitCode: 1, stderr: `Draft spawn failed: ${error instanceof Error ? error.message : "unknown error"}.${permissionNote}` };
        }
        const DRAFT_POLL_MS = 5000;
        const DRAFT_POLLS = 36;
        for (let poll = 0; poll < DRAFT_POLLS; poll++) {
          await new Promise((resolve) => setTimeout(resolve, DRAFT_POLL_MS));
          const thread = await bb.sdk.threads.get({ threadId: draftThread.id }).catch(() => null);
          const status = (thread as { status?: unknown } | null)?.status;
          if (status === "idle" || status === "stopping") break;
          // The worker may be archived mid-draft (dependent lifecycle above):
          // stop polling and fall through to the empty-draft path below.
          if (status === "archived" || status === "deleted") break;
          if (status === "failed" || status === "error") {
            await stopWorkerThread(draftThread.id).catch(() => undefined);
            return { exitCode: 1, stderr: `Draft thread ${draftThread.id} ended with status ${String(status)} — do the draft yourself.` };
          }
          if (poll === DRAFT_POLLS - 1) {
            await stopWorkerThread(draftThread.id).catch(() => undefined);
            return { exitCode: 1, stderr: `Draft thread ${draftThread.id} still running after 3 minutes — stopped; do the draft yourself.` };
          }
        }
        const output = await bb.sdk.threads.output({ threadId: draftThread.id }).then((result) => result.output ?? "").catch(() => "");
        await stopWorkerThread(draftThread.id).catch(() => undefined);
        const validated = validateDraftOutput(output);
        if (!validated.ok) return { exitCode: 1, stderr: validated.error ?? "Empty draft." };
        const stamp = roundTimestamp();
        const draftStateDir = card.dir_hash ? await workflowStateDir(bb, draftWorkspace.path, card.id, card.dir_hash).catch(() => null) : null;
        let draftPath: string | null = null;
        if (draftStateDir) {
          const full = join(draftStateDir, `drafts/draft-${stamp}.md`);
          try {
            await bb.sdk.files.mkdir({ path: dirname(full), rootPath: draftWorkspace.path, recursive: true });
            await bb.sdk.files.write({
              path: full,
              content: `# Draft ${stamp} (${resolved.source})\n\nCard: ${card.display_name ?? card.name}\nThread: ${draftThread.id}\nPreset: ${draftPreset.name}\n\n${validated.text}\n`,
            });
            draftPath = workspaceRelative(draftWorkspace.path, full) ?? `drafts/draft-${stamp}.md`;
          } catch { /* draft still returned via stdout */ }
        }
        logCardComment(cardId, "card", cardId, "agent", `Draft burst (${draftPreset.name}${fallbackNote}) — judge every word before using it.${draftPath ? ` Record: ${draftPath}.` : ""}${permissionNote}`);
        if (json) return { exitCode: 0, stdout: JSON.stringify({ draft: validated.text, truncated: validated.truncated ?? false, threadId: draftThread.id, path: draftPath, source: resolved.source }, null, 2) };
        return { exitCode: 0, stdout: validated.text };
      }
      if (argv[0] === "preset") {
        const sub = argv[1];
        // Preset mutation is a host/UI concern (card Agent preset section,
        // Presets screen). A worker thread rewriting the shared preset pool
        // mid-flight would change the brains of every other card — refuse
        // with the redirect. Listing stays open (workers read their assignment).
        if ((sub === "add" || sub === "remove" || sub === "assign") && ctx.threadId && getCardByWorkerThread(ctx.threadId)) {
          return { exitCode: 1, stderr: "Refused: presets are managed from the card's Agent preset section (or the Presets screen), never by a worker thread. If you need a different brain for this phase, ask for it via `bb stelow ask` instead of reassigning presets yourself." };
        }
        const flag = (name: string, list: string[]) => { const index = list.indexOf(name); return index >= 0 ? list[index + 1] : undefined; };
        const rows = (db.prepare("SELECT * FROM presets WHERE id NOT LIKE 'card-override-%' ORDER BY is_default DESC, name COLLATE NOCASE ASC").all() as PresetRow[]);
        if (!sub || sub === "list") {
          return { exitCode: 0, stdout: rows.map((row) => `${row.id}\t${row.is_default === 1 ? "*" : " "}${row.built_in === 1 ? "B" : " "}\t${row.name}\t${row.provider_id}/${row.model_id}\t${row.reasoning_level}\t${row.permission_mode}`).join("\n") };
        }
        if (sub === "add") {
          const args = argv.slice(2);
          const name = flag("--name", args);
          const providerId = flag("--provider", args) ?? "pi";
          const modelId = flag("--model", args) ?? "bifrost/harness-coding";
          const reasoningLevel = flag("--reasoning", args) ?? "medium";
          const permissionMode = flag("--permission", args) ?? "full";
          const environmentKind = (flag("--workspace", args) ?? "project-default") as "project-default" | "new-worktree";
          const instructions = flag("--instructions", args) ?? "";
          if (!name) return { exitCode: 2, stderr: "Usage: bb stelow preset add --name <name> [--provider <id>] [--model <id>] [--reasoning <level>] [--permission <mode>] [--workspace <kind>] [--instructions <text>]" };
          try {
            const result = await upsertPresetHandler({ id: null, name, providerId, modelId, reasoningLevel, permissionMode: permissionMode as "accept-edits" | "auto" | "full", environmentKind, baseBranch: null, machineId: null, instructions });
            return { exitCode: 0, stdout: `OK ${result.preset.id} ${result.preset.name}` };
          } catch (error) {
            return { exitCode: 1, stderr: error instanceof Error ? error.message : "Unable to add preset." };
          }
        }
        if (sub === "remove") {
          const id = argv[2];
          if (!id) return { exitCode: 2, stderr: "Usage: bb stelow preset remove <id>" };
          const result = await deletePresetHandler({ id });
          if (!result.deleted) return { exitCode: 1, stderr: result.error ?? "Could not remove preset." };
          return { exitCode: 0, stdout: `Removed ${id}` };
        }
        if (sub === "assign") {
          const args = argv.slice(2);
          const cardId = flag("--card", args);
          const presetId = flag("--preset", args);
          if (!cardId || !presetId) return { exitCode: 2, stderr: "Usage: bb stelow preset assign --card <card_id> --preset <preset_id>" };
          const result = await assignPresetHandler({ cardId, presetId });
          if (!result.ok) return { exitCode: 1, stderr: result.error ?? "Could not assign preset." };
          return { exitCode: 0, stdout: `Assigned ${presetId} to ${cardId}` };
        }
        return { exitCode: 2, stderr: "Usage: bb stelow preset list|add|remove|assign" };
      }
      const suggestion = typeof argv[0] === "string" && argv[0] ? nearestCommand(argv[0], STELOW_CLI_COMMANDS.map((entry) => entry.name)) : null;
      return { exitCode: 2, stderr: `Unknown command "${argv[0] ?? ""}".${suggestion ? ` Did you mean "${suggestion}"?` : ""}\n${cliUsageLine(STELOW_CLI_COMMANDS)}` };
    },
  });

  const upsertPresetHandler = async ({ id, name, providerId, modelId, reasoningLevel, permissionMode, environmentKind, baseBranch, machineId, instructions }: { id: string | null; name: string; providerId: string; modelId: string; reasoningLevel: string; permissionMode: "accept-edits" | "auto" | "full"; environmentKind: "project-default" | "new-worktree"; baseBranch: string | null; machineId: string | null; instructions: string }) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Preset name is required.");
    const effectiveId = id ?? `preset_${Math.random().toString(36).slice(2, 10)}`;
    const collision = db.prepare("SELECT id FROM presets WHERE LOWER(name) = LOWER(?) AND id != ?").get(trimmed, effectiveId) as { id: string } | undefined;
    if (collision) throw new Error(`A preset named "${trimmed}" already exists.`);
    const existing = db.prepare("SELECT id, built_in FROM presets WHERE id = ?").get(effectiveId) as { id: string; built_in: number } | undefined;
    if (existing?.built_in === 1 && (!id || id !== effectiveId)) throw new Error("Built-in presets cannot be renamed or duplicated; create a new one instead.");
    const ts = now();
    if (existing) {
      db.prepare("UPDATE presets SET name = ?, provider_id = ?, model_id = ?, reasoning_level = ?, permission_mode = ?, environment_kind = ?, base_branch = ?, machine_id = ?, instructions = ?, updated_at = ? WHERE id = ?").run(trimmed, providerId, modelId, reasoningLevel, permissionMode, environmentKind, baseBranch ?? null, machineId ?? null, instructions, ts, effectiveId);
    } else {
      db.prepare("INSERT INTO presets (id, name, provider_id, model_id, reasoning_level, permission_mode, environment_kind, base_branch, machine_id, instructions, is_default, built_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)").run(effectiveId, trimmed, providerId, modelId, reasoningLevel, permissionMode, environmentKind, baseBranch ?? null, machineId ?? null, instructions, ts, ts);
    }
    return { preset: { id: effectiveId, name: trimmed } };
  };

  const deletePresetHandler = async ({ id }: { id: string }) => {
    const row = db.prepare("SELECT built_in FROM presets WHERE id = ?").get(id) as { built_in: number } | undefined;
    if (!row) return { deleted: false, error: ERR_PRESET_NOT_FOUND };
    if (row.built_in === 1) return { deleted: false, error: "Built-in presets cannot be deleted." };
    const inUse = db.prepare("SELECT COUNT(*) AS count FROM card_presets WHERE preset_id = ?").get(id) as { count: number };
    if (inUse.count > 0) return { deleted: false, error: `Preset is assigned to ${inUse.count} card(s). Unassign first.` };
    db.prepare("DELETE FROM presets WHERE id = ?").run(id);
    return { deleted: true, error: null };
  };

  const assignPresetHandler = async ({ cardId, presetId }: { cardId: string; presetId: string | null }) => {
    const card = getCard(cardId);
    if (!card) return { ok: false, error: ERR_CARD_NOT_FOUND };
    if (presetId === null) {
      db.prepare("DELETE FROM card_presets WHERE card_id = ?").run(cardId);
    } else {
      const preset = getPresetById(presetId);
      if (!preset) return { ok: false, error: ERR_PRESET_NOT_FOUND };
      db.prepare("INSERT OR REPLACE INTO card_presets (card_id, preset_id, assigned_at) VALUES (?, ?, ?)").run(cardId, presetId, now());
      refreshRestartPending(db, cardId, card.worker_thread_id, card.worker_preset_id, presetId);
    }
    bb.realtime.publish("card-state", { cardId });
    return { ok: true, error: null };
  };

  bb.ui.registerMentionProvider({
    id: "workflow",
    label: "Stelow workflows",
    triggers: ["@"],
    async search({ query, projectId }) {
      const board = await loadBoard(bb, projectId ?? null);
      const needle = query.toLowerCase();
      const fromBoard = board.workflows.filter((workflow) => workflow.name.toLowerCase().includes(needle)).slice(0, 20).map((workflow) => ({ id: workflow.id, title: workflow.name, subtitle: `${workflow.stage} · ${workflow.status}` }));
      // Boards are project-root scoped and miss exploratory cards (per-card
      // stelow.json). Fall back to the cards table so every card is findable.
      const cardRows = (projectId
        ? db.prepare("SELECT id, display_name, name, stage, status, intent, dir_hash FROM cards WHERE project_id = ? AND status != 'archived'").all(projectId)
        : db.prepare("SELECT id, display_name, name, stage, status, intent, dir_hash FROM cards WHERE status != 'archived'").all()) as Array<{ id: string; display_name: string | null; name: string; stage: string; status: string; intent: string; dir_hash: string | null }>;
      const fromCards = cardRows
        .filter((card) => (card.display_name ?? card.name).toLowerCase().includes(needle))
        .slice(0, 20)
        .map((card) => ({ id: card.dir_hash ?? card.id, title: card.display_name ?? card.name, subtitle: `${card.stage} · ${card.status} · ${card.intent}` }));
      const seen = new Set(fromBoard.map((item) => item.id));
      return [...fromBoard, ...fromCards.filter((item) => !seen.has(item.id))].slice(0, 20);
    },
    async resolve(itemId) {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      for (const project of projects) {
        const board = await loadBoard(bb, project.id);
        const workflow = board.workflows.find((item) => item.id === itemId);
        if (workflow) return { context: `Stelow workflow ${workflow.name}: stage=${workflow.stage}, status=${workflow.status}, appetite=${workflow.appetite}, review_mode=${workflow.reviewMode}. Scopes: ${workflow.scopes.map((scope) => `${scope.id}:${scope.status}`).join(", ") || "none"}.` };
      }
      const card = db.prepare("SELECT display_name, name, stage, status, intent FROM cards WHERE dir_hash = ? OR id = ?").get(itemId, itemId) as { display_name: string | null; name: string; stage: string; status: string; intent: string } | undefined;
      if (card) return { context: `Stelow card ${card.display_name ?? card.name}: stage=${card.stage}, status=${card.status}, intent=${card.intent}.` };
      throw new Error("Stelow workflow no longer exists.");
    },
  });

  // File mentions: type @ + filename in any composer (including the Stelow
  // board) to insert a workspace file reference the agent can open/read.
  bb.ui.registerMentionProvider({
    id: "file",
    label: "Workspace files",
    triggers: ["@"],
    async search({ query, projectId }) {
      if (!projectId) return [];
      const project = await bb.sdk.projects.get({ projectId }).catch(() => null);
      const root = project?.sources.find((entry) => entry.isDefault)?.path ?? null;
      if (!root) return [];
      const listed = await bb.sdk.files.list({ path: root, query, limit: 20 }).catch(() => null);
      return (listed?.files ?? []).slice(0, 20).map((file) => ({ id: file.path, title: file.path.split("/").pop() ?? file.path, subtitle: file.path }));
    },
    async resolve(itemId) {
      return { context: `Workspace file: ${itemId}` };
    },
  });
}
