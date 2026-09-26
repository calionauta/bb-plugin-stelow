import {
  buildReviewPrompt,
} from "../../../lib/review-verdict.mjs";
import { workerEnvironment } from "../../workers.js";
import {
  ERR_CARD_ARCHIVED,
  ERR_WORKSPACE_UNAVAILABLE,
  noCardInContext,
  refuse,
  scanFlags,
  unknownCard,
  type CliCommandFn,
  type CliResult,
  type Refusal,
} from "./cli-contract.js";
import {
  buildDocumentSubject,
  deliverableSubject,
} from "./cli-review-subject.js";
import { recordVerdict } from "./cli-review-verdict.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE = "Usage: bb stelow review [--card <card_id>] [--artifact <path>]";
const POLL_MS = 10000;
const POLL_MAX = 60;

/** Independent artifact review (docs/phase6-independent-review-plan.md):
 * explicit opt-in, read-only, cross-lineage. Refuses without a designated
 * review preset (never falls back to the worker preset) and when deterministic
 * verify fails (never spend review budget on thin files). Research and explore
 * review the card deliverable; --artifact reviews one registered manifest
 * document (any card, including build documents like spec-product or
 * spec-tech). */
export function createReviewCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "review") return null;
    const args = argv.slice(1);
    const scan = scanFlags(args, { boolean: [], valued: ["--card", "--artifact"], usage: USAGE });
    if (!scan.ok) return scan.result;
    const cardId =
      scan.flags.card ?? cardOfThread(ctx, deps);
    if (!cardId) return noCardInContext();
    const card = deps.getCard(cardId);
    if (!card) return unknownCard(cardId);
    const refusal = reviewEligibility(deps, card, scan.flags.artifact);
    if (refusal) return refusal;
    return runReview(deps, card, scan.flags.artifact ?? null);
  };
}

function cardOfThread(
  ctx: { threadId?: string | null },
  deps: CliDeps,
): string | undefined {
  return ctx.threadId ? deps.getCardByWorkerThread(ctx.threadId)?.id : undefined;
}

function reviewEligibility(
  deps: CliDeps,
  card: WorkerCard,
  artifactArg: string | undefined,
): CliResult | null {
  if (card.status === "archived")
    return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
  if (!artifactArg && card.kind === "build")
    return {
      exitCode: 2,
      stderr:
        "Card review covers research and explore cards; for build documents pass --artifact <registered path> (e.g. a spec-product or spec-tech file).",
    };
  if (card.kind !== "research" && card.kind !== "explore" && card.kind !== "build")
    return {
      exitCode: 2,
      stderr: `Unknown card kind "${card.kind}". Archive this card and start a new one.`,
    };
  if (!reviewPreset(deps))
    return {
      exitCode: 2,
      stderr:
        "No artifact-reviewer preset designated. In Manage presets, mark one preset as the reviewer (a different model family from your \
workers, low reasoning, restrictive permission) — review never falls back to the worker preset.",
    };
  return null;
}

function reviewPreset(deps: CliDeps) {
  const designated = deps.presets.getReviewPresetId();
  return designated ? deps.presets.getPresetById(designated) : null;
}

async function runReview(
  deps: CliDeps,
  card: WorkerCard,
  artifactArg: string | null,
): Promise<CliResult> {
  const subject = artifactArg
    ? await buildDocumentSubject(deps, card, artifactArg)
    : await deliverableSubject(deps, card);
  if ("refusal" in subject) return subject.refusal;
  const reviewPresetRow = reviewPreset(deps)!;
  const params = deps.presets.presetAttachmentParams(reviewPresetRow);
  const permissionNote = permissionNoteFor(params);
  const environment = await reviewEnvironment(deps, card, params);
  if ("refusal" in environment) return environment.refusal;
  const prompt = buildReviewPrompt({
    cardName: card.display_name ?? card.name,
    request: card.prompt,
    contractLabel: subject.contractLabel,
    artifactContent: subject.artifactText,
    deterministicFailures: [],
    evidence: subject.evidence,
  });
  const spawned = await spawnReview(
    deps,
    card,
    prompt,
    params,
    permissionNote,
    environment.environment,
  );
  if ("refusal" in spawned) return spawned.refusal;
  deps.logCardComment(
    card.id,
    "card",
    card.id,
    "agent",
    `Review requested — reviewer thread ${spawned.threadId} (${reviewPresetRow.name}).${permissionNote}`,
  );
  const polled = await awaitReviewer(deps, spawned.threadId);
  if ("refusal" in polled) return polled.refusal;
  return recordVerdict(
    deps,
    card,
    spawned.threadId,
    reviewPresetRow.name,
    subject,
    polled.output,
    permissionNote,
  );
}

