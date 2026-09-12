import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncHelperScript } from "../lib/workflow-skills-sync.mjs";

// Guard: same fail-soft contract as the skills sync — network failures skip,
// logic failures fail. Uses an isolated temp plugin root (skills/ + data/)
// so no state leaks between runs.
const root = mkdtempSync(join(tmpdir(), "stelow-helper-test-"));
mkdirSync(join(root, "skills"), { recursive: true });
mkdirSync(join(root, "data"), { recursive: true });
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// GitHub being offline or rate-limited is the sync's normal fail-soft path —
// it reports those in `errors` and never throws. Skip only those; a missing
// file upstream, a truncated tree, or a sha mismatch is a real defect.
const UNAVAILABLE = /(403|429|50\d)\b|fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|offline|timeout|unreachable|socket|getaddrinfo|stale \S+: content sha mismatch/i;

/** Throw with the sync's own error text, so the guard above can classify it. */
function assertCleanSync(result, label) {
  if (result.errors.length) throw new Error(`${label} failed: ${result.errors.join("; ")}`);
}

/** Offline still proves the vendored pair shipped and is sane. */
function assertVendoredHelper() {
  const helper = readFileSync(join(pluginRoot, "data", "stelow"), "utf8");
  assert.ok(helper.includes("do_advance"), "vendored helper contains advance");
  assert.ok(helper.includes("STELOW_STATEDIR"), "vendored helper supports per-workflow dirs");
  const pkg = JSON.parse(readFileSync(join(pluginRoot, "data", "stelow-package.json"), "utf8"));
  assert.match(pkg.version, /^\d+\.\d+\.\d+/, "vendored upstream package carries a semver version");
}

try {
  const first = await syncHelperScript(root, { log: () => {} });
  assertCleanSync(first, "first sync");
  assert.ok(first.created.length > 0 || first.updated.length > 0, "first sync writes data/stelow");
  const written = readFileSync(join(root, "data", "stelow"), "utf8");
  assert.ok(written.includes("do_advance"), "synced helper contains advance");
  assert.ok(written.includes("STELOW_STATEDIR"), "synced helper supports per-workflow dirs");
  const pkg = JSON.parse(readFileSync(join(root, "data", "stelow-package.json"), "utf8"));
  assert.match(pkg.version, /^\d+\.\d+\.\d+/, "synced upstream package carries a semver version");

  // Second run must be a no-op (state sha match) — no re-download, no churn.
  const before = readFileSync(join(root, "data", "stelow"), "utf8");
  const second = await syncHelperScript(root, { log: () => {} });
  assertCleanSync(second, "second sync");
  assert.equal(second.created.length, 0, "second sync creates nothing");
  assert.equal(second.updated.length, 0, "second sync updates nothing");
  assert.equal(second.changed, false, "second sync reports unchanged");
  assert.equal(readFileSync(join(root, "data", "stelow"), "utf8"), before, "second sync touches nothing");

  console.log("helper sync test ok: data/stelow + upstream version synced from calionauta/stelow, idempotent on second run");
} catch (err) {
  const msg = String(err && err.message ? err.message : err);
  if (UNAVAILABLE.test(msg)) {
    try {
      assertVendoredHelper();
      console.log(`helper sync test SKIPPED (GitHub unavailable); vendored data/stelow verified offline: ${msg}`);
    } catch (offlineError) {
      console.error(`helper sync test FAILED: vendored artifacts invalid — ${offlineError.message}`);
      process.exit(1);
    }
  } else {
    console.error(`helper sync test FAILED: ${msg}`);
    process.exit(1);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
