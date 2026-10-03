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
    requiredForStage({ stage: "selection", reviewMode, explorationCount: 3 }),
    [{ id: "interface-pick", kind: "human-ask", receipt: "interfaces/selected-interface.md" }],
    `${reviewMode} requires the human interface pick at breadth 3`,
  );
}
// A legacy appetite string maps once to its breadth.
assert.deepEqual(
  requiredForStage({ stage: "selection", reviewMode: humanModes[0], appetite: "Core" }),
  [{ id: "interface-pick", kind: "human-ask", receipt: "interfaces/selected-interface.md" }],
  "legacy Core appetite maps to breadth 3",
);

assert.deepEqual(
  requiredForStage({ stage: "selection", reviewMode: "Auto", explorationCount: 2 }),
  [{ id: "interface-pick-auto", kind: "agent-receipt", receipt: "interfaces/selected-interface.md" }],
  "Auto requires the agent's selected-interface receipt",
);
assert.deepEqual(
  requiredForStage({ stage: "selection", reviewMode: "Product Spec Gate", explorationCount: 5, kind: "agent-receipt" }),
  [{ id: "interface-pick-auto", kind: "agent-receipt", receipt: "interfaces/selected-interface.md" }],
  "kind filtering retains the requested receipt contract",
);
assert.deepEqual(requiredForStage({ stage: "selection", reviewMode: "Unknown", explorationCount: 3 }), [], "unknown modes fail open");
assert.deepEqual(
  requiredForStage({ stage: "selection", reviewMode: humanModes[0], explorationCount: 1 }),
  [],
  "count 1 has no multi-option selection contract",
);

// The architecture stage resolves its own pick: human ask at tech-review
// modes, worker adoption below.
const ARCH_PICK = { id: "architecture-pick", kind: "human-ask", receipt: "architecture/selected-architecture.md" };
const ARCH_AUTO = { id: "architecture-pick-auto", kind: "agent-receipt", receipt: "architecture/selected-architecture.md" };
assert.deepEqual(
  requiredForStage({ stage: "architecture", reviewMode: "Product Spec + Interface + Tech Review", explorationCount: 3 }),
  [ARCH_PICK],
  "tech-review modes require the human architecture pick",
);
assert.deepEqual(
  requiredForStage({ stage: "architecture", reviewMode: "Auto", explorationCount: 3 }),
  [ARCH_AUTO],
  "Auto adopts the architecture pick by worker receipt",
);

console.log("question contracts test ok: generated source, mode/breadth matrix, architecture picks, and fail-open behavior");
