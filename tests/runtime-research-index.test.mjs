import assert from "node:assert/strict";
import test from "node:test";
import {
  ERRORS,
  INDEX,
  NOT_AN_INDEX,
  firstCall,
  harness,
  researchCard,
} from "./helpers/research-track-harness.mjs";

/** The index read: refusals, the pending state, the content cap, and the
 * workspace-scoped round list. */

test("researchIndex refuses a missing or non-research card before reading files", async () => {
  const missing = harness({ card: { ...researchCard(), id: "card_other" } });
  const notFound = await missing.handlers.researchIndex({ cardId: "card_r1" });
  assert.equal(notFound.error, ERRORS.cardNotFound);
  assert.equal(notFound.found, false);
  assert.deepEqual(missing.calls, [], "a refused read touches no file or db");

  const build = harness({ card: researchCard({ kind: "build" }) });
  const wrongKind = await build.handlers.researchIndex({ cardId: "card_r1" });
  assert.match(
    wrongKind.error,
    /Only research cards have results to review/,
  );
  assert.deepEqual(build.calls, []);
});

test("researchIndex propagates the resolution error instead of masking it", async () => {
  const { calls, handlers } = harness({ indexOk: false });
  const result = await handlers.researchIndex({ cardId: "card_r1" });
  assert.equal(result.error, "No workspace for this card.");
  assert.equal(result.indexPath, null);
  assert.ok(
    !calls.some(([name]) => name === "rounds"),
    "a card with no index file has no rounds to report",
  );
});

test("researchIndex reports a pending index with its path and known rounds", async () => {
  const { handlers } = harness({
    index: NOT_AN_INDEX,
    roundFiles: [{ id: "business-models", state: "done" }],
  });
  const result = await handlers.researchIndex({ cardId: "card_r1" });
  assert.equal(result.error, "Research results are still being prepared.");
  assert.equal(result.indexPath, "research-index.md");
  assert.equal(result.found, false);
  assert.deepEqual(result.rounds, [{ id: "business-models", state: "done" }]);
});

test("researchIndex caps the worker-written index and flags the truncation", async () => {
  const { handlers } = harness({ index: `${INDEX}\n${"x".repeat(100_000)}` });
  const result = await handlers.researchIndex({ cardId: "card_r1" });
  assert.equal(result.found, true);
  assert.equal(result.error, null);
  assert.equal(result.content.length, 100_000);
  assert.equal(result.truncated, true);

  const small = await harness({ index: INDEX });
  const untruncated = await small.handlers.researchIndex({ cardId: "card_r1" });
  assert.equal(untruncated.content, INDEX);
  assert.equal(untruncated.truncated, false);
});

test("researchIndex lists only the parsed opportunities, with their group", async () => {
  const { handlers } = harness();
  const result = await handlers.researchIndex({ cardId: "card_r1" });
  assert.deepEqual(result.opportunities, [
    {
      id: "second-marketplace-launch-demand-is-thin-1",
      title: "Second marketplace launch — demand is thin",
      checked: false,
      group: "Business models — 2026-01-01",
    },
    {
      id: "legacy-pricing-cleanup-already-shipped-2",
      title: "Legacy pricing cleanup — already shipped",
      checked: true,
      group: "Business models — 2026-01-01",
    },
    {
      id: "retain-pricing-experiment-churn-is-high-3",
      title: "Retain pricing experiment — churn is high",
      checked: false,
      group: "Business models — 2026-01-01",
    },
    {
      id: "checkout-funnel-teardown-leaks-at-the-last-step-4",
      title: "Checkout funnel teardown — leaks at the last step",
      checked: false,
      group: "Business models — 2026-01-01",
    },
  ]);
});

