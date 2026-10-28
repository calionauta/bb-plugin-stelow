/**
 * The publication reconciler: keep the publication ledger honest about merges
 * that happened somewhere else.
 *
 * `integrationPending` reads only `publication_events`, and that is on purpose —
 * the board lists every card, so a per-card git call would turn a scroll into a
 * spawn. The design has one hole: work that landed outside the panel writes no
 * event, so the chip keeps reporting it as owed. Measured on this board:
 * `card_e3u00eb4` was merged through a pull request the panel never saw, and
 * `card_oqm8gyae` was committed by hand on a `rescue/` branch that no code path
 * in this repository creates.
 *
 * This pass closes it by asking the SAME question the worktree cleanup gate asks
 * before it deletes a directory — `integrationProof`, over `isWorkIntegrated`:
 *
 * - the forge, for "is this card's pull request merged" — decisive while it
 *   holds, because a merged pull request stays merged;
 * - the content, for "does the base branch already contain these files" — the
 *   proof a squash leaves behind, and the one that sees a merge nobody recorded.
 *
 * Nothing is inferred from a merge base, a branch name, or the absence of
 * unpushed commits — that last one is not a proof, since a pushed and unmerged
 * branch has none either. When neither proof answers, the card is left exactly
 * as the ledger described it: a chip reading "No commit recorded" is honest, and
 * a chip reading "landed" on an inference is not.
 *
 * It is a reconcile rule, not a read: it runs on the same tick as the other
 * sweeps, it is idempotent, and it cannot fail the reconcile — one card's git or
 * forge error is one card's silence.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { recordPublication } from "./artifacts-publication-status.js";
import { integrationProof, type GitRunner } from "./integration-proof.js";
import { hasRecordedIntegration } from "../lib/integration-pending.mjs";
import {
  createProbeBackoff,
  PROBE_PASS_BUDGET_MS,
  PROBE_PASS_LIMIT,
  type ProbeBackoff,
} from "../lib/publication-probe-backoff.mjs";
import type {
  ArtifactsPublicationDeps,
  PublicationCard,
  PublicationCheckout,
} from "./artifacts-publication.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/**
 * Everything this pass needs, as the wiring root already holds it. The shape
 * lives here so the root adds a call rather than a facade — and so the test can
 * hand it the same object the root does.
 */
export type PublicationReconcileCore = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  randomId: (prefix: string) => string;
  cardNotFound: string;
  getCard: (cardId: string) => PublicationCard | undefined;
  checkout: (card: PublicationCard) => Promise<PublicationCheckout | null>;
  cardStatusOf: (value: unknown) => string;
  /** The worktree the card worked in, so the content proof has a directory. */
  discardEvidence: (card: PublicationCard) => Promise<{ checkoutPath?: string | null } | null>;
  runGitIn: GitRunner;
};

function publicationDepsFor(core: PublicationReconcileCore): ArtifactsPublicationDeps {
  return {
    db: core.db,
    bb: core.bb,
    now: core.now,
    randomId: core.randomId,
    cardNotFound: core.cardNotFound,
    cards: { get: core.getCard, checkout: core.checkout },
    cardStatusOf: core.cardStatusOf,
  };
}

export function createPublicationReconcile(core: PublicationReconcileCore) {
  const backoff = createProbeBackoff();
  return { reconcilePublications: () => reconcilePublications(core, backoff) };
}

/**
 * The cards worth asking about: finished, backed by a repository, and not
 * already known to have landed.
 */
