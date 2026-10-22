#!/usr/bin/env node
// Blessed sync for vendored Stelow assets (see AGENTS.md "Skills sync").
//
// ONE implementation, two callers. A maintainer at a checkout runs it bare;
// the `sync Stelow` workflow runs it with `--from-checkout upstream`. The
// workflow used to re-implement this as `cp` commands in YAML, and the copy
// had already drifted: it refreshed skills, the helper and the catalogs but
// never `data/stelow-assets`, the vendored recipes and schemas the artifact
// contracts are checked against. A sync is not a place for a second opinion.
//
// Manual:  node scripts/sync-stelow-assets.mjs
// CI:      node scripts/sync-stelow-assets.mjs --from-checkout upstream
//
// With `--from-checkout`, the version and commit come from that checkout and
// are written to the pin (source + fork ledger) before syncing, so the pin and
// the files it names can never disagree. Without it, the current pin is synced.
// Run from the plugin root. Then `npm run reload` in a live checkout so the
// server re-registers the new skill trees.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readPinnedStelowSource,
  syncHelperScript,
  syncWorkflowSkills,
  writePinnedRevision,
} from "../lib/workflow-skills-sync.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = join(root, "data", ".skills-sync-state.json");
const USAGE = "Usage: node scripts/sync-stelow-assets.mjs [--from-checkout <upstream-dir>]";

function parseArgs(argv) {
  const options = { fromCheckout: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--from-checkout") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`--from-checkout requires a directory\n${USAGE}`);
      options.fromCheckout = value;
      index += 1;
    } else {
      throw new Error(`unknown option ${token}\n${USAGE}`);
    }
  }
  return options;
}

/** Read the revision a checkout is at, and pin it before syncing from it. */
function pinFromCheckout(directory) {
  const version = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version;
  const commit = execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return writePinnedRevision(root, { version, commit });
}

try {
  const { fromCheckout } = parseArgs(process.argv.slice(2));
  const { commit, version } = fromCheckout ? pinFromCheckout(fromCheckout) : readPinnedStelowSource(root);
  console.log(`sync: stelow ${version} ${commit.slice(0, 12)}`);
  const skills = await syncWorkflowSkills(join(root, "skills"), { ref: commit, log: console.log, statePath });
  const helper = await syncHelperScript(root, { log: console.log, statePath });
  const errors = [...skills.errors, ...helper.errors];
  console.log(
    `sync done: skills ${skills.updated.length}u/${skills.created.length}c/${skills.removed.length}r, ` +
      `helper ${helper.updated.length}u/${helper.created.length}c (pin ${version} ${commit.slice(0, 12)})`,
  );
  if (errors.length) {
    for (const error of errors) console.error(`  error: ${error}`);
    process.exit(1);
  }
  console.log("Next: npm run reload (live checkout) so the server re-registers the new skill trees, then commit the result.");
} catch (error) {
  console.error(`sync failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
