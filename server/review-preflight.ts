import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { resolveArtifactPath } from "../lib/artifact-manifest.mjs";
import { contractForBuildArtifact } from "../lib/artifact-contracts.mjs";
import {
  buildReviewPrompt,
  parseReviewOutput,
  reviewSummary,
} from "../lib/review-verdict.mjs";
import { validateArtifact } from "../lib/artifact-validation.mjs";
import { preReviewArtifactKind } from "../lib/review-gates.mjs";
import { isArchivedCard } from "../lib/worker-action-policy.mjs";
import type { PresetAttachmentParams, PresetRow } from "./preset-contracts.ts";
import type { WorkerCard } from "./workers-types.ts";

type Artifact = { kind: string; path: string };
type Board = { workflows: Array<{ id: string; artifacts: Artifact[] }> };
type Workspace = { path: string } | null;
type SpawnDisposable = (
  args: Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0],
  site: string,
) => Promise<{ id: string }>;
type Reviewable = (path: string, content: string) => boolean;

type GatePreReviewDeps = {
  bb: BbPluginApi;
  getCard: (cardId: string) => WorkerCard | undefined;
  getReviewPresetId: () => string | null;
  getPresetById: (id: string) => PresetRow | null;
  presetAttachmentParams: (preset: PresetRow) => PresetAttachmentParams;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace>;
  boardFromRoot: (
    bb: BbPluginApi,
    root: string,
    dirHash: string,
  ) => Promise<Board>;
  spawnDisposable: SpawnDisposable;
  stopThread: (threadId: string) => Promise<unknown>;
  logCardComment: (
    cardId: string,
    target: string,
    targetId: string,
    author: "user" | "agent",
    body: string,
  ) => string;
  sleep?: (ms: number) => Promise<void>;
  reviewable?: Reviewable;
};

function isReviewable(path: string, content: string): boolean {
  const contract = contractForBuildArtifact(path, content);
  const depth = contract ? validateArtifact(content, contract) : null;
  return Boolean(depth?.pass);
}

function reviewSpawnArgs(args: {
  card: WorkerCard;
  params: PresetAttachmentParams;
  stage: string;
  prompt: string;
}) {
  return {
    projectId: args.card.project_id,
    environment: { type: "project-default" as const },
    visibility: "hidden" as const,
    ...(args.card.worker_thread_id
      ? { lifecycleOwnerThreadId: args.card.worker_thread_id }
      : {}),
    title: `Stelow pre-review (${args.stage}): ${args.card.display_name ?? args.card.name}`,
    providerId: args.params.providerId,
    model: args.params.modelId,
    reasoningLevel: args.params.reasoningLevel as
      | "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
    permissionMode: (args.params.permissionMode === "full"
      ? "accept-edits"
      : args.params.permissionMode) as "accept-edits" | "auto" | "full",
    executionInputSources: {
      providerId: "explicit" as const,
      model: "explicit" as const,
      reasoningLevel: "explicit" as const,
      permissionMode: "explicit" as const,
    },
    prompt: args.prompt,
  };
}

type RuntimeDeps = GatePreReviewDeps & {
  sleep: (ms: number) => Promise<void>;
  reviewable: Reviewable;
};

async function eligibleArtifact(
  deps: RuntimeDeps,
  card: WorkerCard,
  kind: string,
) {
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  if (!workspace?.path) return null;
  const board = await deps.boardFromRoot(
    deps.bb,
    workspace.path,
    card.dir_hash ?? "",
  ).catch(() => null);
  const artifact = board?.workflows
    .find((item) => item.id === card.dir_hash)
    ?.artifacts.find((entry) => entry.kind === kind) ?? null;
  if (!artifact) return null;
  const path = resolveArtifactPath(workspace.path, artifact.path);
  const content = path
    ? await deps.bb.sdk.files
        .read({ path })
        .then((file) => file.content)
        .catch(() => null)
    : null;
  return typeof content === "string" &&
    content.trim() &&
    deps.reviewable(artifact.path, content)
    ? { path: path ?? "", content }
    : null;
}

async function waitForThread(
  deps: RuntimeDeps,
  threadId: string,
): Promise<string | null> {
  for (let poll = 0; poll < 60; poll += 1) {
    await deps.sleep(10000);
    const thread = await deps.bb.sdk.threads
      .get({ threadId })
      .catch(() => null);
    const status = (thread as { status?: unknown } | null)?.status;
    if (["idle", "stopping", "archived", "deleted"].includes(String(status))) break;
    if (status === "failed" || status === "error" || poll === 59) return null;
  }
  return deps.bb.sdk.threads
    .output({ threadId })
    .then((result) => result.output ?? "")
    .catch(() => "");
}

async function requestGatePreReview(
  deps: RuntimeDeps,
  cardId: string,
  stage: string,
): Promise<void> {
  try {
    const kind = preReviewArtifactKind(stage);
    if (!kind) return;
    const card = deps.getCard(cardId);
    if (!card || card.kind !== "build" || isArchivedCard(card)) return;
    const designated = deps.getReviewPresetId();
    const reviewPreset = designated ? deps.getPresetById(designated) : null;
    if (!reviewPreset) return;
    const artifact = await eligibleArtifact(deps, card, kind);
    if (!artifact) return;
    const params = deps.presetAttachmentParams(reviewPreset);
    const prompt = buildReviewPrompt({
      cardName: card.display_name ?? card.name,
      request: card.prompt,
      contractLabel: `pre-review for ${stage}`,
      artifactContent: artifact.content,
      deterministicFailures: [],
      evidence: "verified",
    });
    const preThread = await deps.spawnDisposable(
      reviewSpawnArgs({ card, params, stage, prompt }),
      "review",
    ).catch(() => null);
    if (!preThread) return;
    const output = await waitForThread(deps, preThread.id);
    await deps.stopThread(preThread.id).catch(() => undefined);
    if (output === null) return;
    const parsed = parseReviewOutput(output, artifact.content);
    if (!parsed?.findings.length) return;
    deps.logCardComment(
      cardId,
      "card",
      cardId,
      "agent",
      `Independent pre-review (${stage}, ${reviewPreset.name}):\n\n${reviewSummary(parsed)}`,
    );
    deps.bb.realtime.publish("card-state", { cardId });
  } catch {
    // Advisory path: silence is the status quo ante.
  }
}

export function createGatePreReview(options: GatePreReviewDeps) {
  const deps: RuntimeDeps = {
    ...options,
    sleep:
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    reviewable: options.reviewable ?? isReviewable,
  };
  return requestGatePreReview.bind(null, deps);
}
