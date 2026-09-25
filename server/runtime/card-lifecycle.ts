import { existsSync, rmSync } from "node:fs";
import { isAbsolute, join as nodeJoin } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  discardConfirm,
  discardEligibility as eligibilityFor,
  discardTrail as trailFor,
  type DiscardEvidence,
} from "../../lib/discard-policy.mjs";
import { isArchivedCard } from "../../lib/worker-action-policy.mjs";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Workspace = { path: string; hostId: string | null };
type DiscardAction = "worktree-drop" | "branch-reset" | "dir-delete";
type Decision = ReturnType<typeof eligibilityFor>;
type DiscardTrail = typeof trailFor;
type GitResult = { ok: boolean; stdout: string };

type CardLifecycleDeps = {
  db: Db;
  bb: BbPluginApi;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  workflowStateDir: (
    bb: BbPluginApi,
    rootPath: string,
    workflowId: string,
    dirHash: string,
  ) => Promise<string | null>;
  workers: {
    stop: (threadId: string | null) => Promise<unknown>;
    deleteCard: (cardId: string) => void;
  };
  updateCard: (cardId: string, values: Record<string, unknown>) => void;
  releaseClaims: (cardId: string) => Promise<void>;
  removeCardPreset: (cardId: string) => void;
  logCardComment: (
    cardId: string,
    target: string,
    targetId: string,
    author: "user" | "agent",
    body: string,
  ) => string;
  runGitIn: (cwd: string, args: string[]) => Promise<GitResult>;
  exploratoryScope: string;
  discardEvidence: (card: WorkerCard) => Promise<DiscardEvidence>;
  discardEligibility: (evidence: DiscardEvidence) => Decision;
  discardConfirm: typeof discardConfirm;
  discardTrail: DiscardTrail;
  errors: { cardNotFound: string };
};

const discardFailure = (error: string) => ({
  ok: false,
  summary: null,
  error,
});

export function createCardLifecycleHandlers(deps: CardLifecycleDeps) {
  return {
    cancelCard: (input: { cardId: string }) => cancelCard(deps, input),
    deleteCard: (input: { cardId: string }) => deleteCard(deps, input),
    discardPreview: (input: { cardId: string }) => discardPreview(deps, input),
    discardCardChanges: (input: { cardId: string }) => discardCardChanges(deps, input),
  };
}

async function cancelCard(
  deps: CardLifecycleDeps,
  { cardId }: { cardId: string },
) {

  const card = deps.getCard(cardId);
  if (!card) return { archived: false };
  await deps.workers.stop(card.worker_thread_id);
  deps.updateCard(cardId, { status: "archived", activity: "idle" });
  await deps.releaseClaims(cardId);
  deps.bb.realtime.publish("card-state", { cardId });
  deps.bb.realtime.publish("board-changed", { cardId });
  return { archived: true };

}

async function deleteCard(
  deps: CardLifecycleDeps,
  { cardId }: { cardId: string },
) {

  const card = deps.getCard(cardId);
  if (!card) return { deleted: false, error: deps.errors.cardNotFound };
  if (card.status !== "archived") return {
    deleted: false,
    error: "Only archived cards can be deleted. Archive it first.",
  };
  await deps.workers.stop(card.worker_thread_id);
  await deps.releaseClaims(cardId);
  await removeOwnedState(deps, card);
  deleteCardRows(deps, cardId);
  deps.bb.realtime.publish("card-state", { cardId });
  deps.bb.realtime.publish("board-changed", { cardId });
  return { deleted: true, error: null };

}

