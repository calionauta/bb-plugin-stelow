import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyPresetSelection,
  runPresetAssignment,
} from "../lib/preset-assignment.mjs";

// Preset surfaces (manager New/Edit form, assign dialog custom row) reuse
// BB's host-owned pickers instead of hand-rolled provider/model selects:
// the live catalog and its search come from the host, Stelow only files
// the choice. The manager dialog additionally discloses instead of
// overflowing: bounded frame + collapsed band routing.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const assignDialog = readFileSync(
  join(root, "components/settings/preset-assign-dialog.tsx"),
  "utf8",
);
const assignOptions = readFileSync(
  join(root, "components/settings/preset-assign-options.tsx"),
  "utf8",
);
const picker = readFileSync(
  join(root, "components/settings/preset-execution-picker.tsx"),
  "utf8",
);
const managerShell = readFileSync(join(root, "components/settings/preset-manager-shell.tsx"), "utf8");
const managerForm = readFileSync(join(root, "components/settings/preset-manager-form.tsx"), "utf8");
const managerList = readFileSync(join(root, "components/settings/preset-manager-list.tsx"), "utf8");

// BB-owned pickers live with the shared settings block, not the app shell.
assert.match(
  picker,
  /experimental_ProviderModelPicker as ProviderModelPicker/,
  "the settings picker imports the host provider/model picker",
);
assert.match(
  picker,
  /experimental_PermissionModePicker as PermissionModePicker/,
  "the settings picker imports the host permission-mode picker",
);
assert.doesNotMatch(
  app,
  /experimental_(?:ProviderModel|PermissionMode)Picker/,
  "the app shell no longer owns preset-picker implementation details",
);

// One shared block, both preset surfaces — never pasted per dialog.
const defs = picker.match(/function PresetExecutionPicker\(/g) ?? [];
assert.equal(defs.length, 1, "PresetExecutionPicker is defined once, not pasted per dialog");
const uses = [
  ...managerForm.match(/<PresetExecutionPicker/g) ?? [],
  ...assignOptions.match(/<PresetExecutionPicker/g) ?? [],
];
assert.equal(uses.length, 2, "manager form and assign custom row share the picker block");
assert.doesNotMatch(
  app,
  /function PresetExecutionPicker\(/,
  "the app shell no longer defines a second picker",
);
assert.match(
  picker,
  /reasoningLevel: asPresetReasoningLevel\(value\.reasoningLevel\)/,
  "the host picker receives the normalized reasoning level",
);
assert.match(
  picker,
  /permissionMode: next/,
  "permission changes flow back through the shared settings contract",
);

// The hand-rolled controls are gone from the preset surfaces (manager
// New/Edit form, assign dialog custom row) — scoped, not app-wide: the
// Decision API section owns a free-text model-id field on purpose (external
// API model ids live outside BB's provider catalog, so the host picker
// would be wrong there; see decision-routers.test.mjs for its shape pin).

// Manager dialog: bounded frame + disclosed band routing + picker form.
const managerWindow = `${managerShell}\n${managerForm}`;
assert.ok(managerShell.includes("overflow-y-auto sm:max-h-[calc(100dvh-1rem)]"), "the manager frame scrolls instead of overflowing the viewport");
assert.ok(managerShell.includes("fullscreenOnMobile"), "the manager stays a real modal on phones");
assert.match(managerShell, /title="Worker preset per track"/, "band routing hides behind a disclosure");
assert.match(managerForm, /<PresetExecutionPicker/, "the New/Edit form uses the shared picker block");
assert.doesNotMatch(managerWindow, /listProviderModels/, "the manager no longer fetches Stelow's catalog for its form");

// Assign dialog: the custom row uses the shared block; the radio rows stay
// for one-click picks across the full catalog.
assert.doesNotMatch(app, /function PresetAssignDialog\(/, "the assign dialog no longer lives in the app shell");
assert.match(assignDialog, /export function PresetAssignDialog\(/, "the focused assign component owns the dialog boundary");
assert.match(assignOptions, /<PresetExecutionPicker/, "the custom row uses the shared picker block");
assert.match(assignOptions, /value=\{`model:\$\{provider\.id\}\/\$\{model\.model\}`\}/, "one-click model rows survive below the picker");
assert.match(assignDialog, /<PresetAssignOptions[\s\S]*onSelect=\{setSelected\}/, "the dialog owns selection while options own catalog presentation");
assert.equal(
  (app.match(/<PresetAssignDialog/g) ?? []).length,
  2,
  "panel and thread-drawer adapters share the extracted dialog without duplicating it",
);
assert.match(
  assignDialog,
  /if \(result\.ok\)[\s\S]*complete\([\s\S]*\)[\s\S]*setError\(result\.error \?\? fallback\)/,
  "successful assignments close and refresh while failures stay actionable in the open dialog",
);
assert.match(
  assignDialog,
  /function complete\(message: string\)[\s\S]*onOpenChange\(false\)[\s\S]*onChanged\(\)[\s\S]*toast\.success\(message\)/,
  "assignment success closes, refreshes, and records one visible outcome",
);
assert.match(
  assignDialog,
  /if \(open\)[\s\S]*setBusy\(false\)[\s\S]*setError\(null\)[\s\S]*\}, \[open\]\)/,
  "reopening the dialog clears stale progress and errors",
);

for (const [window, name] of [[managerWindow, "manager"], [assignOptions, "assign"]]) {
  assert.doesNotMatch(window, /function CustomModelCombobox\(/, `the hand-rolled model combobox is removed (${name})`);
  assert.doesNotMatch(window, /<span>Provider<\/span>/, `no hand-rolled provider select label survives (${name})`);
  assert.doesNotMatch(window, /<span>Model<\/span>/, `no hand-rolled model select label survives (${name})`);
  assert.doesNotMatch(window, /aria-label="Custom provider"/, `no hand-rolled custom provider select survives (${name})`);
  assert.doesNotMatch(window, /aria-label="Custom model id"/, `no hand-rolled custom model input survives (${name})`);
// Creation lives with the list: a header row names the count and offers
// New preset beside it, the form renders directly below the list (never
// under the routing disclosures), and opening scrolls it into view —
// authoring stays in the context it extends.
assert.match(managerList, /<h3 className="text-sm font-semibold">Presets \(\{presets\.length\}\)<\/h3>/, "the list header names its count");
assert.match(managerShell, /scrollIntoView\(\{ block: "nearest" \}\)/, "opening creation scrolls it into view instead of stranding");
const presetsHeaderAt = managerShell.indexOf("<PresetManagerList");
const presetFormAt = managerShell.indexOf("<PresetManagerFormView");
const routingAt = managerShell.indexOf('title="Worker preset per track"');
assert.ok(presetsHeaderAt >= 0 && presetFormAt > presetsHeaderAt && routingAt > presetFormAt, "order reads list, creation, routing — never creation last");
assert.equal((managerForm.match(/id="preset-form-body"/g) ?? []).length, 1, "one creation form, not a top/bottom pair");
const openEffectAt = managerShell.indexOf("useEffect(() => {", managerShell.indexOf("function PresetManagerDialog"));
const openEffectEnd = managerShell.indexOf("  const startNew =", openEffectAt);
const openEffect = managerShell.slice(openEffectAt, openEffectEnd);
assert.ok(openEffectAt >= 0 && openEffectEnd > openEffectAt, "the open-state initialization effect is bounded");
assert.doesNotMatch(openEffect, /\[open,\s*presets,/, "a parent preset refresh cannot reset the active create or edit form");
}

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
