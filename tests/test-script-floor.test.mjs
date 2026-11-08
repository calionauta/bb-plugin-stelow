// The band count, not just the wiring. `suite-wiring.test.mjs` proves every
// test FILE appears in some script; it cannot see a band that vanished while
// its files stayed mentioned elsewhere. #420 was that merge: master declared 88
// `test:` scripts, the branch 87, and taking the branch side of the
// package.json conflict dropped `test:contrast-wiring` with a green suite.
//
// This test reads the real package.json and a fixture copy of it with one band
// deleted. The copy is what proves the guard fails: without the deletion half,
// a floor that never fires looks exactly like a floor that is satisfied.
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TEST_SCRIPT_FLOOR, assertTestScriptFloor, testScriptNames } from "../lib/test-script-floor.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = mkdtempSync(join(tmpdir(), "stelow-test-floor-"));
const fixturePath = join(fixtureDir, "package.json");

/** A real file on disk, not an in-memory object: the guard reads what CI reads. */
function readScripts(path = join(root, "package.json")) {
  return JSON.parse(readFileSync(path, "utf8")).scripts;
}

function writeFixture(drop = [], add = []) {
  const scripts = { ...readScripts() };
  for (const name of drop) delete scripts[name];
  for (const name of add) scripts[name] = "node tests/suite-wiring.test.mjs";
  copyFileSync(join(root, "package.json"), fixturePath);
  const manifest = JSON.parse(readFileSync(fixturePath, "utf8"));
  manifest.scripts = scripts;
  writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));
}

try {
  // 1. The tree as it stands clears its own recorded floor.
  const live = readScripts();
  assert.ok(
    assertTestScriptFloor(live).count >= TEST_SCRIPT_FLOOR,
    `the live package.json declares at least ${TEST_SCRIPT_FLOOR} test bands`,
  );

  // 2. The floor keeps up. A stale floor is a floor that stopped guarding: it
  //    would take three more dropped bands before anyone heard about it.
  assert.equal(
    testScriptNames(live).length,
    TEST_SCRIPT_FLOOR,
    "TEST_SCRIPT_FLOOR equals the live band count: raising it is part of adding a band",
  );

  // 3. Red proof — delete one band from the fixture copy and the guard fires,
  //    naming both numbers and the band that went missing from CI.
  assert.ok(testScriptNames(live).includes("test:contrast-wiring"), "the band the #420 merge dropped exists today");
  writeFixture(["test:contrast-wiring"]);
  assert.throws(
    () => assertTestScriptFloor(readScripts(fixturePath)),
    /declares 89 "test:" scripts, below the recorded floor of 90 — 1 CI band\(s\) went missing/,
    "one deleted band falls under the floor and is refused by name, not silently accepted",
  );

  // 4. The floor is a floor, not an equality: a branch that ADDS a band passes
  //    without touching the constant.
  writeFixture([], ["test:fixture-extra"]);
  assert.equal(
    assertTestScriptFloor(readScripts(fixturePath)).count,
    TEST_SCRIPT_FLOOR + 1,
    "a band above the floor passes — only falling under it is a refusal",
  );

  // 5. A malformed manifest is refused at the boundary, not read as zero bands.
  assert.throws(() => testScriptNames(null), /scripts must be an object/);
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}

console.log(`test script floor ok: ${TEST_SCRIPT_FLOOR} test bands, one deleted band refused`);
