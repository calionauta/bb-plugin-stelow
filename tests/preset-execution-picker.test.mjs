import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  asPresetReasoningLevel,
  modeLabel,
  PRESET_REASONING_LEVELS,
} from "../components/settings/preset-execution-values.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const decisionRouterUi = readFileSync(join(root, "components/settings/decision-router-row.tsx"), "utf8");

function loadPresetExecutionPicker() {
  const source = readFileSync(
    join(root, "components/settings/preset-execution-picker.tsx"),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const hostPickers = {
    experimental_PermissionModePicker: () => null,
    experimental_ProviderModelPicker: () => null,
  };
  const module = { exports: {} };
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
  };
  const execute = new Function("exports", "require", "module", "React", compiled);
  execute(
    module.exports,
    (specifier) => {
      if (specifier === "@get-bb/plugin-sdk/app") return hostPickers;
      if (specifier === "./preset-execution-values.mjs") {
        return { asPresetReasoningLevel };
      }
      throw new Error(`Unexpected import: ${specifier}`);
    },
    module,
    React,
  );
  return {
    PresetExecutionPicker: module.exports.PresetExecutionPicker,
    PermissionModePicker: hostPickers.experimental_PermissionModePicker,
    ProviderModelPicker: hostPickers.experimental_ProviderModelPicker,
  };
}

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

assert.match(
  decisionRouterUi,
  /import \{ modeLabel \} from "\.\/preset-execution-values\.mjs"/,
  "decision routing consumes the tested mode-label helper",
);
assert.doesNotMatch(
  app,
  /function (?:asPresetReasoningLevel|modeLabel)\(/,
  "normalization helpers no longer live in the app shell",
);

const {
  PermissionModePicker,
  PresetExecutionPicker,
  ProviderModelPicker,
} = loadPresetExecutionPicker();
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
