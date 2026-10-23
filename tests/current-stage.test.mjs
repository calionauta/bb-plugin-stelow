import assert from "node:assert/strict";

import { parseCurrentStage } from "../lib/current-stage.mjs";

/**
 * One reader for the stage, and the reason it exists.
 *
 * Seven sites derived this fact with their own regex; four were unanchored
 * (`/current_stage:\s*(\S+)/` without `^`). On a state file with a mention
 * anywhere above the field, an unanchored match returns the mention. Every
 * assertion below is one of those shapes: each fails if the anchor is dropped.
 */

// The bug, exactly: a comment above the field that names it.
const WITH_MENTION = [
  "# note: the previous current_stage: audit was reverted",
  "---",
  "name: card",
  "current_stage: triage",
  "artifacts: []",
].join("\n");
assert.equal(parseCurrentStage(WITH_MENTION), "triage", "a mention above the field is not the field");
assert.equal(
  WITH_MENTION.match(/current_stage:\s*(\S+)/)?.[1],
  "audit",
  "and the unanchored pattern the host used returns the mention — that is the defect",
);

assert.equal(parseCurrentStage("---\ncurrent_stage: build\n---"), "build", "a plain field parses");
assert.equal(
  parseCurrentStage('---\ncurrent_stage: "build"\n---'),
  "build",
  "a quoted value unquotes",
);
assert.equal(
  parseCurrentStage("---\ncurrent_stage: build  # reviewer moved it\n---"),
  "build",
  "a trailing comment is tolerated",
);
assert.equal(parseCurrentStage("---\ncurrent_stage: |\n---"), "|", "junk still parses as junk, not as null");
assert.equal(parseCurrentStage("---\nname: card\n---"), null, "a state without the field yields null");
assert.equal(parseCurrentStage("  current_stage: indented"), null, "an indented key is not the frontmatter key");
assert.equal(parseCurrentStage(null), null, "null yields null");
assert.equal(parseCurrentStage(undefined), null, "undefined yields null");

console.log("current stage reader ok: one anchor, mentions never win");
