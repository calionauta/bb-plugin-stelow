import assert from "node:assert/strict";
import { createBandRouter } from "../server/execution-advance-dispatch.ts";
import { createTierShadow } from "../server/decision-tier.ts";

function tierCtx({ mode = "rules", answers = null, usable = true, callImpl = null } = {}) {
  const logs = [];
  const calls = [];
  return {
    ctx: {
      bb: { log: { info: (message) => logs.push(message), warn: () => undefined } },
      route: { callRoute: () => ({ usable, provider: "simplejev", endpoint: "https://x.test", apiKey: "", model: "m" }) },
      pointRow: () => ({ mode, thresholds: JSON.stringify({ routeAt: 0.7 }) }),
      parsedThresholds: () => ({ routeAt: 0.7 }),
      evaluateCall: callImpl ?? (async (input) => { calls.push(input); return { ok: true, answers }; }),
    },
    logs,
    calls,
  };
}

const card = { id: "card-tier", kind: "build", intent: "feature" };

// Rules default: no call, no log, null.
{
  const { ctx, logs, calls } = tierCtx();
  assert.equal(await createTierShadow(ctx).suggestTierShadow(card, "planning"), null);
  assert.equal(calls.length, 0, "rules mode never calls out");
  assert.equal(logs.length, 0, "rules mode logs nothing");
}

// Agreement and disagreement both record; disagreement says so.
for (const [choice, hint, agreement] of [["best", "planning", true], ["economy", "planning", false]]) {
  const { ctx, logs } = tierCtx({
    mode: "api",
    answers: { tier: { type: "choice", choice, confidence: 0.9 } },
  });
  const suggestion = await createTierShadow(ctx).suggestTierShadow(card, hint === "planning" ? "planning" : hint);
  assert.ok(suggestion, "confident choice records");
  assert.equal(suggestion.agreement, agreement, `agreement is ${agreement} for ${choice}`);
  assert.equal(logs.length, 1, "one server-log line per recorded suggestion");
  if (!agreement) assert.match(logs[0], /DISAGREE/, "disagreements are greppable");
}

// Low confidence, unusable route, failed call, unknown stage: all null, no throw.
for (const setup of [
  tierCtx({ mode: "api", answers: { tier: { type: "choice", choice: "best", confidence: 0.2 } } }),
  tierCtx({ mode: "api", usable: false }),
  tierCtx({ mode: "api", callImpl: async () => ({ ok: false, error: "down" }) }),
  tierCtx({ mode: "preset" }),
]) {
  assert.equal(await createTierShadow(setup.ctx).suggestTierShadow(card, "planning"), null);
  assert.equal(setup.logs.length, 0, "silent when there is nothing to record");
}
{
  const { ctx } = tierCtx({ mode: "api" });
  assert.equal(await createTierShadow(ctx).suggestTierShadow(card, "no-such-stage"), null, "unknown stage has no hint to review");
}

// applyBand: shadow fires on a real swap only, never changes the swap,
// and a throwing shadow never breaks the respawn.
{
  const seen = [];
  const router = createBandRouter({
    getReliablePreset: () => ({ id: "preset-next" }),
    getCardPresetId: () => "preset-now",
    respawn: async () => seen.push("respawn"),
    scheduleRespawn: () => seen.push("scheduled"),
    suggestTier: async (advCard, stage) => { seen.push(`shadow:${stage}`); return null; },
  });
  await router.applyBand({ ...card, worker_preset_id: null }, "planning", false);
  assert.deepEqual(seen, ["respawn", "shadow:planning"], "swap happens, then shadow observes");
}
{
  const seen = [];
  const router = createBandRouter({
    getReliablePreset: () => ({ id: "preset-same" }),
    getCardPresetId: () => "preset-same",
    respawn: async () => seen.push("respawn"),
    scheduleRespawn: () => seen.push("scheduled"),
    suggestTier: async () => { seen.push("shadow"); return null; },
  });
  await router.applyBand({ ...card, worker_preset_id: null }, "planning", false);
  assert.deepEqual(seen, [], "no swap means no shadow call");
}
{
  const seen = [];
  const router = createBandRouter({
    getReliablePreset: () => ({ id: "preset-next" }),
    getCardPresetId: () => "preset-now",
    respawn: async () => seen.push("respawn"),
    scheduleRespawn: () => seen.push("scheduled"),
    suggestTier: async () => { throw new Error("shadow down"); },
  });
  await router.applyBand({ ...card, worker_preset_id: null }, "planning", true);
  assert.deepEqual(seen, ["scheduled"], "a throwing shadow never breaks the swap");
}

console.log("decision tier shadow test ok: rules-inert, agree/disagree records, swap-only observation");
