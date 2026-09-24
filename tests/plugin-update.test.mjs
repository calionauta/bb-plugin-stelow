import assert from "node:assert/strict";
import { mapUpdateEntry, selectOwnEntry, shortRef, isPathInstall, applyFailedCheck, updateAvailableFrom } from "../lib/plugin-update.mjs";
import {
  markPluginUpdateLoaded,
  markPluginUpdateUnloaded,
  pluginUpdateSnapshot,
  setPluginUpdateAvailable,
  subscribePluginUpdate,
} from "../lib/plugin-update-signal.mjs";

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

assert.equal(isPathInstall("path:/home/deploy/repos/bb-plugin-stelow"), true, "path source is a path install");
assert.equal(isPathInstall("  PATH:/x "), true, "prefix match is case- and space-tolerant");
assert.equal(isPathInstall("https://github.com/calionauta/bb-plugin-stelow.git@v0.18.47 (4450336fde35)"), false, "git installs are BB-managed");
assert.equal(isPathInstall("bb-plugin-auto-archive@0.1.4"), false, "registry installs are BB-managed");
assert.equal(isPathInstall(null), false, "missing display is not a path install");

// A failed refresh keeps the last known verdict; it must never hide a real
// candidate on a transient network blip (the update button disappeared in
// the field while a release was pending).
const verdict = { outcome: "update-available", installed: "v0.25.0", installedDisplay: "x@v0.25.0", candidate: "v0.26.0", candidateDisplay: "x@v0.26.0", detail: null, checkedAt: 100 };
const failed = applyFailedCheck(verdict, "fetch failed", 200);
assert.equal(failed.outcome, "update-available", "a known candidate survives a failed refresh");
assert.equal(failed.candidate, "v0.26.0", "candidate fields are preserved verbatim");
assert.equal(failed.detail, "Update check failed: fetch failed", "failure names itself in the detail");
assert.equal(failed.checkedAt, 200, "the failed attempt still stamps its check time");

const noVerdict = applyFailedCheck({ outcome: "checking" }, "fetch failed");
assert.equal(noVerdict.outcome, "unavailable", "no previous verdict falls back to unavailable, not a lie");
assert.equal(noVerdict.candidate, null, "no candidate is invented for an unknown state");

const currentVerdict = applyFailedCheck({ outcome: "current", installed: "v0.25.0", installedDisplay: "x@v0.25.0", candidate: null, candidateDisplay: null, detail: null, checkedAt: 100 }, "fetch failed", 300);
assert.equal(currentVerdict.outcome, "current", "a previous freshness verdict is kept with the failure note");
assert.equal(currentVerdict.detail, "Update check failed: fetch failed", "failure detail survives on kept verdicts too");

// The shared update signal: every surface (sidebar accessory, About tab
// badge, About header, status box) reads this one predicate, so a forced
// check that flips one must flip them all.
assert.equal(updateAvailableFrom({ pluginUpdate: { outcome: "update-available" }, githubRelease: null }), true, "a BB candidate lights the signal");
assert.equal(updateAvailableFrom({ pluginUpdate: { outcome: "current" }, githubRelease: { newer: true } }), true, "an unmanaged newer release also lights it");
assert.equal(updateAvailableFrom({ pluginUpdate: { outcome: "current" }, githubRelease: { newer: false } }), false, "nothing pending reads as no update");
assert.equal(updateAvailableFrom({ pluginUpdate: { outcome: "unavailable" }, githubRelease: null }), false, "an unreachable check is not an update");
assert.equal(updateAvailableFrom({ pluginUpdate: { outcome: "checking" } }), false, "checking never claims an update");
assert.equal(updateAvailableFrom({ pluginUpdate: { outcome: "incompatible" } }), false, "incompatible is a refusal, not a candidate");
assert.equal(updateAvailableFrom(null), false, "null reads as no update, never a throw");
assert.equal(updateAvailableFrom({}), false, "missing shapes read as no update");
assert.equal(updateAvailableFrom({ pluginUpdate: "x", githubRelease: 7 }), false, "off-shape fields never throw or lie");

setPluginUpdateAvailable(false);
let notifications = 0;
const unsubscribe = subscribePluginUpdate(() => { notifications += 1; });
setPluginUpdateAvailable("yes");
assert.equal(pluginUpdateSnapshot(), true, "the shared store normalizes truthy input");
assert.equal(notifications, 1, "a changed verdict notifies every subscribed surface");
setPluginUpdateAvailable(true);
assert.equal(notifications, 1, "an unchanged verdict does not churn React subscribers");
unsubscribe();
setPluginUpdateAvailable(false);
assert.equal(notifications, 1, "unsubscribe stops cross-surface notifications");
assert.equal(markPluginUpdateLoaded(), true);
assert.equal(markPluginUpdateLoaded(), false);
markPluginUpdateUnloaded();
assert.equal(markPluginUpdateLoaded(), true, "a failed first read allows the next surface to retry");

console.log("plugin update test ok: entry select, map, shortRef, install source, failed-check merge, shared signal");
