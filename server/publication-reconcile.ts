/**
 * The publication reconciler: keep the publication ledger honest about merges
 * that happened somewhere else.
 *
 * `integrationPending` reads only `publication_events`, and that is on purpose —
 * the board lists every card, so a per-card git call would turn a scroll into a
 * spawn. The design has one hole: a pull request merged outside the panel writes
 * no event, so the chip keeps reporting work as still owed after it has already
 * landed. The board cannot close that hole from a read without giving up the
 * reason it is cheap.
 *
 * This pass closes it from the forge's side. It asks the one question whose
 * answer is decisive — "is this card's pull request merged?" — and records the
 * landing only when the platform answers yes. Nothing is inferred from a
 * working tree, a merge base or a branch name: a card with no pull request, a
 * workspace that is gone, or a status BB cannot read is left alone, so the chip
 * goes on saying what it recorded rather than what it guessed.
 *
 * It is a reconcile rule, not a read: it runs on the same tick as the other
 * sweeps, it is idempotent (a card that already records a merge is skipped), and
 * it cannot fail the reconcile — one card's forge error is one card's silence.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { publicationEvents, recordPublication } from "./artifacts-publication-status.js";
import type { ArtifactsPublicationDeps } from "./artifacts-publication.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/** The only action that means the work reached the base branch. */
const LANDED = "pull_request_merge";

export function createPublicationReconcile(deps: ArtifactsPublicationDeps) {
  return { reconcilePublications: () => reconcilePublications(deps) };
}

/**
 * The cards worth asking about: finished, backed by a repository, and not
 * already known to have landed.
 */
function pendingCandidates(db: Db): string[] {
  const rows = db.prepare(`
    SELECT id FROM cards
     WHERE status = 'completed' AND coalesce(workspace_kind, '') <> 'exploratory'
  `).all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

function alreadyLanded(deps: ArtifactsPublicationDeps, cardId: string): boolean {
  return publicationEvents(deps, cardId).some((event) => event.action === LANDED);
}

export async function reconcilePublications(
  deps: ArtifactsPublicationDeps,
): Promise<void> {
  for (const cardId of pendingCandidates(deps.db)) {
    try {
      if (alreadyLanded(deps, cardId)) continue;
      const card = deps.cards.get(cardId);
      if (!card) continue;
      const checkout = await deps.cards.checkout(card).catch(() => null);
      if (!checkout?.environmentId) continue;
      const status = await deps.bb.sdk.environments
        .pullRequest({ environmentId: checkout.environmentId })
        .catch(() => null);
      if (status?.outcome !== "available") continue;
      const pullRequest = status.pullRequest;
      if (pullRequest?.state !== "merged") continue;
      recordPublication(
        deps,
        cardId,
        LANDED,
        "Reconciled: this card's pull request is merged, so its work is already on the base branch."
          + " Recorded by the publication reconciler, which asks the forge rather than the ledger.",
        null,
        pullRequest.url,
      );
    } catch {
      // A reconcile pass reports nothing and stops nothing. The next tick retries.
    }
  }
}
