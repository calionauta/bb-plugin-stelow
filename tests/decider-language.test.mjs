import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Decider language, pinned on source text — not on worker compliance.
//
// card_g89gtmwt asked a Build context question that read like a recon log:
// no recommendation, a three-sentence Context dump ("11 bundles, 0
// parseable rows"), and the methodology brand in the template it was
// quoted from. No unit test can force a worker to write well, but the
// surfaces a question can quote from can be kept quotable: templates and
// worker prompts without the brand, and the short/plain/no-internals rule
// stated where every spawn path renders it.
//
// Boundary, documented: the end user reads Build questions, the Build card
// UI, and whatever workers quote from the Build playbook. Skill-name
// references (stelow-workflow-shape-up), standalone track prompts, the
// Explore technique picker, and methodology docs keep the method's name —
// renaming those is a migration (ids, artifacts, sync pins), not a wording
// fix. This pins the user-facing Build surfaces only.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const surfaces = [
  "skills/stelow-workflow-orchestrator/stages/ask-patterns.md",
  "skills/stelow-workflow-orchestrator/stages/interface-selection.md",
  "skills/stelow-workflow-orchestrator/stages/setup.md",
  "skills/stelow-workflow-orchestrator/stages/context.md",
  "skills/stelow-workflow-orchestrator/stages/selection.md",
  "skills/stelow-workflow-orchestrator/references/strategic-exploration.md",
  "skills/stelow-workflow-orchestrator/references/cli-tools/stage-status.md",
  "server/runtime/plugin-protocols.ts",
  "lib/question-presentation.mjs",
];

function walk(dir, base) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full.slice(base.length + 1));
  }
  return out;
}
for (const file of walk(join(root, "components"), root)) surfaces.push(file);

for (const file of surfaces) {
  const text = readFileSync(join(root, file), "utf8");
  assert.ok(
    !/\bshape up\b/i.test(text),
    `${file} names the methodology brand where the end user reads — use stelow concepts (shaping)`,
  );
  assert.ok(
    !/shape-up/i.test(text),
    `${file} carries the hyphenated brand where the end user reads`,
  );
}

// The general rule exists where workers are told how to ask, and the
// spawn-prompt sentence is pinned by equality in prompt-path-contract —
// here only that the playbook states it.
const patterns = readFileSync(
  join(root, "skills/stelow-workflow-orchestrator/stages/ask-patterns.md"),
  "utf8",
);
assert.match(patterns, /Write for the decider, not the log/, "the general rule is stated in the question playbook");
assert.match(patterns, /methodology brand names/, "the rule names the brand ban explicitly");
assert.match(patterns, /two sentences max/, "Pattern 1 bounds its context instead of inviting a dump");
assert.match(
  patterns,
  /Recommendation: \[approach\(es\)/,
  "Pattern 1 requires a recommendation instead of an unranked menu",
);
assert.match(
  patterns,
  /label: "Shaping \(Recommended\)"/,
  "the setup stage option carries the stelow concept, not the brand",
);

console.log(`decider language ok: ${surfaces.length} user-facing surfaces brand-free, playbook rules stated`);
