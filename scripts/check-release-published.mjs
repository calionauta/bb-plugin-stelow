#!/usr/bin/env node
/**
 * Fail loudly when master carries a version that was never published.
 *
 * Wired into the release workflow after release-please, in the same job, so it
 * observes exactly what the action just did. Every ordinary push is `released`
 * (master still sits at the published version, because the bump only lands with
 * the release PR) and an in-flight release PR is `pending`; only a merged bump
 * with no tag and no open release pull request is `unpublished`, and that is
 * the state that silently strands installs.
 *
 * The published tag is read from GitHub, not from the local clone. The clone is
 * checked out before release-please runs, so its tags cannot contain the tag
 * the action is about to push — checking them there reported v0.57.1 as
 * unpublished seconds after it had been published, and would have blocked a
 * legitimate release. The local tags remain a fallback for a checkout with no
 * `gh`.
 *
 * The decision itself lives in lib/release-published.mjs so it is testable
 * without a network.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compareReleaseTags, parseReleaseTag } from "../lib/github-release.mjs";
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

function gh(args) {
  return run("gh", args);
}

/** owner/repo, from the origin URL. */
function repoSlug() {
  const url = run("git", ["remote", "get-url", "origin"]).trim();
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) throw new Error(`cannot read owner/repo from origin: ${url}`);
  return `${match[1]}/${match[2]}`;
}

/**
 * Newest published tag, as GitHub knows it. Returns the tag and where it came
 * from, so a fallback is visible in the log rather than silent.
 */
function latestPublishedTag() {
  try {
    const stdout = gh(["api", `repos/${repoSlug()}/releases`, "--paginate", "-q", ".[].tag_name"]);
    const tags = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && parseReleaseTag(line));
    if (tags.length === 0) return { tag: null, source: "GitHub releases (none yet)" };
    const newest = tags.reduce((best, candidate) =>
      compareReleaseTags(candidate, best) > 0 ? candidate : best,
    );
    return { tag: newest, source: "GitHub releases" };
  } catch {
    // No `gh`, no auth, or offline: fall back to the tags this clone knows.
    const tags = run("git", ["tag", "--merged", "HEAD", "--sort=-v:refname", "--list", "v*"])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && parseReleaseTag(line));
    return { tag: tags[0] ?? null, source: "local tags (gh unavailable, may be stale)" };
  }
}

/** Versions with an open release pull request, from their titles. */
function openReleaseVersions() {
  try {
    return gh(["pr", "list", "--state", "open", "--limit", "50", "--json", "title", "-q", ".[].title"])
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
  console.log(
    "release-published skipped: cannot list open pull requests, so an unpublished bump cannot be told from one in flight",
  );
  process.exit(0);
}

const { tag: latestTag, source } = latestPublishedTag();
const result = classifyReleaseState({ version, latestTag, openReleaseVersions: openVersions });
console.log(`${describeReleaseState(result)} (newest tag from ${source})`);

if (result.state === "unpublished") {
  console.error("");
  console.error(`::error::${result.reason}`);
  console.error(
    "Create the tag and the GitHub release from master's CHANGELOG entry, then re-run this workflow to confirm the baseline recovered.",
  );
  process.exit(1);
}
