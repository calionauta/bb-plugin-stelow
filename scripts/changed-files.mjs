/**
 * Which files a gate should read: what changed since a base, plus what is new
 * and untracked.
 *
 * The porcelain slice is the subtle part. `git status --porcelain` prefixes each
 * line with a two-character status code and a space, so `line.slice(3)` yields
 * the path — for EVERY code, not just `??`. Reading all of them admits deletions
 * and renames into the file list, and a gate that then opens those paths dies
 * with ENOENT on a file that was removed in the working tree. That is not a
 * cosmetic failure: deleting a file inside a branch is ordinary work, and the
 * shape and budget gates both stopped being runnable while it was in progress.
 *
 * A file that does not exist has no lines to measure and no debt to report, so
 * untracked here means exactly `??`. The tracked half already filters to
 * A/C/M/R/T, which excludes D for the same reason.
 */
import { execFileSync } from "node:child_process";

function git(...command) {
  return execFileSync("git", command, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** Files added, modified, renamed or type-changed since `base`. */
export function trackedSince(base) {
  return git("diff", "--name-only", "--diff-filter=ACMRT", base, "--")
    .trim()
    .split("\n")
    .filter(Boolean);
}

/** Files git does not track yet. `??` and nothing else. */
export function untrackedFiles() {
  return git("status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3))
    .filter((file) => file && !file.includes(" -> "));
}

/**
 * Both halves, deduplicated. Callers filter to the source extensions they own;
 * this only decides WHICH paths exist to be filtered.
 */
export function changedFiles(base) {
  return [...new Set([...trackedSince(base), ...untrackedFiles()])];
}