async function discardCardChanges(
  deps: CardLifecycleDeps,
  { cardId }: { cardId: string },
) {

  const card = deps.getCard(cardId);
  if (!card) return discardFailure(deps.errors.cardNotFound);
  const protectedFailure = protectedDiscardFailure(card);
  if (protectedFailure) return discardFailure(protectedFailure);
  const evidence = await deps.discardEvidence(card);
  const decision = deps.discardEligibility(evidence);
  if (!decision.eligible || !decision.action) {
    return discardFailure(decision.reason ?? "Nothing safe to discard.");
  }
  await deps.workers.stop(card.worker_thread_id);
  const live = deps.getCard(cardId);
  if (!live) return discardFailure(deps.errors.cardNotFound);
  const fresh = await deps.discardEvidence(live);
  const refusal = revalidationRefusal(decision, fresh, deps.discardEligibility(fresh));
  if (refusal) return discardFailure(refusal);
  const executionError = await executeDiscard(
    deps,
    decision.action as DiscardAction,
    fresh,
  );
  if (executionError) return discardFailure(executionError);
  return finishDiscard(deps, live, decision.action as DiscardAction, fresh);

}

async function discardPreview(
  deps: CardLifecycleDeps,
  { cardId }: { cardId: string },
) {

  const card = deps.getCard(cardId);
  if (!card) return emptyDiscardPreview(deps.errors.cardNotFound);
  const evidence = await deps.discardEvidence(card);
  const decision = deps.discardEligibility(evidence);
  if (!decision.eligible || !decision.action) {
    return {
      ...emptyDiscardPreview(),
      reason: decision.reason,
      branch: evidence.branch,
    };
  }
  const copy = deps.discardConfirm(evidence, decision.action);
  const files = [...evidence.changed, ...evidence.untracked];
  return {
    eligible: true,
    action: decision.action,
    reason: null,
    branch: evidence.branch,
    files: files.slice(0, 50),
    fileCount: files.length,
    commitCount: evidence.unpushedCommits,
    sharedWith: evidence.sharedWith,
    confirmTitle: copy.title,
    confirmBody: copy.body,
    error: null,
  };

}


function emptyDiscardPreview(error: string | null = null) {
  return {
    eligible: false,
    action: null as DiscardAction | null,
    reason: null as string | null,
    branch: null as string | null,
    files: [] as string[],
    fileCount: 0,
    commitCount: 0,
    sharedWith: 0,
    confirmTitle: null as string | null,
    confirmBody: null as string | null,
    error,
  };
}

function protectedDiscardFailure(card: WorkerCard): string | null {
  if (card.status === "completed" || card.status === "blocked") {
    return "Completed work is history — reset it by hand.";
  }
  return null;
}

function revalidationRefusal(
  decision: Decision,
  fresh: DiscardEvidence,
  confirmation: Decision,
): string | null {
  if (!confirmation.eligible || confirmation.action !== decision.action) {
    return confirmation.reason ?? "The checkout changed under this discard — review it again.";
  }
  const needsBranch = decision.action === "worktree-drop" || decision.action === "branch-reset";
  if (needsBranch && !fresh.branch) {
    return "The checkout lost its branch mid-discard — review it by hand.";
  }
  if (decision.action === "branch-reset" && !fresh.resetTarget) {
    return "No safe reset point could be determined — reset it by hand.";
  }
  return null;
}

async function executeDiscard(
  deps: CardLifecycleDeps,
  action: DiscardAction,
  evidence: DiscardEvidence,
): Promise<string | null> {
  try {
    if (action === "dir-delete") return deleteExploratoryDirectory(deps, evidence);
    if (action === "worktree-drop") return removeGitWorktree(deps, evidence);
    return resetGitCheckout(deps, evidence);
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Discard failed midway — review the checkout by hand.";
  }
}

function deleteExploratoryDirectory(
  deps: CardLifecycleDeps,
  evidence: DiscardEvidence,
): string | null {
  const target = evidence.checkoutPath ?? "";
  const scoped =
    target === deps.exploratoryScope || target.startsWith(`${deps.exploratoryScope}/`);
  if (!scoped) throw new Error("Refusing to delete outside the exploratory scope.");
  rmSync(target, { recursive: true, force: true });
  if (existsSync(target)) throw new Error("The folder survived deletion.");
  return null;
}

