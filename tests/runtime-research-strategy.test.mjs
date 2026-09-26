import assert from "node:assert/strict";
import test from "node:test";
import {
  ERRORS,
  NOW,
  callsNamed,
  comments,
  firstCall,
  harness,
  researchCard,
} from "./helpers/research-track-harness.mjs";

/** Strategy rounds: a fresh worker appends a new section to the same card,
 * and the round is only recorded once that worker is live. */

const ROUND_FILE = /^rounds\/pricing-r\d+-\d{8}-\d{4}\.md$/;

test("runResearchStrategy refuses unknown, non-research, and archived cards", async () => {
  const missing = harness({ card: { ...researchCard(), id: "card_other" } });
  assert.deepEqual(
    await missing.handlers.runResearchStrategy({
      cardId: "card_r1",
      strategy: "pricing",
    }),
    { ok: false, strategy: null, error: ERRORS.cardNotFound },
  );

  const build = harness({ card: researchCard({ kind: "build" }) });
  assert.match(
    (
      await build.handlers.runResearchStrategy({
        cardId: "card_r1",
        strategy: "pricing",
      })
    ).error,
    /Only research cards run strategies/,
  );

  const archived = harness({ card: researchCard({ status: "archived" }) });
  assert.equal(
    (
      await archived.handlers.runResearchStrategy({
        cardId: "card_r1",
        strategy: "pricing",
      })
    ).error,
    ERRORS.cardArchived,
  );
  assert.deepEqual(archived.calls, [], "a retired card never respawns a worker");
});

test("runResearchStrategy names the valid strategies in its refusal", async () => {
  const { handlers } = harness();
  const result = await handlers.runResearchStrategy({
    cardId: "card_r1",
    strategy: "nope",
  });
  assert.equal(result.ok, false);
  assert.match(
    result.error,
    /^Unknown research strategy "nope"\. Pick one of: business-models, /,
  );
});

test("runResearchStrategy respawns on the reliable preset with an append flavor", async () => {
  const { calls, handlers } = harness();
  const result = await handlers.runResearchStrategy({
    cardId: "card_r1",
    strategy: "pricing",
  });
  assert.deepEqual(result, { ok: true, strategy: "pricing", error: null });

  const respawn = firstCall(calls, "respawn");
  assert.equal(respawn[1], "card_r1");
  assert.equal(respawn[2], "preset_reliable", "the round respawns the override-aware preset");
  assert.equal(respawn[3], "strategy-add");
  assert.equal(respawn[4].strategyId, "pricing");
  assert.equal(respawn[4].flavor, "append", "an existing index is appended, never rewritten");
});

test("runResearchStrategy numbers the round after the recorded history", async () => {
  const history = [
    { id: "business-models", at: "2026-01-01T00:00:00.000Z", file: "rounds/r1.md" },
  ];
  const { calls, handlers } = harness({ strategyRounds: history });
  await handlers.runResearchStrategy({ cardId: "card_r1", strategy: "pricing" });
  assert.equal(firstCall(calls, "respawn")[4].roundNo, 2);
  assert.match(firstCall(calls, "respawn")[4].roundFile, /^rounds\/pricing-r2-/);
});

test("runResearchStrategy appends to the history without rewriting earlier rounds", async () => {
  const history = [
    { id: "business-models", at: "2026-01-01T00:00:00.000Z", file: "rounds/r1.md" },
  ];
  const { calls, handlers } = harness({ strategyRounds: history });
  await handlers.runResearchStrategy({ cardId: "card_r1", strategy: "pricing" });

  const write = firstCall(calls, "write");
  assert.match(write[1], /UPDATE cards SET research_strategies/);
  assert.equal(write[2][1], NOW, "the row is stamped so the board can order the change");
  const recorded = JSON.parse(write[2][0]);
  assert.equal(recorded.length, 2);
  assert.deepEqual(recorded[0], history[0], "earlier rounds are preserved verbatim");
  assert.equal(recorded[1].id, "pricing");
  assert.equal(recorded[1].at, new Date(NOW).toISOString());
  assert.match(recorded[1].file, ROUND_FILE);
});

test("runResearchStrategy creates the round parent directory before the spawn", async () => {
  const { calls, handlers } = harness();
  await handlers.runResearchStrategy({ cardId: "card_r1", strategy: "pricing" });
  const mkdir = firstCall(calls, "mkdir");
  assert.equal(mkdir[1], "/w");
  assert.match(mkdir[2], ROUND_FILE);
  assert.ok(
    calls.indexOf(mkdir) < calls.findIndex(([name]) => name === "respawn"),
    "the worker never creates its own directory",
  );
});

test("a strategy round on a card with no workspace still spawns without a file", async () => {
  const { calls, handlers } = harness({
    card: researchCard({ dir_hash: null }),
  });
  const result = await handlers.runResearchStrategy({
    cardId: "card_r1",
    strategy: "pricing",
  });
  assert.equal(result.ok, true);
  assert.equal(firstCall(calls, "respawn")[4].roundFile, "");
  assert.equal(JSON.parse(firstCall(calls, "write")[2][0])[0].file, "");
  assert.ok(!callsNamed(calls, "mkdir").length, "no parent is created for an empty path");
});

test("a failed strategy spawn records no round, so a retry is the same round", async () => {
  const { calls, handlers } = harness({
    respawn: async () => {
      calls.push(["respawn"]);
      return { ok: false, error: "No free worker slot." };
    },
  });
  const result = await handlers.runResearchStrategy({
    cardId: "card_r1",
    strategy: "pricing",
  });
  assert.deepEqual(result, {
    ok: false,
    strategy: null,
    error: "No free worker slot.",
  });
  assert.ok(!firstCall(calls, "write"), "history stays untouched");
  assert.deepEqual(comments(calls), []);
  assert.ok(!callsNamed(calls, "publish").length);
});

test("a strategy spawn with no reason still reports an actionable error", async () => {
  const { handlers } = harness({ respawn: async () => ({ ok: false }) });
  const result = await handlers.runResearchStrategy({
    cardId: "card_r1",
    strategy: "pricing",
  });
  assert.equal(result.error, "Could not start the strategy round.");
});

test("a successful strategy round leaves a trail naming the preset and the append", async () => {
  const { calls, handlers } = harness();
  await handlers.runResearchStrategy({ cardId: "card_r1", strategy: "pricing" });
  assert.deepEqual(comments(calls), [
    'Started a Pricing research round on preset "Reliable preset". Results will be added to this card. Previous worker archived.',
  ]);
  assert.deepEqual(
    callsNamed(calls, "publish").map(([, event]) => event),
    ["card-state"],
  );
});

test("a round on an uncataloged preset still names the id in the trail", async () => {
  const { calls, handlers } = harness({ presetName: () => undefined });
  await handlers.runResearchStrategy({ cardId: "card_r1", strategy: "pricing" });
  assert.deepEqual(comments(calls), [
    'Started a Pricing research round on preset "preset_reliable". Results will be added to this card. Previous worker archived.',
  ]);
});
