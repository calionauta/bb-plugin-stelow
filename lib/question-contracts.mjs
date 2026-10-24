import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contrastAskDeclarations } from "./contrast-artifact.mjs";
import { isPremise, isReversalCost, premiseRefs, premiseVerdict } from "./premise-staleness.mjs";
import { normalizeReviewGates } from "./review-gates.mjs";
import { LEGACY_APPETITE_MAP } from "./workflow-config.mjs";

/** Closed vocabulary shared by the upstream contract and host enforcement. */
export const QUESTION_KINDS = ["human-ask", "agent-receipt", "skip"];

const DEFAULT_CATALOG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "stelow-stage-catalog.json",
);

export function loadQuestionContracts() {
  const catalog = JSON.parse(readFileSync(DEFAULT_CATALOG_PATH, "utf8"));
  if (catalog?.version !== 2) throw new Error("stage catalog version is invalid");
  return catalog.stages.flatMap((stage) => (stage.questions ?? []).map((question) => ({ ...question, stage: stage.id })));
}

function matchesSet(contract, gates) {
  if (typeof contract.gate !== "string") return false;
  const selected = normalizeReviewGates(gates).includes(contract.gate);
  return contract.kind === "human-ask" ? selected : !selected;
}

function matchesBreadth(contract, explorationCount) {
  if (typeof contract.exploration_min_count !== "number") return true;
  if (typeof explorationCount !== "number") return true;
  return explorationCount >= contract.exploration_min_count;
}

/**
 * The checklist that must be satisfied before leaving a completed stage.
 * Unknown stages, modes, and breadths fail open, matching stage-skips.
 * `reviewMode` accepts a legacy ladder string (matched against the
 * contract's `modes`, as before) or an explicit gate-atom array
 * (resolved per gate — the set path).
 * `explorationCount` gates breadth-scaled picks (a legacy `appetite`
 * ladder string is mapped once to its breadth).
 */
export function requiredForStage({ stage, reviewMode, appetite, explorationCount, kind } = {}) {
  const breadth =
    typeof explorationCount === "number"
      ? explorationCount
      : (typeof appetite === "string" && LEGACY_APPETITE_MAP[appetite]?.explorationCount) || null;
  if (typeof stage !== "string") return [];
  if (Array.isArray(reviewMode)) {
    return loadQuestionContracts()
      .filter((contract) => contract.stage === stage)
      .filter((contract) => matchesSet(contract, reviewMode))
      .filter((contract) => matchesBreadth(contract, breadth))
      .filter((contract) => !kind || contract.kind === kind)
      .map(({ id, kind: contractKind, receipt }) => ({ id, kind: contractKind, receipt }));
  }
  if (typeof reviewMode !== "string") return [];
  return loadQuestionContracts()
    .filter((contract) => contract.stage === stage)
    .filter((contract) => contract.modes.includes(reviewMode))
    .filter((contract) => matchesBreadth(contract, breadth))
    .filter((contract) => !kind || contract.kind === kind)
    .map(({ id, kind: contractKind, receipt }) => ({ id, kind: contractKind, receipt }));
}

/** The generated catalog is the only runtime source for question contracts. */

/* ---- merged from lib/ask-contracts.mjs: ask-to-contract linkage ---- */
/**
 * Ask-to-contract linkage for provenance. A worker may declare which
 * question contract an ask answers (`--contract <id>` per --question
 * group); when the human answers, the matching declaration is consumed and
 * the trail names the contract. Pure DB helpers (no BB host dependency),
 * following the worker-ledger precedent.
 *
 * Matching is by normalized question text, not interaction id: the host
 * interaction service returns no synchronous id at ask time, and the
 * duplicate guard serializes asks per card (at most one open set), so an
 * earliest-unconsumed text match is exact in practice. Re-asking identical
 * text with a different contract is already banned worker discipline.
 * Nothing here enforces advance acceptance — undeclared flows behave
 * byte-identically to before.
 */

