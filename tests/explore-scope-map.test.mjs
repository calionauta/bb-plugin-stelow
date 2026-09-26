import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TECHNIQUE_CATALOG, techniqueById } from "../lib/stage-catalog.mjs";

const technique = techniqueById("scope-mapping");
assert.ok(technique, "Scope Mapping is available in Explore");
assert.equal(technique.skill, "stelow-product-scope-mapping", "Explore delegates to the product method skill");
assert.equal(technique.primaryArtifact, "explore-scope-map.md", "Explore has one readable primary artifact");
assert.deepEqual(technique.optionalEvidence, ["scope-map.json"], "machine evidence is optional and does not replace Markdown");
assert.ok(TECHNIQUE_CATALOG.some((entry) => entry.id === "scope-mapping"), "Scope Mapping is in the Explore catalog");
const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
assert.match(server, /stage\.primaryArtifact \?\? `explore-\$\{stage\.id\}\.md`/, "Explore prompt uses the declared primary artifact");
assert.match(server, /primaryArtifact/, "Explore prompt preserves the catalog artifact contract");

console.log("explore scope map test ok: catalog, skill, primary artifact, optional evidence, prompt wiring");
