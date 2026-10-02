// The strategy's `contract_truth` BLOCK gate, which had no executor.
//
// Condition (plans/testing-strategy.md): "FEATURES.md or a pinned copy string
// still describes the pre-control product". Action: BLOCK.
//
// It read as implemented and was not: `grep -rl contract_truth tests/` returned
// nothing, so a full `git checkout <base> -- FEATURES.md` — reverting the card's
// entire documentation deliverable — passed every gate in the suite. A gate that
// has never run is a sentence, and this one sat in the strategy as though the
// suite had it.
//
// A pinned string is named explicitly rather than parsed out of prose, because
// the failure being guarded is a DOCUMENT describing behaviour the code no
// longer has — which is a fact about text, not about a runtime value. Each
// entry is a sentence that was true before the control existed and false after.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const features = readFileSync(join(root, "FEATURES.md"), "utf8");

/**
 * Sentences describing the pre-control product. Each was true before the
 * environment control existed and is false after it, so FEATURES.md carrying
 * one means the document and the code have parted company — the exact
 * condition the strategy blocks on.
 */
const preControlClaims = [
  {
    claim: "a preset saved mid-dialog cannot re-seed over the person's choice",
    why: "only the environment picker is frozen; the host re-seeds every default* prop, and provider/model/reasoning level/permission mode are still read live",
  },
  {
    claim: "Needs a New-worktree preset in Agent Presets",
    why: "Agent Presets is where that preset is created, so the sentence told the reader to do the thing they were already doing",
  },
  {
    claim: "A control labelled \"Project checkout vs Worktree\" over the raw enum",
    why: "the pair is deliberately not built — the two words mean opposite things "
      + "in Stelow and in bb, so a labelled pair would promise a checkout the card does not get",
  },
];

/**
 * Whitespace-collapsed so a claim cannot slip through by being re-wrapped, and
 * lowercased so the check is about the sentence rather than its capitalisation.
 * A guard that breaks when someone re-wraps a paragraph trains people to stop
 * editing, which is the opposite of what it is for.
 */
const prose = features.replace(/\s+/g, " ").toLowerCase();

const survived = preControlClaims
  .filter(({ claim }) => prose.includes(claim.toLowerCase()))
  .map(({ claim, why }) => `  "${claim}" — ${why}`);

assert.deepEqual(
  survived,
  [],
  "FEATURES.md still describes the pre-control product; the contract_truth gate "
    + "blocks on exactly this:\n" + survived.join("\n"),
);

// The gate must also be able to say the other thing. If it only ever passes,
// it cannot fail — and a gate proven only by its happy path is how this one
// spent its life unwritten. The same matcher, run against a document that
// carries every claim, has to block.
for (const { claim } of preControlClaims) {
  const planted = `FEATURES.md prose.\n${claim}\n`;
  const matches = preControlClaims.filter((c) =>
    planted.replace(/\s+/g, " ").toLowerCase().includes(c.claim.toLowerCase()),
  );
  assert.ok(
    matches.length > 0,
    `the matcher fails to find a planted claim (${JSON.stringify(claim.slice(0, 40))}), `
      + "so this gate could never have blocked anything",
  );
}

// And the width the document now holds is the width the code keeps. Guarding
// only the withdrawn sentences would let the document drift back to promising
// nothing about the frozen picker, which is the overstatement this card was
// corrected for in the first place.
assert.match(
  prose,
  /the picker freezing is the \*only\* thing frozen/,
  "the document still states which single field is frozen; without it a future "
    + "edit could drop the limit and the withdrawn-claim check would still pass",
);

console.log(
  "contract truth gate ok: FEATURES.md describes the control the code ships, "
  + `and all ${preControlClaims.length} pre-control claims still block`,
);