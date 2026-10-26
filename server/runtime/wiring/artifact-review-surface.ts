/**
 * The reviewed mark, wired: the reader both the card detail and the mark use,
 * and the two RPC doors.
 *
 * The mark's fingerprint is resolved from `readDetailArtifacts` — the same read
 * the card renders — so a mark can never name a version the reader did not see,
 * and a path the card does not carry cannot acquire one.
 */
import type { RuntimeCore } from "../runtime-core.js";
import { auditReceiptNote } from "../audit-receipts.js";
import { workspaceRelative } from "../card-files.js";
import { readDetailArtifacts } from "../card-detail-artifacts.js";
import { createArtifactReviewHandlers } from "../artifact-reviews.js";
import { fileTimestamp } from "../root-paths.js";
import type { WorkerCard } from "../../workers-types.js";

type ArtifactReadDeps = Parameters<typeof readDetailArtifacts>[0];

/**
 * The one artifact read the detail and the review mark share.
 *
 * A second reader with its own timestamp rules would let the mark and the row
 * disagree about which version was reviewed.
 */
export function artifactReadDeps(core: RuntimeCore): ArtifactReadDeps {
  const { bb } = core;
  return {
    bb,
    stateDir: (sourcePath: string, card: WorkerCard) =>
      card.dir_hash
        ? core.workflowStateDir(bb, sourcePath, card.id, card.dir_hash)
        : Promise.resolve(null),
    fileTimestamp,
    auditReceiptNote,
    workspaceRelative,
  };
}

/**
 * The mark's two doors. Neither resolves an inbox event or moves a stage: the
 * mark is a fact about an artifact, not about the card's fate.
 */
export function buildArtifactReviews(core: RuntimeCore) {
  return createArtifactReviewHandlers({
    db: core.db,
    now: core.now,
    getCard: core.getCard,
    readArtifacts: async (card) => {
      const workspace = await core.cardWorkspace(card).catch(() => null);
      if (!workspace?.path) return null;
      return readDetailArtifacts(
        artifactReadDeps(core),
        card,
        workspace.path,
        workspace.hostId,
      );
    },
    publish: (cardId) => core.bb.realtime.publish("card-state", { cardId }),
    errors: {
      cardNotFound: core.ERRORS.cardNotFound,
      cardArchived: core.ERRORS.cardArchived,
    },
  });
}
