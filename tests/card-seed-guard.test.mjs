import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cardWorkerSeedRefusal, withRuntimeIgnoreEntry, RUNTIME_IGNORE_ENTRY } from "../lib/card-seed-guard.mjs";

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

// Server contract: the seed CLI resolves the calling card worker and
// refuses through the guard instead of minting a project-root workflow.
const serverSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/plugin-runtime.ts"), "utf8");
const seedBlock = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/runtime/cli/cli-seed.ts"), "utf8");
assert.match(seedBlock, /argv\[0\] === "seed" \? runSeed\(deps, argv, ctx\) : null/, "the seed family claims exactly its verb");
assert.match(seedBlock, /getCardByWorkerThread\(ctx\.threadId\)/, "the seed handler resolves the calling card worker like advance/doctor do");
assert.match(seedBlock, /cardWorkerSeedRefusal\(/, "a card worker seed is refused through the guard");
assert.match(
  seedBlock,
  /deps\.workflowStateDir\(\s*seedRoot,\s*seedCard\.id,\s*seedCard\.dir_hash,\s*\)/,
  "the refusal redirects to the card's own state dir",
);

// Server contract: build prompts state the workflow is pre-seeded so the
// worker never reaches for seed in the first place. The clause lives in
// the NEVER_SEED const and every spawn path references it — covered by
// tests/prompt-contracts.test.mjs; here just pin the single definition.
assert.match(serverSource, /const NEVER_SEED\s*=\s*"/, "the seed ban is a single-source const");

// Seed-time hygiene: .stelow/ (live runs) stays out of git; the committed
// record is the exported docs/runs/<card>/ bundle.
assert.equal(RUNTIME_IGNORE_ENTRY, ".stelow/", "ignore entry names the runtime dir");
assert.ok(withRuntimeIgnoreEntry(null).endsWith(".stelow/\n"), "missing file gets entry with comment");
assert.equal(withRuntimeIgnoreEntry(".stelow/\n"), null, "present entry is a no-op");
assert.equal(withRuntimeIgnoreEntry("/.stelow"), null, "leading-slash variant counts as covered");
assert.equal(withRuntimeIgnoreEntry("node_modules/"), "node_modules/\n# Stelow runtime state (live per-card runs — commit docs/runs/<card>/ instead)\n.stelow/\n", "appends after existing content");
assert.equal(withRuntimeIgnoreEntry("node_modules"), "node_modules\n# Stelow runtime state (live per-card runs — commit docs/runs/<card>/ instead)\n.stelow/\n", "missing trailing newline handled");
assert.equal(withRuntimeIgnoreEntry("# stelow stuff\n"), "# stelow stuff\n# Stelow runtime state (live per-card runs — commit docs/runs/<card>/ instead)\n.stelow/\n", "a mere substring never counts as covered");
assert.match(serverSource, /withRuntimeIgnoreEntry\(/, "seedWorkflow applies the ignore guard");
assert.match(serverSource, /existsSync\(join\(rootPath, "\.git"\)\)/, "guard runs in git checkouts only");

console.log("card seed guard test ok: refusal copy, card-worker seed refusal, pre-seeded prompts");
