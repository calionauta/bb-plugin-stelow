import assert from "node:assert/strict";
import { loadQuestionContracts, requiredForStage } from "../lib/question-contracts.mjs";

// The generated catalog is the host's only source for question contracts.
const contracts = loadQuestionContracts();
assert.ok(contracts.length > 0, "generated catalog contains question contracts");
assert.equal(new Set(contracts.map(({ stage, id }) => `${stage}/${id}`)).size, contracts.length, "question ids are unique per stage");

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
// 0.85 renamed the appetite gate to exploration_min_count: the catalog is now
// the semantic source (appetite deprecated in the schema), and the canonical
// legacy map (setup.md) resolves Lean -> exploration 2, which satisfies the
// min of 2. So a Lean card in a human mode still gets the human interface
// pick; only an exploration count of 1 (no options to choose between) would
// not. Assert the new semantics so a future catalog edit that removes the
// min breaks here loudly instead of silently changing who is asked.
assert.deepEqual(
  requiredForStage({ stage: "selection", reviewMode: humanModes[0], appetite: "Lean" }),
  [{ id: "interface-pick", kind: "human-ask", receipt: "interfaces/selected-interface.md" }],
  "Lean meets exploration_min_count 2 and keeps the human interface pick",
);
assert.deepEqual(
  requiredForStage({ stage: "architecture", reviewMode: "Product Spec + Interface + Tech Review", appetite: "Lean" }),
  [{ id: "architecture-pick", kind: "human-ask", receipt: "architecture/selected-architecture.md" }],
  "architecture-pick follows the same min-count rule at Lean",
);

console.log("question contracts test ok: generated source, mode/appetite matrix, and fail-open behavior");