function pendingCandidates(db: Db): string[] {
  const rows = db.prepare(`
    SELECT id FROM cards
     WHERE status = 'completed' AND coalesce(workspace_kind, '') <> 'exploratory'
     ORDER BY updated_at ASC
  `).all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

type Landing = { prUrl: string | null; by: "pr" | "content" };

async function provedLanding(
  core: PublicationReconcileCore,
  card: PublicationCard,
): Promise<Landing | null> {
  // The forge first: a merged pull request stays merged, so it survives the base
  // branch moving on. The content proof does not — it holds only while the trees
  // still match — which is why it is the second answer, not the only one.
  const checkout = await core.checkout(card).catch(() => null);
  const environmentId = checkout?.environmentId ?? null;
  const pullRequest = environmentId
    ? await core.bb.sdk.environments.pullRequest({ environmentId }).catch(() => null)
    : null;
  const prUrl = pullRequest?.outcome === "available" && pullRequest.pullRequest?.state === "merged"
    ? pullRequest.pullRequest.url ?? null
    : null;

  const evidence = await core.discardEvidence(card).catch(() => null);
  const verdict = await integrationProof({
    runGitIn: core.runGitIn,
    checkoutPath: evidence?.checkoutPath ?? null,
    recorded: hasRecordedIntegration(core.db, card.id) || prUrl !== null,
  });
  if (!verdict.integrated) return null;
  if (prUrl !== null) return { prUrl, by: "pr" };
  // "recorded" means the ledger already said so; there is nothing to write.
  return verdict.proof === "content" ? { prUrl: null, by: "content" } : null;
}

export async function reconcilePublications(
  core: PublicationReconcileCore,
  backoff: ProbeBackoff = createProbeBackoff(),
): Promise<void> {
  const deps = publicationDepsFor(core);
  const failures: string[] = [];
  const startedAt = core.now();
  const probed = dueCandidates(core, backoff, startedAt);
  for (const cardId of probed) {
    await probeCard(core, backoff, cardId, deps, failures);
  }
  reportFailures(core, failures);
}

/** The cards this pass may ask about: due, and bounded by the per-pass limit. */
function dueCandidates(
  core: PublicationReconcileCore,
  backoff: ProbeBackoff,
  startedAt: number,
): string[] {
  const due: string[] = [];
  for (const cardId of pendingCandidates(core.db)) {
    if (due.length >= PROBE_PASS_LIMIT) break;
    if (core.now() - startedAt >= PROBE_PASS_BUDGET_MS) break;
    if (backoff.due(cardId, core.now())) due.push(cardId);
  }
  return due;
}

/** One card, one proof. A failure backs the card off; an answered ledger entry
 * forgets it. */
async function probeCard(
  core: PublicationReconcileCore,
  backoff: ProbeBackoff,
  cardId: string,
  deps: ArtifactsPublicationDeps,
  failures: string[],
): Promise<void> {
  try {
    if (hasRecordedIntegration(core.db, cardId)) {
      backoff.succeeded(cardId);
      return;
    }
    const card = core.getCard(cardId);
    if (!card) {
      backoff.succeeded(cardId);
      return;
    }
    const landing = await provedLanding(core, card);
    if (!landing) {
      backoff.failed(cardId, core.now());
      return;
    }
    recordPublication(
      deps,
      cardId,
      landing.by === "pr" ? "pull_request_merge" : "reconciled_integrated",
      landing.by === "pr"
        ? "Reconciled: this card's pull request is merged, so its work is already on the base branch."
        : "Reconciled: the base branch already contains this branch's files, so the work is integrated."
          + " Proved by content — the proof a squash merge leaves and a commit id does not.",
      null,
      landing.prUrl,
    );
    backoff.succeeded(cardId);
  } catch (error) {
    failures.push(`${cardId} (${error instanceof Error ? error.message : String(error)})`);
    backoff.failed(cardId, core.now());
  }
}

function reportFailures(core: PublicationReconcileCore, failures: string[]): void {
  if (failures.length > 0) {
    const shown = failures.slice(0, 3).join(", ");
    const more = failures.length > 3 ? `, and ${failures.length - 3} more` : "";
    core.bb.log.warn(
      `publication reconcile could not ask the forge about ${failures.length} card(s): ${shown}${more}`,
    );
  }
}
