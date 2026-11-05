import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { approveScopeMapOnCard } from "../server/scope-map-approval.ts";

const ROOT = "/scope-cas-fixture";
const STATE_DIR = `${ROOT}/.stelow/2026-11-05/cas-fixture`;
const MAP_PATH = `${STATE_DIR}/scope-map.json`;
const STATE_PATH = `${STATE_DIR}/state.md`;
const DRAFT = {
  schemaVersion: 1,
  mapId: "sm-cas-fixture",
  status: "draft",
  shapeVersion: "spec-product_v2.md",
  provenance: ["scope-stage:fixture"],
  openDecisions: [],
  scopes: [{
    id: "S1",
    title: "Zoë’s résumé",
    outcome: "An independently reviewed boundary survives approval",
    capabilities: ["evidence"],
    inScope: ["Preserve the existing boundary"],
    outOfScope: ["Silent replacement"],
    dependsOn: [],
    status: "current",
  }],
};
const RAW_DRAFT = ` \r\n${JSON.stringify(DRAFT, null, "\t")}\r\n`;
const STATE = [
  "---",
  "workflow_id: card_1",
  "current_stage: scope",
  "shape_version: spec-product_v1.md",
  "started_at: 2026-11-05T06:24:00Z",
  "custom_field: preserve-this-value",
  "---",
  "",
  "## Evidence",
  "Keep receipt_original and Zoë’s résumé.",
  "",
].join("\n");
const sha256 = (content) => createHash("sha256").update(content, "utf8").digest("hex");

/** Model the SDK: null means create-only; a digest compares exact current bytes. */
function casFiles(initial, hooks = {}) {
  const contents = new Map(Object.entries(initial));
  const reads = [];
  const writes = [];
  return {
    contents, reads, writes,
    read: async ({ path }) => {
      hooks.beforeRead?.({ path }, contents);
      reads.push(path);
      if (!contents.has(path)) throw new Error("ENOENT");
      return { content: contents.get(path) };
    },
    write: async (request) => {
      hooks.beforeWrite?.(request, contents);
      const exists = contents.has(request.path);
      const currentHash = exists ? sha256(contents.get(request.path)) : null;
      const expected = request.expectedSha256;
      const matches = expected === undefined
        || (expected === null ? !exists : expected === currentHash);
      const outcome = matches ? "written" : "conflict";
      writes.push({ ...request, outcome });
      if (!matches) return { outcome: "conflict" };
      contents.set(request.path, request.content);
      return { outcome: "written", sha256: sha256(request.content) };
    },
  };
}

function fixture({ mapText = RAW_DRAFT, stateText = STATE, status = "in-progress", hooks } = {}) {
  const files = casFiles({ [MAP_PATH]: mapText, [STATE_PATH]: stateText }, hooks);
  const effects = { comments: [], published: [] };
  let sequence = 0;
  const card = { id: "card_1", dir_hash: "cas-fixture", status, kind: "build" };
  const deps = {
    bb: { sdk: { files } },
    getCard: (id) => id === card.id ? card : undefined,
    cardWorkspace: async () => ({ path: ROOT, hostId: "host-fixture" }),
    workflowStateDir: async () => STATE_DIR,
    randomId: (prefix) => `${prefix}_${++sequence}`,
    logCardComment: (...args) => effects.comments.push(args),
    publish: (id) => effects.published.push(id),
    errors: {
      cardNotFound: "Card not found.",
      cardArchived: "This card is archived.",
      workspaceUnavailable: "Workspace is unavailable.",
    },
  };
  return { files, effects, deps };
}

function withoutShapeVersion(text) {
  return text.split("\n").filter((line) => !line.startsWith("shape_version:")).join("\n");
}

function assertStatePreserved(actual, original) {
  assert.equal(withoutShapeVersion(actual), withoutShapeVersion(original));
  assert.equal(actual.match(/^shape_version:.*$/gm)?.length, 1);
}

test("existing UTF-8 draft approves once using read-byte CAS and preserves state", async () => {
  const { files, effects, deps } = fixture();
  const result = await approveScopeMapOnCard(deps, "card_1");
  assert.equal(result.ok, true, "an unchanged existing draft must be approvable");
  const approvedText = files.contents.get(MAP_PATH);
  const approved = JSON.parse(approvedText);
  assert.equal(approved.status, "approved");
  assert.equal(approved.approval.receiptId, result.receiptId);
  assert.deepEqual(approved.scopes, DRAFT.scopes);
  assert.deepEqual(approved.provenance, DRAFT.provenance);
  assert.equal(files.writes.find((write) => write.path === MAP_PATH).expectedSha256, sha256(RAW_DRAFT));
  assert.equal(files.writes.find((write) => write.path === STATE_PATH).expectedSha256, sha256(STATE));
  const mirrored = files.contents.get(STATE_PATH);
  assert.match(mirrored, /^shape_version: spec-product_v2\.md$/m);
  assertStatePreserved(mirrored, STATE);
  assert.equal(effects.comments.length, 1);
  assert.deepEqual(effects.published, ["card_1"]);
  assert.ok(effects.comments[0][4].includes(result.receiptId));

  const second = await approveScopeMapOnCard(deps, "card_1");
  assert.equal(second.ok, false, "an approval cannot rewrite its original receipt");
  assert.equal(files.contents.get(MAP_PATH), approvedText);
  assert.equal(files.contents.get(STATE_PATH), mirrored);
  assert.equal(effects.comments.length, 1);
  assert.equal(effects.published.length, 1);
});

