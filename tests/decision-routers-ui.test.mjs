import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Decision router settings UI: two progressive disclosures in the preset
// manager, one settings block and one router list. Modes read as outcomes,
// saving is explicit and local, and every control the operator touches meets
// the repo's min-h-11 rule. The runtime wiring these rows drive lives in
// tests/decision-routers.test.mjs.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const managerShell = readFileSync(join(root, "components/settings/preset-manager-shell.tsx"), "utf8");
const decisionEntry = readFileSync(join(root, "components/settings/decision-api.tsx"), "utf8");
const decisionApiUi = readFileSync(join(root, "components/settings/decision-api-section.tsx"), "utf8");
const decisionRouterUi = readFileSync(join(root, "components/settings/decision-router-row.tsx"), "utf8");
const decisionRoutersUi = readFileSync(join(root, "components/settings/decision-routers-section.tsx"), "utf8");

assert.match(decisionApiUi, /Showing defaults — nothing saved yet/, "fresh installs state that defaults are in effect");
assert.match(decisionApiUi, /Could not load the Decision API settings\./, "a failed settings load stays answerable");
assert.match(decisionApiUi, /Decision API is disabled on this host/, "the settings block states the kill switch in place");
assert.match(decisionRoutersUi, /has no key — api routers answer with built-in rules/, "keyless api routers state why they degrade");
assert.match(decisionRouterUi, /disabled={busy \|\| !dirty \|\| !valid}/, "threshold saves stay disabled until the value is a 0–1 number");

// UI: two progressive disclosures in the preset manager — one settings
// block, one router list. Modes read as outcomes, never mechanisms.
assert.match(managerShell, /title="Decision API"[\s\S]*?Jev-compatible/, "the settings block hides behind a disclosure");
assert.match(decisionApiUi, /Set the provider first — the rest follows its schema/, "the intro stays one short line");
assert.doesNotMatch(app, /any provider speaking that schema works here/, "the wrapping paragraph stays removed");
assert.match(managerShell, /title="Decision routers"[\s\S]*?per-judgment modes/, "the routers hide behind a disclosure");
assert.match(managerShell, /from "\.\/decision-api"/, "settings consume the extracted decision boundary");
assert.match(decisionEntry, /export \{ DecisionApiSection \} from "\.\/decision-api-section"/, "the settings section keeps one stable entry");
assert.match(decisionEntry, /export \{ DecisionRoutersSection \} from "\.\/decision-routers-section"/, "the routers section keeps one stable entry");
assert.match(decisionApiUi, /export function DecisionApiSection\(/, "the settings section owns the API controls");
assert.match(decisionRoutersUi, /export function DecisionRoutersSection\(/, "the routers section owns the point list");
assert.match(decisionApiUi, /type="password"/, "the key field masks input");
assert.match(decisionApiUi, /Test connection/, "the section offers an explicit probe");
assert.match(decisionRouterUi, /Built-in rules: \{props\.point\.rules\}/, "rules-mode rows explain what built-in means for that point");
assert.match(decisionRouterUi, /Needs: \{props\.point\.requires\}/, "provider requirements render per row");
assert.match(decisionRouterUi, /draft\.mode === "api" \|\| draft\.mode === "preset"/, "threshold controls render only for api and preset drafts");
assert.match(decisionRouterUi, /Act at confidence/, "thresholds read as confidence floors");
assert.match(decisionApiUi, /<span>Model<\/span>\s*<Input/, "the Decision API model field is a free-text input (external ids live outside BB's catalog)");
assert.match(
  decisionApiUi,
  /DECISION_PROVIDERS\.filter\(\(entry\) => entry\.id !== "jev"\)\.map\(\(entry\) => \(/,
  "non-default providers render from the registry (adding one is UI-free)",
);
assert.match(decisionApiUi, /<option value="jev">TypeSafe AI(&apos;|')s Jev-compatible<\/option>/, "the provider select keeps jev (no one-way door)");
assert.match(decisionApiUi, /State \+ questions schema — endpoint \+ key \+ model required/, "the jev hint states the schema requirement in one line");
assert.match(decisionApiUi, /knownDefaults\.includes\(endpoint\)/, "custom endpoint URLs survive provider flips (only pristine defaults swap)");
assert.doesNotMatch(decisionApiUi + decisionRouterUi + decisionRoutersUi, /preset-thread/i, "no thread jargon survives in the UI");

// Router rows save explicitly and refresh locally: flipping the mode select
// stores nothing by itself (preset mode must explain itself first), and a
// save never pays for a board reload — point state lives nowhere else.
assert.match(decisionRouterUi, /const \[mode, setMode\] = useState\(point\.mode\)/, "mode selection stages locally before saving");
assert.match(decisionRouterUi, /modeDirty && draft\.mode !== "preset"/, "mode flips save through one explicit button");
assert.doesNotMatch(decisionRouterUi, /void setMode\(event\.target\.value\)/, "no immediate save rides the select anymore");
assert.match(decisionRouterUi, /role=\{saves\.notice\.isError \? "alert" : "status"\}/, "failures announce as alerts, confirmations stay status");
assert.match(decisionRouterUi, /refresh: \(\) => Promise<void>/, "rows refresh their own section after saving");

// Touch targets meet the repo's min-h-11 rule inside router rows: the mode
// select, the threshold input, and the judge-preset select all render h-11.
// A regression to h-9 fails here before a phone user finds it.
assert.ok(decisionRouterUi.includes('className="cursor-pointer h-11 shrink-0'), "the mode select meets min-h-11");
assert.ok(decisionRouterUi.includes('step="0.05"\n          className="h-11"'), "the threshold input meets min-h-11");
assert.ok(decisionRouterUi.includes('className="cursor-pointer h-11 flex-1'), "the judge-preset select meets min-h-11");
assert.match(
  decisionRoutersUi,
  /const refresh = useCallback\(async \(\) => \{ reload\(\); \}, \[reload\]\)/,
  "the section takes no board reload — router saves stay local",
);
assert.match(decisionRouterUi, /note\("Saved\.", false\)/, "successful saves confirm instead of going silent");
assert.match(
  decisionRouterUi,
  /mode: draft\.mode,\s*thresholds: \{ routeAt: Number\(draft\.routeAt\) \}/,
  "threshold saves carry a pending mode flip so refresh never wipes it",
);
assert.match(decisionRouterUi, /No presets yet — create one under Agent Presets/, "an empty preset catalog guides instead of stranding");

console.log("decision routers ui test ok: disclosures, explicit saves, touch targets");
