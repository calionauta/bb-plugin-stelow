import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Preset surfaces (manager New/Edit form, assign dialog custom row) reuse
// BB's host-owned pickers instead of hand-rolled provider/model selects:
// the live catalog and its search come from the host, Stelow only files
// the choice. The manager dialog additionally discloses instead of
// overflowing: bounded frame + collapsed band routing.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
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
  ...app.match(/<PresetExecutionPicker/g) ?? [],
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
const assignAt = app.indexOf("function PresetAssignDialog(");
assert.ok(assignAt >= 0, "the assign dialog exists");
const assignWindow = app.slice(assignAt);
assert.match(assignWindow, /<PresetExecutionPicker/, "the custom row uses the shared picker block");
assert.match(assignWindow, /radioRow\(`model:\$\{provider\.id\}\/\$\{model\.model\}`/, "one-click model rows survive below the picker");

for (const [window, name] of [[managerWindow, "manager"], [assignWindow, "assign"]]) {
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
}

console.log("preset ui test ok: BB pickers shared, hand-rolled selects gone, manager disclosed and bounded");
