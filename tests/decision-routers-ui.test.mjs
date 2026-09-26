import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Decision router settings UI: two progressive disclosures in the preset
// manager, one settings block and one router list. The runtime wiring these
// rows drive lives in tests/decision-routers.test.mjs.
//
// What is pinned here, and why only this: a .tsx file cannot be executed by
// these node tests, so the only honest thing to assert about it is wiring and
// control flow — which section owns which controls, that a save is explicit
// rather than implicit, that a save stays local, and that a value is gated
// before it is sent. Literal user-facing copy and Tailwind classes are NOT
// pinned: a copy pin passes on broken logic and fails on a reworded string,
// and the repo's test standard bans both. The one class rule that is a
// product principle rather than styling — the min-h-11 touch target — is
// counted, not string-matched, so a refactor of the class order cannot break
// it (same approach as tests/card-start.test.mjs).

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const managerShell = readFileSync(join(root, "components/settings/preset-manager-shell.tsx"), "utf8");
const decisionEntry = readFileSync(join(root, "components/settings/decision-api.tsx"), "utf8");
const decisionApiUi = readFileSync(join(root, "components/settings/decision-api-section.tsx"), "utf8");
const decisionRouterUi = readFileSync(join(root, "components/settings/decision-router-row.tsx"), "utf8");
const decisionRoutersUi = readFileSync(join(root, "components/settings/decision-routers-section.tsx"), "utf8");

// --- progressive disclosure: the two blocks hide behind their own control --
assert.match(managerShell, /title="Decision API"/, "the settings block hides behind a disclosure");
assert.match(managerShell, /title="Decision routers"/, "the routers hide behind a disclosure");

// --- the settings boundary stays split, so the shell imports one file per job
assert.match(managerShell, /from "\.\/decision-api"/, "settings consume the extracted decision boundary");
assert.match(decisionEntry, /export \{ DecisionApiSection \} from "\.\/decision-api-section"/, "the settings section keeps one stable entry");
assert.match(decisionEntry, /export \{ DecisionRoutersSection \} from "\.\/decision-routers-section"/, "the routers section keeps one stable entry");
assert.match(decisionApiUi, /export function DecisionApiSection\(/, "the settings section owns the API controls");
assert.match(decisionRoutersUi, /export function DecisionRoutersSection\(/, "the routers section owns the point list");

// --- providers render from the registry, so adding one needs no UI change
assert.match(
  decisionApiUi,
  /DECISION_PROVIDERS\.filter\(\(entry\) => entry\.id !== "jev"\)\.map\(\(entry\) => \(/,
  "non-default providers render from the registry (adding one is UI-free)",
);
assert.match(
  decisionApiUi,
  /knownDefaults\.includes\(endpoint\)/,
  "custom endpoint URLs survive provider flips (only pristine defaults swap)",
);

// --- the threshold control is gated on being a real 0–1 number, not on the field being non-empty
assert.match(decisionRouterUi, /disabled=\{busy \|\| !dirty \|\| !valid\}/, "threshold saves stay disabled until the value is a 0–1 number");
assert.match(
  decisionRouterUi,
  /draft\.mode === "api" \|\| draft\.mode === "preset"/,
  "threshold controls render only for api and preset drafts",
);

// --- saving is explicit: a mode flip stages locally and never rides the select
assert.match(decisionRouterUi, /const \[mode, setMode\] = useState\(point\.mode\)/, "mode selection stages locally before saving");
assert.match(decisionRouterUi, /modeDirty && draft\.mode !== "preset"/, "mode flips save through one explicit button");
assert.doesNotMatch(decisionRouterUi, /void setMode\(event\.target\.value\)/, "no immediate save rides the select anymore");

// --- a save is local and complete: no board reload, and a pending mode flip
//     survives the refresh it triggers
assert.match(
  decisionRoutersUi,
  /const refresh = useCallback\(async \(\) => \{ reload\(\); \}, \[reload\]\)/,
  "the section takes no board reload — router saves stay local",
);
assert.match(decisionRouterUi, /refresh: \(\) => Promise<void>/, "rows refresh their own section after saving");
assert.match(
  decisionRouterUi,
  /mode: draft\.mode,\s*thresholds: \{ routeAt: Number\(draft\.routeAt\) \}/,
  "threshold saves carry a pending mode flip so refresh never wipes it",
);
assert.match(
  decisionRouterUi,
  /role=\{saves\.notice\.isError \? "alert" : "status"\}/,
  "failures announce as alerts, confirmations stay status",
);

// --- touch targets: the mode select, the threshold input, and the judge-preset
//     select all render h-11. Counted, not string-matched, so a class-order
//     refactor does not fail here.
assert.ok(
  (decisionRouterUi.match(/h-11/g) ?? []).length >= 3,
  "the mode select, threshold input, and judge-preset select all meet min-h-11",
);

// --- regression pins: content that was deliberately removed stays removed
assert.doesNotMatch(app, /any provider speaking that schema works here/, "the wrapping paragraph stays removed");
assert.doesNotMatch(decisionApiUi + decisionRouterUi + decisionRoutersUi, /preset-thread/i, "no thread jargon survives in the UI");

console.log("decision routers ui test ok: disclosures, explicit saves, touch targets");
