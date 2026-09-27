import assert from "node:assert/strict";
import { archivedDeleteProps, ARCHIVED_COLUMN } from "../components/board/archived-delete-props.ts";

/**
 * The safety of "delete all" is entirely in two properties, and a panel that
 * got either wrong would look identical until someone lost work:
 *
 * 1. the blast radius is the column AS FILTERED — the same list on screen;
 * 2. the confirmation names that filter, so a narrow delete is
 *    distinguishable from a wide one before anything irreversible runs.
 *
 * Both are derived in one shared function so the three boards cannot drift. So
 * the pins are on the derivation, not on markup.
 */

// Only the Archived column gets the affordance. A board with an "Archived"
// column is the only place cards are eligible for hard delete at all, and
// putting the control anywhere else would offer an action that is refused.
assert.equal(ARCHIVED_COLUMN, "archived");
for (const column of ["inbox", "analysis", "planning", "execution", "review", "completed", "doing", "done"]) {
  assert.equal(
    archivedDeleteProps({ column, cards: [{ id: "a" }], filters: {}, onConfirm: async () => {} }),
    undefined,
    `the ${column} column must not offer a bulk delete`,
  );
}

// The blast radius is the cards passed in — the column's current contents.
{
  const onConfirm = async () => {};
  const props = archivedDeleteProps({
    column: "archived",
    cards: [{ id: "card_a" }, { id: "card_b" }],
    filters: {},
    onConfirm,
  });
  assert.deepEqual(props?.cardIds, ["card_a", "card_b"], "exactly the cards on screen, in order");
  assert.equal(props?.filterLabel, "all cards", "and it says so when no filter narrows the board");
  assert.equal(props?.onConfirm, onConfirm, "the caller's handler is used, not a re-derived one");
}

// A filter is named in the label, so the reader can tell a narrow delete from
// a wide one. Without a label map the raw values still appear — worse to read,
// but honest, which is the requirement.
{
  const withLabels = archivedDeleteProps({
    column: "archived",
    cards: [{ id: "a" }],
    filters: { intents: ["refactor"], statuses: ["archived"] },
    labels: { refactor: "Refactor", archived: "Archived" },
    onConfirm: async () => {},
  });
  assert.equal(withLabels?.filterLabel, "type: Refactor · status: Archived", "display names, not raw values");

  const raw = archivedDeleteProps({
    column: "archived",
    cards: [{ id: "a" }],
    filters: { intents: ["refactor"] },
    onConfirm: async () => {},
  });
  assert.equal(raw?.filterLabel, "type: refactor", "a missing label falls back to the value, never to a blank");
}

// Projects are named by name. A raw project id in a confirmation about
// irreversible work is the kind of detail that makes a reader approve without
// reading.
{
  const props = archivedDeleteProps({
    column: "archived",
    cards: [{ id: "a" }],
    filters: { projectIds: ["p1"] },
    projects: [{ id: "p1", name: "Alpha" }],
    onConfirm: async () => {},
  });
  assert.equal(props?.filterLabel, "project: Alpha", "the project's name, not its id");
}

// A filter key the caller does not supply must not throw, and must not invent
// a filter: the state objects are wider than the filter set.
{
  const props = archivedDeleteProps({
    column: "archived",
    cards: [],
    filters: { collapsedColumns: {}, viewMode: "board", loading: false },
    onConfirm: async () => {},
  });
  assert.equal(props?.filterLabel, "all cards", "unrelated state keys are not filters");
  assert.deepEqual(props?.cardIds, [], "an empty column still yields an empty set, not undefined");
}

console.log("archived delete props test ok: the blast radius is the filtered column, and the confirmation names the filter");
