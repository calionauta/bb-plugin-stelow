import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TECHNIQUE_CATALOG, techniqueById } from "../lib/stage-catalog.mjs";
import { exploreArtifactFile } from "../lib/research-artifacts.mjs";

/**
 * The Explore deliverable's filename is stated once, in the catalog, and read
 * in four places: the prompt that tells the worker what to write, the card's
 * declared capability, the review CLI's subject, and the quality seal.
 *
 * It used to be resolved twice — the prompt honoured `primaryArtifact`, the
 * other three assumed `explore-<id>.md`. For `scope-mapping`, which declares
 * `explore-scope-map.md`, the worker wrote that name and the seal looked for
 * `explore-scope-mapping.md`, never matched, and returned no verdict. The
 * quality seal for that technique was silently dead, and declaring a
 * `primaryArtifact` was what killed it.
 *
 * So the invariant is not "scope-mapping has a primary artifact" — it is that
 * no technique can declare one and quietly switch its own checks off.
 */

const promptFile = (entry) => entry.primaryArtifact ?? `explore-${entry.id}.md`;

for (const entry of TECHNIQUE_CATALOG) {
  assert.equal(
    exploreArtifactFile(entry.id),
    promptFile(entry),
    `${entry.id}: the seal and the prompt must name the same file, or the seal never fires`,
  );
}

// The case that was broken, pinned by its real values.
assert.equal(
  techniqueById("scope-mapping").primaryArtifact,
  "explore-scope-map.md",
  "Scope Mapping still ships under its own name — this fix does not rename it away",
);
assert.equal(
  exploreArtifactFile("scope-mapping"),
  "explore-scope-map.md",
  "and every check now reads that same name, which is what the worker is told to write",
);

// An unknown stage still gets the convention, so a technique that is not in the
// catalog cannot make the resolver throw or return something unmatchable.
assert.equal(exploreArtifactFile("not-a-technique"), "explore-not-a-technique.md", "an unknown stage falls back to the convention");
assert.equal(exploreArtifactFile(""), "explore-.md", "an empty stage still yields a filename rather than throwing");
assert.equal(exploreArtifactFile(undefined), "explore-undefined.md", "a missing stage is handled, not thrown on");

// The prompt must resolve through the shared function, not restate the rule —
// restating it is exactly how the two drifted apart.
const prompts = readFileSync(new URL("../server/runtime/track-prompts.ts", import.meta.url), "utf8");
assert.match(
  prompts,
  /const primaryArtifact = exploreArtifactFile\(stage\.id\);/,
  "the prompt asks the same resolver the seal asks, so they cannot disagree",
);
assert.doesNotMatch(
  prompts,
  /stage\.primaryArtifact \?\?/,
  "no second copy of the fallback rule — one definition, or the next drift is a matter of time",
);

console.log("explore artifact filename test ok: one filename, stated once, read by the prompt and every check");
