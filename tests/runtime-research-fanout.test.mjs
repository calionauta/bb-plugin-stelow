import assert from "node:assert/strict";
import test from "node:test";
import {
  ERRORS,
  OPPORTUNITY,
  callsNamed,
  comments,
  firstCall,
  harness,
  researchCard,
} from "./helpers/research-track-harness.mjs";

/** Fan-out: which opportunities are claimable, where the build cards land,
 * and what the index and the trail record when a spawn fails midway. */

test("fanOutResearch refuses unknown, non-research, and archived cards in order", async () => {
  const missing = harness({ card: { ...researchCard(), id: "card_other" } });
  assert.deepEqual(
    await missing.handlers.fanOutResearch({
      cardId: "card_r1",
      opportunityIds: [],
    }),
    { ok: false, created: [], error: ERRORS.cardNotFound },
  );

  const build = harness({ card: researchCard({ kind: "build" }) });
  assert.match(
    (
      await build.handlers.fanOutResearch({
        cardId: "card_r1",
        opportunityIds: [],
      })
    ).error,
    /Only research cards fan out/,
  );

  // Archived is refused before the index read: a retired card never touches
  // the workspace and never spawns.
  const archived = harness({ card: researchCard({ status: "archived" }) });
  const result = await archived.handlers.fanOutResearch({
    cardId: "card_r1",
    opportunityIds: [],
  });
  assert.equal(result.error, ERRORS.cardArchived);
  assert.deepEqual(archived.calls, []);
});

test("fanOutResearch refuses when no selected opportunity is still available", async () => {
  const none = /None of the selected opportunities are still available/;
  const alreadyFanned = await harness().handlers.fanOutResearch({
    cardId: "card_r1",
    opportunityIds: [OPPORTUNITY.legacy],
  });
  assert.match(alreadyFanned.error, none);

  const unknown = await harness().handlers.fanOutResearch({
    cardId: "card_r1",
    opportunityIds: ["not-in-the-index"],
  });
  assert.match(unknown.error, none);
});

test("fanOutResearch refuses an index that is still being prepared", async () => {
  const { calls, handlers } = harness({ index: "## Summary\nno block yet" });
  const result = await handlers.fanOutResearch({
    cardId: "card_r1",
    opportunityIds: [OPPORTUNITY.marketplace],
  });
  assert.equal(result.error, "Research results are still being prepared.");
  assert.ok(!callsNamed(calls, "createCard").length, "nothing is spawned");
});

