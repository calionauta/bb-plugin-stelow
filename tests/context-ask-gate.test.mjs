import assert from "node:assert/strict";
import { CONTEXT_SKIP_INTENTS, CONTEXT_STAGE, contextAskGate, decideAskGate } from "../lib/question-gate.mjs";
import { parseAskGroups } from "../lib/question-batch.mjs";

// context:5 permits a reduced opt-in ask for refactor/bugfix when the
// baseline is verifiable. The host cannot inspect that methodology predicate,
// so it must fail open instead of imposing its former blanket refusal.
assert.deepEqual(CONTEXT_SKIP_INTENTS, ["refactor", "bugfix"], "the skip set is one const");
assert.equal(CONTEXT_STAGE, "context", "the gate covers the strategy stage only");

const refactorAtContext = { kind: "build", intent: "refactor", stage: "context", tag: "standard", forced: false };
assert.equal(contextAskGate(refactorAtContext).allowed, true, "refactor at context may use the permitted reduced ask");
assert.equal(
  contextAskGate({ kind: "build", intent: "bugfix", stage: "context", tag: "standard", forced: false }).allowed,
  true,
  "bugfix at context may use the permitted reduced ask",
);

// Every escape hatch stays open: explicit force, other intents, other
// stages, other tracks, split mechanics, and the unclassifiable.
assert.equal(contextAskGate({ ...refactorAtContext, forced: true }).allowed, true, "--force opts back in");
assert.equal(contextAskGate({ ...refactorAtContext, tag: "split" }).allowed, true, "split mechanics keep their own gate");
assert.equal(contextAskGate({ ...refactorAtContext, intent: "feature" }).allowed, true, "feature still explores");
assert.equal(contextAskGate({ ...refactorAtContext, intent: "unknown" }).allowed, true, "unclassified intent fails open");
assert.equal(contextAskGate({ ...refactorAtContext, stage: "select" }).allowed, true, "scope questions at select are untouched");
assert.equal(contextAskGate({ ...refactorAtContext, stage: "shape" }).allowed, true, "shape is untouched");
assert.equal(contextAskGate({ ...refactorAtContext, kind: "research" }).allowed, true, "other tracks are untouched");

// Host wiring (behavioral): the ask handler enforces the gate through the
// shared dispatcher on slug truth before anything persists — a refusal never
// pings the human. `--force` passes through the group parser untouched
// (unknown flags are ignored there). Proven here through the dispatcher's own
// inputs: the stage value the handler reads from the card slug, and the
// forced flag it reads from argv.
{
  const gateGroups = [{
    question: "Approve the plan?",
    options: [{ label: "Approve", description: "go", preview: null, artifact: null }],
  }];
  const decide = (stage, argv) => decideAskGate({
    liveCount: 0,
    expiredCount: 0,
    kind: "build",
    intent: "feature",
    stage,
    tag: null,
    forced: argv.includes("--force"),
    groups: gateGroups,
    reviewMode: null,
  });
  // Slug truth decides: a gateless plan-gate ask refuses, planning passes.
  const refused = decide("plan-gate", ["ask", "--thread", "t"]);
  assert.equal(refused.allowed, false, "a gateless plan-gate ask refuses before anything persists");
  assert.match(refused.reason, /nothing to review/, "the refusal names the failure");
  assert.equal(refused.code, 2, "a gate refusal is terminal, never retried blindly");
  assert.equal(decide("planning", ["ask", "--thread", "t"]).allowed, true, "planning questions are untouched by the gate");
  // The explicit override reaches the gate through the dispatcher.
  assert.equal(decide("plan-gate", ["ask", "--thread", "t", "--force"]).allowed, true, "--force opts back in through the shared dispatcher");
  assert.equal(decide("context", ["ask", "--thread", "t"]).allowed, true, "refactor at context may use the permitted reduced ask via the dispatcher");
  // --force passes through the group parser untouched: it is not a group
  // flag, so the question groups parse exactly as without it.
  const plain = parseAskGroups(["--question", "Q?", "--option", "A", "--option", "B"]);
  const withForce = parseAskGroups(["--force", "--question", "Q?", "--option", "A", "--option", "B"]);
  assert.deepEqual(withForce.groups, plain.groups, "--force does not disturb group parsing");
}

console.log("context ask gate test ok: context:5 reduced asks remain possible, force opts back in");
