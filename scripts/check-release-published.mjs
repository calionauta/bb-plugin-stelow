#!/usr/bin/env node
/**
 * Fail loudly when master carries a version that was never published.
 *
 * Wired into the release workflow after release-please, in the same job, so it
 * observes exactly what the action just did. Every ordinary push is `released`
 * (master still sits at the published version, because the bump only lands with
 * the release PR) and an in-flight release PR is `pending`; only a merged bump
 * with no tag and nothing open is `unpublished`, and that is the state that
 * silently strands installs.
 *
 * Facts are read from the local clone and `gh`; the decision itself lives in
 * lib/release-published.mjs so it is testable without a network.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReleaseTag } from "../lib/github-release.mjs";
import { classifyReleaseState, describeReleaseState } from "../lib/release-published.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  });
}

/** Newest published tag reachable from master, or null when there is none. */
function latestPublishedTag() {
  const tags = run("git", ["tag", "--merged", "HEAD", "--sort=-v:refname", "--list", "v*"])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && parseReleaseTag(line));
  return tags[0] ?? null;
}

/** Versions with an open release pull request, from their titles. */
function openReleaseVersions() {
  let stdout;
  try {
    stdout = run("gh", ["pr", "list", "--state", "open", "--limit", "50", "--json", "title", "-q", ".[].title"]);
  } catch {
    // No `gh`, no auth, or offline: report nothing rather than guess. The
    // consequence is a possible false positive, never a silent pass.
    return null;
  }
  return stdout
    .split("\n")
    .map((line) => line.match(/release (\d+\.\d+\.\d+(?:-[\w.]+)?)/)?.[1])
    .filter(Boolean);
}

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const openVersions = openReleaseVersions();

if (openVersions === null) {
  console.log("release-published skipped: cannot list open pull requests, so an unpublished bump cannot be distinguished from one in flight");
  process.exit(0);
}

const result = classifyReleaseState({ version, latestTag: latestPublishedTag(), openReleaseVersions: openVersions });
console.log(describeReleaseState(result));

if (result.state === "unpublished") {
  console.error("");
  console.error(`::error::${result.reason}`);
  console.error("Create the tag and the GitHub release from master's CHANGELOG entry, then re-run this workflow to confirm the baseline recovered.");
  process.exit(1);
}
