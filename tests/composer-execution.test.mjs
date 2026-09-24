import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

// Contracts: the choice must travel composer -> RPC -> spawn on every
// track, through one shared helper per layer — never pasted per site.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = [
  readFileSync(join(root, "server.ts"), "utf8"),
  readFileSync(join(root, "server/workers.ts"), "utf8"),
].join("\n");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const composerHelper = readFileSync(join(root, "components", "creation", "composer-execution.ts"), "utf8");
const buildDialog = readFileSync(join(root, "components", "creation", "create-build-dialog.tsx"), "utf8");
const exploreDialog = readFileSync(join(root, "components", "creation", "create-explore-dialog.tsx"), "utf8");
const researchDialog = readFileSync(join(root, "components", "creation", "create-research-dialog.tsx"), "utf8");

assert.match(server, /composerExecutionSchema/, "the RPC contract names the shared execution schema");
for (const method of ["createCard", "createResearchCard", "createExploreCard"]) {
  const at = server.indexOf(`${method}: {`);
  assert.ok(at >= 0, `the ${method} RPC exists`);
  const window = server.slice(at, server.indexOf("},", at) + 2);
  assert.ok(window.includes("execution"), `the ${method} input carries the composer execution`);
}
assert.match(server, /composerPresetOverride\(/, "creation resolves the override through the shared helper");
assert.match(server, /composerSpawnInput\(/, "the spawn carries the shared spawn input");
assert.equal((server.match(/executionInputSources: \{ providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" \}/g) ?? []).length, 5, "only restart/reseed/review/draft/gate-pre-review keep the hardcoded preset-explicit sources; the initial spawn forwards the composer's");
assert.match(server, /card-override-\$\{cardId\}/, "a divergent choice pins a card-override row");
assert.match(server, /INSERT OR REPLACE INTO card_presets \(card_id, preset_id, assigned_at\) VALUES \(\?, \?, \?\)/, "the override is pinned through card_presets");

// Ordering: card_presets references cards, so the pin must land after the
// card row exists — and a spawn failure must not orphan the staged row.
const createAt = server.indexOf("async function createCardInternal");
assert.ok(createAt >= 0, "createCardInternal exists");
const createWindow = server.slice(createAt, server.indexOf("type CardRow"));
const cardsInsertAt = createWindow.indexOf("INSERT INTO cards (");
const pinAt = createWindow.indexOf("pinnedOverrideId, ts");
assert.ok(cardsInsertAt >= 0 && pinAt >= 0 && cardsInsertAt < pinAt, "the override pin lands after the card row");
assert.ok(createWindow.includes("DELETE FROM presets WHERE id = ?"), "a failed spawn cleans the staged override row");

assert.match(composerHelper, /export function composerExecutionOf\(/, "the creation module extracts the composer choice through one helper");
assert.equal((app.match(/composerExecutionOf\(request\)/g) ?? []).length, 0, "no submit left in the panel forwards inline");
assert.equal((buildDialog.match(/composerExecutionOf\(request\)/g) ?? []).length, 1, "the build submit forwards the choice");
assert.equal((researchDialog.match(/composerExecutionOf\(request\)/g) ?? []).length, 1, "the research submit forwards the choice");
assert.equal((exploreDialog.match(/composerExecutionOf\(request\)/g) ?? []).length, 1, "the explore submit forwards the choice");
assert.ok(!app.includes('rpc.call("createCard", { projectId: targetProjectId, environment: request.environment, prompt, attachments, intent, appetite, reviewMode })'), "the build submit no longer drops the choice");
assert.match(buildDialog, /execution: composerExecutionOf\(request\)/, "the build submit carries the composer choice");

console.log("composer execution test ok: sanitize, merge, override, spawn input, all three tracks wired");
