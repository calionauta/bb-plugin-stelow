import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { executionRunDeepLink, executionRunFocus, executionRunSubPath, parseExecutionRunSubPath } from "../lib/execution-deep-link.mjs";

const appSource = readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "app.tsx"), "utf8");
assert.match(appSource, /localRunId:\s*run\.id/, "run rows use the tested in-app route builder");
assert.doesNotMatch(appSource, /localRunId:\s*run\.runId/, "native run identity never becomes in-app navigation");
assert.match(appSource, /executionRunFocus\(/, "deep-open focus uses the shared state mapping");
assert.match(appSource, /execution-needs-input-questions/, "needs_input deep-open names the real card question target");

const expectedFocus = {
  queued: "run",
  running: "run",
  needs_input: "question",
  succeeded: "history",
  failed: "history",
  cancelled: "history",
};

for (const [status, focus] of Object.entries(expectedFocus)) {
  const input = { track: "build", cardId: "card_contract", localRunId: `exec_${status}`, status, nativeRunId: "native-run-id", previewDirective: "preview-directive" };
  const link = executionRunDeepLink(input);
  assert.equal(link?.kind, "card-run", `${status} has an in-app run link`);
  assert.equal(link?.focus, focus, `${status} opens the ${focus} surface`);
  assert.equal(link?.localRunId, input.localRunId, `${status} navigates by the local ledger id`);
  assert.equal("nativeRunId" in (link ?? {}), false, `${status} does not expose native identity as navigation`);
  assert.equal("previewDirective" in (link ?? {}), false, `${status} does not expose preview evidence as navigation`);
  assert.equal(executionRunSubPath(input), `build/card/card_contract/run/${input.localRunId}`, `${status} has a stable panel subpath`);
  assert.equal(executionRunFocus({ localRunId: input.localRunId, status, hasQuestion: true }), status === "needs_input" ? "execution-needs-input-questions" : `execution-run-${input.localRunId}`, `${status} has a deterministic focus target`);
}

assert.equal(executionRunDeepLink({ track: "build", cardId: "card_contract", localRunId: "exec-paused", status: "paused" }), null, "unsupported states do not invent a route");
assert.equal(executionRunDeepLink({ track: "build", cardId: "card_contract", localRunId: "run-native", status: "running" }), null, "native ids are not in-app route identities");
assert.equal(executionRunSubPath({ track: "build", cardId: "card_contract", localRunId: "exec_running", status: "running", previewDirective: "preview" }), "build/card/card_contract/run/exec_running", "preview directives do not change the route");
assert.equal(executionRunFocus({ localRunId: "exec_needs_input", status: "needs_input", hasQuestion: false }), "execution-run-exec_needs_input", "a missing question falls back to the run row instead of failing silently");
assert.deepEqual(parseExecutionRunSubPath("build/card/card_contract/event/evt_boundary/run/exec_running"), { track: "build", cardId: "card_contract", eventId: "evt_boundary", localRunId: "exec_running" }, "tracked and event-plus-run paths parse through the shared grammar");
assert.deepEqual(parseExecutionRunSubPath("card/card_contract/run/exec_running"), { track: null, cardId: "card_contract", eventId: null, localRunId: "exec_running" }, "bare card run paths remain supported");
assert.equal(parseExecutionRunSubPath("build/card/card_contract/run/run-native"), null, "parser refuses native ids");

console.log("execution deep-link test ok: six-state focus matrix, local identity, unsupported-state refusal");
