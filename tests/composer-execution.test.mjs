import assert from "node:assert/strict";
import {
  sanitizeComposerExecution,
  resolveComposerSpawn,
  composerPresetOverride,
  composerSpawnInput,
} from "../lib/composer-execution.mjs";

// The base preset every assertion merges over: pi/harness-coding, the
// installation default the bug report spawned when acp-opencode was picked.
const base = { provider_id: "pi", model_id: "bifrost/harness-coding", reasoning_level: "medium", permission_mode: "full" };

// Sanitize: garbage in, clean choice out — never a throw, never "".
assert.equal(sanitizeComposerExecution(null), null, "null execution means no choice");
assert.equal(sanitizeComposerExecution("pi"), null, "non-object execution means no choice");
assert.equal(sanitizeComposerExecution({}), null, "empty execution means no choice");
assert.equal(sanitizeComposerExecution({ providerId: "  ", model: "" }), null, "blank strings count as absent");
assert.deepEqual(
  sanitizeComposerExecution({ providerId: "acp-opencode", model: "opencode-go/muse-spark", permissionMode: "workspace-write", serviceTier: "ultra", reasoningLevel: "high" }),
  { providerId: "acp-opencode", model: "opencode-go/muse-spark", reasoningLevel: "high" },
  "unknown permission/service values are dropped, valid fields survive",
);
assert.deepEqual(
  sanitizeComposerExecution({ providerId: "pi", executionInputSources: { providerId: "explicit", model: "bogus" } }),
  { providerId: "pi", executionInputSources: { providerId: "explicit" } },
  "only valid provenance values survive",
);

assert.deepEqual(
  sanitizeComposerExecution({ reasoningLevel: "banana" }),
  null,
  "a reasoning level no host will honour is dropped, not carried to the spawn",
);
assert.deepEqual(
  sanitizeComposerExecution({ providerId: "pi", reasoningLevel: "banana", model: "m" }),
  { providerId: "pi", model: "m" },
  "dropping the level leaves the rest of the choice intact",
);

// Merge: composer wins per-field, the base fills the gaps.
assert.deepEqual(
  resolveComposerSpawn(base, null),
  { providerId: "pi", modelId: "bifrost/harness-coding", reasoningLevel: "medium", permissionMode: "full" },
  "absent execution resolves to the base preset",
);
assert.deepEqual(
  resolveComposerSpawn(base, { model: "bifrost/gpt-5.6-sol" }),
  { providerId: "pi", modelId: "bifrost/gpt-5.6-sol", reasoningLevel: "medium", permissionMode: "full" },
  "a partial choice merges per-field instead of clobbering",
);
assert.deepEqual(
  resolveComposerSpawn({ providerId: "pi", modelId: "m", reasoningLevel: "low", permissionMode: "auto" }, { providerId: "acp-opencode", model: "x", reasoningLevel: "high", permissionMode: "full" }),
  { providerId: "acp-opencode", modelId: "x", reasoningLevel: "high", permissionMode: "full" },
  "camelCase bases merge the same way as preset rows",
);

// Override: null when the choice already matches (no dead card-override
// rows), merged values otherwise — the exact bug report scenario.
assert.equal(composerPresetOverride(base, null), null, "no choice pins nothing");
assert.equal(
  composerPresetOverride(base, { providerId: "pi", model: "bifrost/harness-coding", reasoningLevel: "medium", permissionMode: "full" }),
  null,
  "a choice matching the base preset pins nothing",
);
assert.deepEqual(
  composerPresetOverride(base, { providerId: "acp-opencode", model: "opencode-go/muse-spark", reasoningLevel: "medium", permissionMode: "full" }),
  { providerId: "acp-opencode", modelId: "opencode-go/muse-spark", reasoningLevel: "medium", permissionMode: "full" },
  "the reported mismatch pins the composer's provider/model",
);
assert.deepEqual(
  composerPresetOverride(base, { model: "bifrost/gpt-5.6-sol" }),
  { providerId: "pi", modelId: "bifrost/gpt-5.6-sol", reasoningLevel: "medium", permissionMode: "full" },
  "a model-only change pins the merged row",
);

// Spawn input: composer's values + provenance survive the spawn (the server
// drops a requested providerId/model without provenance); missing
// provenance defaults to explicit, never to an inference.
const spawn = composerSpawnInput(base, {
  providerId: "acp-opencode",
  model: "opencode-go/muse-spark",
  reasoningLevel: "medium",
  permissionMode: "full",
  executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
});
assert.equal(spawn.providerId, "acp-opencode", "spawn carries the composer's provider");
assert.equal(spawn.model, "opencode-go/muse-spark", "spawn carries the composer's model");
assert.deepEqual(
  spawn.executionInputSources,
  { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
  "spawn carries the composer's provenance",
);
assert.ok(!("serviceTier" in spawn), "no serviceTier key without a valid choice");
const tiered = composerSpawnInput(base, { providerId: "pi", serviceTier: "fast", executionInputSources: { serviceTier: "client-preference" } });
assert.equal(tiered.serviceTier, "fast", "a valid serviceTier rides to spawn");
assert.equal(tiered.executionInputSources.serviceTier, "client-preference", "its provenance rides along");
const fallback = composerSpawnInput(base, { providerId: "pi" });
assert.equal(fallback.executionInputSources.providerId, "explicit", "missing provenance defaults to explicit");

console.log("composer execution test ok: sanitize, merge, override, spawn input, all three tracks wired");