async function removeGitWorktree(
  deps: CardLifecycleDeps,
  evidence: DiscardEvidence,
): Promise<string | null> {
  const checkout = evidence.checkoutPath ?? "";
  const common = await deps.runGitIn(checkout, ["rev-parse", "--git-common-dir"]);
  const commonDir = common.ok ? common.stdout.trim() : "";
  const mainDir = commonDir
    ? isAbsolute(commonDir)
      ? commonDir
      : nodeJoin(checkout, commonDir)
    : "";
  if (!mainDir) throw new Error("Cannot locate the main checkout.");
  await deps.runGitIn(mainDir, ["worktree", "unlock", checkout]);
  const removed = await deps.runGitIn(mainDir, ["worktree", "remove", "--force", checkout]);
  if (!removed.ok) throw new Error("Could not remove the worktree.");
  const pruned = await deps.runGitIn(mainDir, ["branch", "-D", evidence.branch ?? ""]);
  if (!pruned.ok) {
    throw new Error("Worktree removed, but the branch survived — delete it by hand.");
  }
  if (evidence.checkoutPath && existsSync(evidence.checkoutPath)) {
    throw new Error("The worktree folder survived removal.");
  }
  return null;
}

async function resetGitCheckout(
  deps: CardLifecycleDeps,
  evidence: DiscardEvidence,
): Promise<string | null> {
  const checkout = evidence.checkoutPath ?? "";
  const reset = await deps.runGitIn(checkout, ["reset", "--hard", evidence.resetTarget ?? ""]);
  if (!reset.ok) throw new Error("Could not reset the branch.");
  const cleaned = await deps.runGitIn(checkout, ["clean", "-fd"]);
  if (!cleaned.ok) {
    throw new Error("Branch reset, but untracked files survived — remove them by hand.");
  }
  const verify = await deps.runGitIn(checkout, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (!verify.ok || verify.stdout.trim()) {
    throw new Error("The checkout is not clean after discard — review it by hand.");
  }
  return null;
}

function finishDiscard(
  deps: CardLifecycleDeps,
  card: WorkerCard,
  action: DiscardAction,
  evidence: DiscardEvidence,
) {
  const summary = deps.discardTrail(action, evidence);
  deps.logCardComment(card.id, "card", card.id, "agent", summary);
  if (!isArchivedCard(card)) {
    deps.updateCard(card.id, { status: "archived", activity: "idle" });
  }
  publishCardLifecycle(deps, card.id);
  return { ok: true, summary, error: null };
}

async function removeOwnedState(
  deps: CardLifecycleDeps,
  card: WorkerCard,
): Promise<void> {
  try {
    const workspace = await deps.cardWorkspace(card).catch(() => null);
    const stateDir =
      workspace?.path && card.dir_hash
        ? await deps.workflowStateDir(
            deps.bb,
            workspace.path,
            card.id,
            card.dir_hash,
          ).catch(() => null)
        : null;
    if (stateDir) rmSync(stateDir, { recursive: true, force: true });
  } catch {
    /* bookkeeping rows below still delete */
  }
}

function deleteCardRows(deps: CardLifecycleDeps, cardId: string): void {
  for (const table of [
    "comments",
    "expired_questions",
    "ask_contracts",
    "inbox_events",
  ]) {
    deps.db.prepare(`DELETE FROM ${table} WHERE card_id = ?`).run(cardId);
  }
  deps.removeCardPreset(cardId);
  deps.workers.deleteCard(cardId);
  deps.db.prepare("UPDATE github_imports SET card_id = NULL WHERE card_id = ?").run(cardId);
  deps.db.prepare("DELETE FROM cards WHERE id = ?").run(cardId);
}

function publishCardLifecycle(deps: CardLifecycleDeps, cardId: string): void {
  deps.bb.realtime.publish("card-state", { cardId });
  deps.bb.realtime.publish("board-changed", { cardId });
}
