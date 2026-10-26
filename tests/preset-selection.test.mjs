import assert from "node:assert/strict";
import { canApplyPresetSelection, presetProviderGroups } from "../lib/preset-selection.mjs";
import {
  findElementByType,
  loadComponent,
  renderTree,
  treeText,
} from "./helpers/render-component.mjs";

// The regression: the dialog renders the EFFECTIVE value (raw picker merged
// with the board default). Choosing "Custom" showed a complete fallback —
// provider and model visible — while Apply stayed disabled because the raw
// picker was still empty. The button must ask the question the form answers.
assert.equal(
  canApplyPresetSelection("custom", {
    providerId: "acp-opencode",
    modelId: "opencode/deepseek-v4.1-flash",
  }),
  true,
  "a complete effective value is applicable even when the raw picker was empty",
);

// Incomplete custom is refused: the server would reject it and Apply must not
// promise something it cannot save.
assert.equal(
  canApplyPresetSelection("custom", { providerId: "", modelId: "opencode/deepseek-v4.1-flash" }),
  false,
  "custom without a provider is not applicable",
);
assert.equal(
  canApplyPresetSelection("custom", { providerId: "acp-opencode", modelId: "" }),
  false,
  "custom without a model is not applicable",
);
assert.equal(
  canApplyPresetSelection("custom", { providerId: "acp-opencode", modelId: "   " }),
  false,
  "custom with a blank model is not applicable",
);
assert.equal(canApplyPresetSelection("custom", null), false, "custom with no value is not applicable");
assert.equal(canApplyPresetSelection("custom", undefined), false, "custom with an undefined value is not applicable");

// No choice yet, versus a complete named choice.
assert.equal(canApplyPresetSelection(null, { providerId: "acp-opencode", modelId: "m" }), false, "no selection is not applicable");
assert.equal(canApplyPresetSelection("default", null), true, "the board default is applicable");
assert.equal(canApplyPresetSelection("preset:preset-a", null), true, "a named preset is applicable");
assert.equal(canApplyPresetSelection("model:a/b", null), true, "a picked model is applicable");

// Provider sections: only providers that actually list a model. Cursor before
// sign-in registers an empty catalog, and a "0 models" section reads as a
// configuration the reader forgot to make.
const catalog = {
  providers: [
    { id: "pi", displayName: "Pi", modelsAvailable: true },
    { id: "acp-opencode", displayName: "OpenCode", modelsAvailable: true },
    { id: "acp-cursor", displayName: "Cursor", modelsAvailable: false },
  ],
  models: [
    { providerId: "pi", model: "pi/one", displayName: "Pi One" },
    { providerId: "acp-opencode", model: "opencode/deepseek-v4.1-flash", displayName: "DeepSeek V4.1 Flash" },
    { providerId: "pi", model: "pi/two", displayName: "Pi Two" },
  ],
};
const groups = presetProviderGroups(catalog);
assert.deepEqual(
  groups.map((group) => group.provider.id),
  ["pi", "acp-opencode"],
  "empty providers are dropped and provider order is preserved",
);
assert.deepEqual(
  groups[0].models.map((model) => model.model),
  ["pi/one", "pi/two"],
  "each provider keeps exactly its own models in input order",
);
assert.deepEqual(
  groups[1].models.map((model) => model.model),
  ["opencode/deepseek-v4.1-flash"],
  "a single-model provider keeps that model",
);
assert.equal(
  groups.some((group) => group.provider.id === "acp-cursor"),
  false,
  "a provider with zero models is not offered",
);

// Nothing to offer: missing, empty, or malformed catalogs never throw.
assert.deepEqual(presetProviderGroups(undefined), [], "undefined catalog has no groups");
assert.deepEqual(presetProviderGroups(null), [], "null catalog has no groups");
assert.deepEqual(presetProviderGroups({}), [], "catalog without arrays has no groups");
assert.deepEqual(presetProviderGroups({ providers: [], models: [] }), [], "empty catalog has no groups");
assert.deepEqual(presetProviderGroups({ providers: null, models: null }), [], "null arrays have no groups");
assert.deepEqual(
  presetProviderGroups({ providers: "nope", models: "nope" }),
  [],
  "non-array catalog fields have no groups",
);
assert.deepEqual(
  presetProviderGroups({ providers: [{ id: "pi" }], models: "nope" }),
  [],
  "providers without a usable model array have no groups",
);

// ── Rendered wiring ─────────────────────────────────────────────────────────
// Correct helpers prove nothing if the components stop calling them. These
// sections render the real .tsx (compiled by tests/helpers/render-component.mjs)
// and assert on the tree, so a re-inlined unfiltered provider map, or an Apply
// button that checks the raw picker instead of the effective value, fails here.

const normalize = (text) => text.replace(/\s+/g, " ").trim();

// treeText keeps only string children; the options header and provider rows
// render their counts as numbers. Stringify them first so the assertion is on
// the text a reader sees ("Pi · 2"), not on a treeText blind spot.
function withNumericText(node) {
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(withNumericText);
  if (!node || typeof node !== "object") return node;
  return { ...node, children: (node.children ?? []).map(withNumericText) };
}

