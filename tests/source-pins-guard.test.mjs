import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifySourcePin } from "../scripts/source-pin-classify.mjs";

// SCOPE7 ratchet: no NEW source-text pins on the composition entrypoints.
//
// A "pin" here is a test that reads server.ts/app.tsx (or any file under
// server/, components/, hooks/, lib/) as TEXT and asserts regexes against
// it. Pins pass on broken logic (they match prose, not behavior) and break
// on refactors (a rename fails the suite while the product still works).
// Behavioral contracts import the module and call it; that is what the five
// keep-suites do (transition-totality, review-gates normalize matrix,
// scope/card claims contention, inbox-flows idempotency, reconcile honesty).
//
// The long-term direction is deletion toward <30 pin files and <400
// untested seams (ripwire --seams). This guard is the ratchet, not the
// destination: the ceilings below are the counts last measured (a ceiling may
// fall, never rise), and every assertion only fails on GROWTH. Shrinking a
// list needs no guard edit; unused allowlist entries warn instead of failing.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "source-pins-guard.test.mjs";

// The 4 test files that still read server.ts/app.tsx as text. No file outside
// this list may gain such a pin: a text pin passes on broken logic and breaks
// on a refactor, so a new one has to become a behavioral import instead.
// An entry is dropped once the file's entrypoint read becomes a behavioral
// import: a stale entry would keep whitelisting a pin nobody has, so the file
// could quietly grow a text read again and this guard would stay silent.
// preset-execution-picker and preset-onboarding were dropped here on the
// SCOPE7 pass-3 ratchet: both now import their module instead of reading it.
const ENTRYPOINT_ALLOWLIST = new Set([
  "decision-routers-ui.test.mjs",
  "detail-route-adapters.test.mjs",
  "workflow-state-identity.test.mjs",
  "workspace-recovery.test.mjs",
]);

// 28 test files read source text (server.ts/app.tsx or anything under
// server/, components/, hooks/, lib/). That count must not grow: convert pins
// to behavioral imports instead of adding text reads. Fixture/data readers
// (state.md fixtures, package.json, skills mirrors like the transition table)
// are outside this count by construction, not by exception.
const SOURCE_PIN_CEILING = 28;

const files = readdirSync(join(root, "tests"))
  .filter((file) => file.endsWith(".test.mjs") && file !== SELF)
  .sort();
assert.ok(files.length > 400, `the suite is intact (saw ${files.length} test files)`);

const entrypointPins = [];
const sourcePinFiles = [];
for (const file of files) {
  const text = readFileSync(join(root, "tests", file), "utf8");
  const { sourcePin, entrypointPin } = classifySourcePin(text);
  if (entrypointPin) entrypointPins.push(file);
  if (sourcePin) sourcePinFiles.push(file);
}

const freshEntrypointPins = entrypointPins.filter((file) => !ENTRYPOINT_ALLOWLIST.has(file));
assert.deepEqual(
  freshEntrypointPins,
  [],
  `no new source-text pins on server.ts/app.tsx — convert to a behavioral import instead, culprits: ${freshEntrypointPins.join(", ") || "none"}`,
);

assert.ok(
  sourcePinFiles.length <= SOURCE_PIN_CEILING,
  `source-text pin files must not grow past ${SOURCE_PIN_CEILING} (saw ${sourcePinFiles.length}) — convert pins to behavioral imports`,
);

const unused = [...ENTRYPOINT_ALLOWLIST].filter((file) => !entrypointPins.includes(file));
if (unused.length > 0) {
  console.log(`source pins guard: ${unused.length} allowlist entries no longer pin entrypoints and can be dropped: ${unused.join(", ")}`);
}

console.log(
  `source pins guard ok: ${entrypointPins.length} entrypoint pin files `
  + `(allowlist ${ENTRYPOINT_ALLOWLIST.size}), ${sourcePinFiles.length} source pin files `
  + `(ceiling ${SOURCE_PIN_CEILING})`,
);
