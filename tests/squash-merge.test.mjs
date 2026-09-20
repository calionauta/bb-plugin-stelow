import assert from "node:assert/strict";
import {
  SQUASH_DONE_MARKER,
  SQUASH_EXIT_COMMIT_FAILED,
  SQUASH_EXIT_CONFLICT,
  SQUASH_EXIT_MARKER,
  SQUASH_SHA_MARKER,
  buildSquashScript,
  parseSquashOutput,
  shellQuote,
  squashExitMessage,
} from "../lib/squash-merge.mjs";

// Quoting: a branch name must never break out of its shell word.
assert.equal(shellQuote("feature/card"), "'feature/card'");
assert.equal(shellQuote("o'clock"), "'o'\\''clock'");
assert.throws(() => shellQuote(""), /non-empty/);
assert.throws(() => shellQuote(null), /non-empty/);

// Script shape: squash into base, commit, restore the branch — every path.
const script = buildSquashScript({ base: "main", branch: "feature/card", message: "Squash merge" });
assert.match(script, /git checkout 'main'/, "checks out the base first");
assert.match(script, /git merge --squash 'feature\/card'/, "squashes instead of merging");
assert.match(script, /git merge --abort/, "a conflict aborts instead of stranding mid-merge");
assert.match(script, /git reset --hard HEAD/, "a failed commit resets before restoring");
assert.match(script, /git checkout 'feature\/card' >\/dev\/null/, "the worker branch is restored last");
assert.match(script, new RegExp(`${SQUASH_EXIT_MARKER}:\\$code`), "the verdict marker carries the exit");
assert.match(script, new RegExp(SQUASH_SHA_MARKER), "success reports the new HEAD");
assert.match(script, new RegExp(`${SQUASH_DONE_MARKER}:1`), "completion is marked after the restore");

// Hostile names stay inside their quotes: the injected quote is closed,
// escaped, and reopened, so the `;` never becomes a command separator.
const hostile = buildSquashScript({ base: "main", branch: "x'; rm -rf /; echo '", message: "m" });
assert.match(hostile, /'x'\\''; rm -rf/, "the quote is escaped and the separator stays quoted");

// Empty refs fail fast instead of scripting `git checkout ''`.
assert.throws(() => buildSquashScript({ base: "", branch: "b", message: "m" }), /non-empty/);
assert.throws(() => buildSquashScript({ base: "main", branch: "", message: "m" }), /non-empty/);

// Parsing: success needs the done marker AND exit 0 AND a sha.
assert.deepEqual(parseSquashOutput(`${SQUASH_EXIT_MARKER}:0\n${SQUASH_SHA_MARKER}:abc1234\n${SQUASH_DONE_MARKER}:1`), {
  finished: true,
  exit: 0,
  sha: "abc1234",
});
assert.deepEqual(parseSquashOutput(`${SQUASH_EXIT_MARKER}:${SQUASH_EXIT_CONFLICT}\n${SQUASH_DONE_MARKER}:1`).exit, SQUASH_EXIT_CONFLICT);
assert.deepEqual(parseSquashOutput(`${SQUASH_EXIT_MARKER}:${SQUASH_EXIT_COMMIT_FAILED}\n${SQUASH_DONE_MARKER}:1`).exit, SQUASH_EXIT_COMMIT_FAILED);
// Exit without done means the restore has not run: not finished, never close.
const midFlight = parseSquashOutput(`${SQUASH_EXIT_MARKER}:0\n${SQUASH_SHA_MARKER}:abc1234\n`);
assert.equal(midFlight.finished, false);
assert.equal(midFlight.exit, 0, "the verdict is visible before the restore finishes");
// Done without an exit marker is a broken pipe: never success, never a sha.
const broken = parseSquashOutput(`${SQUASH_DONE_MARKER}:1`);
assert.equal(broken.finished, true);
assert.equal(broken.exit, null);
assert.equal(broken.sha, null);
assert.deepEqual(parseSquashOutput(""), { finished: false, exit: null, sha: null });
assert.deepEqual(parseSquashOutput(null), { finished: false, exit: null, sha: null });

// Verdicts name the branch state and the next step, never a bare code.
assert.match(squashExitMessage(SQUASH_EXIT_CONFLICT, "feature/card", "main"), /aborted and feature\/card restored/);
assert.match(squashExitMessage(SQUASH_EXIT_COMMIT_FAILED, "feature/card", "main"), /reset and feature\/card restored/);
assert.match(squashExitMessage(10, "feature/card", "main"), /could not check out main/);
assert.match(squashExitMessage(null, "feature/card", "main"), /unknown/);

console.log("squash-merge test ok: script shape, quoting, markers, and verdicts");
