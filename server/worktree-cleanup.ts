import { cleanupConfirm, cleanupEligibility, cleanupTrail } from "../lib/discard-policy.mjs";

type Card = {
  id: string;
  worker_thread_id: string | null;
};

export type CleanupEvidence = {
  checkoutPath: string | null;
  branch: string | null;
  changed: string[];
  untracked: string[];
  unpushedCommits: number;
};

type CleanupDeps = {
  getCard: (cardId: string) => Card | undefined;
  evidence: (card: Card) => Promise<CleanupEvidence>;
  dropWorktree: (checkoutPath: string, branch: string) => Promise<void>;
  stopWorker: (threadId: string) => Promise<void>;
  log: (cardId: string, body: string) => void;
  publish: (event: "card-state" | "board-changed", payload: { cardId: string }) => void;
};

type PreviewResult = {
  eligible: boolean;
  reason: string | null;
  branch: string | null;
  fileCount: number;
  commitCount: number;
  confirmTitle: string | null;
  confirmBody: string | null;
};

type CleanupResult = { ok: boolean; summary: string | null; error: string | null };

function unavailable(reason: string): PreviewResult {
  return {
    eligible: false,
    reason,
    branch: null,
    fileCount: 0,
    commitCount: 0,
    confirmTitle: null,
    confirmBody: null,
  };
}

export function createWorktreeCleanup(deps: CleanupDeps) {
  async function preview(cardId: string): Promise<PreviewResult> {
    const card = deps.getCard(cardId);
    if (!card) return unavailable("Card not found.");
    const evidence = await deps.evidence(card);
    const decision = cleanupEligibility(evidence);
    if (!decision.eligible) {
      return {
        ...unavailable(decision.reason ?? "This checkout cannot be cleaned up."),
        branch: evidence.branch,
      };
    }
    const confirm = cleanupConfirm(evidence);
    return {
      eligible: true,
      reason: null,
      branch: evidence.branch,
      fileCount: evidence.changed.length + evidence.untracked.length,
      commitCount: evidence.unpushedCommits,
      confirmTitle: confirm.title,
      confirmBody: confirm.body,
    };
  }

  async function cleanup(cardId: string): Promise<CleanupResult> {
    const card = deps.getCard(cardId);
    if (!card) return { ok: false, summary: null, error: "Card not found." };
    const before = cleanupEligibility(await deps.evidence(card));
    if (!before.eligible) {
      return { ok: false, summary: null, error: before.reason ?? "Nothing safe to clean up." };
    }
    if (card.worker_thread_id) await deps.stopWorker(card.worker_thread_id);
    const evidence = await deps.evidence(card);
    const confirmed = cleanupEligibility(evidence);
    if (!confirmed.eligible) {
      return { ok: false, summary: null, error: confirmed.reason ?? "Review the checkout again." };
    }
    if (!evidence.checkoutPath || !evidence.branch) {
      return { ok: false, summary: null, error: "The linked worktree identity is unavailable." };
    }
    try {
      await deps.dropWorktree(evidence.checkoutPath, evidence.branch);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cleanup failed.";
      return { ok: false, summary: null, error: message };
    }
    const summary = cleanupTrail(evidence);
    deps.log(cardId, summary);
    deps.publish("card-state", { cardId });
    deps.publish("board-changed", { cardId });
    return { ok: true, summary, error: null };
  }

  return {
    preview,
    cleanup,
    handlers: {
      cleanupWorktreePreview: ({ cardId }: { cardId: string }) => preview(cardId),
      cleanupWorktree: ({ cardId }: { cardId: string }) => cleanup(cardId),
    },
  };
}

export type WorktreeCleanup = ReturnType<typeof createWorktreeCleanup>;
