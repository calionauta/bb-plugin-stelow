import assert from "node:assert/strict";
import { classifyAskCancel, interruptionWhy, TRANSIENT_CANCEL_REASONS } from "../lib/ask-cancel.mjs";

// Full cancel-reason matrix: only infrastructure transients persist.
assert.equal(classifyAskCancel("submitted", null), "passthrough", "answered questions pass through");
assert.equal(classifyAskCancel("submitted", "timeout"), "passthrough", "outcome wins over reason");
for (const reason of TRANSIENT_CANCEL_REASONS) {
  assert.equal(classifyAskCancel("cancelled", reason), "persist", `${reason} persists the question`);
}
for (const reason of ["user", "thread-stopped", "thread-deleted"]) {
  assert.equal(classifyAskCancel("cancelled", reason), "passthrough", `explicit end state ${reason} passes through`);
}
assert.equal(classifyAskCancel("cancelled", "bogus-reason"), "passthrough", "unknown reasons default to passthrough");
assert.equal(classifyAskCancel("cancelled", null), "passthrough", "missing reason defaults to passthrough");
assert.equal(classifyAskCancel("cancelled", "user", true), "persist", "a throwing request persists regardless of reason");

// Worker-facing honesty: never blame the user for infrastructure drops.
assert.match(interruptionWhy("timeout", false, 3600), /away/, "timeout blames absence");
assert.match(interruptionWhy("plugin-disposed", false, 12), /plugin reload/, "reload names the real cause");
assert.match(interruptionWhy("server-restarted", false, 12), /server-restarted/, "restart names the real cause");
assert.match(interruptionWhy(null, true, 3), /failed before delivery/, "throw path is honest");

console.log("ask cancel test ok: full reason matrix, honest worker messaging");
