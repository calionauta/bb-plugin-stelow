import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// 31 test files read source text (server.ts/app.tsx or anything under
// server/, components/, hooks/, lib/). That count must not grow: convert pins
// to behavioral imports instead of adding text reads. Fixture/data readers
// (state.md fixtures, package.json, skills mirrors like the transition table)
// are outside this count by construction, not by exception.
const SOURCE_PIN_CEILING = 31;

const ENTRYPOINT_PATTERN = /(server\.ts|app\.tsx)/;
const SOURCE_PATTERN = /(server\.ts|app\.tsx|server\/|components\/|hooks\/|lib\/)/;
// Fixture/data reads are outside the pin count by construction (see header):
// state.md fixtures, package.json, skills mirrors (transitions.md), data/
// snapshots, binary assets. Only a source-text read counts.
const FIXTURE_PATTERN = /(\.state\.md|package\.json|skills\/|data\/|stelow\.json|\.png|\.jpg|\.svg|tests\/fixtures)/;

function readCallWindows(text) {
  const windows = [];
  let from = 0;
  while (true) {
    const at = text.indexOf("readFileSync(", from);
    if (at < 0) break;
    // Balanced-paren slice so multiline join()/URL forms stay inside one window.
    let depth = 0;
    let end = at;
    for (; end < text.length && end < at + 4000; end++) {
      if (text[end] === "(") depth++;
      else if (text[end] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    windows.push(text.slice(at, Math.min(end + 1, at + 4000)));
    from = at + 1;
  }
  return windows;
}

const files = readdirSync(join(root, "tests"))
  .filter((file) => file.endsWith(".test.mjs") && file !== SELF)
  .sort();
assert.ok(files.length > 400, `the suite is intact (saw ${files.length} test files)`);

const entrypointPins = [];
const sourcePinFiles = [];
for (const file of files) {
  const text = readFileSync(join(root, "tests", file), "utf8");
  const windows = readCallWindows(text).filter((window) => !FIXTURE_PATTERN.test(window));
  // Dynamic-dir reads (readdirSync + readFileSync(join(dir, name))) carry no
  // literal in the call window; the dir literal lives nearby. Count the file
  // when it lists a source dir and also reads files.
  const dynamicDirPin = /readdirSync/.test(text) && windows.length > 0 && SOURCE_PATTERN.test(text);
  if (windows.length === 0) continue;
  if (windows.some((window) => ENTRYPOINT_PATTERN.test(window))) entrypointPins.push(file);
  if (windows.some((window) => SOURCE_PATTERN.test(window)) || dynamicDirPin) sourcePinFiles.push(file);
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
