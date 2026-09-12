import assert from "node:assert/strict";
import { ownsWorkflowState, stateWorkflowId, upsertWorkflowEntry, workflowDirHash, workflowEntryForOwner, workflowStateRelativeDir } from "../lib/workflow-state-identity.mjs";

const oldSameName = { name: "jogo-da-velha", dirHash: "pw-old", created: "2026-09-04T17:14:57.065Z" };
const firstCard = { workflowId: "card_first", name: "jogo-da-velha", dirHash: "pw-first", created: "2026-09-12T20:00:00.000Z" };
const secondCard = { workflowId: "card_second", name: "jogo-da-velha", dirHash: "pw-second", created: "2026-09-12T20:01:00.000Z" };

// A legacy name-only row is intentionally unclaimable: guessing is how cards
// used to inherit each other's state.
assert.equal(workflowEntryForOwner([oldSameName], "card_first"), null);

const afterFirst = upsertWorkflowEntry([oldSameName], firstCard);
const afterSecond = upsertWorkflowEntry(afterFirst, secondCard);
assert.equal(afterSecond.length, 3, "same-name cards coexist instead of replacing each other");
assert.equal(workflowEntryForOwner(afterSecond, "card_first", "pw-first"), firstCard);
assert.equal(workflowEntryForOwner(afterSecond, "card_second", "pw-second"), secondCard);
assert.equal(workflowEntryForOwner(afterSecond, "card_second", "pw-first"), null, "dir hashes cannot cross owners");
assert.equal(workflowStateRelativeDir(firstCard), ".stelow/2026-09-12/pw-first");
assert.equal(workflowDirHash("card_first", false, 1), "pw-card_first");
assert.equal(workflowDirHash("card_first", true, 36), "pw-card_first-10");
assert.notEqual(workflowDirHash("card_first"), workflowDirHash("card_second"), "different cards have different state directories");

const firstState = "---\nworkflow_id: card_first\nname: jogo-da-velha\ncurrent_stage: triage\n---\n";
assert.equal(stateWorkflowId(firstState), "card_first");
assert.equal(ownsWorkflowState(firstState, "card_first"), true);
assert.equal(ownsWorkflowState(firstState, "card_second"), false, "a state file never belongs to a same-name card");

const updatedFirst = { ...firstCard, dirHash: "pw-reseed" };
const afterReseed = upsertWorkflowEntry(afterSecond, updatedFirst);
assert.equal(afterReseed.length, 3, "reseed replaces only the same owner");
assert.equal(workflowEntryForOwner(afterReseed, "card_first", "pw-reseed")?.dirHash, "pw-reseed");

console.log("workflow state identity test ok: immutable owner, exact lookup, fail-closed legacy rows");
