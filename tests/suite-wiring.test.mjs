import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Regression: completion.test.mjs and playbook.test.mjs shipped, passed in
// isolation, but were never wired into any npm test script — CI never ran
// them. A test outside the suite is a hope, not a guard. This file lists
// every tests/*.test.mjs against package.json and fails when one is
// unwired (itself included).
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = readdirSync(join(root, "tests")).filter((file) => file.endsWith(".test.mjs")).sort();
assert.ok(files.length > 0, "the tests directory holds contract tests");
const scripts = JSON.stringify(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts);
const unwired = files.filter((file) => !scripts.includes(`tests/${file}`));
assert.deepEqual(unwired, [], `every test file runs in CI, unwired: ${unwired.join(", ") || "none"}`);

console.log(`suite wiring test ok: ${files.length} test files wired into npm scripts`);
