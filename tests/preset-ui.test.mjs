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

// BB-owned pickers, imported once from the SDK app entry.
assert.match(app, /experimental_ProviderModelPicker as ProviderModelPicker/, "the host provider/model picker is imported");
assert.match(app, /experimental_PermissionModePicker as PermissionModePicker/, "the host permission-mode picker is imported");

// One shared block, both preset surfaces — never pasted per dialog.
const defs = app.match(/function PresetExecutionPicker\(/g) ?? [];
assert.equal(defs.length, 1, "PresetExecutionPicker is defined once, not pasted per dialog");
const uses = app.match(/<PresetExecutionPicker/g) ?? [];
assert.ok(uses.length >= 2, "manager form and assign custom row share the picker block");
assert.match(app, /same host pickers as the new-card composer/, "the shared block names its BB source");

// The hand-rolled controls are gone from the preset surfaces (manager
// New/Edit form, assign dialog custom row) — scoped, not app-wide: the
// Decision API section owns a free-text model-id field on purpose (external
// API model ids live outside BB's provider catalog, so the host picker
// would be wrong there; see decision-routers.test.mjs for its shape pin).

// Manager dialog: bounded frame + disclosed band routing + picker form.
const managerAt = app.indexOf("function PresetManagerDialog(");
assert.ok(managerAt >= 0, "the manager dialog exists");
const managerWindow = app.slice(managerAt, app.indexOf("function PresetAssignDialog("));
assert.ok(managerWindow.includes("overflow-y-auto sm:max-h-[calc(100dvh-1rem)]"), "the manager frame scrolls instead of overflowing the viewport");
assert.ok(managerWindow.includes("fullscreenOnMobile"), "the manager stays a real modal on phones");
assert.match(managerWindow, /<DisclosureSection title="Worker preset per track"/, "band routing hides behind a disclosure");
assert.match(managerWindow, /<PresetExecutionPicker/, "the New/Edit form uses the shared picker block");
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
assert.match(app, /<h3 className="text-sm font-semibold">Presets \(\{\s*presets\.length\s*\}\)<\/h3>/, "the list header names its count");
assert.match(app, /scrollIntoView\(\{ block: "nearest" \}\)/, "opening creation scrolls it into view instead of stranding");
const presetsHeaderAt = app.indexOf("Presets ({presets.length})");
const presetFormAt = app.indexOf('ref={formRef} className="mt-3 rounded-md border');
const routingAt = app.indexOf('title="Worker preset per track"');
assert.ok(presetsHeaderAt >= 0 && presetFormAt > presetsHeaderAt && routingAt > presetFormAt, "order reads list, creation, routing — never creation last");
assert.equal((app.match(/id="preset-form-body"/g) ?? []).length, 1, "one creation form, not a top/bottom pair");
}

console.log("preset ui test ok: BB pickers shared, hand-rolled selects gone, manager disclosed and bounded");
