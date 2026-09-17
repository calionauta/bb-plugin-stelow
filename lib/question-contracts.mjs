import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Closed vocabulary shared by the upstream contract and host enforcement. */
export const QUESTION_KINDS = ["human-ask", "agent-receipt", "skip"];

const APPETITES = new Set(["Lean", "Core", "Complete"]);
const DEFAULT_CONTRACT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "skills",
  "stelow-workflow-orchestrator",
  "stages.yaml",
);

function scalar(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const quoted = text.match(/^(?:"([\s\S]*)"|'([\s\S]*)')$/);
  return (quoted ? quoted[1] ?? quoted[2] : text).trim();
}

/** Parse the small YAML inline-list subset used by stages.yaml, quote-aware. */
function inlineList(value, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text.startsWith("[") || !text.endsWith("]")) throw new Error(`question contract ${label} must be an inline list`);
  const values = [];
  let token = "";
  let quote = null;
  for (const char of text.slice(1, -1)) {
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
    } else if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === ",") {
      const item = token.trim();
      if (!item) throw new Error(`question contract ${label} contains an empty value`);
      values.push(item);
      token = "";
    } else {
      token += char;
    }
  }
  if (quote) throw new Error(`question contract ${label} has an unclosed quote`);
  const final = token.trim();
  if (final) values.push(final);
  if (values.length === 0) throw new Error(`question contract ${label} must not be empty`);
  return values;
}

function validate(contract) {
  const prefix = `question contract ${contract.stage}/${contract.id ?? "<missing id>"}`;
  if (!/^[a-z][a-z0-9-]*$/.test(contract.id ?? "")) throw new Error(`${prefix} has an invalid id`);
  if (!QUESTION_KINDS.includes(contract.kind)) throw new Error(`${prefix} has an unknown kind`);
  if (!Array.isArray(contract.modes) || contract.modes.some((mode) => !mode)) throw new Error(`${prefix} needs one or more modes`);
  if (contract.appetite && contract.appetite.some((appetite) => !APPETITES.has(appetite))) throw new Error(`${prefix} has an unknown appetite`);
  if (typeof contract.receipt !== "string" || !contract.receipt || contract.receipt.startsWith("/") || contract.receipt.split("/").includes("..")) {
    throw new Error(`${prefix} has an unsafe or missing receipt path`);
  }
  return contract;
}

/**
 * Read question blocks from the vendored upstream stage model. The parser is
 * deliberately narrow: stages.yaml is the source of truth, and an invalid
 * contract fails loudly instead of silently removing a required question.
 */
export function parseQuestionContracts(source) {
  const contracts = [];
  let stage = null;
  let inQuestions = false;
  let current = null;
  const finish = () => {
    if (!current) return;
    const contract = validate(current);
    if (contracts.some((entry) => entry.stage === contract.stage && entry.id === contract.id)) throw new Error(`duplicate question contract ${contract.stage}/${contract.id}`);
    contracts.push(contract);
    current = null;
  };

  for (const line of String(source ?? "").split("\n")) {
    const stageMatch = line.match(/^  - name:\s*(\S+)\s*$/);
    if (stageMatch) {
      finish();
      stage = stageMatch[1];
      inQuestions = false;
      continue;
    }
    if (stage && /^    questions:\s*$/.test(line)) {
      inQuestions = true;
      continue;
    }
    if (!inQuestions) continue;
    const questionMatch = line.match(/^      - id:\s*(.+?)\s*$/);
    if (questionMatch) {
      finish();
      current = { stage, id: scalar(questionMatch[1]) };
      continue;
    }
    if (/^    \S/.test(line)) {
      finish();
      inQuestions = false;
      continue;
    }
    if (!current || /^\s*(?:#|$)/.test(line)) continue;
    const field = line.match(/^        (kind|modes|appetite|evidence|receipt):\s*(.*?)\s*$/);
    if (!field) continue;
    const [, key, value] = field;
    current[key] = key === "modes" || key === "appetite" ? inlineList(value, `${stage}/${current.id}.${key}`) : scalar(value);
  }
  finish();
  return contracts;
}

export function loadQuestionContracts({ path = DEFAULT_CONTRACT_PATH } = {}) {
  return parseQuestionContracts(readFileSync(path, "utf8"));
}

/**
 * The checklist that must be satisfied before leaving a completed stage.
 * Unknown stages, modes, and appetites fail open, matching stage-skips.
 */
export function requiredForStage({ stage, reviewMode, appetite, kind } = {}) {
  if (typeof stage !== "string" || typeof reviewMode !== "string") return [];
  return loadQuestionContracts()
    .filter((contract) => contract.stage === stage)
    .filter((contract) => contract.modes.includes(reviewMode))
    .filter((contract) => !contract.appetite || contract.appetite.includes(appetite))
    .filter((contract) => !kind || contract.kind === kind)
    .map(({ id, kind: contractKind, receipt }) => ({ id, kind: contractKind, receipt }));
}

/** Pin shape: tests compare this explicit host mirror to the vendored source. */
export const EXPECTED_QUESTION_CONTRACTS = [
  {
    stage: "selection",
    id: "interface-pick",
    kind: "human-ask",
    modes: ["Product Spec + Interface Gates", "Product Spec + Interface + Scopes", "Product Spec + Interface + Tech Review", "Product Spec + Interface + Tech Review + Code Diff"],
    appetite: ["Core", "Complete"],
    evidence: "per-option",
    receipt: "interfaces/selected-interface.md",
  },
  {
    stage: "selection",
    id: "interface-pick-auto",
    kind: "agent-receipt",
    modes: ["Auto", "Product Spec Gate"],
    receipt: "interfaces/selected-interface.md",
  },
  {
    stage: "shape",
    id: "assumptions-auto-resolved",
    kind: "agent-receipt",
    modes: ["Auto", "Product Spec Gate"],
    receipt: "plans/spec-product*.md",
  },
  {
    stage: "shape",
    id: "assumptions-confirmed",
    kind: "human-ask",
    modes: ["Product Spec + Interface Gates", "Product Spec + Interface + Scopes", "Product Spec + Interface + Tech Review", "Product Spec + Interface + Tech Review + Code Diff"],
    receipt: "plans/spec-product*.md",
  },
  {
    stage: "critique",
    id: "critique-report",
    kind: "agent-receipt",
    modes: ["Auto", "Product Spec Gate"],
    receipt: "critiques/critique-report.md",
  },
  {
    stage: "critique",
    id: "critique-gap-resolution",
    kind: "human-ask",
    modes: ["Product Spec + Interface Gates", "Product Spec + Interface + Scopes", "Product Spec + Interface + Tech Review", "Product Spec + Interface + Tech Review + Code Diff"],
    receipt: "critiques/critique-report.md",
  },
  {
    stage: "scope",
    id: "scope-adjustment-auto",
    kind: "agent-receipt",
    modes: ["Auto", "Product Spec Gate", "Product Spec + Interface Gates"],
    receipt: "plans/spec-product*.md",
  },
  {
    stage: "scope",
    id: "scope-adjustment-confirmed",
    kind: "human-ask",
    modes: ["Product Spec + Interface + Scopes", "Product Spec + Interface + Tech Review", "Product Spec + Interface + Tech Review + Code Diff"],
    receipt: "plans/spec-product*.md",
  },
];
