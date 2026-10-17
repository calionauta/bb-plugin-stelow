import assert from "node:assert/strict";
import {
  classifyPresetSelection,
  runPresetAssignment,
} from "../lib/preset-assignment.mjs";

assert.equal(classifyPresetSelection(null), null, "no selection never starts an assignment");
assert.deepEqual(classifyPresetSelection("default"), { kind: "default" }, "board default resets the card override");
assert.deepEqual(
  classifyPresetSelection("preset:reviewer"),
  { kind: "preset", presetId: "reviewer" },
  "a saved preset keeps its full identifier",
);
assert.deepEqual(
  classifyPresetSelection("model:openai/vendor/model-v2"),
  { kind: "model", providerId: "openai", modelId: "vendor/model-v2" },
  "catalog model ids may contain slashes after the provider",
);
assert.deepEqual(classifyPresetSelection("custom"), { kind: "custom" }, "picker values stay on the custom upsert path");
assert.throws(
  () => classifyPresetSelection("unknown:value"),
  /Unsupported preset selection/,
  "an unknown selection fails instead of silently doing nothing",
);

function assignmentRpc(calls, assignResult = { ok: true }) {
  return {
    call(method, payload) {
      calls.push({ method, payload });
      if (method === "upsertPreset") {
        return Promise.resolve({ preset: { id: "card-override-card-1" } });
      }
      return Promise.resolve(assignResult);
    },
  };
}

const defaultPreset = {
  providerId: "default-provider",
  modelId: "default-model",
  reasoningLevel: "high",
  permissionMode: "auto",
  environmentKind: "new-worktree",
};
const customValue = {
  providerId: "custom-provider",
  modelId: " custom-model ",
  reasoningLevel: "low",
  permissionMode: "accept-edits",
};

const modelCalls = [];
assert.deepEqual(
  await runPresetAssignment({
    rpc: assignmentRpc(modelCalls),
    cardId: "card-1",
    selected: "model:openai/vendor/model-v2",
    customValue,
    defaultPreset,
  }),
  { kind: "assigned", mode: "override", result: { ok: true } },
  "a catalog model upserts with the board default execution settings",
);
assert.deepEqual(modelCalls, [
  {
    method: "upsertPreset",
    payload: {
      id: "card-override-card-1",
      name: "Card override card-1",
      providerId: "openai",
      modelId: "vendor/model-v2",
      reasoningLevel: "high",
      permissionMode: "auto",
      environmentKind: "new-worktree",
    },
  },
  {
    method: "assignPreset",
    payload: { cardId: "card-1", presetId: "card-override-card-1" },
  },
], "custom assignment upserts first and then assigns the saved override");

const customCalls = [];
await runPresetAssignment({
  rpc: assignmentRpc(customCalls),
  cardId: "card-1",
  selected: "custom",
  customValue,
  defaultPreset: null,
});
assert.deepEqual(customCalls[0].payload, {
  id: "card-override-card-1",
  name: "Card override card-1",
  providerId: "custom-provider",
  modelId: "custom-model",
  reasoningLevel: "low",
  permissionMode: "accept-edits",
  environmentKind: "project-default",
}, "custom values are trimmed and use conservative execution fallbacks");

for (const [selected, presetId, mode] of [
  ["default", null, "reset"],
  ["preset:reviewer", "reviewer", "override"],
]) {
  const calls = [];
  assert.deepEqual(
    await runPresetAssignment({
      rpc: assignmentRpc(calls),
      cardId: "card-1",
      selected,
      customValue,
      defaultPreset,
    }),
    { kind: "assigned", mode, result: { ok: true } },
    `${selected} reaches assignPreset with the right mode`,
  );
  assert.deepEqual(calls, [
    { method: "assignPreset", payload: { cardId: "card-1", presetId } },
  ], `${selected} does not create a custom preset`);
}

const invalidCalls = [];
assert.deepEqual(
  await runPresetAssignment({
    rpc: assignmentRpc(invalidCalls),
    cardId: "card-1",
    selected: "custom",
    customValue: { ...customValue, providerId: "", modelId: "" },
    defaultPreset: null,
  }),
  { kind: "invalid" },
  "an incomplete custom choice is rejected at the RPC boundary",
);
assert.deepEqual(invalidCalls, [], "an invalid custom choice never mutates presets");

const failedCalls = [];
assert.deepEqual(
  await runPresetAssignment({
    rpc: assignmentRpc(failedCalls, { ok: false, error: "host refused" }),
    cardId: "card-1",
    selected: "default",
    customValue,
    defaultPreset,
  }),
  {
    kind: "assigned",
    mode: "reset",
    result: { ok: false, error: "host refused" },
  },
  "host assignment failures retain their actionable error",
);

console.log("preset ui test ok: BB pickers shared, hand-rolled selects gone, manager disclosed and bounded");
