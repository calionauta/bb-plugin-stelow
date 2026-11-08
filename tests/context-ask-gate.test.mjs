import assert from "node:assert/strict";
import { decideAskGate } from "../lib/question-gate.mjs";
import { parseAskGroups } from "../lib/question-batch.mjs";

// context:5 permits a reduced opt-in ask for refactor/bugfix when the
// baseline is verifiable. The host cannot inspect that methodology predicate,
// so it has no intent gate of its own: an intent or stage it cannot classify
// must reach the human. Only the gates it can read may refuse.
const gateGroups = [{
  question: "Approve the plan?",
  options: [{ label: "Approve", description: "go", preview: null, artifact: null }],
}];

const decide = ({
  stage = "context",
  tag = null,
  intent = "refactor",
  kind = "build",
  argv = ["ask", "--thread", "t"],
} = {}) => decideAskGate({
  liveCount: 0,
  expiredCount: 0,
  kind,
  intent,
  stage,
  tag,
  forced: argv.includes("--force"),
  groups: gateGroups,
  reviewMode: null,
});

// The removed intent gate's whole matrix, asserted through the dispatcher:
// every intent/stage pair it used to read still reaches the human.
for (const intent of ["refactor", "bugfix", "feature", "unknown"]) {
  assert.equal(decide({ intent }).allowed, true, `intent "${intent}" is not a gate at context`);
}
for (const stage of ["select", "shape"]) {
  assert.equal(decide({ stage }).allowed, true, `stage "${stage}" is not a gate either`);
}
assert.equal(decide({ kind: "research" }).allowed, true, "other tracks are untouched");
assert.equal(decide({ tag: "split" }).allowed, true, "split mechanics keep their own branch");

// Host wiring (behavioral): the ask handler reaches the gates it still has
// through the shared dispatcher on slug truth before anything persists — a
// refusal never pings the human. `--force` passes through the group parser
// untouched (unknown flags are ignored there).
{
  // Slug truth decides: a gateless plan-gate ask refuses, planning passes.
  const refused = decide({ stage: "plan-gate" });
  assert.equal(refused.allowed, false, "a gateless plan-gate ask refuses before anything persists");
  assert.match(refused.reason, /nothing to review/, "the refusal names the failure");
  assert.equal(refused.code, 2, "a gate refusal is terminal, never retried blindly");
  assert.equal(decide({ stage: "planning" }).allowed, true, "planning questions are untouched by the gate");
  // The explicit override reaches the gate through the dispatcher.
  assert.equal(
    decide({ stage: "plan-gate", argv: ["ask", "--thread", "t", "--force"] }).allowed,
    true,
    "--force opts back in through the shared dispatcher",
  );
  // --force passes through the group parser untouched: it is not a group
  // flag, so the question groups parse exactly as without it.
  const plain = parseAskGroups(["--question", "Q?", "--option", "A", "--option", "B"]);
  const withForce = parseAskGroups(["--force", "--question", "Q?", "--option", "A", "--option", "B"]);
  assert.deepEqual(withForce.groups, plain.groups, "--force does not disturb group parsing");
}

console.log("context ask gate test ok: context asks reach the human, only readable gates refuse");
