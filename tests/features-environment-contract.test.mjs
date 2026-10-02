import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * FEATURES.md is the plugin's user-facing contract, and nothing in the test
 * tree read it: `git checkout <base> -- FEATURES.md` — reverting a card's
 * entire documentation deliverable — passed the whole suite. These are
 * regression pins for the claims this feature makes about its own limits, so
 * an overstated sentence cannot ship and a corrected one cannot be undone.
 *
 * Narrow on purpose. A `doesNotMatch` is a regression pin for a withdrawn
 * claim; an `assert.match` is a promise the code must keep. Neither is a test
 * of the feature's behaviour — that lives in `preset-environment-seed.test.mjs`
 * and executes the components.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const features = readFileSync(join(root, "FEATURES.md"), "utf8");

// The claim that was FALSE and is now true in the narrower wording: only the
// environment picker is frozen, and the sibling defaults are not. An earlier
// sentence said a mid-dialog save "cannot re-seed over the person's choice",
// which the host's own documented re-seed rule made untrue.
// FEATURES.md wraps its prose, so a phrase can straddle a newline. Collapse
// whitespace before matching: a pin that breaks on a re-wrap is a pin that
// trains people to stop re-wrapping.
const prose = features.replace(/\s+/g, " ");

{
  assert.doesNotMatch(
    prose,
    /cannot re-seed over the person's choice/,
    "the withdrawn blanket guarantee is gone: only the environment picker is frozen, and saying otherwise overstates the code",
  );
  assert.match(
    prose,
    /the \*only\* thing frozen/i,
    "the replacement sentence says which field is protected and, by naming the others, which is not",
  );
  for (const sibling of ["provider", "model", "reasoning level", "permission mode"]) {
    assert.ok(
      prose.includes(sibling),
      `the limit names the sibling seed it does NOT freeze (${sibling}), so the scope is concrete`,
    );
  }
}

// The sibling seeds must appear in the LIMIT sentence itself, not merely
// somewhere in a 130k-character document. This is the pair of words that makes
// the limit concrete rather than a vague disclaimer.
{
  const limit = prose.slice(
    prose.indexOf("Two known limits"),
    prose.indexOf("Two known limits") + 700,
  );
  assert.ok(limit.length > 0, "the preset entry still states its known limits");
  for (const sibling of ["provider", "model", "reasoning level", "permission mode"]) {
    assert.ok(
      limit.includes(sibling),
      `the limit names the sibling seed it does NOT freeze (${sibling}), so the scope is concrete`,
    );
  }
}

// The silent substitution on a personal/exploratory project: real, and named
// rather than hidden. A future edit that drops the honesty loses the sentence.
assert.match(
  prose,
  /\*\*silent\*\*|\bsilent\b/i,
  "the personal/exploratory substitution is still disclosed, not quietly removed",
);

// The authoring control exists and the built-in is protected. These are the two
// sentences a reader uses to know whether they may touch the toggle at all.
assert.match(
  prose,
  /protected/i,
  "FEATURES.md still states that built-in presets are protected from the kind change",
);

// The preset's kind is the composer's default and the person can still change
// it — the two halves of the feature's actual intent, in the reader's words.
assert.match(
  prose,
  /prefill|seed/i,
  "FEATURES.md still documents that a preset's kind seeds card creation",
);
assert.match(
  prose,
  /change it|still change/i,
  "and that the seeded value is overridable rather than forced",
);

console.log(
  "features environment contract ok: the frozen-picker limit is stated at the "
  + "width the code keeps, the silent substitution stays disclosed, and the "
  + "authoring control's two promises are both still documented",
);
