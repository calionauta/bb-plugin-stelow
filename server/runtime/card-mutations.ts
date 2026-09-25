import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { heuristicDisplayName } from "../../lib/draft-burst.mjs";
import { statusForNewCardWork } from "../../lib/card-work-resume.mjs";
import { isArchivedCard } from "../../lib/worker-action-policy.mjs";
import { canEditWorkflowIntent } from "../../lib/workflow-intent-policy.mjs";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Workspace = { path: string; hostId: string | null };
const ERR_CARD_ARCHIVED = "This card is archived.";

type CardMutationDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  workflowStateDir: (
    bb: BbPluginApi,
    rootPath: string,
    workflowId: string,
    dirHash: string,
  ) => Promise<string | null>;
  logCardComment: (
    cardId: string,
    target: string,
    targetId: string,
    author: "user" | "agent",
    body: string,
  ) => string;
  updateCard: (cardId: string, values: Record<string, unknown>) => void;
  errors: { cardNotFound: string; cardArchived: string };
};

async function syncIntentState(
  deps: CardMutationDeps,
  card: WorkerCard,
  intent: string,
): Promise<string | null> {
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path) return null;
  const stateDir = card.dir_hash
    ? await deps.workflowStateDir(
        deps.bb,
        workspace.path,
        card.id,
        card.dir_hash,
      )
    : null;
  if (card.dir_hash && !stateDir) {
    return "Workflow state ownership cannot be verified. Reseed this card before changing its workflow type.";
  }
  const statePath = stateDir
    ? join(stateDir, "state.md")
    : join(workspace.path, "state.md");
  const existing = await deps.bb.sdk.files
    .read({ path: statePath })
    .catch(() => null);
  if (existing) {
    await deps.bb.sdk.files.write({
      path: statePath,
      content: existing.content.replace(/^intent:.*$/m, `intent: ${intent}`),
    });
  }
  return null;
}

export function createCardMutationHandlers(deps: CardMutationDeps) {
  return {
    updateCardIntent: (input: { cardId: string; intent: string }) =>
      updateCardIntent(deps, input),
    renameCard: (input: { cardId: string; name: string }) =>
      renameCard(deps, input),
    addCardComment: (input: {
      cardId: string;
      target: "card" | "scope" | "task";
      targetId: string;
      body: string;
    }) => addCardComment(deps, input),
  };
}

async function updateCardIntent(
  deps: CardMutationDeps,
  { cardId, intent }: { cardId: string; intent: string },
) {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound };
  if (!canEditWorkflowIntent(card)) {
    return {
      ok: false,
      error: card.kind !== "build"
        ? "Only Build cards use a workflow type."
        : "This workflow has already left triage. Reclassify it from Card actions to restart from triage.",
    };
  }
  deps.db.prepare("UPDATE cards SET intent = ?, updated_at = ? WHERE id = ?")
    .run(intent, deps.now(), cardId);
  try {
    const error = await syncIntentState(deps, card, intent);
    if (error) return { ok: false, error };
  } catch {
    /* state.md sync is best-effort */
  }
  deps.bb.realtime.publish("card-state", { cardId });
  return { ok: true, error: null };
}

async function renameCard(
  deps: CardMutationDeps,
  { cardId, name }: { cardId: string; name: string },
) {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound };
  const next = name.trim().slice(0, 120) ||
    heuristicDisplayName(card.prompt, card.name);
  deps.db.prepare("UPDATE cards SET display_name = ?, updated_at = ? WHERE id = ?")
    .run(next, deps.now(), cardId);
  deps.bb.realtime.publish("card-state", { cardId });
  return { ok: true, error: null };
}

async function addCardComment(
  deps: CardMutationDeps,
  input: {
    cardId: string;
    target: "card" | "scope" | "task";
    targetId: string;
    body: string;
  },
) {
  const { cardId, target, targetId, body } = input;
  const card = deps.getCard(cardId);
  if (!card) return { commentId: "", error: deps.errors.cardNotFound };
  if (isArchivedCard(card)) return { commentId: "", error: ERR_CARD_ARCHIVED };
  const commentId = deps.logCardComment(cardId, target, targetId, "user", body);
  const workerError = await routeCommentToWorker(deps, card, target, body);
  if (workerError) return { commentId, error: workerError };
  deps.bb.realtime.publish("card-state", { cardId });
  return { commentId, error: null };
}

async function routeCommentToWorker(
  deps: CardMutationDeps,
  card: WorkerCard,
  target: "card" | "scope" | "task",
  body: string,
): Promise<string | null> {
  if (target === "card" && targetIsLiveWorker(card)) {
    try {
      await deps.bb.sdk.threads.send({
        threadId: card.worker_thread_id!,
        mode: "auto",
        input: [
          {
            type: "text",
            text: `User comment on card "${card.name}":\n\n${body}`,
            mentions: [],
          },
        ],
      });
      const resume = statusForNewCardWork({
        kind: card.kind,
        status: card.status,
        stage: card.stage,
      });
      deps.updateCard(card.id, {
        activity: "running",
        status: resume.status,
      });
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Failed to route comment to worker thread.";
    }
  }
  return null;
}

function targetIsLiveWorker(card: WorkerCard): card is WorkerCard & {
  worker_thread_id: string;
} {
  return Boolean(card.worker_thread_id);
}
