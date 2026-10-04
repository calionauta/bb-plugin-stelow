import assert from "node:assert/strict";
import test from "node:test";
import { gateAsk, parseAskIntent, readCardReviewMode } from "../server/runtime/cli/cli-ask-gate.ts";

/**
 * The tag a scope confirm carries, and the mode the gate reads.
 *
 * Pattern 3 lives in skill prose; the host enforced nothing, so "Keep IN ×7"
 * arrived untagged in Auto and parked a card whose mode decides itself.
 * The tag marks the shape, the gate reads the workflow's own review_mode —
 * both directions pinned here: parsing accepts the tag and rejects typos,
 * and the mode reader fails open whenever the state is unreadable.
 */

const intent = (argv) => parseAskIntent(argv, { threadId: "thr_1" });
const scopeArgv = [
  "ask",
  "--thread", "thr_1",
  "--tag", "scope-adjust",
  "--question", "Keep IN scope?",
  "--multiple",
  "--option", "needsNaming helper", "--selected",
  "--option", "Start-time refire", "--selected",
];

test("--tag scope-adjust parses and keeps its shape", () => {
  const result = intent(scopeArgv);
  assert.ok(!("refusal" in result), "the tag is accepted");
  if ("refusal" in result) return;
  assert.equal(result.groups.length, 1);
  assert.equal(result.tag, "scope-adjust");
  assert.equal(result.groups[0].multiple, true);
  assert.deepEqual(
    result.groups[0].options.map((option) => option.selected === true),
    [true, true],
  );
});

test("a typo tag still refuses by name", () => {
  const result = intent(["ask", "--thread", "thr_1", "--tag", "scope", "--question", "Q?", "--option", "A", "--option", "B"]);
  assert.ok("refusal" in result);
  if (!("refusal" in result)) return;
  assert.match(result.refusal.stderr ?? "", /scope-adjust/, "and names the real tag");
});

const card = { id: "card_1", dir_hash: "abc123" };
const stateDeps = (state) => ({
  cardWorkspace: async () => ({ path: "/work" }),
  workflowStateDir: async () => "/work/.stelow/x",
  bb: { sdk: { files: { read: async () => ({ content: state }) } } },
});

test("the mode reader returns the workflow's own label", async () => {
  assert.equal(
    await readCardReviewMode(stateDeps("review_mode: Auto\n"), card),
    "Auto",
  );
  assert.equal(
    await readCardReviewMode(stateDeps("review_mode: Product Spec Gate\n"), card),
    "Product Spec Gate",
  );
});

test("the mode reader fails open on anything unreadable", async () => {
  assert.equal(await readCardReviewMode(stateDeps(null), card), null, "no state text");
  assert.equal(
    await readCardReviewMode(stateDeps("review_mode: Auto\n"), { id: "card_1", dir_hash: null }),
    null,
    "no state dir without a hash",
  );
  const noWorkspace = { ...stateDeps("review_mode: Auto\n"), cardWorkspace: async () => null };
  assert.equal(await readCardReviewMode(noWorkspace, card), null, "no workspace");
  const noDir = { ...stateDeps("review_mode: Auto\n"), workflowStateDir: async () => null };
  assert.equal(await readCardReviewMode(noDir, card), null, "no state dir");
  const throwing = { ...stateDeps("review_mode: Auto\n"), workflowStateDir: async () => { throw new Error("boom"); } };
  assert.equal(await readCardReviewMode(throwing, card), null, "a throw is a null, never a crash");
});

console.log("scope adjust ask test ok: the tag parses, the mode reads, unreadable fails open");

// The missing link neither unit proves: gateAsk threading the reader into
// the dispatcher. If readCardReviewMode always returned null, every test
// above would still pass while Auto cards asked freely — so an Auto state
// must refuse here, and an unreadable one must allow.
function gateDeps(state) {
  const card = {
    id: "card_1", kind: "build", intent: "feature", stage: "scope",
    dir_hash: "abc123", worker_thread_id: "thr_1",
  };
  return {
    getCard: () => card,
    openExpiredQuestionIds: () => [],
    cardStageSlug: async () => "scope",
    ...stateDeps(state),
  };
}

const scopeGroups = [{
  question: "Keep IN scope?",
  multiple: true,
  options: [
    { label: "needsNaming helper", description: "predicate", preview: null, artifact: null, selected: true },
    { label: "Start-time refire", description: "burst", preview: null, artifact: null, selected: true },
  ],
}];

test("gateAsk refuses an Auto scope ask end to end", async () => {
  const refusal = await gateAsk(gateDeps("review_mode: Auto\n"), "card_1", [], "scope-adjust", scopeGroups, ["ask"]);
  assert.match(refusal?.refusal?.stderr ?? "", /review mode is Auto/, "the reader output reaches the dispatcher");
});

test("gateAsk allows when the mode is unreadable", async () => {
  const refusal = await gateAsk(gateDeps(null), "card_1", [], "scope-adjust", scopeGroups, ["ask"]);
  assert.equal(refusal, null, "fail-open: no mode, no refusal");
});
