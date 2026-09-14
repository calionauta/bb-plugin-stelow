import assert from "node:assert/strict";
import { questionOpenGuard } from "../lib/question-presence.mjs";

assert.deepEqual(questionOpenGuard({ liveInteractions: 0, expiredQuestions: 0 }), { canOpen: true, reason: null }, "no visible form permits a fresh ask");
assert.equal(questionOpenGuard({ liveInteractions: 1, expiredQuestions: 0 }).canOpen, false, "a live form prevents a duplicate ask");
assert.equal(questionOpenGuard({ liveInteractions: 0, expiredQuestions: 1 }).canOpen, false, "a recovered card question prevents a duplicate ask");
assert.match(questionOpenGuard({ liveInteractions: 0, expiredQuestions: 2 }).reason, /still answerable on this card/, "the worker gets an actionable recovery explanation");

console.log("question-presence test ok: only visible or recoverable card forms block a new ask");
