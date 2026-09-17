import assert from "node:assert/strict";
import { reconReceiptStatus } from "../lib/recon-receipt.mjs";

assert.deepEqual(reconReceiptStatus(null), { state: "missing", detail: "No context/recon-receipt.json was found." });
assert.equal(reconReceiptStatus("not json").state, "invalid");
assert.equal(reconReceiptStatus(JSON.stringify({ contract: "old", workspace: { git: true } })).state, "invalid");
const one = JSON.stringify({ contract: "stelow-recon-v2", workspace: { git: true }, workflow: { stateDir: "/repo/.stelow/a" }, missing: ["cymbal"] });
const two = JSON.stringify({ contract: "stelow-recon-v2", workspace: { git: true }, workflow: { stateDir: "/repo/.stelow/b" }, missing: [] });
assert.deepEqual(reconReceiptStatus(one, "/repo/.stelow/a"), { state: "recorded", detail: "Optional tools unavailable: cymbal." });
assert.equal(reconReceiptStatus(two, "/repo/.stelow/a").state, "invalid", "a second workflow cannot attest this card");
console.log("recon receipt test ok");