/** Canonical form shared by writers and matchers. */
export function normalizeQuestionText(text) {
  return String(text ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Validate declared contract ids against the stage checklist (from
 * requiredForStage, or null when unreadable). Unknown ids with a readable
 * checklist refuse, naming the valid ids; without one the ask records raw
 * (fail-open — a stale mirror must never deadlock a worker).
 */
export function validateAskContracts(declarations, checklist) {
  const ids = [...new Set(
    (Array.isArray(declarations) ? declarations : [])
      .map((entry) => entry?.contractId)
      .filter((id) => typeof id === "string" && id),
  )];
  if (ids.length === 0) return { ok: true, error: null };
  if (!Array.isArray(checklist)) return { ok: true, error: null };
  const known = new Map();
  for (const entry of checklist) {
    if (entry && typeof entry.id === "string" && typeof entry.kind === "string") known.set(entry.id, entry.kind);
  }
  for (const id of ids) {
    const kind = known.get(id);
    if (kind === "agent-receipt") {
      return { ok: false, error: `"${id}" is resolved by its file receipt, not by asking — write the receipt instead.` };
    }
    if (kind === undefined && known.size > 0) {
      return { ok: false, error: `Unknown contract "${id}" for this stage. Valid ids: ${[...known.keys()].join(", ")}.` };
    }
  }
  return { ok: true, error: null };
}

/** Persist declarations ({ id, cardId, question, contractId, askedAt }). */
export function recordAskContracts(db, rows) {
  let count = 0;
  const insert = db.prepare("INSERT INTO ask_contracts (id, card_id, question_text, contract_id, asked_at, consumed_at) VALUES (?, ?, ?, ?, ?, NULL)");
  db.transaction(() => {
    for (const row of rows ?? []) {
      const question = normalizeQuestionText(row?.question);
      if (!row?.id || !row?.cardId || !question || !row?.contractId) continue;
      insert.run(row.id, row.cardId, question, row.contractId, row.askedAt ?? Date.now());
      count++;
    }
  })();
  return count;
}

/**
 * Record the questions a DERIVED ask produced — one the host read off an
 * artifact (a contrast matrix, today) rather than one a worker phrased freely.
 *
 * Two fields are mandatory here and absent from every legacy row, and that is
 * the whole point of the split:
 *
 * - `premise` names the cell (`cart|paid`, `cart|paid|pay-button`) or the
 *   artifact line (`artifact:plans/spec-tech.md:118`) the question came from.
 *   Without it the question cannot be checked, located, or invalidated by a
 *   rewind — it is a complaint with options.
 * - `reversalCost` is `{ level: low|medium|high, why }`, the cost of reversing
 *   the answer. A decision with no stated cost is one the next reader cannot
 *   weigh.
 *
 * Validation runs over every row BEFORE the transaction opens, so a faulty
 * batch writes nothing: half a derived ask is worse than none, because the
 * half that landed is the half a reader will find.
 *
 * `contract_id` is NOT NULL in the table it grew out of, and a derived question
 * answers no checklist contract — `''` is the row's way of saying none, the same
 * convention `split_proposals.question` already uses. Falsy reads as none
 * everywhere (`consumeAnsweredContract`), so the sentinel cannot leak out as a
 * contract id.
 */
export function recordDerivedQuestions(db, rows) {
  const prepared = (Array.isArray(rows) ? rows : []).map((row, index) => derivedRow(row, index));
  let count = 0;
  const insert = db.prepare(
    "INSERT INTO ask_contracts (id, card_id, question_text, contract_id, asked_at, consumed_at, premise, reversal_cost) "
    + "VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
  );
  db.transaction(() => {
    for (const row of prepared) {
      insert.run(row.id, row.cardId, row.question, row.contractId, row.askedAt, row.premise, row.reversalCost);
      count++;
    }
  })();
  return count;
}

function derivedRow(row, index) {
  const subject = typeof row?.id === "string" && row.id ? `"${row.id}"` : `rows[${index}]`;
  if (typeof row?.id !== "string" || !row.id) throw new Error(`derived question ${subject} has no id`);
  if (typeof row.cardId !== "string" || !row.cardId) throw new Error(`derived question ${subject} has no cardId`);
  const question = normalizeQuestionText(row.question);
  if (!question) throw new Error(`derived question ${subject} has no question text`);
  const premise = typeof row.premise === "string" ? row.premise.trim() : "";
  if (!premise) {
    throw new Error(
      `derived question ${subject} has no premise — a derived question must name the cell `
      + "(place|state) or artifact (artifact:<path>:<line>) it came from; a question without one "
      + "cannot be checked or invalidated by a rewind",
    );
  }
  if (!isPremise(premise)) {
    let why = "it is not a cell or artifact reference";
    try {
      premiseRefs(premise);
    } catch (error) {
      why = error instanceof Error ? error.message : why;
    }
    throw new Error(`derived question ${subject} has an unreadable premise: ${why}`);
  }
  if (!isReversalCost(row.reversalCost)) {
    throw new Error(
      `derived question ${subject} has no reversal_cost — it needs a level (low, medium or high) `
      + "and one sentence saying why reversing the answer costs that much",
    );
  }
  return {
    id: row.id,
    cardId: row.cardId,
    question,
    contractId: typeof row.contractId === "string" ? row.contractId : "",
    askedAt: typeof row.askedAt === "number" ? row.askedAt : Date.now(),
    premise,
    reversalCost: JSON.stringify({ level: row.reversalCost.level, why: row.reversalCost.why.trim() }),
  };
}

/**
 * Every question the card recorded with its premise, oldest first. A legacy row
 * (written before the premise existed) comes back with `premise: null` and
 * `reversalCost: null` — it still loads, and it never reads as stale, because a
 * decision with no premise has no ground to lose.
 */
export function questionPremises(db, cardId) {
  const rows = db.prepare(
    "SELECT id, question_text AS question, contract_id AS contractId, premise, reversal_cost AS reversalCost, "
    + "asked_at AS askedAt, consumed_at AS consumedAt FROM ask_contracts "
    + "WHERE card_id = ? ORDER BY asked_at ASC, id ASC",
  ).all(cardId);
  return rows.map((row) => ({
    ...row,
    premise: typeof row.premise === "string" && row.premise ? row.premise : null,
    reversalCost: parseReversalCost(row.reversalCost),
  }));
}

function parseReversalCost(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return isReversalCost(parsed) ? { level: parsed.level, why: parsed.why } : null;
  } catch {
    return null;
  }
}

/**
 * Consume the earliest unconsumed declaration matching the answered question
 * text. Returns the contract id, or null when nothing matches (normal path for
 * undeclared asks — no behavior change there).
 */
export function consumeAskContract(db, cardId, questionText, consumedAt = Date.now()) {
  return consumeAnsweredContract(db, cardId, questionText, { consumedAt }).contract;
}

/**
 * The answer boundary's consume, with its premise verdict.
 *
 * An answer resting on a premise that is gone is not an answer: the cell was
 * removed by a rewind, or the cited artifact line no longer exists. Consuming
 * the declaration would let that stale decision satisfy a checklist contract,
 * which is the side of the ledger a human reads later and believes. So a stale
 * premise leaves the row unconsumed and comes back with the verdict, and the
 * answer door names it on the trail instead of silently accepting it.
 *
 * `observe` is the card's premise observation (lib/premise-staleness). Absent
 * or unobservable means NO VERDICT — never "stale": an artifact the host could
 * not read must not accuse a decision, and every ask recorded before this
 * change keeps working exactly as it did.
 */
export function consumeAnsweredContract(db, cardId, questionText, { consumedAt = Date.now(), observe = null } = {}) {
  const text = normalizeQuestionText(questionText);
  if (!text) return { contract: null, premise: null, verdict: null };
  const row = db.prepare(
    "SELECT id, contract_id AS contractId, premise FROM ask_contracts "
    + "WHERE card_id = ? AND consumed_at IS NULL AND question_text = ? "
    + "ORDER BY asked_at ASC, id ASC LIMIT 1",
  ).get(cardId, text);
  if (!row) return { contract: null, premise: null, verdict: null };
  const premise = typeof row.premise === "string" && row.premise ? row.premise : null;
  const verdict = premise ? premiseVerdict(premise, observe) : null;
  if (verdict?.stale) return { contract: null, premise, verdict };
  db.prepare("UPDATE ask_contracts SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").run(consumedAt, row.id);
  return { contract: typeof row.contractId === "string" && row.contractId ? row.contractId : null, premise, verdict };
}

/**
 * Record the questions a contrast artifact implies, through the derived
 * question path. This is the seam the ask boundary calls with the matrix the
 * scope stage wrote: the artifact is parsed, the model derives its questions,
 * and each one lands with the cell or artifact line it came from.
 */
export function recordContrastAsks(db, { cardId, artifact, askedAt, makeId, contractId = "" } = {}) {
  if (typeof cardId !== "string" || !cardId) throw new Error("recordContrastAsks: cardId is required.");
  if (typeof makeId !== "function") throw new Error("recordContrastAsks: makeId is required to mint one row id per question.");
  if (typeof askedAt !== "number") throw new Error("recordContrastAsks: askedAt is required.");
  const rows = contrastAskDeclarations(artifact).map((declaration, index) => ({
    id: makeId(declaration, index),
    cardId,
    question: declaration.question,
    premise: declaration.premise,
    reversalCost: declaration.reversalCost,
    contractId,
    askedAt,
  }));
  return { declarations: rows.length, recorded: recordDerivedQuestions(db, rows) };
}
