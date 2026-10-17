import assert from "node:assert/strict";
import { assignBundleNames, parseBundleManifest, staleBundleEntries, unbundledSources } from "../lib/run-bundle.mjs";
import { renderBundleManifest } from "../lib/artifact-manifest.mjs";
import { createBundleWriter } from "../server/runtime/cli/cli-bundle-writer.ts";
import { createExportCommand } from "../server/runtime/cli/cli-export.ts";
import { doneStdout } from "../server/runtime/cli/cli-done-track.ts";
import { cliHarness, auditableBuildDone, buildCard, callsNamed } from "./helpers/cli-harness.mjs";

// Filename assignment: stable basenames, stage prefix on collision, numeric
// suffix when even that collides — a repeated basename must never silently
// overwrite its sibling in the bundle.
assert.deepEqual(
  assignBundleNames([{ stage: "shape", path: "spec-product.md" }, { stage: "plan", path: "spec-tech.md" }]),
  [
    { name: "spec-product.md", stage: "shape", sourcePath: "spec-product.md" },
    { name: "spec-tech.md", stage: "plan", sourcePath: "spec-tech.md" },
  ],
  "distinct basenames keep their names",
);
assert.deepEqual(
  assignBundleNames([{ stage: "shape", path: "a/notes.md" }, { stage: "plan", path: "b/notes.md" }]).map((entry) => entry.name),
  ["notes.md", "plan-notes.md"],
  "a repeated basename gets a stage prefix, not an overwrite",
);
assert.deepEqual(
  assignBundleNames([
    { stage: "plan", path: "a/notes.md" },
    { stage: "plan", path: "b/notes.md" },
    { stage: "plan", path: "c/notes.md" },
  ]).map((entry) => entry.name),
  ["notes.md", "plan-notes.md", "plan-notes.md-2"],
  "a triple collision still yields unique names",
);
assert.deepEqual(
  assignBundleNames([null, "x", 42, {}, { stage: "s" }, { path: "" }, { path: "ok.md" }]),
  [{ name: "ok.md", stage: null, sourcePath: "ok.md" }],
  "junk registrations are skipped, never bundled",
);
assert.deepEqual(
  assignBundleNames([{ stage: "s", path: "dir\\win.md" }]),
  [{ name: "win.md", stage: "s", sourcePath: "dir\\win.md" }],
  "windows separators split the basename but the source path is preserved",
);

// Manifest round-trip: what renderBundleManifest writes, parseBundleManifest
// reads back — --check compares against exactly this shape.
const rendered = renderBundleManifest({
  cardId: "card1",
  cardName: "Card One",
  stage: "audit",
  generatedAt: "2026-09-19T00:00:00.000Z",
  files: [
    { name: "spec-product.md", stage: "shape", sha8: "a1b2c3d4", sourcePath: "spec-product.md" },
    { name: "plan-notes.md", stage: "plan", sha8: "e5f6a7b8", sourcePath: "b/notes.md" },
  ],
  missing: ["gone.md"],
  gapTotals: null,
});
assert.deepEqual(
  parseBundleManifest(rendered),
  [
    { name: "spec-product.md", stage: "shape", sha8: "a1b2c3d4", sourcePath: "spec-product.md" },
    { name: "plan-notes.md", stage: "plan", sha8: "e5f6a7b8", sourcePath: "b/notes.md" },
  ],
  "rendered manifest rows parse back exactly",
);
assert.deepEqual(parseBundleManifest(""), [], "empty content parses to nothing bundled");
assert.deepEqual(parseBundleManifest("# Notes\n| a | b |\n"), [], "foreign markdown never parses as bundle rows");

// Staleness: same SHA is fresh; changed, unreadable, and unknown SHAs are
// stale with a reason that names the fix.
const manifestEntries = [
  { name: "a.md", stage: "shape", sha8: "a1b2c3d4", sourcePath: "a.md" },
  { name: "b.md", stage: "plan", sha8: "e5f6a7b8", sourcePath: "b.md" },
];
assert.deepEqual(
  staleBundleEntries(manifestEntries, { "a.md": "a1b2c3d4", "b.md": "e5f6a7b8" }),
  [],
  "matching SHAs are fresh",
);
assert.deepEqual(
  staleBundleEntries(manifestEntries, new Map([["a.md", "a1b2c3d4"], ["b.md", "ffffffff"]])),
  [{ name: "b.md", stage: "plan", sha8: "e5f6a7b8", sourcePath: "b.md", reason: "changed" }],
  "a changed source is stale with reason changed (Maps work too)",
);
assert.deepEqual(
  staleBundleEntries(manifestEntries, { "a.md": "a1b2c3d4", "b.md": null }),
  [{ name: "b.md", stage: "plan", sha8: "e5f6a7b8", sourcePath: "b.md", reason: "missing" }],
  "an unreadable source is stale with reason missing",
);
assert.deepEqual(
  staleBundleEntries([{ name: "c.md", stage: "s", sha8: "????????", sourcePath: "c.md" }], { "c.md": "12345678" }),
  [{ name: "c.md", stage: "s", sha8: "????????", sourcePath: "c.md", reason: "changed" }],
  "an unknown bundled SHA can never compare fresh",
);

