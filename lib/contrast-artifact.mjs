/**
 * The contrast matrix as a CARD ARTIFACT.
 *
 * `lib/contrast-model.mjs` derives questions from a matrix and stops there,
 * because a derivation with no matrix to read is a library nobody calls. This
 * module is the other half: one markdown file the scope stage writes into the
 * card's state dir, carrying the matrix in a fenced block, so the round trip is
 * mechanical — the artifact is parsed back to the exact object the derivation
 * reads, and no prose has to be interpreted on the way.
 *
 * The scope stage is the owner because the matrix decides SCOPE: a blank cell's
 * question is "missing feature, or deliberately absent?", which is exactly what
 * the Scope Map answers, and the interface stage already owns a differently
 * shaped artifact (`interfaces/contrast.json`, alternatives plus a disposition,
 * with its own exact schema). Naming this one after that stage's artifact would
 * put two artifacts behind one name and one schema that fits neither.
 *
 * JSON inside the fence, not YAML: the repository may not grow a dependency for
 * this (AGENTS.md), and JSON is the one carrier that round-trips a model
 * exactly — key order, arrays and numbers included. The prose around the fence
 * is for the reader; the fence is what the host parses.
 *
 * `parseContrastArtifact` validates through `assertContrastModel`, so an
 * artifact that is not a matrix is refused by the same invariants the
 * derivation applies, with the file named on the way out. A worker that writes
 * a draft matrix gets the matrix's own sentence about what is missing, not a
 * parser shrug.
 */

import { assertContrastModel, deriveQuestions } from "./contrast-model.mjs";

/** The fixed name of the artifact inside the card's state dir. One owner: the
 * state-dir registry imports this rather than re-spelling it. */
export const CONTRAST_ARTIFACT = "contrast-matrix.md";

/** The fence language. Distinct from `json` so a reader (and a future parser)
 * can tell the matrix from every other JSON block in the same document. */
export const CONTRAST_FENCE = "stelow-contrast";

const FENCE = /```stelow-contrast[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/;

function fail(message) {
  throw new Error(`contrast artifact: ${message}`);
}

/**
 * The artifact a worker writes: a heading, the one paragraph that tells the
 * next reader what the table is for, and the matrix.
 *
 * The paragraph is not decoration. A worker that receives only a fence learns
 * to paste a matrix it did not think through; the sentence states the rule the
 * host enforces — a blank cell is a question — so the file teaches the same
 * thing the derivation does.
 */
export function renderContrastArtifact(model) {
  assertContrastModel(model);
  return [
    "# Contrast matrix",
    "",
    "Places crossed with the states they can be in. Each cell lists the",
    "affordances a reader can act on there; a blank cell is a question, not a",
    "typo — the host derives one question per blank cell, per shared affordance,",
    "and per state no place handles. Fill the cell to answer it, or record the",
    "absence on purpose.",
    "",
    `\`\`\`${CONTRAST_FENCE}`,
    JSON.stringify(model, null, 2),
    "```",
    "",
  ].join("\n");
}

/** The fenced block's body, or null when the document has no matrix fence. */
export function contrastMatrixFence(markdown) {
  if (typeof markdown !== "string") return null;
  const match = FENCE.exec(markdown);
  const body = match?.[1]?.trim();
  return body ? body : null;
}

/**
 * Read the matrix back out of an artifact. Throws when the document is not an
 * artifact at all (no fence), when the fence is not JSON, and when the JSON is
 * not a matrix (the model's own invariants say which id is wrong).
 */
export function parseContrastArtifact(markdown) {
  const body = contrastMatrixFence(markdown);
  if (!body) {
    fail(`${CONTRAST_ARTIFACT} has no \`\`\`${CONTRAST_FENCE} block — the matrix lives in that fence, not in the prose`);
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    fail(`the \`\`\`${CONTRAST_FENCE} block is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return assertContrastModel(parsed);
}

/** What the artifact implies, exactly as the model derives it. */
export function contrastArtifactQuestions(markdown) {
  return deriveQuestions(parseContrastArtifact(markdown));
}

/**
 * The derived questions as ask DECLARATIONS: the fields a recorded question
 * carries, and nothing about its id or card (the caller mints those).
 *
 * This is where the artifact reaches a card. Every declaration keeps the
 * question's premise and reversal cost, because a question that loses them on
 * the way to the store cannot be checked, located or invalidated later.
 */
export function contrastAskDeclarations(markdown) {
  return contrastArtifactQuestions(markdown).map((question) => ({
    question: question.prompt,
    premise: question.premise,
    reversalCost: question.reversal_cost,
    options: question.options.map((option) => ({ id: option.id, label: option.label })),
  }));
}
