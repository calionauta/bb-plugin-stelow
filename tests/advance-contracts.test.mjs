import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkAdvanceContracts } from "../lib/advance-contracts.mjs";
import { requiredForStage } from "../lib/question-contracts.mjs";
import { parseWorkflowConfig } from "../lib/workflow-config.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/question-contracts/${name}.state.md`, import.meta.url), "utf8");
const enteredAt = (state) => {
  const rows = [...state.matchAll(/^\s+at:\s*([^\n]+)$/gm)];
  return Date.parse(rows.at(-1)?.[1] ?? "");
};
const contractsFor = (state) => {
  const stage = state.match(/^current_stage:\s*(\S+)/m)?.[1];
  const { appetite, reviewMode } = parseWorkflowConfig(state, { strict: true });
  return stage && appetite && reviewMode ? requiredForStage({ stage, appetite, reviewMode }) : [];
};
const shape = fixture("shape");
const critique = fixture("critique");
const shapeEnteredAt = enteredAt(shape);
const critiqueEnteredAt = enteredAt(critique);
const answeredSince = (timestamps, boundary) => timestamps.some((timestamp) => timestamp >= boundary);

assert.equal(checkAdvanceContracts({
  stage: "shape", enteredAt: shapeEnteredAt, contracts: contractsFor(shape), answered: false,
  receipts: [{ path: "plans/spec-product_v2.md", content: "---\nassumptions_resolved: []\n---", modifiedAtMs: shapeEnteredAt }],
}), null, "a fresh automatic receipt is accepted");

assert.match(checkAdvanceContracts({
  stage: "shape", enteredAt: shapeEnteredAt, contracts: contractsFor(shape), answered: false,
  receipts: [{ path: "plans/spec-product_v2.md", content: "assumptions_resolved: []", modifiedAtMs: shapeEnteredAt - 1 }],
}), /write the fresh receipt/, "an older receipt is rejected");

assert.match(checkAdvanceContracts({
  stage: "shape", enteredAt: shapeEnteredAt, contracts: contractsFor(shape), answered: false,
  receipts: [{ path: "plans/spec-product_v2.md", content: "---\ntitle: proposal\n---", modifiedAtMs: shapeEnteredAt }],
}), /complete `assumptions-auto-resolved`/, "a missing assumptions marker is rejected");

assert.match(checkAdvanceContracts({
  stage: "scope", enteredAt: shapeEnteredAt,
  contracts: requiredForStage({ stage: "scope", appetite: "Core", reviewMode: "Auto" }), answered: false,
  receipts: [{ path: "plans/spec-product_v2.md", content: "---\ntitle: proposal\n---", modifiedAtMs: shapeEnteredAt }],
}), /complete `scope-adjustment-auto`/, "a missing scope-adjustment marker is rejected");

assert.equal(checkAdvanceContracts({
  stage: "critique", enteredAt: critiqueEnteredAt, contracts: contractsFor(critique), answered: false,
  receipts: [{ path: "critiques/critique-report.md", content: "---\ngap_verdict: \"0 gaps\"\n---", modifiedAtMs: critiqueEnteredAt }],
}), null, "a no-gap verdict accepts critique without a human answer");

assert.equal(checkAdvanceContracts({
  stage: "critique", enteredAt: critiqueEnteredAt, contracts: contractsFor(critique), answered: answeredSince([critiqueEnteredAt + 1], critiqueEnteredAt),
  receipts: [],
}), null, "a response recorded after entry satisfies a human ask");

assert.match(checkAdvanceContracts({
  stage: "critique", enteredAt: critiqueEnteredAt, contracts: contractsFor(critique), answered: answeredSince([critiqueEnteredAt - 1], critiqueEnteredAt),
  receipts: [],
}), /answer the required `critique-gap-resolution`/, "an answer before entry does not count");

const missingConfig = fixture("unconfigured");
assert.equal(checkAdvanceContracts({
  stage: "shape", enteredAt: enteredAt(missingConfig), contracts: contractsFor(missingConfig), receipts: [], answered: false,
}), null, "missing configuration fails open");
assert.equal(checkAdvanceContracts({
  stage: "shape", enteredAt: shapeEnteredAt, contracts: requiredForStage({ stage: "shape", appetite: "Core", reviewMode: "Unknown" }), receipts: [], answered: false,
}), null, "an unknown mode fails open");

console.log("advance contracts test ok: fixtures, freshness, markers, asks, and fail-open");