test("fanOutResearch spawns one build card per unchecked selection and flips only those", async () => {
  const { calls, handlers } = harness();
  const result = await handlers.fanOutResearch({
    cardId: "card_r1",
    opportunityIds: [OPPORTUNITY.marketplace, OPPORTUNITY.legacy],
  });
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(
    result.created.length,
    1,
    "the already-checked id is not claimable",
  );

  const spawned = firstCall(calls, "createCard")[1];
  assert.equal(spawned.kind, "build");
  assert.equal(spawned.intent, "unknown");
  assert.equal(spawned.appetite, "Lean");
  assert.equal(spawned.reviewMode, "Auto");
  assert.equal(spawned.projectId, "proj_1", "project research fans out in its project");
  assert.match(
    spawned.prompt,
    /^Spawned from research "Pricing research" \(Business models\)\./,
  );
  assert.match(spawned.prompt, /Opportunity: Second marketplace launch/);
  assert.match(spawned.prompt, /full index at \/w\/research-index\.md/);
  assert.match(spawned.prompt, /read its ## Summary before triage/);
});

test("fanOutResearch flips exactly the spawned boxes in the index", async () => {
  const { calls, handlers } = harness();
  await handlers.fanOutResearch({
    cardId: "card_r1",
    opportunityIds: [OPPORTUNITY.marketplace],
  });
  const flipped = firstCall(calls, "writeFile")[1];
  assert.equal(flipped.path, "/w/research-index.md");
  assert.match(flipped.content, /- \[x\] Second marketplace launch/);
  assert.match(flipped.content, /- \[x\] Legacy pricing cleanup/, "the pre-checked row stays");
  assert.match(flipped.content, /- \[ \] Retain pricing experiment/, "untouched rows stay open");
  assert.match(flipped.content, /- \[ \] Checkout funnel teardown/);
});

test("fanOutResearch routes exploratory research into fresh personal build cards", async () => {
  const { calls, handlers } = harness({
    card: researchCard({ workspace_kind: "exploratory" }),
  });
  await handlers.fanOutResearch({
    cardId: "card_r1",
    opportunityIds: [OPPORTUNITY.marketplace],
  });
  assert.equal(
    firstCall(calls, "createCard")[1].projectId,
    "proj_personal",
    "each spawned card owns its isolated workspace",
  );
});

test("a partial fan-out stops the sweep, flips only what spawned, and says so", async () => {
  let created = 0;
  const { calls, handlers } = harness({
    createCard: async (input) => {
      created += 1;
      if (created === 2) throw new Error("Worker cap reached.");
      calls.push(["createCard", input]);
      return { cardId: "card_new_1", threadId: null };
    },
  });
  const result = await handlers.fanOutResearch({
    cardId: "card_r1",
    opportunityIds: [
      OPPORTUNITY.marketplace,
      OPPORTUNITY.retain,
      OPPORTUNITY.checkout,
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.created.length, 1, "the card that did spawn is still reported");
  assert.match(
    result.error,
    /^Created 1 build card before the remaining opportunities could not be created\. Worker cap reached\.$/,
  );
  assert.equal(
    callsNamed(calls, "createCard").length,
    1,
    "one spawn failure stops the sweep instead of hammering a full worker cap",
  );

  const flipped = firstCall(calls, "writeFile")[1];
  assert.match(flipped.content, /- \[x\] Second marketplace launch/);
  assert.match(flipped.content, /- \[ \] Retain pricing experiment/, "the failed id stays claimable");
  assert.match(flipped.content, /- \[ \] Checkout funnel teardown/, "the unattempted id was never claimed");
});

test("a failed fan-out with nothing spawned reports the bare reason", async () => {
  const { calls, handlers } = harness({
    createCard: async () => {
      throw new Error("Worker cap reached.");
    },
  });
  const result = await handlers.fanOutResearch({
    cardId: "card_r1",
    opportunityIds: [OPPORTUNITY.marketplace],
  });
  assert.equal(result.error, "Worker cap reached.");
  assert.deepEqual(result.created, []);
  assert.deepEqual(comments(calls), [], "a zero-card fan-out leaves no trail comment");
});

test("a non-Error spawn failure still names an actionable reason", async () => {
  const { handlers } = harness({
    createCard: async () => {
      throw "nope";
    },
  });
  const result = await handlers.fanOutResearch({
    cardId: "card_r1",
    opportunityIds: [OPPORTUNITY.marketplace],
  });
  assert.equal(result.error, "Could not spawn a build card.");
});

test("fanOutResearch keeps the spawn and the trail when the flip write fails", async () => {
  const { calls, handlers } = harness({
    writeFile: async () => {
      throw new Error("read-only workspace");
    },
  });
  const result = await handlers.fanOutResearch({
    cardId: "card_r1",
    opportunityIds: [OPPORTUNITY.marketplace],
  });
  assert.equal(result.ok, true, "a failed flip is recoverable; the boxes just stay open");
  assert.equal(result.created.length, 1);
  assert.deepEqual(comments(calls), [
    "Fanned out 1 opportunity into build: Second marketplace launch — demand is thin.",
  ]);
});

test("fanOutResearch names every spawned card and publishes both board events", async () => {
  const { calls, handlers } = harness();
  const result = await handlers.fanOutResearch({
    cardId: "card_r1",
    opportunityIds: [OPPORTUNITY.marketplace, OPPORTUNITY.retain],
  });
  assert.equal(result.created.length, 2);
  assert.deepEqual(
    result.created.map((entry) => entry.title),
    [
      "Second marketplace launch — demand is thin",
      "Retain pricing experiment — churn is high",
    ],
  );
  assert.deepEqual(comments(calls), [
    "Fanned out 2 opportunities into build: Second marketplace launch — demand is thin; Retain pricing experiment — churn is high.",
  ]);
  assert.deepEqual(
    callsNamed(calls, "publish").map(([, event]) => event),
    ["card-state", "board-changed"],
  );
});
