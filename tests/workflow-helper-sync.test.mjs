import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncHelperScript } from "../lib/workflow-skills-sync.mjs";

// Guard: same fail-soft contract as the skills sync — network failures skip,
// logic failures fail. Uses an isolated temp plugin root (skills/ + data/)
// so no state leaks between runs.
const root = mkdtempSync(join(tmpdir(), "stelow-helper-test-"));
mkdirSync(join(root, "skills"), { recursive: true });
mkdirSync(join(root, "data"), { recursive: true });

let ok = true;
try {
  const first = await syncHelperScript(root, { log: () => {} });
  assert.equal(first.errors.length, 0, "first sync has no errors");
  assert.ok(first.created.length > 0 || first.updated.length > 0, "first sync writes data/stelow");
  const written = readFileSync(join(root, "data", "stelow"), "utf8");
  assert.ok(written.includes("do_advance"), "synced helper contains advance");
  assert.ok(written.includes("STELOW_STATEDIR"), "synced helper supports per-workflow dirs");
  const pkg = JSON.parse(readFileSync(join(root, "data", "stelow-package.json"), "utf8"));
  assert.match(pkg.version, /^\d+\.\d+\.\d+/, "synced upstream package carries a semver version");

  // Second run must be a no-op (state sha match) — no re-download, no churn.
  const before = readFileSync(join(root, "data", "stelow"), "utf8");
  const second = await syncHelperScript(root, { log: () => {} });
  assert.equal(second.created.length, 0, "second sync creates nothing");
  assert.equal(second.updated.length, 0, "second sync updates nothing");
  assert.equal(second.errors.length, 0, "second sync has no errors");
  assert.equal(second.changed, false, "second sync reports unchanged");
  assert.equal(readFileSync(join(root, "data", "stelow"), "utf8"), before, "second sync touches nothing");

  console.log("helper sync test ok: data/stelow + upstream version synced from calionauta/stelow, idempotent on second run");
} catch (err) {
  const msg = String(err && err.message ? err.message : err);
  const netish = /fetch|network|ECONN|offline|timeout|unreachable|socket|getaddrinfo/i.test(msg);
  if (netish) {
    console.log(`helper sync test SKIPPED (network unavailable): ${msg}`);
  } else {
    console.error(`helper sync test FAILED: ${msg}`);
    process.exit(1);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