test("a real map edit between read and CAS refuses without a forged approval trail", async () => {
  const edited = `${JSON.stringify({ ...DRAFT, openDecisions: ["A new boundary needs review"] })}\n`;
  let raced = false;
  const { files, effects, deps } = fixture({ hooks: {
    beforeWrite: (request, contents) => {
      if (request.path !== MAP_PATH || raced) return;
      raced = true;
      contents.set(MAP_PATH, edited);
    },
  } });
  const result = await approveScopeMapOnCard(deps, "card_1");
  assert.equal(raced, true, "the test must reach the conditional map write");
  assert.equal(result.ok, false);
  assert.equal(result.receiptId, undefined);
  assert.equal(files.contents.get(MAP_PATH), edited, "the competing draft wins without being signed");
  assert.equal(JSON.parse(files.contents.get(MAP_PATH)).approval, undefined);
  assert.equal(files.contents.get(STATE_PATH), STATE);
  assert.equal(files.writes.some((write) => write.outcome === "written"), false);
  assert.deepEqual(effects.comments, []);
  assert.deepEqual(effects.published, []);
});

test("the state mirror uses the latest bytes from its own read", async () => {
  const latest = STATE.replace("custom_field: preserve-this-value", "custom_field: changed-before-state-read");
  let stateAdvanced = false;
  const { files, deps } = fixture({ hooks: {
    beforeRead: (request, contents) => {
      if (request.path !== STATE_PATH || stateAdvanced) return;
      stateAdvanced = true;
      contents.set(STATE_PATH, latest);
    },
  } });
  const result = await approveScopeMapOnCard(deps, "card_1");
  assert.equal(result.ok, true);
  assert.equal(stateAdvanced, true);
  const stateWrite = files.writes.find((write) => write.path === STATE_PATH);
  assert.ok(stateWrite, "existing state must actually be mirrored");
  assert.equal(stateWrite.expectedSha256, sha256(latest), "state CAS uses its own read bytes, not the map version");
  const mirrored = files.contents.get(STATE_PATH);
  assert.match(mirrored, /^shape_version: spec-product_v2\.md$/m);
  assertStatePreserved(mirrored, latest);
});

test("a state edit after its read is never clobbered by the shape mirror", async () => {
  const concurrent = STATE.replace("current_stage: scope", "current_stage: verification")
    .replace("custom_field: preserve-this-value", "custom_field: concurrent-state-edit");
  let raced = false;
  const { files, deps } = fixture({ hooks: {
    beforeWrite: (request, contents) => {
      if (request.path !== STATE_PATH || raced) return;
      raced = true;
      contents.set(STATE_PATH, concurrent);
    },
  } });
  await approveScopeMapOnCard(deps, "card_1");
  assert.equal(raced, true, "the mirror race must be exercised, not skipped");
  const writes = files.writes.filter((write) => write.path === STATE_PATH);
  assert.equal(writes[0].expectedSha256, sha256(STATE));
  assert.equal(writes[0].outcome, "conflict", "the actual edit invalidates the prior state read");
  assertStatePreserved(files.contents.get(STATE_PATH), concurrent);
  // A conflict may be reported or retried against a fresh read; neither may lose the edit.
});

test("an existing approval and its original receipt are never rewritten", async () => {
  const original = `${JSON.stringify({
    ...DRAFT, status: "approved",
    approval: { receiptId: "receipt_original", approvedBy: "original-operator" },
  }, null, "\t")}\n`;
  const { files, effects, deps } = fixture({ mapText: original });
  const result = await approveScopeMapOnCard(deps, "card_1");
  assert.equal(result.ok, false);
  assert.equal(files.contents.get(MAP_PATH), original);
  assert.equal(files.contents.get(STATE_PATH), STATE);
  assert.deepEqual(files.writes, []);
  assert.deepEqual(effects.comments, []);
  assert.deepEqual(effects.published, []);
});

test("archived cards refuse approval before file access or publication", async () => {
  const { files, effects, deps } = fixture({ status: "archived" });
  const result = await approveScopeMapOnCard(deps, "card_1");
  assert.equal(result.ok, false);
  assert.match(result.error, /archived/i);
  assert.equal(files.contents.get(MAP_PATH), RAW_DRAFT);
  assert.equal(files.contents.get(STATE_PATH), STATE);
  assert.deepEqual(files.reads, []);
  assert.deepEqual(files.writes, []);
  assert.deepEqual(effects.comments, []);
  assert.deepEqual(effects.published, []);
});
