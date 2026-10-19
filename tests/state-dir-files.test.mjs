// The registry that names the card's fixed-name files, and the two invariants
// that keep it honest. Remaining-fragility #6 in rfc-worker-robustness: the host
// knows the exact paths, so it should tell instead of letting the worker search.
//
// This file is deliberately narrow: it pins the REGISTRY against the sources it
// mirrors (gate-vocabulary, the audit-trail contract), so naming a path cannot
// drift into naming a path that does not exist.
import assert from "node:assert/strict";
import {
  STATE_DIR_FILES,
  STATE_DIR_SUBDIRS,
  STATE_SUBDIR_FILES,
  stateDirFileEntries,
  stateDirSubdirEntries,
} from "../lib/state-dir-files.mjs";
import { AUDIT_TRAIL_FILE } from "../lib/audit-trail-contract.mjs";
import { GATES } from "../server/runtime/gate-vocabulary.ts";

// --- the receipts this list names must be the ones the code writes ---
// The board decides a card is "approved" by reading the receipt `GATES` names,
// while the worker writes that file itself. If this registry ever names a
// different spelling, the worker is confidently sent to the wrong path — worse
// than the search it replaces, because it stops looking.
const gateReceipts = Object.values(GATES).map((spec) => spec.receipt);
const namedSubdirPaths = STATE_SUBDIR_FILES.map((file) => file.path);
for (const receipt of gateReceipts) {
  assert.ok(
    namedSubdirPaths.includes(receipt),
    `gate receipt "${receipt}" from GATES must be named by the registry`,
  );
}
assert.equal(
  new Set(gateReceipts).size,
  gateReceipts.length,
  "every gate has a distinct receipt, so naming them cannot collide",
);

// The portable trail's filename is owned by its contract module, not restated.
const stateNames = STATE_DIR_FILES.map((file) => file.name);
assert.ok(
  stateNames.includes(AUDIT_TRAIL_FILE),
  "the audit trail's filename must come from audit-trail-contract, not be re-spelled",
);
assert.ok(stateNames.includes("state.md"), "the state file is always named");

// --- conditional vs always-present is a behavioural distinction ---
// A conditional file is something a card EARNS; reporting it missing would teach
// the worker to ignore the missing verdict that is real (a broken install).
const alwaysPresent = STATE_DIR_FILES.filter((file) => !file.conditional).map((f) => f.name);
assert.deepEqual(alwaysPresent, ["state.md"], "state.md is the only file whose absence is a real failure");

// --- entries never invent a path without a state dir ---
assert.deepEqual(stateDirFileEntries(null, () => true), [], "no state dir, no named paths");
assert.deepEqual(stateDirFileEntries("", () => true), [], "an empty state dir is no state dir");
assert.deepEqual(stateDirSubdirEntries(null), [], "no state dir, no layout claim");

// A trailing slash is not a different directory: joining must not double it.
const withSlash = stateDirFileEntries("/sd/", () => true);
const without = stateDirFileEntries("/sd", () => true);
assert.deepEqual(
  withSlash.map((entry) => entry.path),
  without.map((entry) => entry.path),
  "a trailing slash yields the same paths, not /sd//state.md",
);

// Conditional files carry no verdict; the one always-present file does.
const entries = stateDirFileEntries("/sd", () => false);
assert.equal(entries.find((e) => e.label === "state").missing, true, "a missing state.md is reported");
assert.ok(
  entries.filter((e) => e.label !== "state").every((e) => e.missing === false),
  "no conditional receipt is ever reported missing",
);

// --- the layout claim is one row, and it names every measured directory ---
const subdirs = stateDirSubdirEntries("/sd");
assert.equal(subdirs.length, 1, "the layout is one row, not one per directory");
assert.equal(subdirs[0].missing, false, "a layout claim is never a broken install");
for (const measured of ["runs", "context", "plans", "critiques", "interfaces", "audit"]) {
  assert.ok(
    STATE_DIR_SUBDIRS.includes(measured),
    `measured subdirectory "${measured}" must be named, or workers still enumerate`,
  );
}

console.log("state dir files test ok: registry mirrors GATES and the audit-trail contract, no invented paths");
