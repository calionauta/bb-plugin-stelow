/**
 * The artifact-review store: marks bound to the version of the file a person
 * read.
 *
 * The mark is written by the SERVER from the artifact list it just read, never
 * from a fingerprint the client supplies. A client-supplied fingerprint would
 * let an old mark be written as current — the exact claim the fingerprint
 * exists to make impossible — so the RPC input carries only `{ cardId, path }`
 * and this module resolves the rest.
 *
 * Two operations, and the pair is deliberate: marking is a decision, unmarking
 * is the door back. A mark is not a gate and resolves no inbox event; it only
 * lets the card say which files were read at the version on screen.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { isArchivedCard } from "../../lib/worker-action-policy.mjs";
import type { WorkerCard } from "../workers-types.js";
import type { DetailArtifact } from "./card-detail-artifacts.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/**
 * The refusal a path earns when it is not one of this card's artifacts.
 *
 * Names the exit rather than restating the rule: the reader can see the list
 * the path has to come from, and a refusal without a door is a deadlock with a
 * good error message (AGENTS.md).
 */
export const ARTIFACT_NOT_ON_CARD = "That path is not an artifact on this card. "
  + "Open the card's Artifacts section to see the list.";

/**
 * The workspace could not be read, which is NOT the same as "no artifacts".
 *
 * A transient host failure rendered as `ARTIFACT_NOT_ON_CARD` would send the
 * reader to a section that shows the file as soon as the workspace is back —
 * a refusal naming the wrong door.
 */
export const ARTIFACTS_UNAVAILABLE = "The host could not read this card's artifacts. "
  + "Reopen the card and try again.";

/** Every mark this card carries, as path → the fingerprint it was marked at. */
export function reviewMarks(db: Db, cardId: string): Map<string, string> {
  const rows = db
    .prepare("SELECT path, reviewed_fingerprint FROM artifact_reviews WHERE card_id = ?")
    .all(cardId) as Array<{ path?: unknown; reviewed_fingerprint?: unknown }>;
  const marks = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.path === "string" && typeof row.reviewed_fingerprint === "string") {
      marks.set(row.path, row.reviewed_fingerprint);
    }
  }
  return marks;
}

/** Record, or refresh, the mark for one artifact at the fingerprint read. */
export function markArtifactReviewed(
  db: Db,
  cardId: string,
  path: string,
  fingerprint: string,
  at: number,
): void {
  db.prepare(`INSERT INTO artifact_reviews (card_id, path, reviewed_at, reviewed_fingerprint)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(card_id, path) DO UPDATE SET
      reviewed_at = excluded.reviewed_at,
      reviewed_fingerprint = excluded.reviewed_fingerprint`).run(cardId, path, at, fingerprint);
}

/**
 * Clear the mark. No artifact-list requirement: the file a mark names may have
 * been deleted or renamed away since, and refusing its removal would leave a
 * row nobody can ever clean up. Its absence already keeps it out of the count.
 */
export function unmarkArtifactReviewed(db: Db, cardId: string, path: string): void {
  db.prepare("DELETE FROM artifact_reviews WHERE card_id = ? AND path = ?").run(cardId, path);
}

export type ArtifactReviewDeps = {
  db: Db;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  /** The SERVER's read of the card's current artifacts. `null` is UNKNOWN (the
   * workspace could not be read), never "no artifacts". */
  readArtifacts: (card: WorkerCard) => Promise<DetailArtifact[] | null>;
  publish: (cardId: string) => void;
  errors: { cardNotFound: string; cardArchived: string };
};

type ReviewInput = { cardId: string; path: string };
type ReviewResult = { ok: boolean; error: string | null };

export function createArtifactReviewHandlers(deps: ArtifactReviewDeps) {
  return {
    markArtifactReviewed: (input: ReviewInput) => markReviewed(deps, input),
    unmarkArtifactReviewed: (input: ReviewInput) => unmarkReviewed(deps, input),
  };
}

function refused(error: string): ReviewResult {
  return { ok: false, error };
}

function accepted(): ReviewResult {
  return { ok: true, error: null };
}

/** Both doors refuse the same two cards before touching any mark. */
function cardRefusal(
  deps: ArtifactReviewDeps,
  cardId: string,
): { card: WorkerCard } | { error: string } {
  const card = deps.getCard(cardId);
  if (!card) return { error: deps.errors.cardNotFound };
  if (isArchivedCard(card)) return { error: deps.errors.cardArchived };
  return { card };
}

/**
 * Mark one artifact reviewed, at the version the server sees NOW.
 *
 * The artifact is looked up in the same list the detail renders, so a path the
 * card does not carry cannot acquire a mark. The stored fingerprint is that
 * artifact's `generatedAt`, never anything the caller sent.
 */
async function markReviewed(
  deps: ArtifactReviewDeps,
  { cardId, path }: ReviewInput,
): Promise<ReviewResult> {
  const checked = cardRefusal(deps, cardId);
  if ("error" in checked) return refused(checked.error);
  const artifacts = await deps.readArtifacts(checked.card);
  if (artifacts === null) return refused(ARTIFACTS_UNAVAILABLE);
  const artifact = artifacts.find((entry) => entry.path === path);
  if (!artifact) return refused(ARTIFACT_NOT_ON_CARD);
  markArtifactReviewed(deps.db, cardId, artifact.path, artifact.generatedAt, deps.now());
  deps.publish(cardId);
  return accepted();
}

/** Clear one mark, whether or not the artifact still exists. */
function unmarkReviewed(
  deps: ArtifactReviewDeps,
  { cardId, path }: ReviewInput,
): ReviewResult {
  const checked = cardRefusal(deps, cardId);
  if ("error" in checked) return refused(checked.error);
  unmarkArtifactReviewed(deps.db, cardId, path);
  deps.publish(cardId);
  return accepted();
}
