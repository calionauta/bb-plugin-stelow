#!/usr/bin/env node
/**
 * Vendor stelow's job-to-be-done criteria into this plugin.
 *
 * stelow owns the methodology: which substeps exist, in what order, and what a
 * complete artifact contains. This plugin owns the enforcement: the check DSL,
 * the depth floors, and the judge. The two used to be kept in step by hand, and
 * they drifted — the plugin carried its own word floors and its own reference
 * paths, so a rename upstream broke review silently and a floor nobody upstream
 * had ever declared was refused as if it were methodology.
 *
 * This script copies the criteria stelow publishes and stamps the stelow commit
 * they came from. `tests/jtbd-contract-coverage.test.mjs` then fails when a
 * criterion upstream has no mechanical check and no judge delegation here.
 *
 *   node scripts/sync-jtbd-contracts.mjs [path-to-stelow-checkout]
 *   STELOW_REPO=/path/to/stelow node scripts/sync-jtbd-contracts.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = resolve(HERE, "..");
const OUT = join(PLUGIN, "lib", "stelow-jtbd-contracts.mjs");
const CONTRACTS = join("skills", "stelow-product-job-to-be-done", "references", "contracts.json");

const candidates = [
  process.argv[2],
  process.env.STELOW_REPO,
  join(PLUGIN, "..", "stelow"),
  join(process.env.HOME ?? "", "repos", "stelow"),
].filter(Boolean);

const repo = candidates.find((candidate) => existsSync(join(candidate, CONTRACTS)));
if (!repo) {
  console.error(
    `sync-jtbd-contracts: no stelow checkout with ${CONTRACTS} found.\n` +
      `Tried:\n  ${candidates.join("\n  ")}\n` +
      `Pass the path as an argument or set STELOW_REPO.`,
  );
  process.exit(1);
}

const commit = execFileSync("git", ["-C", repo, "rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["-C", repo, "status", "--porcelain", "--", CONTRACTS], { encoding: "utf8" }).trim();
const data = JSON.parse(readFileSync(join(repo, CONTRACTS), "utf8"));

// Plain JSON as the literal: pretty-printing is enough, and rewriting keys
// would corrupt criteria text that happens to contain the same word.
const render = (value) => JSON.stringify(value, null, 2);

const source = `/**
 * GENERATED — do not edit. Source: stelow ${commit}${dirty ? " (working tree)" : ""}
 * Regenerate with: node scripts/sync-jtbd-contracts.mjs [path-to-stelow]
 *
 * Only the methodology crosses over: substep slugs, their reference files, and
 * the criteria each one declares. Depth floors and check rules stay in
 * lib/jtbd-contracts.mjs, because they are this host's policy.
 */
export const STELOW_JTBD_CONTRACTS = ${render(data)};
`;

writeFileSync(OUT, source, "utf8");
const criteria = data.substeps.reduce((total, substep) => total + substep.criteria.length, 0);
console.log(
  `sync-jtbd-contracts: ${data.substeps.length} substeps, ${criteria} criteria from stelow ${commit}` +
    `${dirty ? " (working tree, uncommitted)" : ""} -> ${OUT.slice(PLUGIN.length + 1)}`,
);
