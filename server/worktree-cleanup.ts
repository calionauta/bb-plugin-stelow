import { z } from "zod";
import { cleanupConfirm, cleanupEligibility, cleanupIntegrationGate, cleanupTrail } from "../lib/discard-policy.mjs";
import { resolveWithinRoot } from "../lib/path-jail.mjs";

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

const cardIdInput = z.object({ cardId: z.string().min(1) }).strict();

// A branch name that reaches a shell or git CLI must not smuggle flags or
// traversals: no leading dash, no `..`, no whitespace, no NUL.
const SAFE_BRANCH = /^(?!-)(?!.*\.\.)[A-Za-z0-9/_.-]+$/;

function jailedCheckout(checkoutPath: string | null, branch: string | null): string | null {
  if (!checkoutPath || !branch) return null;
  if (!SAFE_BRANCH.test(branch)) return null;
  // The checkout resolves against itself: absolute, NUL-free, separator-clean.
  // A relative or hostile path never reaches the removal below.
  return resolveWithinRoot(checkoutPath, ".");
}

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

async function preview(deps: CleanupDeps, cardId: string): Promise<PreviewResult> {
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
  // The worktree exists and could go; the question is whether the work in it
  // is safe to lose. A card at Done routinely is not — that is the case this
  // exists for. `card_cbnihg4c` sat at its last stage with 963 lines on a
  // branch nobody merged.
  const integration = cleanupIntegrationGate(evidence);
  if (!integration.safe) {
    return {
      ...unavailable(integration.blockers.join(" ")),
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

async function cleanup(deps: CleanupDeps, cardId: string): Promise<CleanupResult> {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, summary: null, error: "Card not found." };
  const before = cleanupEligibility(await deps.evidence(card));
  if (!before.eligible) {
    return { ok: false, summary: null, error: before.reason ?? "Nothing safe to clean up." };
  }
  // Re-checked at the moment of removal, not only in the preview: the preview
  // may be minutes old, and this is the check that has to hold.
  const integration = cleanupIntegrationGate(await deps.evidence(card));
  if (!integration.safe) {
    return { ok: false, summary: null, error: integration.blockers.join(" ") };
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
  // Last look before a destructive removal: the checkout and branch re-prove
  // themselves against the jail. Evidence is re-read above, so a checkout
  // that moved (or a branch that changed shape) between preview and removal
  // refuses instead of deleting the wrong tree.
  const jailed = jailedCheckout(evidence.checkoutPath, evidence.branch);
  if (!jailed) {
    return { ok: false, summary: null, error: "The linked worktree path failed validation. Refresh and review again." };
  }
  try {
    await deps.dropWorktree(jailed, evidence.branch);
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

export function createWorktreeCleanup(deps: CleanupDeps) {
  return {
    preview: (cardId: string) => preview(deps, cardIdInput.parse({ cardId }).cardId),
    cleanup: (cardId: string) => cleanup(deps, cardIdInput.parse({ cardId }).cardId),
    handlers: {
      cleanupWorktreePreview: (input: { cardId: string }) => preview(deps, cardIdInput.parse(input).cardId),
      cleanupWorktree: (input: { cardId: string }) => cleanup(deps, cardIdInput.parse(input).cardId),
    },
  };
}

export type WorktreeCleanup = ReturnType<typeof createWorktreeCleanup>;
