// No tracked file may contain a merge-conflict marker.
//
// This exists because a squash merge shipped one. PR #249 was resolved by hand
// across eight files, three marker lines survived into master in FEATURES.md,
// and every gate stayed green: the document tests assert specific SENTENCES, so
// markers sitting between correct sentences are invisible to them. Nothing in
// the suite asked whether the file was well-formed at all.
//
// The failure mode is not subtle in review — it is invisible in CI, which is
// worse, because a green build is exactly the signal that would have shipped it.
// So the check is here, asks the one question the other gates cannot, and names
// the file and line so the fix is not a hunt.
//
// Scoped to TRACKED files: an untracked scratch file in someone's worktree is
// their business, and a merge in progress legitimately has markers on disk.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function git(...command) {
  const result = spawnSync("git", command, { encoding: "utf8" });
  assert.equal(result.status, 0, `git ${command.join(" ")}\n${result.stderr}`);
  return result.stdout;
}

// `<<<<<<< ` is 7 chars and the separator is 7 bare `=`. The 8th character is
// what separates the real marker from prose: `=======` at the start of a line
// is a markdown heading, and a line of `<<<<<<<` in a fenced code block is
// documentation of a conflict. Anchoring on the trailing space (HEAD has one,
// so does every git-written marker) keeps both out of the count.
const MARKERS = [
  /^<{7} \S/m,
  /^>{7} \S/m,
  /^={7}$/m,
];

const files = git("ls-files", "-z").split("\0").filter(Boolean);
const binaryish = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
  ".woff", ".woff2", ".ttf", ".eot", ".mp3", ".mp4", ".mov", ".wasm",
]);

const offenders = [];
for (const file of files) {
  if (binaryish.has(file.slice(file.lastIndexOf(".")).toLowerCase())) continue;
  let content;
  try {
    content = git("show", `:${file}`);
  } catch {
    continue; // a path git tracks but cannot stage-read is not this test's job
  }
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    if (MARKERS.some((pattern) => pattern.test(line))) {
      offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 60)}`);
    }
  });
}

assert.deepEqual(
  offenders,
  [],
  "a tracked file still carries a merge-conflict marker — resolve it before merging:\n"
    + offenders.join("\n"),
);

// The check is worthless if it cannot see a marker, so prove it on the exact
// shapes it claims to catch. A guard that has never been shown red is a
// comment, and this file exists because a guard once looked green on a broken
// tree.
const samples = [
  ["<<<<<<< HEAD", true],
  [">>>>>>> a492f61 (fix: something)", true],
  ["=======", true],
  ["  =======", false], // indented, so not a marker line
  ["======= not exactly seven", false],
  ["<<<<<<<", false], // no branch name: prose, not a git marker
  ["# ======= heading", false],
];
for (const [line, shouldMatch] of samples) {
  const matched = MARKERS.some((pattern) => pattern.test(line));
  assert.equal(
    matched,
    shouldMatch,
    `marker detection ${shouldMatch ? "missed" : "fired on"} ${JSON.stringify(line)}`,
  );
}

console.log(
  `conflict marker test ok: ${files.length} tracked files carry no unresolved merge marker`,
);