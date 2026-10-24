import { randomUUID } from "node:crypto";
import { recordMatrixQuestions } from "../../lib/contrast-ask-door.mjs";
import type { CardDetailDeps } from "./card-detail-types.js";
import type { WorkerCard } from "../workers-types.js";

/** Only the host reads this door needs, so a test can hand in four fields. */
type ContrastDoorDeps = Pick<CardDetailDeps, "db" | "bb" | "now" | "stateDir">;

/**
 * The door: the card's contrast matrix, read, becomes open questions.
 *
 * The card detail is where the host reads the card's state-dir documents for a
 * person, so it is the first moment the matrix is parsed at all — and therefore
 * where a blank cell becomes a question whose premise is that cell
 * (lib/contrast-ask-door). A card with no matrix, which is most cards, is
 * untouched: no file, no questions, no row.
 *
 * Best effort on purpose. A matrix the worker wrote and the model refuses must
 * not make the card unopenable: the human opening it is not the reader who can
 * act on a parser sentence, and the refusal belongs to the worker's own write
 * path. A broken document therefore costs the questions it implies, nothing
 * else — and it can never cost a question its premise, because the refused
 * document records nothing at all.
 */
export async function recordContrastQuestions(
  deps: ContrastDoorDeps,
  card: WorkerCard,
  sourcePath: string | null,
): Promise<{ declarations: number; recorded: number } | null> {
  if (!sourcePath) return null;
  const stateDir = await deps.stateDir(sourcePath, card).catch(() => null);
  return recordMatrixQuestions(deps.db, {
    cardId: card.id,
    stateDir,
    askedAt: deps.now(),
    makeId: () => `askc_${randomUUID()}`,
    read: (path) =>
      deps.bb.sdk.files
        .read({ path })
        .then((file) => file?.content ?? null)
        .catch(() => null),
  }).catch(() => null);
}
