import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const batch = readFileSync(join(root, "components", "conversation", "question-batch.tsx"), "utf8");

// Two defects found by looking at a real card, both from the same cause: the
// decision surface pushed the decision itself out of reach.

// 1. The previews on that card were 27-104 characters, and every one sat
// behind a "Preview" disclosure. Clicking revealed two lines that said no
// more than the label beside it: two clicks for less information. A preview
// is the thing that lets a reader judge WITHOUT opening anything, so a short
// one must be visible without a click.
const short = batch.match(/const AUTO_REVEAL_PREVIEW_CHARS = (\d+);/);
assert.ok(short, "the auto-reveal threshold is a named decision, not a magic number in the markup");
assert.ok(
  Number(short[1]) >= 120,
  "the threshold covers the real previews that were being hidden; two lines of prose is under that",
);
assert.match(
  batch,
  /if \(text\.length <= AUTO_REVEAL_PREVIEW_CHARS\) \{[\s\S]{0,600}What this looks like/,
  "a short preview renders inline, labelled, with no click required",
);

// A long preview keeps its disclosure — collapsing a 4000-character brief
// into the page is its own kind of unusable.
assert.match(
  batch,
  /\}[\s\S]{0,400}<details className="group">[\s\S]{0,300}Preview/,
  "a long preview still collapses behind a disclosure",
);

// 2. The staleness notice listed seven file paths before the question, and
// pushed the question off the screen. The reader's first decision is
// whether the change MATTERS; the paths are for auditing which files moved,
// and belong behind a summary.
assert.match(
  batch,
  /\{paths\.length > 0 \? \(\s*<details/,
  "the touched paths collapse behind a disclosure",
);
assert.match(
  batch,
  /\{paths\.length\} file\{paths\.length === 1 \? "" : "s"\} touched/,
  "the collapsed summary still says how many files moved, so nothing is hidden",
);
assert.doesNotMatch(
  batch,
  /touching \$\{staleness\.touchedPaths\.join\(", "\)\}/,
  "the path list no longer runs inline ahead of the question",
);
// The consequence is stated before the evidence. Anchored on the rendered
// markup — the function's doc comment above also says "touched paths", and a
// comment must never satisfy an ordering claim about what a reader sees.
const notice = batch.slice(batch.indexOf("function StalenessNotice"), batch.indexOf("function BatchStepper"));
const noticeBody = notice.slice(notice.indexOf("return ("));
assert.ok(noticeBody.length > 0, "the rendered staleness notice is found");
assert.ok(
  noticeBody.indexOf("Check the linked document before answering") < noticeBody.indexOf("touched"),
  "the reader learns what to DO before the file list is even mentioned",
);

console.log("question decision surface test ok: previews readable at a glance, staleness says what to do first");