test("researchIndex resolves rounds against the same workspace the index came from", async () => {
  const history = [
    { id: "business-models", at: "2026-01-01T00:00:00.000Z", file: "rounds/a.md" },
  ];
  const { calls, handlers } = harness({ strategyRounds: history });
  await handlers.researchIndex({ cardId: "card_r1" });
  const roundCall = firstCall(calls, "rounds");
  assert.equal(roundCall[1], "/w");
  assert.equal(roundCall[2], "host1");
  assert.equal(roundCall[3], "/w/.stelow/card_r1");
  assert.deepEqual(roundCall[4], history);
  assert.equal(
    roundCall[5],
    false,
    "an idle card is not waiting on a live round",
  );
});

test("researchIndex skips the state dir when the card has no dir hash", async () => {
  const { calls, handlers } = harness({ card: researchCard({ dir_hash: null }) });
  await handlers.researchIndex({ cardId: "card_r1" });
  assert.ok(!calls.some(([name]) => name === "stateDir"));
  assert.equal(firstCall(calls, "rounds")[3], null);
});

test("a waiting research card reports its rounds as live", async () => {
  for (const activity of ["running", "awaiting-answer"]) {
    const { calls, handlers } = harness({
      card: researchCard({ activity }),
    });
    await handlers.researchIndex({ cardId: "card_r1" });
    assert.equal(firstCall(calls, "rounds")[5], true, activity);
  }
});

test("the strategy catalog and stage catalog are published for the pickers", () => {
  const { handlers } = harness();
  const { strategies } = handlers.researchStrategies();
  assert.ok(strategies.some((entry) => entry.id === "job-to-be-done"));
  const { stages } = handlers.stageCatalog();
  assert.ok(stages.some((entry) => entry.id === "plan-critique"));
  assert.deepEqual(
    Object.keys(stages[0]).sort(),
    ["blurb", "emoji", "id", "keywords", "label", "skill"],
  );
});

test("createResearchCard and createExploreCard pin their track defaults", async () => {
  const { calls, handlers } = harness();
  await handlers.createResearchCard({
    projectId: "proj_1",
    environment: null,
    prompt: "How do we price?",
    attachments: [],
    strategy: "job-to-be-done",
    presetId: null,
    start: false,
    execution: null,
  });
  const research = firstCall(calls, "createCard")[1];
  assert.equal(research.kind, "research");
  assert.equal(research.intent, "investigate");
  assert.equal(research.appetite, "Lean");
  assert.equal(research.reviewMode, "Auto");
  assert.equal(research.strategy, "job-to-be-done");
  assert.equal(research.prompt, "How do we price?");
});

test("createExploreCard pins the explore review chain and keeps the caller's choices", async () => {
  const { calls, handlers } = harness();
  await handlers.createExploreCard({
    projectId: "proj_1",
    environment: null,
    prompt: "Map the seams",
    attachments: [],
    stageId: "plan-critique",
    presetId: "preset_x",
    start: true,
    execution: null,
  });
  const explore = firstCall(calls, "createCard")[1];
  assert.equal(explore.kind, "explore");
  assert.equal(explore.intent, "explore");
  assert.equal(explore.appetite, "Complete");
  assert.equal(
    explore.reviewMode,
    "Product Spec + Interface + Tech Review + Code Diff",
  );
  assert.equal(explore.stageId, "plan-critique");
  assert.equal(explore.presetId, "preset_x");
  assert.equal(explore.start, true, "the deferred-start choice is the caller's");
});

test("an unknown strategy or technique refuses with the list of valid ids", () => {
  const { handlers } = harness();
  assert.throws(
    () =>
      handlers.createResearchCard({
        projectId: "proj_1",
        environment: null,
        prompt: "p",
        attachments: [],
        strategy: "nope",
        presetId: null,
        start: false,
        execution: null,
      }),
    /^Error: Unknown research strategy "nope"\. Pick one of: business-models, /,
  );
  assert.throws(
    () =>
      handlers.createExploreCard({
        projectId: "proj_1",
        environment: null,
        prompt: "p",
        attachments: [],
        stageId: "nope",
        presetId: null,
        start: false,
        execution: null,
      }),
    /^Error: Unknown explore technique "nope"\. Pick one of: shape-up, /,
  );
});
