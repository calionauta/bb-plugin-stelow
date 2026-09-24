import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeReviewGates } from "./review-gates.mjs";

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

/**
 * The checklist that must be satisfied before leaving a completed stage.
 * Unknown stages, modes, and appetites fail open, matching stage-skips.
 * `reviewMode` accepts a legacy ladder string (matched against the
 * contract's `modes`, as before) or an explicit gate-atom array
 * (resolved per gate — the set path).
 */
export function requiredForStage({ stage, reviewMode, appetite, kind } = {}) {
  if (typeof stage !== "string") return [];
  if (Array.isArray(reviewMode)) {
    return loadQuestionContracts()
      .filter((contract) => contract.stage === stage)
      .filter((contract) => matchesSet(contract, reviewMode))
      .filter((contract) => !contract.appetite || contract.appetite.includes(appetite))
      .filter((contract) => !kind || contract.kind === kind)
      .map(({ id, kind: contractKind, receipt }) => ({ id, kind: contractKind, receipt }));
  }
  if (typeof reviewMode !== "string") return [];
  return loadQuestionContracts()
    .filter((contract) => contract.stage === stage)
    .filter((contract) => contract.modes.includes(reviewMode))
    .filter((contract) => !contract.appetite || contract.appetite.includes(appetite))
    .filter((contract) => !kind || contract.kind === kind)
    .map(({ id, kind: contractKind, receipt }) => ({ id, kind: contractKind, receipt }));
}

/** The generated catalog is the only runtime source for question contracts. */
