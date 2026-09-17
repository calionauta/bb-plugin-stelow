import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXPECTED_QUESTION_CONTRACTS, loadQuestionContracts, parseQuestionContracts, requiredForStage } from "../lib/question-contracts.mjs";

// The host's enforcement mirror is deliberately pinned to the vendored
// upstream source: methodology changes cannot silently change what bb blocks.
assert.deepEqual(loadQuestionContracts(), EXPECTED_QUESTION_CONTRACTS, "vendored question contract matches the host mirror");

const humanModes = [
  "Product Spec + Interface Gates",
  "Product Spec + Interface + Scopes",
  "Product Spec + Interface + Tech Review",
  "Product Spec + Interface + Tech Review + Code Diff",
];
for (const reviewMode of humanModes) {
  assert.deepEqual(
    requiredForStage({ stage: "selection", reviewMode, appetite: "Core" }),
    [{ id: "interface-pick", kind: "human-ask", receipt: "interfaces/selected-interface.md" }],
    `${reviewMode} requires the human interface pick at Core appetite`,
  );
}

assert.deepEqual(
  requiredForStage({ stage: "selection", reviewMode: "Auto", appetite: "Lean" }),
  [{ id: "interface-pick-auto", kind: "agent-receipt", receipt: "interfaces/selected-interface.md" }],
  "Auto requires the agent's selected-interface receipt",
);
assert.deepEqual(
  requiredForStage({ stage: "selection", reviewMode: "Product Spec Gate", appetite: "Complete", kind: "agent-receipt" }),
  [{ id: "interface-pick-auto", kind: "agent-receipt", receipt: "interfaces/selected-interface.md" }],
  "kind filtering retains the requested receipt contract",
);
assert.deepEqual(requiredForStage({ stage: "selection", reviewMode: "Unknown", appetite: "Core" }), [], "unknown modes fail open");
assert.deepEqual(requiredForStage({ stage: "selection", reviewMode: humanModes[0], appetite: "Lean" }), [], "Lean has no multi-option selection contract");

const malformed = readFileSync(new URL("../skills/stelow-workflow-orchestrator/stages.yaml", import.meta.url), "utf8")
  .replace("kind: agent-receipt", "kind: invented-kind");
assert.throws(() => parseQuestionContracts(malformed), /unknown kind/, "a malformed upstream contract refuses to load instead of dropping the requirement");

console.log("question contracts test ok: pinned source, mode/appetite matrix, fail-open, malformed contract");
