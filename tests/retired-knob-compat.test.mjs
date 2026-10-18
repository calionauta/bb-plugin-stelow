import assert from "node:assert/strict";
import test from "node:test";
import { cardRpcContract } from "../server/card-rpc-contract.ts";
import { boardWorkflowDefaultsSchema } from "../server/contracts.ts";

// Retiring a stored key is a data question before it is a UI question.
//
// The `supervisor` knob was removed from the composer and the worker prompt,
// but it is still written in rows on disk: one kv row holding the board
// defaults, and `state.md` / `stelow.json` for every card seeded earlier.
// Those readers are `.strict()`, so dropping the key from a schema does not
// ignore the field — it rejects the whole payload, and for the kv row that
// means `readBoardWorkflowDefaults` falls back to the defaults and silently
// resets the operator's review gates to Auto.
//
// So the key is absorbed on read and never emitted. These pins hold that
// asymmetry in place: tolerant where old data arrives, strict where anything
// else does, and absent from what the host advertises.

test("the board defaults still absorb a stored supervisor without losing the gates", () => {
  const row = boardWorkflowDefaultsSchema.safeParse({
    quality: "production",
    supervisor: "high",
    explorationCount: 3,
    reviewMode: "Product Spec + Interface + Scopes",
    reviewGates: ["spec", "interface", "scope"],
  });
  assert.equal(row.success, true, "a row written before the knob retired must still parse");
  assert.deepEqual(row.data.reviewGates, ["spec", "interface", "scope"], "the operator's gates survive");
  assert.equal(row.data.supervisor, "high", "the value is read, not erased, so a caller can see what was stored");
});

test("absorbing one legacy key did not make the row schema lax", () => {
  const row = boardWorkflowDefaultsSchema.safeParse({
    quality: "production",
    explorationCount: 3,
    reviewMode: "Auto",
    reviewGates: [],
    somethingElse: true,
  });
  assert.equal(row.success, false, "an unknown key is still refused; only the named legacy key is tolerated");
});

test("createCard accepts a caller built before the knob retired", () => {
  const call = cardRpcContract.createCard.input.safeParse({
    projectId: "p1",
    prompt: "retire the thing",
    supervisor: "high",
  });
  assert.equal(call.success, true, "a pre-retirement client must not be refused at the seam");
});

test("createCard stays strict about keys that were never part of the contract", () => {
  const call = cardRpcContract.createCard.input.safeParse({
    projectId: "p1",
    prompt: "retire the thing",
    notARealKnob: 1,
  });
  assert.equal(call.success, false, "tolerance is named and singular, not a general loosening");
});

test("boardWorkflowDefaults does not advertise a key it never emits", () => {
  const out = cardRpcContract.boardWorkflowDefaults.output;
  assert.ok(out && typeof out === "object" && "shape" in out, "zod object expected");
  const keys = Object.keys(out.shape);
  assert.equal(
    keys.includes("supervisor"),
    false,
    "the retired knob is absorbed on input only — declaring it on the output claims the host still sends it",
  );
  assert.ok(keys.includes("reviewGates"), "the shape is the real one, not an empty object");
});
