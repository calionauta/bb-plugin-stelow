// Host-side artifact registration. A validated native run wrote into staging
// (`<stateDir>/runs/<id>/…`) and the card reads from `<stateDir>/…`; the host
// knows both paths, so it does the copy.
//
// This replaced asking the MODEL to `cp` the files and write a receipt, which
// was the most expensive component in the system doing a deterministic rename.
// Measured cost: 184 of 225 run-dir commands across the live worker threads were
// `find <run> -type f` plus a `for f in …; do cp …; done` plus a `printf`.
import assert from "node:assert/strict";
import {
  canonicalArtifactPath,
  registrationPlan,
  registrationReceipt,
  registrationReceiptPath,
} from "../lib/artifact-registration.mjs";

// --- canonical path derivation ---
assert.equal(
  canonicalArtifactPath("/ws/.stelow/2026-10-01/sw-card_x/runs/exec_abc123", "audit/report.md"),
  "/ws/.stelow/2026-10-01/sw-card_x/audit/report.md",
  "the canonical home is the staging path minus its runs/<id> segment",
);
assert.equal(
  canonicalArtifactPath("/ws/.stelow/x/runs/exec_a", "verification/tests.json"),
  "/ws/.stelow/x/verification/tests.json",
);
// A root that does not carry the staging shape yields null rather than a guess:
// a confidently wrong target is worse than the search it replaces.
assert.equal(canonicalArtifactPath("/ws/.stelow/x", "a.md"), null, "a non-staging root is not guessed at");
assert.equal(canonicalArtifactPath("/ws/.stelow/x/runs/a/b", "a.md"), null, "a nested runs/ root is not staging");
assert.equal(canonicalArtifactPath("", "a.md"), null);
assert.equal(canonicalArtifactPath(null, "a.md"), null);
// Windows separators must not silently produce a broken path.
assert.equal(
  canonicalArtifactPath("C:\\ws\\.stelow\\x\\runs\\exec_a", "audit/report.md"),
  "C:\\ws\\.stelow\\x/audit/report.md",
  "a backslash root still derives a target instead of returning null",
);

// --- the plan: every required path, in recipe order ---
const ROOT = "/ws/.stelow/x/runs/exec_a";
const plan = registrationPlan(ROOT, ["audit/requirements.md", "audit/report.md"]);
assert.deepEqual(plan.copies.map((c) => c.relative), ["audit/requirements.md", "audit/report.md"], "recipe order is preserved");
assert.equal(plan.copies[0].from, `${ROOT}/audit/requirements.md`, "from is the staging path");
assert.equal(plan.copies[0].to, "/ws/.stelow/x/audit/requirements.md", "to is the canonical path");
assert.deepEqual(plan.unresolved, [], "a staging root resolves every path");

// An unresolvable root reports instead of dropping: a run that would lose an
// artifact must fail loudly, not half-register.
const orphan = registrationPlan("/ws/.stelow/x", ["audit/report.md", "audit/evidence.md"]);
assert.deepEqual(orphan.copies, [], "nothing is copied from a root we cannot map");
assert.deepEqual(
  orphan.unresolved,
  ["audit/report.md", "audit/evidence.md"],
  "every unresolvable path is named, so the stall message can say which",
);

// Junk in the list is skipped rather than becoming a copy of "undefined".
const messy = registrationPlan(ROOT, ["", null, "audit/report.md", undefined]);
assert.deepEqual(messy.copies.map((c) => c.relative), ["audit/report.md"], "only real paths become copies");

// --- the receipt ---
const receipt = registrationReceipt("exec_a", ["audit/requirements.md", "audit/report.md"]);
const parsed = JSON.parse(receipt);
assert.equal(parsed.runId, "exec_a", "the receipt names its run, which is how completion is decided");
assert.deepEqual(parsed.outputs, ["audit/requirements.md", "audit/report.md"], "the receipt lists exactly what was copied");
assert.ok(receipt.endsWith("\n"), "the receipt is newline-terminated, so a diff of it is readable");

assert.equal(
  registrationReceiptPath(ROOT),
  `${ROOT}/.registered.json`,
  "the receipt lives in the run's staging root, where the reconciler reads it",
);
assert.equal(registrationReceiptPath(`${ROOT}/`), `${ROOT}/.registered.json`, "a trailing slash does not double");
assert.equal(registrationReceiptPath(""), null, "no root means no receipt path");

console.log("artifact registration test ok: plan, receipt, and no guessed targets");
