import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCardMatches,
  filterAndGroupBuildCards,
} from "../lib/build-panel-state.mjs";

const filters = {
  columns: ["inbox", "analysis", "planning", "execution", "review", "completed", "archived"],
  projectIds: [],
  intents: [],
  statuses: [],
  activities: [],
  stages: [],
  attention: false,
};

function card(overrides = {}) {
  return {
    id: "card-1",
    projectId: "project-1",
    intent: "feature",
    status: "in-progress",
    stage: "plan",
    activity: "idle",
    needsAttention: false,
    updatedAt: 1,
    workerThreadId: null,
    ...overrides,
  };
}

test("groups filtered build cards by board column in newest-first order", () => {
  const cards = [
    card({ id: "old", updatedAt: 1 }),
    card({ id: "new", stage: "framing", updatedAt: 3 }),
    card({ id: "middle", status: "completed", stage: "done", updatedAt: 2 }),
  ];
  const groups = filterAndGroupBuildCards(cards, filters);
  assert.deepEqual(groups.analysis.map((entry) => entry.id), ["new", "old"]);
  assert.deepEqual(groups.completed.map((entry) => entry.id), ["middle"]);
});

test("an attention filter excludes cards that do not need a decision", () => {
  const waiting = card({ id: "waiting", needsAttention: true });
  assert.equal(buildCardMatches(waiting, { ...filters, attention: true }), true);
  assert.equal(buildCardMatches(card(), { ...filters, attention: true }), false);
});

test("project filtering keeps unrelated cards out of the board", () => {
  assert.equal(
    buildCardMatches(card(), { ...filters, projectIds: ["project-1"] }),
    true,
  );
  assert.equal(
    buildCardMatches(card({ projectId: "project-2" }), { ...filters, projectIds: ["project-1"] }),
    false,
  );
});

test("status filtering uses the derived build column", () => {
  const parked = card({ status: "draft", workerThreadId: null });
  assert.equal(
    buildCardMatches(parked, { ...filters, statuses: ["inbox"] }),
    true,
    "a threadless card belongs in the Bucket",
  );
  assert.equal(buildCardMatches(parked, { ...filters, statuses: ["analysis"] }), false);
});