// New sources: registered after the last export reads as drift, bundled
// sources do not.
assert.deepEqual(
  unbundledSources([{ path: "a.md" }, { path: "fresh.md" }], manifestEntries),
  ["fresh.md"],
  "a registered source with no manifest row is drift",
);
assert.deepEqual(unbundledSources([{ path: "a.md" }], manifestEntries), [], "fully bundled sources report no drift");
assert.deepEqual(unbundledSources(null, null), [], "empty inputs report no drift");

console.log("run bundle test ok: stable names, manifest round-trip, changed/missing/new drift");

// Wiring: every done path refreshes the bundle before completing, export
// failures refuse with a retry, and --check exists for drift between dones.
//
// These were source-text regexes over the CLI modules. They are now the
// behaviour those regexes described: `done` runs on each track through the
// real dispatcher and the refreshed run directory is the observable; the
// export command's refusals and JSON are read off the command itself.
const RUN_DIR = "docs/runs/card_1";

/** Where the run-bundle write landed for this card, in call order. */
function bundleWriteIndex(calls) {
  return calls.findIndex(
    ([name, payload]) => name === "mkdir" && String(payload?.path ?? "").endsWith(`/${RUN_DIR}`),
  );
}

/** Where the card was marked complete, in call order. */
function completedIndex(calls) {
  return calls.findIndex(([name, , fields]) => name === "updateCard" && fields?.status === "completed");
}

{
  const build = cliHarness(auditableBuildDone());
  assert.equal((await build.invoke(["done"])).exitCode, 0, "a build done completes");
  const writeAt = bundleWriteIndex(build.calls);
  assert.ok(writeAt >= 0, "build done refreshes the run bundle");
  assert.ok(writeAt < completedIndex(build.calls), "the build bundle refresh lands before the card is marked complete");
}

// A state file with a registered artifact, so each single-stage track reaches
// the bundle writer's write path rather than the "nothing to bundle" skip.
const stateWithArtifact = [
  "---",
  "name: workflow",
  "artifacts:",
  "  - stage: research",
  "    kind: document",
  "    path: report.md",
  "---",
  "",
].join("\n");

for (const [track, options] of [
  [
    "research",
    {
      card: buildCard({ kind: "research" }),
      readiness: { ready: true, fingerprint: "fp1", evidence: "verified", invalid: [] },
      strategyRounds: [{ id: "r1", at: "2026-01-01", file: "round-1.md" }],
    },
  ],
  [
    "explore",
    {
      card: buildCard({ kind: "explore", explore_stage: "shape" }),
      artifact: { ready: true, fingerprint: "fp2", failures: [] },
    },
  ],
]) {
  const run = cliHarness({
    ...options,
    files: {
      "/w/.stelow/state/state.md": stateWithArtifact,
      "/w/report.md": "# Report\n\nBody\n",
    },
  });
  assert.equal((await run.invoke(["done"])).exitCode, 0, `a ${track} done completes`);
  const writeAt = bundleWriteIndex(run.calls);
  assert.ok(writeAt >= 0, `${track} done refreshes the run bundle`);
  assert.ok(writeAt < completedIndex(run.calls), `the ${track} bundle refresh lands before the card is marked complete`);
}

// A bundle refresh that cannot run refuses done and never completes the card.
{
  const blocked = cliHarness({
    card: buildCard({ kind: "research" }),
    noWorkspace: true,
    readiness: { ready: true, fingerprint: "fp1", evidence: "verified", invalid: [] },
    strategyRounds: [{ id: "r1", at: "2026-01-01", file: "round-1.md" }],
  });
  const failed = await blocked.invoke(["done"]);
  assert.equal(failed.exitCode, 1, "a bundle refresh failure refuses done");
  assert.match(failed.stderr, /run-bundle export failed \(.*\) — retry done\./, "the refusal names the retry");
  assert.deepEqual(callsNamed(blocked.calls, "updateCard"), [], "a refused bundle refresh never completes the card");
}

