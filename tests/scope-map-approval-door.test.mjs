import assert from "node:assert/strict";
import test from "node:test";
import { approveScopeMapOnCard } from "../server/scope-map-approval.ts";

/**
 * The approval DOOR, not the stamp. `lib/scope-map-approval.mjs` owns what
 * "approved" means; this owns the act a human takes — and the act is what was
 * missing. Nothing in the runtime ever wrote an approved map, so the X-ray
 * could only appear by hand-editing an artifact. These tests drive the handler
 * end to end against an in-memory state dir: the draft the worker wrote, the
 * stamp, the Shape version mirrored into state.md, the trail comment, and every
 * refusal that must name its exit.
 */

const DRAFT = {
  schemaVersion: 1,
  mapId: "sm-card_1",
  status: "draft",
  shapeVersion: "spec-product_v2",
  provenance: ["human:card_1"],
  openDecisions: [],
  scopes: [
    {
      id: "S1",
      title: "Map section",
      outcome: "Every scope visible",
      capabilities: ["core"],
      inScope: ["the map section"],
      outOfScope: ["mutations"],
      dependsOn: [],
      status: "current",
    },
    {
      id: "S2",
      title: "Collapse rule",
      outcome: "Long AC collapsed",
      capabilities: ["ui"],
      inScope: ["the collapse rule"],
      outOfScope: [],
      dependsOn: ["S1"],
      status: "current",
    },
  ],
};

const STATE = [
  "---",
  "workflow_id: card_1",
  "intent: feature",
  "current_stage: scope",
  "status: active",
  "---",
  "",
  "## Notes",
].join("\n");

const ROOT = "/w";
const STATE_DIR = `${ROOT}/.stelow/2026-09-26/hash1`;

/** An in-memory checkout: the same read/write surface the host uses. */
function memoryFiles(initial = {}) {
  const files = { ...initial };
  return {
    files,
    read: async ({ path }) => {
      if (!(path in files)) throw new Error("ENOENT");
      return { content: files[path] };
    },
    write: async ({ path, content }) => {
      files[path] = content;
      return { outcome: "written" };
    },
  };
}

function depsFor(files, overrides = {}) {
  const card = {
    id: "card_1",
    dir_hash: "hash1",
    status: "in-progress",
    kind: "build",
  };
  return {
    bb: {
      sdk: {
        files,
      },
    },
    getCard: (id) => (id === card.id ? card : undefined),
    cardWorkspace: async () => ({ path: ROOT, hostId: "host1" }),
    workflowStateDir: async () => STATE_DIR,
    randomId: (prefix) => `${prefix}_1`,
    logCardComment: (...args) => {
      overrides.comment?.(args);
    },
    publish: () => {
      overrides.published?.();
    },
    errors: {
      cardNotFound: "Card not found.",
      cardArchived: "This card is archived.",
      workspaceUnavailable: "Workspace is unavailable.",
    },
  };
}

test("approving a draft stamps the map, mirrors the shape version, and records the trail", async () => {
  const files = memoryFiles({
    [`${STATE_DIR}/scope-map.json`]: `${JSON.stringify(DRAFT, null, 2)}\n`,
    [`${STATE_DIR}/state.md`]: STATE,
  });
  let comment = null;
  let published = false;
  const result = await approveScopeMapOnCard(
    depsFor(files, { comment: (a) => (comment = a), published: () => (published = true) }),
    "card_1",
  );

  assert.equal(result.ok, true, "a contract-valid draft is approvable");
  assert.equal(result.receiptId, "receipt_1", "the host mints the receipt");
  assert.equal(result.approvedBy, "operator", "a host approval is attributed to the operator, never the agent");
  assert.deepEqual(result.scopeIds, ["S1", "S2"]);

  const written = JSON.parse(files.files[`${STATE_DIR}/scope-map.json`]);
  assert.equal(written.status, "approved", "the map is stamped approved");
  assert.equal(written.approval.receiptId, "receipt_1", "the receipt is embedded in the map");
  assert.equal(written.approval.approvedBy, "operator");
  // The worker's draft fields survive: approval stamps, it does not rewrite.
  assert.equal(written.mapId, "sm-card_1");
  assert.equal(written.scopes.length, 2);

  const state = files.files[`${STATE_DIR}/state.md`];
  assert.match(state, /shape_version: spec-product_v2/, "the approved Shape version is mirrored so freshness is live");
  assert.match(state, /workflow_id: card_1/, "the mirror only touches the frontmatter, never the body");

  assert.ok(comment, "an openable trail comment is recorded");
  assert.equal(comment[3], "user", "the comment is authored by the human, not the agent");
  assert.match(comment[4], /Scope map approved/);
  assert.match(comment[4], /receipt_1/, "the comment names the receipt as evidence");
  assert.equal(published, true, "the card is republished so the UI draws the X-ray");
});

test("a missing map refuses and names where one comes from", async () => {
  const files = memoryFiles({ [`${STATE_DIR}/state.md`]: STATE });
  const result = await approveScopeMapOnCard(depsFor(files), "card_1");
  assert.equal(result.ok, false);
  assert.match(result.error, /no scope map to approve/, "the refusal names the missing artifact");
  assert.match(result.error, /scope stage/, "the refusal names the exit, not a dead end");
});

test("an off-contract map refuses and lists the exact failing fields", async () => {
  const broken = { mapId: "sm-card_1" };
  const files = memoryFiles({
    [`${STATE_DIR}/scope-map.json`]: JSON.stringify(broken),
    [`${STATE_DIR}/state.md`]: STATE,
  });
  const result = await approveScopeMapOnCard(depsFor(files), "card_1");
  assert.equal(result.ok, false);
  assert.match(result.error, /does not satisfy its contract/, "the refusal names the contract");
  assert.match(result.error, /schemaVersion/, "the refusal lists the fields that failed, not a generic error");
});

test("an already-approved map refuses rather than rewriting who signed it", async () => {
  const files = memoryFiles({
    [`${STATE_DIR}/scope-map.json`]: JSON.stringify({
      ...DRAFT,
      status: "approved",
      approval: { receiptId: "receipt_old", approvedBy: "operator" },
    }),
    [`${STATE_DIR}/state.md`]: STATE,
  });
  const result = await approveScopeMapOnCard(depsFor(files), "card_1");
  assert.equal(result.ok, false);
  assert.match(result.error, /already approved/, "re-approving says so, and why it matters");
});

test("a card with no owned state dir refuses with the redirect", async () => {
  const files = memoryFiles();
  const deps = depsFor(files);
  deps.workflowStateDir = async () => null;
  const result = await approveScopeMapOnCard(deps, "card_1");
  assert.equal(result.ok, false);
  assert.match(result.error, /no owned workflow state/, "the refusal names the missing state");
  assert.match(result.error, /scope stage/, "the refusal names the exit");
});

test("an archived card and an unknown card refuse before any file read", async () => {
  const files = memoryFiles();
  const archived = depsFor(files);
  archived.getCard = (id) => ({ id, dir_hash: "hash1", status: "archived", kind: "build" });
  const r1 = await approveScopeMapOnCard(archived, "card_1");
  assert.equal(r1.ok, false);
  assert.match(r1.error, /archived/);

  const missing = depsFor(files);
  missing.getCard = () => undefined;
  const r2 = await approveScopeMapOnCard(missing, "card_nope");
  assert.equal(r2.ok, false);
  assert.match(r2.error, /not found/i);
  assert.deepEqual(Object.keys(files.files), [], "a refused approval writes nothing");
});

console.log("scope map approval door test ok: the stamp, the mirror, the trail, and every refusal names its exit");
