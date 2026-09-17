#!/usr/bin/env node
// Blessed manual sync for vendored Stelow assets (see AGENTS.md "Skills sync").
// Reads the pinned commit from data/stelow-source.json, syncs skills/ + data
// files with the ledger OUTSIDE skills/ (bb scans skills/ for candidates),
// then reminds to reload the plugin so the server re-registers skill trees.
// Run from the plugin root: node scripts/sync-stelow-assets.mjs
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readPinnedStelowSource, syncHelperScript, syncWorkflowSkills } from "../lib/workflow-skills-sync.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = join(root, "data", ".skills-sync-state.json");

try {
  const { commit, version } = readPinnedStelowSource(root);
  const skills = await syncWorkflowSkills(join(root, "skills"), { ref: commit, log: console.log, statePath });
  const helper = await syncHelperScript(root, { log: console.log, statePath });
  const errors = [...skills.errors, ...helper.errors];
  console.log(`sync done: skills ${skills.updated.length}u/${skills.created.length}c/${skills.removed.length}r, helper ${helper.updated.length}u/${helper.created.length}c (pin stelow ${version} ${commit.slice(0, 12)})`);
  if (errors.length) {
    for (const error of errors) console.error(`  error: ${error}`);
    process.exit(1);
  }
  console.log("Next: npm run reload (live checkout) so the server re-registers the new skill trees, then commit the result.");
} catch (error) {
  console.error(`sync failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
