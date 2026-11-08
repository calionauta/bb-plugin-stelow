/**
 * The door between a card's contrast matrix and the questions it implies.
 *
 * `lib/contrast-artifact.mjs` reads the matrix, `lib/contrast-model.mjs` derives
 * the questions, and `lib/question-contracts.mjs` records one row per question
 * with its premise. All three existed and nothing called them: a card could
 * carry a matrix full of blank cells and record zero questions. This is the
 * call, and it is made where the matrix is actually READ — the card detail,
 * which is the first moment the host parses the card's state-dir documents for
 * a person.
 *
 * The question lands in the existing derived-ask registry (`ask_contracts`),
 * is answered through the existing answer door (which matches it by question
 * text and refuses to consume a declaration whose premise no longer resolves),
 * and appears nowhere else. No new table, no new verb, no second place a
 * question can live.
 *
 * The read is injected so this runs against a real directory in a test and
 * against the host's file API in the server, and so a caller can decide what an
 * unreadable document means without this module guessing: a missing file
 * returns `null` (no matrix, nothing to ask), while a file that is not a valid
 * artifact THROWS the artifact's own sentence. A worker document must not be
 * able to make a card unopenable, so the server catches that — deliberately, at
 * the boundary, where "best effort, never fatal" is a policy a reader can see.
 */

import { join } from "node:path";
import { CONTRAST_ARTIFACT } from "./contrast-artifact.mjs";
import { recordContrastAsks } from "./question-contracts.mjs";

/**
 * Read `<stateDir>/contrast-matrix.md` and record the questions it implies.
 * Returns `null` when there is no matrix to read, otherwise what
 * `recordContrastAsks` reported: how many questions were candidates and how
 * many rows were new (a second read of the same matrix records none).
 */
export async function recordMatrixQuestions(db, { cardId, stateDir, askedAt, makeId, read } = {}) {
  if (typeof stateDir !== "string" || !stateDir) return null;
  if (typeof read !== "function") throw new Error("recordMatrixQuestions: read(path) is required.");
  const content = await read(join(stateDir, CONTRAST_ARTIFACT));
  if (typeof content !== "string" || content.trim() === "") return null;
  return recordContrastAsks(db, { cardId, artifact: content, askedAt, makeId });
}
