import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cardWorkerSeedRefusal, withRuntimeIgnoreEntry, RUNTIME_IGNORE_ENTRY } from "../lib/card-seed-guard.mjs";
import { NEVER_SEED } from "../server/runtime/plugin-protocols.ts";
import { seedWorkflow } from "../server/runtime/workflow-seeding.ts";
import { callsNamed, cliHarness } from "./helpers/cli-harness.mjs";

// Regression: a card worker ran `bb stelow seed` mid-workflow and minted a
// name-derived owner at the project root — an orphan state dir no card
// resolves back — while its own card workflow sat untouched. The seed CLI
// now refuses card workers; the refusal must name the card's own state dir
// as the valid redirect (a refusal without an exit is a deadlock).

const refusal = cardWorkerSeedRefusal({ cardName: "jogo-da-velha", stateDirText: "/w/.stelow/2026-09-13/sw-card_1" });
assert.match(refusal, /never run `bb stelow seed`/, "the refusal names the forbidden command");
assert.match(refusal, /\/w\/\.stelow\/2026-09-13\/sw-card_1/, "the refusal redirects to the card's own state dir");
assert.match(refusal, /jogo-da-velha/, "the refusal names the card it protects");
assert.match(refusal, /ownerless|orphan/i, "the refusal explains why seeding would strand work");

const noDir = cardWorkerSeedRefusal({ cardName: null, stateDirText: null });
assert.match(noDir, /never run `bb stelow seed`/, "the refusal holds without a resolvable state dir");
assert.match(noDir, /already seeded/, "the fallback still states the workflow exists");

// Server contract, driven through the real CLI verb table: the seed CLI
// resolves the calling card worker and refuses through the guard instead of
// minting a project-root workflow. The assertion is on what the invocation
// RETURNS and on whether the seeder ran, so a comment or a rename cannot satisfy it.
const { invoke, calls } = cliHarness();
const refused = await invoke(["seed", "--project", "proj_1", "--name", "jogo-da-velha", "--intent", "feature"]);
assert.equal(refused.exitCode, 1, "a card-worker seed is refused");
assert.match(refused.stderr, /never run `bb stelow seed`/, "and says so through the guard");
assert.match(refused.stderr, /\/w\/\.stelow\/state/, "naming the card's own state dir as the redirect");
assert.deepEqual(callsNamed(calls, "seed"), [], "no project-root workflow is minted from inside a card");

// The refusal is scoped to card workers: a thread that owns no card still seeds.
const outside = cliHarness();
const seeded = await outside.invoke(
  ["seed", "--project", "proj_1", "--name", "jogo-da-velha", "--intent", "feature"],
  { threadId: "thr_stranger", projectId: "proj_1" },
);
assert.equal(seeded.exitCode, 0, "a non-card seed still succeeds");
assert.equal(callsNamed(outside.calls, "seed").length, 1, "and reaches the seeder");

// Build prompts state the workflow is pre-seeded so the worker never reaches
// for seed in the first place. Every spawn path references the same one const.
assert.equal(typeof NEVER_SEED, "string", "the seed ban is a single-source const");
assert.match(NEVER_SEED, /never run `bb stelow seed`/, "and it carries the ban every prompt quotes");

// Seed-time hygiene: .stelow/ (live runs) stays out of git; the committed
// record is the exported docs/runs/<card>/ bundle. Driven through the seeder,
// so the guard is proven by the file it writes rather than by its call site.
const bb = { sdk: { files: { read: async () => { throw new Error("ENOENT"); } } } };
const gitRoot = mkdtempSync(join(tmpdir(), "stelow-seed-git-"));
const plainRoot = mkdtempSync(join(tmpdir(), "stelow-seed-plain-"));
try {
  mkdirSync(join(gitRoot, ".git"));
  const inGit = await seedWorkflow(bb, gitRoot, "card_1", "jogo-da-velha", "feature");
  assert.equal(inGit.error, null, "seeding a git checkout succeeds");
  assert.ok(
    readFileSync(join(gitRoot, ".gitignore"), "utf8").includes(".stelow/"),
    "a git checkout ignores the runtime dir",
  );
  const inPlain = await seedWorkflow(bb, plainRoot, "card_1", "jogo-da-velha", "feature");
  assert.equal(inPlain.error, null, "seeding a non-git workspace succeeds");
  assert.equal(existsSync(join(plainRoot, ".gitignore")), false, "and gets no ignore file");
} finally {
  rmSync(gitRoot, { recursive: true, force: true });
  rmSync(plainRoot, { recursive: true, force: true });
}

assert.equal(RUNTIME_IGNORE_ENTRY, ".stelow/", "ignore entry names the runtime dir");
assert.ok(withRuntimeIgnoreEntry(null).endsWith(".stelow/\n"), "missing file gets entry with comment");
assert.equal(withRuntimeIgnoreEntry(".stelow/\n"), null, "present entry is a no-op");
assert.equal(withRuntimeIgnoreEntry("/.stelow"), null, "leading-slash variant counts as covered");
assert.equal(withRuntimeIgnoreEntry("node_modules/"), "node_modules/\n# Stelow runtime state (live per-card runs — commit docs/runs/<card>/ instead)\n.stelow/\n", "appends after existing content");
assert.equal(withRuntimeIgnoreEntry("node_modules"), "node_modules\n# Stelow runtime state (live per-card runs — commit docs/runs/<card>/ instead)\n.stelow/\n", "missing trailing newline handled");
assert.equal(withRuntimeIgnoreEntry("# stelow stuff\n"), "# stelow stuff\n# Stelow runtime state (live per-card runs — commit docs/runs/<card>/ instead)\n.stelow/\n", "a mere substring never counts as covered");

console.log("card seed guard test ok: refusal copy, card-worker seed refusal, pre-seeded prompts");
