import assert from "node:assert/strict";
import test from "node:test";
import {
  cardIdOfWorkflow,
  orphanWorkflows,
  visibleWorkflows,
  withoutOrphans,
} from "../lib/workflow-inventory.mjs";

/**
 * `bb stelow status` listed 77 workflows "in-progress" against 33 cards.
 *
 * `stelow.json` is append-mostly: a card's entry is written at creation and
 * nothing removes it when the card is deleted. That column is what a worker
 * reads to answer "is anything waiting on me?", so ghosts in it are not
 * cosmetic — 44 of them sat at `triage` forever.
 *
 * The discriminator is the directory hash the plugin itself wrote, never a
 * guess from the name: `sw-card_<cardId>` is card-owned; `sw_<slug>` is a
 * cardless workflow (research/explore) that has no card row BY DESIGN, and
 * hiding one of those would lose a workflow that is actually running.
 */

const card = (id) => ({ id });
const cardless = (id) => ({ id });

test("a card-owned entry maps to its card id", () => {
  assert.equal(cardIdOfWorkflow(card("sw-card_card_qimjr9z4")), "card_qimjr9z4");
});

test("a cardless entry has no card id", () => {
  for (const id of ["sw_jtbd-lifecycle-real", "sw_e2e-needsinput-resu", "workflow-1"]) {
    assert.equal(cardIdOfWorkflow(cardless(id)), null, `"${id}" is cardless`);
  }
});

test("a card-owned entry hides when its card row is gone", () => {
  const live = card("sw-card_card_live");
  const ghost = card("sw-card_card_gone");
  const exists = (id) => id === "card_live";
  assert.deepEqual(visibleWorkflows([live, ghost], exists), [live]);
  assert.deepEqual(orphanWorkflows([live, ghost], exists), [ghost]);
});

test("a cardless workflow is never hidden and never pruned", () => {
  const cardlessEntry = cardless("sw_jtbd-lifecycle-real");
  const exists = () => false;
  assert.deepEqual(
    visibleWorkflows([cardlessEntry], exists),
    [cardlessEntry],
    "a workflow with no card row by design stays visible",
  );
  assert.deepEqual(orphanWorkflows([cardlessEntry], exists), [], "and is never a prune candidate");
});

test("the prune touches workflows and nothing else", () => {
  const tracking = {
    version: 2,
    updated: "2026-09-24",
    workflows: [card("sw-card_card_live"), card("sw-card_card_gone")],
  };
  const pruned = withoutOrphans(tracking, (id) => id === "card_live");
  assert.deepEqual(pruned, {
    version: 2,
    updated: "2026-09-24",
    workflows: [card("sw-card_card_live")],
  });
});

test("nothing to prune answers null, not an empty write", () => {
  const allLive = { workflows: [card("sw-card_card_live")] };
  assert.equal(withoutOrphans(allLive, () => true), null, "a clean file is not rewritten");
  assert.equal(withoutOrphans({ workflows: [] }, () => false), null, "an empty file is not rewritten");
  assert.equal(withoutOrphans(null, () => true), null, "off-shape input is not rewritten");
  assert.equal(withoutOrphans({ workflows: "nope" }, () => false), null);
});

console.log(
  "workflow inventory ok: card-owned entries follow their card row, cardless ones never do, "
  + "and a prune only touches the list it owns",
);
