import { z } from "zod";

/**
 * The reviewed mark's two doors.
 *
 * A mark is a claim about a VERSION of an artifact, so the input carries a path
 * and no fingerprint ON PURPOSE. A client-supplied fingerprint would let an old
 * mark be written as current — the one claim the mark exists to prevent — and
 * `.strict()` refuses a caller that tries. The server resolves the fingerprint
 * from the artifact list it reads (`server/runtime/artifact-reviews.ts`).
 *
 * Kept beside the card-detail contract rather than inside it: that file is at
 * its size budget, and a fragment that names its own refusals is easier to
 * review than two entries appended to a contract of eighty fields.
 */
export const artifactReviewRpcContract = {
  /**
   * Mark one artifact reviewed at the version the server reads now.
   *
   * Refusals name their exits: unknown card (`cardNotFound`), archived card
   * (the existing message), and a path that is not among the card's artifacts
   * (`ARTIFACT_NOT_ON_CARD`, which points at the Artifacts section).
   */
  markArtifactReviewed: {
    experimental_description: "Mark this card's artifact reviewed at its current version",
    input: z.object({ cardId: z.string(), path: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  /**
   * Clear a reviewed mark.
   *
   * Separate from marking because a mark is a person's claim, and the person who
   * made it must be able to take it back; archiving is not the only thing
   * people get wrong. Unlike marking, a path that is no longer an artifact is
   * accepted: its file may be gone, and that must not leave a row nobody can
   * remove.
   */
  unmarkArtifactReviewed: {
    experimental_description: "Clear this card's reviewed mark for one artifact path",
    input: z.object({ cardId: z.string(), path: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
};
