import assert from "node:assert/strict";
import test from "node:test";
import { registerMentionProviders } from "../server/runtime/mentions.ts";

/**
 * A stage a reader can act on, by name.
 *
 * The mention picker is the one surface where a card is chosen BEFORE it is
 * opened, so the stage in its subtitle is often the only thing that tells two
 * cards apart. That makes it load-bearing: a slug there is not a cosmetic slip,
 * it is the whole row.
 *
 * This test drives the provider the host actually registers. It is not a source
 * pin: `registerMentionProviders` hands two providers to `bb.ui`, the host calls
 * `search`, and the assertion is on the string that comes back. Reverting the
 * label to the raw slug fails it, and no amount of leaving the function in place
 * helps.
 */
function providerFixture(rows, workflows) {
  const registered = [];
  const bb = {
    ui: { registerMentionProvider: (provider) => registered.push(provider) },
    sdk: {},
  };
  registerMentionProviders(bb, {
    db: {
      prepare: () => ({
        all: (...args) => (args.length ? rows.filter((r) => r.project_id === args[0]) : rows),
      }),
    },
    loadBoard: async () => ({ workflows }),
  });
  const workflow = registered.find((p) => p.id === "workflow");
  assert.ok(workflow, "the workflow mention provider is registered");
  return (query, projectId) => workflow.search({ query, projectId });
}

const CARD = {
  id: "card_1",
  project_id: "project_1",
  display_name: "Useful card",
  name: "useful",
  stage: "int-gate",
  status: "in-progress",
  intent: "feature",
  dir_hash: "hash_1",
};

const WORKFLOW = {
  id: "wf_1",
  name: "Useful workflow",
  stage: "int-gate",
  status: "in-progress",
  appetite: "small",
  reviewMode: "auto",
  scopes: [],
};

test("a workflow mention names the stage the way the card does", async () => {
  const search = providerFixture([], [WORKFLOW]);
  const [item] = await search("useful", "project_1");
  assert.match(item.subtitle, /^Interface gate · /, "the label the rest of the card uses");
  assert.doesNotMatch(item.subtitle, /int-gate/, "and never the stored slug");
});

test("a card mention names the stage the way the card does", async () => {
  const search = providerFixture([CARD], []);
  const [item] = await search("useful", "project_1");
  assert.match(item.subtitle, /^Interface gate · /);
  assert.doesNotMatch(item.subtitle, /int-gate/, "and never the stored slug");
});

test("every stage in the catalog reaches the picker as a label, not a slug", async () => {
  // The two tests above pin ONE stage, so a catalog that gains a second
  // unlabelled path is invisible. This walks the whole catalog and asks the same
  // question of each: if a stage's label is ever its own id, the slug is on
  // screen and this fails naming the stage that did it.
  const { WORKFLOW_STAGES } = await import("../lib/workflow-vocabulary.mjs");
  const rows = WORKFLOW_STAGES.map((stage, index) => ({
    ...CARD,
    id: `card_${index}`,
    dir_hash: `hash_${index}`,
    display_name: `Card ${stage.id}`,
    stage: stage.id,
  }));
  const search = providerFixture(rows, []);
  const items = await search("card", "project_1");
  assert.equal(items.length, WORKFLOW_STAGES.length, "every stage got a row");

  for (const stage of WORKFLOW_STAGES) {
    const item = items.find((entry) => entry.title === `Card ${stage.id}`);
    assert.ok(item, `${stage.id} produced a mention row`);
    assert.doesNotMatch(
      item.subtitle,
      new RegExp(`(^| · )${stage.id}( · |$)`),
      `${stage.id} reached the picker as a slug`,
    );
  }
});

test("an unknown stage still reaches the picker rather than vanishing", async () => {
  // `stageLabel` falls back to the raw value on purpose: a card on a stage this
  // build does not know about should still be findable and still say where it
  // is. Swallowing it instead would hide the card from the only surface that
  // could introduce it to a reader.
  const search = providerFixture([{ ...CARD, stage: "stage_from_the_future" }], []);
  const [item] = await search("useful", "project_1");
  assert.match(item.subtitle, /^stage_from_the_future · /, "shown as-is, not dropped");
});