/** Spelled out wherever the reader needs it: the reviewer is read-only, and
 * the human should see that the host enforced it. */
function permissionNoteFor(params: ReviewSpawnParams): string {
  return params.permissionMode === "full"
    ? " (preset permission coerced full → accept-edits: reviewers read, never write)"
    : "";
}

type ReviewSpawnParams = ReturnType<CliDeps["presets"]["presetAttachmentParams"]>;
type ReviewEnvironment = Awaited<ReturnType<CliDeps["workers"]["continuingEnvironment"]>>;

/** The reviewer runs where the card's worker runs: the same BB environment,
 * with the preset's permission coercion applied — a reviewer reads, it never
 * writes. Without a workspace there is nothing to review. */
async function reviewEnvironment(
  deps: CliDeps,
  card: WorkerCard,
  params: ReviewSpawnParams,
): Promise<{ environment: ReviewEnvironment } | Refusal> {
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path)
    return refuse({ exitCode: 1, stderr: ERR_WORKSPACE_UNAVAILABLE });
  const source = workspace.hostId
    ? { path: workspace.path, hostId: workspace.hostId }
    : null;
  const fallback = source
    ? workerEnvironment(source, params, card.workspace_kind === "exploratory")
    : { type: "project-default" as const };
  return {
    environment: await deps.workers.continuingEnvironment(card, fallback),
  };
}

async function spawnReview(
  deps: CliDeps,
  card: WorkerCard,
  prompt: string,
  params: ReviewSpawnParams,
  permissionNote: string,
  environment: ReviewEnvironment,
): Promise<{ threadId: string } | Refusal> {
  try {
    const thread = await deps.spawnDisposable(
      reviewSpawnArgs(card, prompt, params, environment),
      "review",
    );
    return { threadId: thread.id };
  } catch (error) {
    return refuse({
      exitCode: 1,
      stderr: `Review spawn failed: ${error instanceof Error ? error.message : "unknown error"}.${permissionNote}`,
    });
  }
}

type ReasoningLevel =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "none"
  | "ultra"
  | "ultracode";

/** Disposable reviewer: archiving the worker archives the review with it (BB
 * 0.43 dependent threads). Lifecycle only — the verdict still travels through
 * files, never thread history. `full` permission is coerced to accept-edits:
 * reviewers read, never write. */
function reviewSpawnArgs(
  card: WorkerCard,
  prompt: string,
  params: ReviewSpawnParams,
  environment: ReviewEnvironment,
) {
  return {
    projectId: card.project_id,
    environment,
    visibility: "hidden" as const,
    ...(card.worker_thread_id
      ? { lifecycleOwnerThreadId: card.worker_thread_id }
      : {}),
    title: `Stelow review: ${card.display_name ?? card.name}`,
    providerId: params.providerId,
    model: params.modelId,
    reasoningLevel: params.reasoningLevel as ReasoningLevel,
    permissionMode: (params.permissionMode === "full"
      ? "accept-edits"
      : params.permissionMode) as "accept-edits" | "auto" | "full",
    executionInputSources: {
      providerId: "explicit" as const,
      model: "explicit" as const,
      reasoningLevel: "explicit" as const,
      permissionMode: "explicit" as const,
    },
    prompt,
  };
}

/** Polls the disposable reviewer until it settles. A vanished reviewer (the
 * worker was archived mid-review) stops the poll and lets the verdict read
 * report the miss rather than waiting out the full window. */
async function awaitReviewer(
  deps: CliDeps,
  threadId: string,
): Promise<{ output: string } | Refusal> {
  for (let poll = 0; poll < POLL_MAX; poll++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const thread = await deps.bb.sdk.threads
      .get({ threadId })
      .catch(() => null);
    const status = (thread as { status?: unknown } | null)?.status;
    if (status === "idle" || status === "stopping") break;
    if (status === "archived" || status === "deleted") break;
    if (status === "failed" || status === "error")
      return refuse({
        exitCode: 1,
        stderr: `Reviewer thread ${threadId} ended with status ${String(status)} — open it to inspect, then rerun review.`,
      });
    if (poll === POLL_MAX - 1)
      return refuse({
        exitCode: 1,
        stderr: `Reviewer thread ${threadId} still running after 10 minutes — open it to follow \
along; the verdict lands as reviews/review-<stamp>.md \
on this card when it finishes.`,
      });
  }
  const output = await deps.bb.sdk.threads
    .output({ threadId })
    .then((result) => result.output ?? "")
    .catch(() => "");
  return { output };
}
