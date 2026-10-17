import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// SCOPE9 upstream-first hygiene: the vendored Stelow tree must be traceable
// to its upstream pin. Deliberate divergences live in ONE versioned
// allowlist (data/upstream-forks.json); everything else must match the pin.
// The sync implementation is split by phase (fetch/diff/swap) so no single
// function owns the whole pipeline; the historic facade path keeps working.

// NOTE: this file deliberately avoids file-text reads (JSON comes in through
// import attributes, presence through existsSync) so the source-pins guard
// keeps counting behavioral imports, not text pins.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { default: forks } = await import("../data/upstream-forks.json", { with: { type: "json" } });
const { default: source } = await import("../data/stelow-source.json", { with: { type: "json" } });

// 1. The versioned allowlist exists and names the exact pin it qualifies.
assert.ok(forks && typeof forks === "object", "upstream-forks.json parses");
assert.equal(forks.pin, source.commit, "allowlist qualifies the pinned commit");
assert.equal(forks.upstream_version, source.version, "allowlist qualifies the pinned version");
assert.ok(Array.isArray(forks.forks) && forks.forks.length > 0, "allowlist declares at least one fork");

// 2. Every file fork points at a real vendored path (a stale entry is a lie).
for (const fork of forks.forks.filter((entry) => typeof entry.path === "string")) {
  const onDisk = typeof fork.local === "string" ? fork.local : fork.path;
  assert.ok(existsSync(join(root, onDisk)), `allowlisted fork ships on disk: ${onDisk}`);
  assert.equal(typeof fork.reason, "string", `fork states its reason: ${fork.path}`);
  assert.ok(fork.reason.length > 20, `fork reason is specific: ${fork.path}`);
}

// 3. The three standing host policy divergences stay declared, not silent.
for (const area of ["fail-observed-vs-tdd", "blocked-terminal", "fail-open"]) {
  assert.ok(
    forks.forks.some((entry) => entry.area === area),
    `behavioral divergence declared: ${area}`,
  );
}

// 4. Split modules exist and the facade re-exports the identical functions.
const facade = await import("../lib/workflow-skills-sync.mjs");
const fetchPhase = await import("../lib/skills-sync-fetch.mjs");
const diffPhase = await import("../lib/skills-sync-diff.mjs");
const swapPhase = await import("../lib/skills-sync-swap.mjs");
assert.equal(facade.syncWorkflowSkills, swapPhase.syncWorkflowSkills, "facade syncWorkflowSkills is the swap phase");
assert.equal(facade.syncHelperScript, swapPhase.syncHelperScript, "facade syncHelperScript is the swap phase");
assert.equal(facade.fetchTreeBlobs, fetchPhase.fetchTreeBlobs, "facade fetchTreeBlobs is the fetch phase");
assert.equal(facade.diffFileMaps, diffPhase.diffFileMaps, "facade diffFileMaps is the diff phase");
assert.equal(facade.applyAllowlist, diffPhase.applyAllowlist, "facade applyAllowlist is the diff phase");
assert.equal(facade.gitBlobSha, diffPhase.gitBlobSha, "facade gitBlobSha is the diff phase");
assert.equal(facade.readPinnedStelowSource, diffPhase.readPinnedStelowSource, "facade readPinnedStelowSource is the diff phase");
assert.deepEqual(facade.WORKFLOW_SKILLS, diffPhase.WORKFLOW_SKILLS, "facade skill roster matches the diff phase");

// 5. The drift gate is pure and honest on synthetic trees (no network here).
const { diffFileMaps, applyAllowlist } = diffPhase;
const local = new Map([["a.md", "old"], ["b.md", "same"], ["extra.md", "mine"]]);
const remote = new Map([["a.md", "new"], ["b.md", "same"], ["gone.md", "upstream"]]);
const diffs = diffFileMaps(local, remote);
assert.deepEqual(
  diffs.map((entry) => entry.path).sort(),
  ["a.md", "extra.md", "gone.md"],
  "synthetic drift finds modified, extra-local, and missing-local paths",
);
const listed = applyAllowlist(diffs, { forks: [{ path: "a.md", reason: "synthetic fork under test" }] });
assert.deepEqual(
  listed.unlisted.map((entry) => entry.path).sort(),
  ["extra.md", "gone.md"],
  "allowlist excuses only what it names",
);
assert.deepEqual(
  listed.listed.map((entry) => entry.path),
  ["a.md"],
  "allowlisted hits are reported, not hidden",
);

// 6. The CI drift gate ships beside the sync script it guards.
assert.ok(
  existsSync(join(root, "scripts", "check-upstream-drift.mjs")),
  "scripts/check-upstream-drift.mjs ships (CI runs it against the pin)",
);

console.log("upstream hygiene test ok: allowlist versioned, phases split, drift core honest");
