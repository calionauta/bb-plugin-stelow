#!/usr/bin/env node
/**
 * Refuse a release that claims a major version on a pre-1.0 line.
 *
 * Wired into the release workflow after release-please, in the same job, so it
 * observes the release pull request the action just opened or updated. The
 * decision lives in lib/release-major-claim.mjs so it is testable without a
 * network; this script only gathers the two inputs.
 *
 * Why a guard and not a config file: this workflow passes `release-type` on the
 * action, and release-please then builds its strategy with `Manifest.fromConfig`
 * — a code path that never reads `release-please-config.json`. A
 * `bump-minor-pre-major` set in a config file would be silently ignored, so the
 * honest options are to restructure the workflow into manifest mode or to
 * refuse the claim. Restructuring is a larger change than the problem, and it
 * would cost the `release-as` input (the action only forwards it on the
 * fromConfig path), which is the documented remedy for exactly this.
 *
 * Proposed versions are read from open release pull request titles, the same
 * place `check-release-published.mjs` reads them, so the two guards agree on
 * what "the version being proposed" means.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyMajorClaim, describeMajorClaim } from "../lib/release-major-claim.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Versions proposed by open release pull requests, from their titles. */
function openReleaseVersions() {
  try {
    return execFileSync("gh", ["pr", "list", "--state", "open", "--limit", "50", "--json", "title", "-q", ".[].title"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    })
      .split("\n")
      .map((line) => line.match(/release (\d+\.\d+\.\d+(?:-[\w.]+)?)/)?.[1])
      .filter(Boolean);
  } catch {
    return null;
  }
}

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const openVersions = openReleaseVersions();

if (openVersions === null) {
  console.log("release-major-claim skipped: cannot list open pull requests, so no proposed version can be read");
  process.exit(0);
}

const result = classifyMajorClaim({ version, openReleaseVersions: openVersions });
console.log(`${describeMajorClaim(result)} (master at ${version})`);

if (result.state === "major-claim") {
  console.error("");
  console.error(`::error::${result.reason}`);
  console.error("");
  console.error(result.remedy);
  process.exit(1);
}
