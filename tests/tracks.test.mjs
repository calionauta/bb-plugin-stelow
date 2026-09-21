import assert from "node:assert/strict";
import {
  CARD_KINDS,
  BOARD_MOVE_COLUMNS,
  LIGHTWEIGHT_KINDS,
  LIGHTWEIGHT_COLUMNS,
  LIGHTWEIGHT_COLUMN_LABELS,
  LIGHTWEIGHT_VISIBLE_COLUMNS,
  LIGHTWEIGHT_STATUS_BY_COLUMN,
  bandForKind,
  describeCardEnvironment,
  isLightweightKind,
  isValidKind,
  normalizeKind,
} from "../lib/tracks.mjs";

// The three concepts exist exactly once: build, research, explore.
assert.deepEqual(CARD_KINDS, ["build", "research", "explore"], "card kinds");
assert.deepEqual(LIGHTWEIGHT_KINDS, ["research", "explore"], "lightweight kinds");
// Bucket is the one word for "captured, nothing running yet" on every track
// (the stored key stays "inbox" — only the label changed, so no migration).
assert.deepEqual(LIGHTWEIGHT_COLUMNS, ["inbox", "doing", "done", "archived"], "lightweight columns");
assert.deepEqual(LIGHTWEIGHT_VISIBLE_COLUMNS, ["doing", "done", "archived"], "rendered lightweight boards hide the Bucket too");
assert.equal(LIGHTWEIGHT_COLUMN_LABELS.inbox, "Bucket", "the first column reads Bucket");
assert.equal(LIGHTWEIGHT_COLUMN_LABELS.done, "Done", "column labels");
assert.deepEqual(LIGHTWEIGHT_STATUS_BY_COLUMN, { inbox: "pending", doing: "in-progress", done: "completed", archived: "archived" }, "lightweight move mapping");
assert.deepEqual(BOARD_MOVE_COLUMNS, ["inbox", "analysis", "planning", "execution", "review", "completed", "archived", "doing", "done"], "all manual targets derive from both board catalogs without duplicate Bucket or Archive");

// Membership predicates agree with the catalogs.
assert.equal(isValidKind("build"), true, "build is valid");
assert.equal(isValidKind("research"), true, "research is valid");
assert.equal(isValidKind("explore"), true, "explore is valid");
assert.equal(isLightweightKind("research"), true, "research is lightweight");
assert.equal(isLightweightKind("explore"), true, "explore is lightweight");
assert.equal(isLightweightKind("build"), false, "build is not lightweight");

// One place normalizes a stored kind: an unrecognized value is a build.
assert.equal(normalizeKind("build"), "build", "build stays build");
assert.equal(normalizeKind("bogus"), "build", "unknown falls back to build");

// Worker bands: build runs the analysis band, research and explore each
// have their own — one line to change, never scattered ternaries.
assert.equal(bandForKind("build"), "analysis", "build band");
assert.equal(bandForKind("research"), "research", "research band");
assert.equal(bandForKind("explore"), "explore", "explore band");
assert.equal(bandForKind("bogus"), "analysis", "an unrecognized kind takes the build band");

// Spawn environment in one stored word: the open card reads it instead of
// guessing shared-vs-worktree from paths.
assert.equal(describeCardEnvironment({ exploratory: true }), "exploratory", "exploratory wins");
assert.equal(describeCardEnvironment({ exploratory: false, envType: "project-default" }), "managed", "BB-managed checkout");
assert.equal(describeCardEnvironment({ exploratory: false, envType: "host", workspaceType: "managed-worktree" }), "worktree", "managed worktree");
assert.equal(describeCardEnvironment({ exploratory: false, envType: "host", workspaceType: "unmanaged" }), "shared", "shared project checkout");
assert.equal(describeCardEnvironment({ exploratory: false, envType: "host", workspaceType: "personal" }), "personal", "personal workspace");
assert.equal(describeCardEnvironment({}), "unknown", "missing facts read as unknown, never a guess");

console.log("tracks test ok: kinds, lightweight lifecycle, bands, kind normalization");
