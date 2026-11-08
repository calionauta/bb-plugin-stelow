import assert from "node:assert/strict";
import test from "node:test";
import {
  isPathInstall,
  mapUpdateEntry,
  updateAvailableFrom,
} from "../lib/plugin-update.mjs";

// About owns one update verdict shared by every surface: the sidebar
// accessory, the About badge, and the status box must agree, so they all
// read one predicate — never an inline expression per call site.
test("update verdict is one predicate for every surface", () => {
  assert.equal(
    updateAvailableFrom({ pluginUpdate: { outcome: "update-available" } }),
    true,
    "a BB-managed candidate counts",
  );
  assert.equal(
    updateAvailableFrom({ githubRelease: { newer: true } }),
    true,
    "a newer GitHub release behind an unmanaged install counts",
  );
  assert.equal(
    updateAvailableFrom({ pluginUpdate: { outcome: "current" } }),
    false,
    "current reads as no update",
  );
  assert.equal(updateAvailableFrom(null), false, "junk reads as no update, never a throw");
  assert.equal(updateAvailableFrom({}), false, "an unknown shape reads as no update");
});

test("path installs take the manual update path only", () => {
  assert.equal(isPathInstall("path:/home/user/checkout"), true, "path installs update from the checkout");
  assert.equal(isPathInstall("  PATH:/x  "), true, "the prefix match ignores case and padding");
  assert.equal(isPathInstall("bb-managed"), false, "managed installs never take the manual path");
  assert.equal(isPathInstall(null), false, "junk never takes the manual path");
});

test("wire entries reduce without throwing", () => {
  assert.equal(
    mapUpdateEntry({
      outcome: "update-available",
      installed: { version: "1.0.0", display: "v1.0.0" },
      candidate: { version: "1.1.0", display: "v1.1.0" },
    }).candidate,
    "1.1.0",
    "the candidate version survives the mapping",
  );
  assert.equal(
    mapUpdateEntry(null).outcome,
    "unavailable",
    "a missing entry reads unavailable, never a throw",
  );
  assert.equal(
    mapUpdateEntry({ outcome: "bogus" }).outcome,
    "unavailable",
    "an unknown outcome reads unavailable",
  );
});

console.log("about UI contracts ok: shared update verdict, path-install routing, entry mapping");
