import assert from "node:assert/strict";
import { isReconActionable, reconReceiptStatus } from "../lib/recon-receipt.mjs";

assert.deepEqual(reconReceiptStatus(null), { state: "missing", detail: "No context/recon-receipt.json was found." });
assert.equal(reconReceiptStatus("not json").state, "invalid");
assert.equal(reconReceiptStatus(JSON.stringify({ contract: "old", workspace: { git: true } })).state, "invalid");
const one = JSON.stringify({ contract: "stelow-recon-v2", workspace: { git: true }, workflow: { stateDir: "/repo/.stelow/a" }, missing: ["cymbal"] });
const two = JSON.stringify({ contract: "stelow-recon-v2", workspace: { git: true }, workflow: { stateDir: "/repo/.stelow/b" }, missing: [] });
assert.deepEqual(reconReceiptStatus(one, "/repo/.stelow/a"), { state: "recorded", detail: "Optional tools unavailable: cymbal." });
assert.equal(reconReceiptStatus(two, "/repo/.stelow/a").state, "invalid", "a second workflow cannot attest this card");

// Active cards surface the receipt only when actionable: missing,
// unreadable, or recorded-but-degraded. All-available stays silent.
assert.equal(isReconActionable({ state: "missing", detail: "No context/recon-receipt.json was found." }), true, "missing is actionable");
assert.equal(isReconActionable({ state: "invalid", detail: "not valid JSON." }), true, "invalid is actionable");
assert.equal(isReconActionable({ state: "recorded", detail: "Optional tools unavailable: sem." }), true, "degraded recorded is actionable");
assert.equal(isReconActionable({ state: "recorded", detail: "All known optional tools were available." }), false, "all-available stays silent");
assert.equal(isReconActionable(null), false, "junk never alarms");
assert.equal(isReconActionable({}), false, "unknown shape never alarms");
console.log("recon receipt test ok");
