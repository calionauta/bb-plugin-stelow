import assert from "node:assert/strict";
import { statusForNewCardWork } from "../lib/card-work-resume.mjs";

// A request on a completed card starts a new worker turn, so Done publication
// state must disappear immediately. The stage remains owned by state.md until
// the worker deliberately advances/rejects it.
assert.deepEqual(
  statusForNewCardWork({ kind: "build", status: "completed", stage: "audit" }),
  { status: "in-progress", reopened: true },
  "a completed Build card reopens without inventing a new stage",
);
assert.deepEqual(
  statusForNewCardWork({ kind: "research", status: "completed", stage: "research" }),
  { status: "in-progress", reopened: true },
  "a completed lightweight card also reopens for new work",
);
assert.deepEqual(
  statusForNewCardWork({ kind: "build", status: "draft", stage: "triage" }),
  { status: "draft", reopened: false },
  "an active triage worker remains a draft",
);
assert.deepEqual(
  statusForNewCardWork({ kind: "build", status: "draft", stage: "context" }),
  { status: "in-progress", reopened: false },
  "a Build workflow leaving triage becomes in progress",
);
assert.deepEqual(
  statusForNewCardWork({ kind: "build", status: "in-progress", stage: "audit" }),
  { status: "in-progress", reopened: false },
  "an already-active card is unchanged",
);

console.log("card work resume test ok: new requests reopen completion without drifting the workflow stage");
