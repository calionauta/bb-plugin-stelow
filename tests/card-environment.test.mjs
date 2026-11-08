import assert from "node:assert/strict";
import { selectCardEnvironment, isManagedWorktreeEnvironment, environmentFallbackNotice } from "../lib/card-environment.mjs";
import { finishCard } from "../server/cards-create-persist.ts";
import { createCardCreator } from "../server/runtime/wiring/card-creator.ts";

// Selection is total and explicit: accepted shapes pass through by
// reference, everything else falls back — and a substituted explicit
// request produces a notice instead of vanishing (the worktree-that-never
// -was shape: asked managed-worktree, worker landed in the checkout).
const fallback = { type: "project-default" };
const worktree = { type: "host", workspace: { type: "managed-worktree", path: "/w" } };
const reuse = { type: "reuse", environmentId: "env_1" };

assert.equal(selectCardEnvironment(worktree, fallback), worktree, "explicit worktree passes by reference");
assert.equal(selectCardEnvironment({ type: "project-default" }, fallback).type, "project-default", "explicit default passes");
assert.equal(selectCardEnvironment(reuse, fallback), reuse, "reuse passes by reference");
assert.deepEqual(
  selectCardEnvironment({ type: "provider", environmentProviderId: "cloud-box", inputs: null }, fallback),
  { type: "provider", environmentProviderId: "cloud-box", inputs: null },
  "provider environments pass through instead of collapsing to the checkout",
);
assert.equal(selectCardEnvironment({ type: "provider" }, fallback), fallback, "provider without id falls back with notice");
assert.match(
  environmentFallbackNotice({ type: "provider" }, fallback) ?? "",
  /asked provider environment \(missing provider id\)/,
  "provider misses name themselves",
);
assert.equal(selectCardEnvironment({ type: "host", workspace: { type: "weird" } }, fallback), fallback, "unknown workspace falls back");
assert.equal(selectCardEnvironment({ type: "host" }, fallback), fallback, "missing workspace falls back");
assert.equal(selectCardEnvironment(null, fallback), fallback, "nothing asked falls back silent");
assert.equal(selectCardEnvironment("worktree", fallback), fallback, "junk falls back");

assert.equal(isManagedWorktreeEnvironment(worktree), true, "worktree detects");
assert.equal(isManagedWorktreeEnvironment(fallback), false, "checkout is not a worktree");
assert.equal(isManagedWorktreeEnvironment(null), false, "junk is not a worktree");

assert.equal(environmentFallbackNotice(null, fallback), null, "nothing asked means no notice");
assert.equal(environmentFallbackNotice(worktree, worktree), null, "honored requests stay silent");
assert.match(
  environmentFallbackNotice(worktree, fallback) ?? "",
  /asked host with managed-worktree workspace, using the project checkout/,
  "substitutions name asked vs used",
);
assert.match(
  environmentFallbackNotice(worktree, fallback) ?? "",
  /restart the worker/,
  "every notice names the redirect",
);
assert.match(
  environmentFallbackNotice({ type: "host", workspace: { type: "weird" } }, fallback) ?? "",
  /asked host with weird workspace/,
  "unrecognized shapes name themselves instead of vanishing",
);
// The one shape no union variant covers must still be diagnosable. It said
// "unknown shape" in the server log, which is true and useless: it did not
// say whether the caller sent an environment record, an empty object, or a
// variant this build has never heard of.
assert.match(
  environmentFallbackNotice({ hostId: "host_x", path: "/p" }, fallback) ?? "",
  /asked a shape carrying hostId, path/,
  "a shape with no type names the keys it carried",
);
assert.match(
  environmentFallbackNotice({}, fallback) ?? "",
  /asked an empty object/,
  "an empty request says so rather than saying nothing",
);

// Wiring: creation surfaces the substitution (log plus card comment),
// shared by build/research/explore through createCardInternal. These were
// source-text pins on card-creator.ts and cards-create-persist.ts; they are
// behavioral now, because a regex passes on a creation path whose comment
// writer was rewired to drop the page.