// The completion output names the refreshed dir and carries the paste-ready
// trailer; a card with nothing to bundle says so instead of pretending.
{
  const refreshed = doneStdout('Done. Workflow "checkout" completed at audit.', {
    wrote: true,
    dir: RUN_DIR,
    trailer: ["Stelow-Card: card_1", "Stelow-Artifacts: 2"],
  });
  assert.match(refreshed, /Run bundle refreshed at docs\/runs\/card_1\//, "completion output names the refreshed bundle dir");
  assert.match(
    refreshed,
    /paste below the commit subject:[\s\S]*Stelow-Card: card_1[\s\S]*Stelow-Artifacts: 2/,
    "completion output carries the paste-ready trailer",
  );
  assert.match(
    doneStdout("Done.", { wrote: false, dir: RUN_DIR, trailer: [] }),
    /No registered artifacts — nothing to bundle\./,
    "a card with no registered artifacts says so instead of pretending",
  );
}

// The export command: an unknown flag prints the usage that advertises
// --check; --check reports drift and the uncommitted-bundle fix; JSON carries
// the commit dimension; and a write with nothing registered skips.
{
  const card = { id: "card_1", worker_thread_id: "thr_worker" };
  const exportDeps = {
    getCard: (id) => (id === "card_1" ? card : undefined),
    getCardByWorkerThread: (threadId) => (threadId === "thr_worker" ? card : undefined),
  };
  const ctx = { threadId: "thr_worker", projectId: "proj_1" };

  const usageResult = await createExportCommand(exportDeps, async () => {
    throw new Error("a usage refusal never calls the writer");
  })(["export", "--bogus"], ctx);
  assert.equal(usageResult.exitCode, 2, "an unknown export flag is a usage refusal");
  assert.match(usageResult.stderr, /export \[--json\] \[--check\] \[--card <card_id>\]/, "export usage advertises --check");

  const checkDrift = await createExportCommand(exportDeps, async () => ({
    ok: true, check: true, dir: RUN_DIR, fresh: true, stale: [], added: [], missing: [], committed: false,
  }))(["export", "--check"], ctx);
  assert.equal(checkDrift.exitCode, 1, "an uncommitted bundle is not settled");
  assert.match(checkDrift.stderr, /differs from HEAD — commit it with the work/, "an uncommitted bundle names its fix");

  const checkJson = await createExportCommand(exportDeps, async () => ({
    ok: true,
    check: true,
    dir: RUN_DIR,
    fresh: false,
    stale: [{ name: "a.md", stage: "shape", sha8: "aaaaaaaa", sourcePath: "a.md", reason: "changed" }],
    added: [],
    missing: [],
    committed: false,
  }))(["export", "--check", "--json"], ctx);
  assert.equal(checkJson.exitCode, 1, "drift is not settled in JSON either");
  assert.equal(JSON.parse(checkJson.stdout).committed, false, "--check JSON carries the commit dimension alongside freshness");

  const noWrites = await createExportCommand(exportDeps, async () => ({
    ok: true, check: false, dir: RUN_DIR, files: [], missing: [], trailer: [], wrote: false,
  }))(["export"], ctx);
  assert.equal(noWrites.exitCode, 0, "an empty registration is not an error");
  assert.match(noWrites.stdout, /No registered artifacts — nothing to bundle\./, "an empty registration skips the write");
}

// The bundle writer reads commit-awareness from a read-only git status over
// exactly the bundle dir: clean means committed, dirty means not, and no
// manifest means there is nothing to compare (null).
{
  const manifest = renderBundleManifest({
    cardId: "card_1",
    cardName: "Checkout",
    stage: "audit",
    generatedAt: "2026-01-01T00:00:00.000Z",
    files: [{ name: "report.md", stage: "audit", sha8: "aaaaaaaa", sourcePath: "report.md" }],
    missing: [],
    gapTotals: null,
  });
  const card = { id: "card_1", name: "Checkout", stage: "audit", kind: "build", dir_hash: "hash1" };
  const writerWith = (gitStatus, body) => {
    const gitCalls = [];
    const files = {
      "/w/.stelow/state/state.md": stateWithArtifact,
      "/w/report.md": "# Report\n",
      ...(body === null ? {} : { [`/w/${RUN_DIR}/manifest.md`]: manifest }),
    };
    return {
      gitCalls,
      deps: {
        cardWorkspace: async () => ({ path: "/w" }),
        workflowStateDir: async () => "/w/.stelow/state",
        bb: {
          sdk: {
            files: {
              read: async ({ path }) => {
                if (path in files) return { content: files[path] };
                throw new Error("ENOENT");
              },
            },
          },
        },
        runGitIn: async (cwd, args) => {
          gitCalls.push([cwd, args]);
          return { ok: true, stdout: gitStatus };
        },
      },
    };
  };

  const clean = writerWith("");
  const cleanCheck = await createBundleWriter(clean.deps)(card, { checkOnly: true });
  assert.equal(cleanCheck.committed, true, "a clean git status reads the bundle as committed");
  assert.deepEqual(
    clean.gitCalls,
    [["/w", ["status", "--porcelain", "--", RUN_DIR]]],
    "commit-awareness is a read-only git status on the bundle dir",
  );

  const dirty = writerWith(" M docs/runs/card_1/report.md\n");
  assert.equal(
    (await createBundleWriter(dirty.deps)(card, { checkOnly: true })).committed,
    false,
    "an uncommitted bundle dir reads as not committed",
  );

  const noManifest = writerWith("", null);
  assert.equal(
    (await createBundleWriter(noManifest.deps)(card, { checkOnly: true })).committed,
    null,
    "with no bundle to compare there is no commit reading",
  );
}

console.log("run bundle wiring test ok: done refreshes on all tracks, failure refuses, --check advertised and committed");
