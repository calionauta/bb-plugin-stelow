import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PELE_PIN } from "../lib/diagram-strategy.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

// 1. The About card names this pin and the renderer bundles it, so a drift
// means the card lies: the strategy pin and the installed dependency must be
// the same exact string.
const depPin = pkg?.dependencies?.pele;
assert.equal(typeof depPin, "string", "package.json dependencies.pele exists");
assert.equal(PELE_PIN, depPin, "PELE_PIN matches package.json dependencies.pele");
assert.match(
  depPin,
  /^\d+\.\d+\.\d+$/,
  "dependencies.pele is an exact pin, no caret/range",
);

// 2. Reproducible install proof: the lockfile resolves the same version and
// carries an integrity hash.
const locked = lock?.packages?.["node_modules/pele"];
assert.ok(locked, 'package-lock.json packages["node_modules/pele"] exists');
assert.equal(locked.version, PELE_PIN, "lockfile pele version matches PELE_PIN");
assert.equal(typeof locked.integrity, "string", "lockfile pele integrity is a string");
assert.ok(locked.integrity.length > 0, "lockfile pele integrity is non-empty");

// 3. @ast-grep/cli must NOT be a bundled dependency. Its binary arrives via
// per-platform `optionalDependencies` plus a postinstall script, both skipped
// by bb git-install flags `npm install --omit=dev --omit=optional
// --ignore-scripts` — see the bundling rule in `lib/host-tools.mjs`. This
// assertion documents the exclusion; if the delivery ever changes, update this
// test alongside the rule, do not silently drop it.
assert.ok(
  !pkg?.dependencies?.["@ast-grep/cli"],
  "@ast-grep/cli stays out of package.json dependencies (host installer owns it)",
);

// 4. The pin is an exact semver triple, no range prefix.
assert.match(PELE_PIN, /^\d+\.\d+\.\d+$/, "PELE_PIN is exact semver x.y.z");

console.log("diagram pin consistency ok: strategy pin, package.json, and lockfile agree");
