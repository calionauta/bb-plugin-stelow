import assert from "node:assert/strict";
import { TECHNIQUE_CATALOG, techniqueById } from "../lib/technique-catalog.mjs";
import { exploreArtifactFile } from "../lib/research-artifacts.mjs";
import { createTrackPrompts } from "../server/runtime/track-prompts.ts";

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
 *
 * The prompt half is driven through the real builder and asserted on the string
 * it returns, not on the source that produces it: a prompt that names the wrong
 * file is caught here whatever the code says, and a comment cannot satisfy it.
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
// restating it is exactly how the two drifted apart. Driven through the real
// builder: the filename the worker is told to write is read back out of the
// prompt string the builder returns.
const prompts = createTrackPrompts({
  cardOwnerRules: "owner rules",
  doneProtocol: "done protocol",
  reviewProtocol: "review protocol",
  draftProtocol: "draft protocol",
  userInputContract: "user input contract",
});

function explorePrompt(stage) {
  return prompts.exploreWorkerPrompt({
    displayName: stage.label,
    prompt: "do the thing",
    stage,
    stateDirText: "/s",
    workspaceRoot: "/w",
    instructions: "",
    flavor: "initial",
    previousThreadId: null,
  });
}

for (const entry of TECHNIQUE_CATALOG) {
  const prompt = explorePrompt(entry);
  assert.ok(
    prompt.includes(exploreArtifactFile(entry.id)),
    `${entry.id}: the prompt asks the same resolver the seal asks, so they cannot disagree`,
  );
}

// The prompt reads the file from the CATALOG entry for the stage id, never from
// the stage object it was handed. This is the old bug's shape and the thing the
// deleted source pin existed for: a prompt that honoured a second
// `primaryArtifact` rule would name the value on this object, while the seal
// (which resolves the id) named the catalog's — the same file, two sources.
const mismatched = { ...techniqueById("scope-mapping"), primaryArtifact: "some-other-name.md" };
const mismatchedPrompt = explorePrompt(mismatched);
assert.ok(
  mismatchedPrompt.includes("explore-scope-map.md"),
  "the prompt names the catalog's file, whatever the stage object says",
);
assert.ok(
  !mismatchedPrompt.includes("some-other-name.md"),
  "no second copy of the fallback rule — one definition, or the next drift is a matter of time",
);

console.log("explore artifact filename test ok: one filename, stated once, read by the prompt and every check");
