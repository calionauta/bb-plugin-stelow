import assert from "node:assert/strict";
import { reconReceiptStatus } from "../lib/recon-receipt.mjs";

assert.deepEqual(reconReceiptStatus(null), { state: "missing", detail: "No context/recon-receipt.json was found." });
assert.equal(reconReceiptStatus("not json").state, "invalid");
assert.equal(reconReceiptStatus(JSON.stringify({ contract: "old", workspace: { git: true } })).state, "invalid");
assert.deepEqual(reconReceiptStatus(JSON.stringify({ contract: "stelow-recon-v1", workspace: { git: true }, missing: ["cymbal"] })), { state: "recorded", detail: "Optional tools unavailable: cymbal." });
console.log("recon receipt test ok");
