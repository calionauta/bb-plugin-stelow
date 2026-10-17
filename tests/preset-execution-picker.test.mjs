import assert from "node:assert/strict";
import {
  asPresetReasoningLevel,
  modeLabel,
  PRESET_REASONING_LEVELS,
} from "../components/settings/preset-execution-values.mjs";
import { loadComponent, renderTree, treeText } from "./helpers/render-component.mjs";

// The picker and the decision-router row are loaded as components and driven
// with plain props, so the host contract, the callbacks and the mode labels are
// facts about a rendered tree rather than about the source text that made it.
const hostPickers = {
  experimental_PermissionModePicker: () => null,
  experimental_ProviderModelPicker: () => null,
};
const PermissionModePicker = hostPickers.experimental_PermissionModePicker;
const ProviderModelPicker = hostPickers.experimental_ProviderModelPicker;

const PresetExecutionPicker = loadComponent(
  "components/settings/preset-execution-picker.tsx",
  "PresetExecutionPicker",
  {
    "@get-bb/plugin-sdk/app": hostPickers,
    "./preset-execution-values.mjs": { asPresetReasoningLevel },
  },
);

function findElement(node, type) {
  if (!node || typeof node !== "object") return null;
  if (node.type === type) return node;
  for (const child of node.children) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return null;
}

assert.deepEqual(
  [...PRESET_REASONING_LEVELS],
  ["low", "medium", "high", "xhigh", "max", "none", "ultra", "ultracode"],
  "the host reasoning catalog keeps its supported levels",
);
for (const level of PRESET_REASONING_LEVELS) {
  assert.equal(
    asPresetReasoningLevel(level),
    level,
    `the host picker preserves the supported ${level} level`,
  );
}
for (const value of ["", "medium-high", "LEGACY", " undefined "]) {
  assert.equal(
    asPresetReasoningLevel(value),
    "medium",
    `legacy reasoning value ${JSON.stringify(value)} falls back to medium`,
  );
}

assert.equal(modeLabel("api"), "Decision API", "API mode names its external source");
assert.equal(modeLabel("preset"), "Preset judge", "preset mode names its saved source");
for (const value of ["rules", "", "unknown"]) {
  assert.equal(
    modeLabel(value),
    "Built-in rules (default)",
    `unknown mode ${JSON.stringify(value)} keeps the built-in default`,
  );
}

// Decision routing consumes the tested mode-label helper: the row is rendered
// and its mode option labels are read off the tree, so a hand-copied label or a
// helper that stopped being used fails here instead of surviving a regex. The
// normalization helpers live in the values module, imported and driven above.
const DecisionRouterRow = loadComponent(
  "components/settings/decision-router-row.tsx",
  "DecisionRouterRow",
  {
    react: {
      useState: (initial) => [initial, () => {}],
      useEffect: () => {},
    },
    "../ui/button": { Button: () => null },
    "../ui/input": { Input: () => null },
    "./preset-execution-values.mjs": { modeLabel },
  },
);
const routerRow = DecisionRouterRow({
  rpc: { call: async () => ({}) },
  point: {
    id: "point-1",
    label: "Auto-continue",
    description: "Decide whether a finished turn made progress.",
    modes: ["api", "preset", "rules"],
    mode: "rules",
    presetId: null,
    thresholds: { routeAt: 0.7 },
  },
  presets: [],
  refresh: async () => {},
});
const routerText = treeText(renderTree(routerRow));
assert.ok(routerText.includes("Decision API"), "the api mode is labelled through the shared helper");
assert.ok(routerText.includes("Preset judge"), "the preset mode is labelled through the shared helper");
assert.ok(
  routerText.includes("Built-in rules (default)"),
  "the fallback mode is labelled through the shared helper",
);

for (const incomplete of [
  { providerId: "", modelId: "model", reasoningLevel: "high", permissionMode: "full" },
  { providerId: "provider", modelId: "", reasoningLevel: "high", permissionMode: "full" },
]) {
  const tree = PresetExecutionPicker({ value: incomplete, onChange: () => {} });
  assert.equal(tree.type, "p", "an incomplete execution renders the setup instruction");
  assert.equal(
    tree.children[0],
    "Pick or create a preset to configure its provider and model.",
  );
  assert.equal(findElement(tree, ProviderModelPicker), null);
  assert.equal(findElement(tree, PermissionModePicker), null);
}

const value = {
  providerId: "provider-a",
  modelId: "model-a",
  reasoningLevel: "legacy",
  permissionMode: "full",
};
let changed;
const tree = PresetExecutionPicker({
  value,
  onChange: (next) => {
    changed = next;
  },
});
const providerPicker = findElement(tree, ProviderModelPicker);
const permissionPicker = findElement(tree, PermissionModePicker);
assert.deepEqual(
  providerPicker.props.value,
  { providerId: "provider-a", model: "model-a", reasoningLevel: "medium" },
  "the host model picker receives a normalized legacy reasoning level",
);
assert.deepEqual(
  { providerId: permissionPicker.props.providerId, value: permissionPicker.props.value },
  { providerId: "provider-a", value: "full" },
  "the permission picker receives the current host execution context",
);
providerPicker.props.onChange({
  providerId: "provider-b",
  model: "model-b",
  reasoningLevel: "high",
});
assert.deepEqual(
  changed,
  { providerId: "provider-b", modelId: "model-b", reasoningLevel: "high", permissionMode: "full" },
  "model changes map host fields back to the persisted execution shape",
);
permissionPicker.props.onChange("auto");
assert.deepEqual(
  changed,
  { providerId: "provider-a", modelId: "model-a", reasoningLevel: "legacy", permissionMode: "auto" },
  "permission changes preserve every unrelated execution field",
);

console.log("preset execution picker test ok: host contract, callbacks, normalization, and mode labels");
