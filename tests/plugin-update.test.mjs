import assert from "node:assert/strict";
import { mapUpdateEntry, selectOwnEntry, shortRef } from "../lib/plugin-update.mjs";

const own = {
  id: "stelow",
  outcome: "update-available",
  installed: { version: "4450336fde35284d6a78a2105b8a7c3a699c320b", display: "https://github.com/calionauta/bb-plugin-stelow.git@v0.18.47 (4450336fde35)" },
  candidate: { version: "ace1d9b402f9b3338e749cab0c93721ad4edc61c", display: "https://github.com/calionauta/bb-plugin-stelow.git@v0.18.48 (ace1d9b402f9)" },
};

assert.equal(selectOwnEntry([ { id: "other", outcome: "pinned" }, own ], "stelow"), own);
assert.equal(selectOwnEntry([], "stelow"), null);
assert.equal(selectOwnEntry(undefined, "stelow"), null);
assert.equal(selectOwnEntry([ { id: "other" } ], "stelow"), null);

assert.deepEqual(mapUpdateEntry(own), {
  outcome: "update-available",
  installed: "4450336fde35284d6a78a2105b8a7c3a699c320b",
  installedDisplay: "https://github.com/calionauta/bb-plugin-stelow.git@v0.18.47 (4450336fde35)",
  candidate: "ace1d9b402f9b3338e749cab0c93721ad4edc61c",
  candidateDisplay: "https://github.com/calionauta/bb-plugin-stelow.git@v0.18.48 (ace1d9b402f9)",
  detail: null,
});

const current = mapUpdateEntry({ id: "stelow", outcome: "current", installed: { version: "v0.20.0", display: " StelOW " }, candidate: { version: "zzz", display: "zzz" } });
assert.equal(current.outcome, "current");
assert.equal(current.candidate, null);
assert.equal(current.candidateDisplay, null);

assert.equal(mapUpdateEntry(null).outcome, "unavailable");
assert.equal(mapUpdateEntry(null).detail, "BB returned no update status for this plugin.");
assert.equal(mapUpdateEntry({ id: "stelow", outcome: "brand-new" }).outcome, "unavailable");
assert.equal(mapUpdateEntry({ id: "stelow" }).installed, null);

assert.equal(shortRef(own.candidate.version, own.candidate.display), "v0.18.48");
assert.equal(shortRef(own.installed.version, own.installed.display), "v0.18.47");
assert.equal(shortRef("4450336fde35284d6a78a2105b8a7c3a699c320b", null), "4450336fde35");
assert.equal(shortRef("0.1.4", "bb-plugin-auto-archive@0.1.4"), "0.1.4");
assert.equal(shortRef("v1.0.0", "https://user@host.example/x.git@v1.0.0 (abc)"), "v1.0.0");
assert.equal(shortRef(null, null), null);

const blocked = mapUpdateEntry({ id: "stelow", outcome: "incompatible", installed: { version: "x", display: "x" }, blocked: { reasons: ["requires bb >=0.99"], version: "v9" } });
assert.equal(blocked.detail, "requires bb >=0.99");

console.log("plugin update test ok: entry select, map, shortRef");