// The persist path actually pages the card: drive `finishCard` with a
// substituted environment and read what the card comment writer received.
const comments = [];
const warnings = [];
const preset = {
  id: "preset-1",
  provider_id: "pi",
  model_id: "model",
  reasoning_level: "medium",
  permission_mode: "full",
  environment_kind: "project-default",
  base_branch: null,
  machine_id: null,
  instructions: "",
};
const deps = {
  db: {},
  bb: {
    log: { warn: (...args) => warnings.push(args) },
    realtime: { publish: () => {} },
    storage: { kv: { set: async () => {} } },
  },
  now: () => 1,
  randomId: (prefix) => `${prefix}_1`,
  roundTimestamp: () => "stamp",
  seedBuildIntent: async () => "feature",
  seedWorkflow: async () => ({ error: null, dirHash: null, stateDir: null }),
  researchStrategy: () => null,
  exploreStage: () => null,
  researchIds: () => [],
  exploreIds: () => [],
  defaultPreset: () => preset,
  getPreset: () => preset,
  getBandPresetId: () => null,
  getReliablePresetId: () => null,
  createCardOverride: (_cardId, base) => base,
  pinCardPreset: () => true,
  removeCardPreset: () => {},
  presetParams: () => ({
    providerId: "pi",
    modelId: "model",
    reasoningLevel: "medium",
    permissionMode: "full",
    environmentKind: "project-default",
    machineId: null,
    instructions: "",
  }),
  spawnInitial: async () => ({ id: "thr_new" }),
  recordThread: () => {},
  lineage: async () => {},
  roundPath: (stateDir) => stateDir,
  roundFile: () => "round.md",
  ensureParent: async () => {},
  researchPrompt: () => "",
  explorePrompt: () => "",
  rules: {},
  describeManagedWorktree: () => false,
  recordStageEvent: () => {},
  comment: (cardId, body) => comments.push([cardId, body]),
  suggestCardName: async () => {},
};
const track = {
  research: true,
  explore: false,
  researchStrategy: null,
  exploreStage: null,
  intent: "feature",
  reviewGates: [],
  reviewRung: "Auto",
  seed: { error: null, dirHash: null, stateDir: null },
};
await finishCard(
  deps,
  { projectId: "p1", environment: worktree, prompt: "do the work", attachments: [], intent: "feature", reviewMode: [], kind: "research" },
  "card_1",
  { projectId: "p1", rootPath: "/repo", source: { path: "/repo", hostId: "host_a" }, exploratory: false },
  { displayName: "Card", params: deps.presetParams(preset), environment: fallback, roundFile: "round.md", prompt: "do the work" },
  track,
  preset,
  null,
  null,
  1,
);
assert.deepEqual(
  comments,
  [["card_1", environmentFallbackNotice(worktree, fallback)]],
  "a substituted environment is paged as a card comment, not only logged",
);
assert.match(warnings[0]?.[0] ?? "", /card card_1: .*asked host with managed-worktree workspace/, "and logged with the card id");

// The comment writer the card creators hand to `finishCard` is the ledger's,
// so "substitutions page the card" cannot be true of one path and false of
// the other: call the assembled creator's own writer and read the ledger.
const ledgerCalls = [];
const creator = createCardCreator({
  bb: {},
  db: {},
  now: () => 1,
  randomId: () => "id_1",
  presetServer: {},
  workers: {},
  seams: {},
  prompts: {},
  trackCapabilities: {},
  roundRelPath: (stateDir) => stateDir,
  roundFileName: () => "round.md",
  decision: { seedBuildIntent: () => {} },
  ledger: { recordStageEvent: () => {}, logCardComment: (...args) => ledgerCalls.push(args) },
  drafting: { suggestCardName: async () => {} },
});
creator.comment("card_9", "Substituted the environment.");
assert.deepEqual(
  ledgerCalls,
  [["card_9", "card", "card_9", "agent", "Substituted the environment."]],
  "the creator pages the card through the ledger's single comment writer",
);

console.log("card environment test ok: explicit pass-through, honest fallback, creation notice");
