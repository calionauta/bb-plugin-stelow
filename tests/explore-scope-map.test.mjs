import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TECHNIQUE_CATALOG, techniqueById } from "../lib/stage-catalog.mjs";

const technique = techniqueById("scope-mapping");
assert.ok(technique, "Scope Mapping is available in Explore");
assert.equal(technique.skill, "stelow-product-scope-mapping", "Explore delegates to the product method skill");
assert.equal(technique.primaryArtifact, "explore-scope-map.md", "Explore has one readable primary artifact");
assert.deepEqual(technique.optionalEvidence, ["scope-map.json"], "machine evidence is optional and does not replace Markdown");
assert.ok(TECHNIQUE_CATALOG.some((entry) => entry.id === "scope-mapping"), "Scope Mapping is in the Explore catalog");
// This used to pin the prompt's INLINE fallback, which is how the prompt and
// the seal ended up naming different files and the seal stopped firing for
// Scope Map. The prompt now asks the shared resolver, so that is what this
// pins; the resolver's behaviour is covered in explore-artifact-filename.
const prompts = readFileSync(new URL("../server/runtime/track-prompts.ts", import.meta.url), "utf8");
assert.match(
  prompts,
  /const primaryArtifact = exploreArtifactFile\(stage\.id\);/,
  "Explore prompt asks the shared resolver, so it cannot name a different file than the seal",
);
assert.match(prompts, /primaryArtifact/, "Explore prompt still carries the catalog artifact contract into the worker instruction");

console.log("explore scope map test ok: catalog, skill, primary artifact, optional evidence, prompt wiring");
