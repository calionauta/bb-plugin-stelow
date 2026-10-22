import assert from "node:assert/strict";
import { TECHNIQUE_CATALOG, techniqueById } from "../lib/technique-catalog.mjs";
import { exploreArtifactFile } from "../lib/research-artifacts.mjs";
import { createTrackPrompts } from "../server/runtime/track-prompts.ts";

const technique = techniqueById("scope-mapping");
assert.ok(technique, "Scope Mapping is available in Explore");
assert.equal(technique.skill, "stelow-product-scope-mapping", "Explore delegates to the product method skill");
assert.equal(technique.primaryArtifact, "explore-scope-map.md", "Explore has one readable primary artifact");
assert.deepEqual(technique.optionalEvidence, ["scope-map.json"], "machine evidence is optional and does not replace Markdown");
assert.ok(TECHNIQUE_CATALOG.some((entry) => entry.id === "scope-mapping"), "Scope Mapping is in the Explore catalog");
// This used to pin the prompt's INLINE fallback as source text, which is how the
// prompt and the seal ended up naming different files and the seal stopped firing
// for Scope Map. The prompt now asks the shared resolver, so this renders the real
// prompt and proves the worker is told to write the same file the checks resolve.
const prompts = createTrackPrompts({
  cardOwnerRules: "OWNER RULES",
  doneProtocol: "DONE",
  reviewProtocol: "REVIEW",
  draftProtocol: "DRAFT",
  userInputContract: "USER INPUT CONTRACT",
});

function renderExplore(entry) {
  return prompts.exploreWorkerPrompt({
    displayName: "Card",
    prompt: "request",
    stage: entry,
    stateDirText: "<state-dir>",
    workspaceRoot: "/workspace",
    instructions: "",
    flavor: "initial",
    previousThreadId: null,
  });
}

for (const entry of TECHNIQUE_CATALOG) {
  const rendered = renderExplore(entry);
  const resolved = exploreArtifactFile(entry.id);
  assert.ok(
    rendered.includes(resolved),
    `${entry.id}: the prompt tells the worker to write ${resolved}, the file the seal and review CLI resolve`,
  );
  if (entry.primaryArtifact && entry.primaryArtifact !== `explore-${entry.id}.md`) {
    assert.ok(
      !rendered.includes(`explore-${entry.id}.md`),
      `${entry.id}: no second copy of the fallback rule — the prompt never names the convention beside the catalog`,
    );
  }
}

// The case that was broken, pinned by its real values through the rendered prompt.
const scopeRendered = renderExplore(technique);
assert.ok(
  scopeRendered.includes("explore-scope-map.md"),
  "the prompt tells the worker to write the catalog's file, so the seal can fire",
);
assert.ok(
  !scopeRendered.includes("explore-scope-mapping.md"),
  "and never restates the convention the resolver exists to override",
);

console.log("explore scope map test ok: catalog, skill, primary artifact, optional evidence, prompt rendering");
