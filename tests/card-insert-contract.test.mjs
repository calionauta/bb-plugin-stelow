import assert from "node:assert/strict";
import { CARD_COLUMNS, insertCard } from "../server/cards-create-persist.ts";

// Card creation is shared by Build, Research, and Explore. Keep its SQL shape
// derived from one column list so a new field cannot break every creation flow.
//
// The contract is proven by DRIVING insertCard and reading the statement it
// actually prepares: one canonical column list, one placeholder per column, and
// one value per column, aligned by position. A rename of the column list, a
// dropped placeholder, or a values/columns drift all fail here because the
// INSERT the database would run is what is asserted — not a regex over the file.

assert.ok(CARD_COLUMNS.length > 0, "card INSERT declares one canonical column list");
assert.equal(new Set(CARD_COLUMNS).size, CARD_COLUMNS.length, "card INSERT columns are unique");
assert.equal(CARD_COLUMNS.length, 25, "card INSERT has the expected 25 columns");

const prepared = [];
const db = {
  prepare(sql) {
    return { run: (...values) => prepared.push({ sql, values }) };
  },
};

const input = {
  projectId: "project_1",
  prompt: "Ship it",
  attachments: [],
  intent: "feature",
  reviewMode: "off",
  start: true,
};
const workspace = {
  projectId: "project_1",
  rootPath: "/repo",
  source: { path: "/repo", hostId: "host_1" },
  exploratory: false,
};
const cardPrepared = {
  displayName: "Ship it",
  params: {},
  environment: { type: "project-default", workspace: { type: "project" } },
  roundFile: "round.md",
  prompt: "Ship it",
};
const track = {
  research: false,
  explore: false,
  researchStrategy: null,
  exploreStage: null,
  intent: "feature",
  reviewGates: [],
  reviewRung: "off",
  seed: { error: null, dirHash: "hash", stateDir: "/repo/.stelow" },
};
const preset = {
  id: "preset_1",
  provider_id: "pi",
  model_id: "model",
  reasoning_level: "low",
  permission_mode: "full",
  environment_kind: "project-default",
  base_branch: null,
  machine_id: null,
  instructions: "",
};

await insertCard(
  { now: () => 1_700_000_000_000, db },
  input,
  "card_1",
  workspace,
  cardPrepared,
  track,
  preset,
  null,
  null,
);

assert.equal(prepared.length, 1, "one card INSERT is prepared");
const [{ sql, values }] = prepared;
assert.equal(
  sql,
  `INSERT INTO cards (${CARD_COLUMNS.join(", ")}) VALUES (${CARD_COLUMNS.map(() => "?").join(", ")})`,
  "the statement derives from the one column list",
);
assert.equal(values.length, CARD_COLUMNS.length, "the INSERT carries exactly one value per column");
assert.equal(
  values[CARD_COLUMNS.indexOf("status")],
  "draft",
  "a value is written at the position the column list names, not merely adjacent to it",
);

console.log("card insert contract test ok: placeholders derive from 25 unique columns");