const reactStateStubs = {
  useState: (initial) => [initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
};

const PresetAssignOptions = loadComponent(
  "components/settings/preset-assign-options.tsx",
  "PresetAssignOptions",
  {
    react: reactStateStubs,
    "./preset-execution-picker": { PresetExecutionPicker: () => null },
    "../../lib/preset-selection.mjs": { canApplyPresetSelection, presetProviderGroups },
  },
);

const renderedCatalog = {
  providers: [
    { id: "pi", displayName: "Pi", modelsAvailable: true },
    { id: "acp-opencode", displayName: "OpenCode", modelsAvailable: true },
    { id: "acp-cursor", displayName: "Cursor", modelsAvailable: false },
  ],
  models: [
    { providerId: "pi", model: "pi/one", displayName: "Pi One" },
    {
      providerId: "acp-opencode",
      model: "opencode/deepseek-v4.1-flash",
      displayName: "DeepSeek V4.1 Flash",
    },
    { providerId: "pi", model: "pi/two", displayName: "Pi Two" },
  ],
};

const boardDefaultPreset = {
  id: "preset-default",
  name: "Board Primary",
  providerId: "acp-opencode",
  modelId: "opencode/deepseek-v4.1-flash",
  reasoningLevel: "medium",
  permissionMode: "full",
  environmentKind: "project-default",
  isDefault: true,
};
const customPreset = {
  id: "preset-custom",
  name: "Strict Reviewer",
  providerId: "pi",
  modelId: "pi/two",
  reasoningLevel: "high",
  permissionMode: "full",
  environmentKind: "project-default",
  isDefault: false,
};

const optionsTree = PresetAssignOptions({
  open: true,
  presets: [boardDefaultPreset, customPreset],
  catalog: renderedCatalog,
  selected: "custom",
  customValue: {
    providerId: "acp-opencode",
    modelId: "opencode/deepseek-v4.1-flash",
    reasoningLevel: "medium",
    permissionMode: "full",
  },
  onCustomChange: () => {},
  onSelect: () => {},
});
const optionsText = normalize(treeText(withNumericText(renderTree(optionsTree))));

assert.ok(optionsText.includes("Pi · 2"), "the pi section names its two models");
assert.ok(optionsText.includes("OpenCode · 1"), "the opencode section names its one model");
assert.equal(
  optionsText.includes("Cursor"),
  false,
  "the zero-model provider is not offered anywhere in the rendered options",
);
assert.ok(
  optionsText.indexOf("Pi · 2") < optionsText.indexOf("OpenCode · 1"),
  "the rendered provider groups preserve catalog order",
);
assert.ok(optionsText.includes("Custom provider + model"), "the custom option is rendered");
assert.ok(optionsText.includes("Board default"), "the board default option is rendered");
assert.ok(optionsText.includes("2 providers"), "the header counts only the providers with models");
assert.equal(optionsText.includes("3 providers"), false, "the empty provider is not counted");

// The exported PresetAssignDialog is the renderable entry point; the unexported
// View it delegates to is reached through it. Hooks are positional, so the
// stubbed useState feeds the dialog's six states in call order — presets,
// catalog, selected, custom picker, busy, error — and then asserts every slot
// was consumed. A new hook in the source fails loudly instead of shifting the
// fixture silently. The custom picker state stays EMPTY: the effective value
// comes from the board-default fallback, which is the exact regression.
function dialogHooks(states) {
  let next = 0;
  const react = {
    useState: (initial) => {
      const value = next < states.length ? states[next] : initial;
      next += 1;
      return [value, () => {}];
    },
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
  };
  return { react, consumed: () => next };
}

function passthroughElement(type) {
  return (props) => {
    const children = props?.children;
    return {
      type,
      props: props ?? {},
      children: Array.isArray(children) ? children : children == null ? [] : [children],
    };
  };
}

function ButtonProbe({ disabled, onClick, children }) {
  return {
    type: "button",
    props: { disabled, onClick },
    children: Array.isArray(children) ? children : children == null ? [] : [children],
  };
}

const dialogState = dialogHooks([
  [boardDefaultPreset, customPreset],
  renderedCatalog,
  "custom",
  { providerId: "", modelId: "", reasoningLevel: "", permissionMode: "" },
  false,
  null,
]);
const div = passthroughElement("div");
const PresetAssignDialog = loadComponent(
  "components/settings/preset-assign-dialog.tsx",
  "PresetAssignDialog",
  {
    react: dialogState.react,
    "@get-bb/plugin-sdk/app": { useRpc: () => ({ call: async () => ({}) }) },
    sonner: { toast: { success: () => {}, error: () => {} } },
    "../../lib/preset-assignment.mjs": { runPresetAssignment: async () => ({ kind: "idle" }) },
    "../../lib/preset-selection.mjs": { canApplyPresetSelection, presetProviderGroups },
    "./preset-assign-options": { PresetAssignOptions },
    "@/components/ui/button": { Button: ButtonProbe },
    "@/components/ui/dialog": {
      Dialog: div,
      DialogContent: div,
      DialogHeader: div,
      DialogTitle: div,
      DialogDescription: div,
      DialogFooter: div,
    },
  },
);
const dialogTree = renderTree(PresetAssignDialog({
  open: true,
  cardId: "card-1",
  onOpenChange: () => {},
  onChanged: () => {},
}));
const applyButton = findElementByType(dialogTree, "button");
assert.ok(applyButton, "the dialog renders the Apply button");
assert.equal(
  applyButton.props.disabled,
  false,
  "a complete effective custom value leaves Apply enabled even with an empty raw picker",
);
assert.equal(
  dialogState.consumed(),
  6,
  "the hook fixture matches the dialog's state order",
);
assert.match(normalize(treeText(dialogTree)), /Agent preset for this card/, "the real dialog shell rendered");

console.log("preset selection test ok: helpers, rendered options wiring, and Apply availability");
