import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTEXT_SKIP_INTENTS, CONTEXT_STAGE, contextAskGate } from "../lib/context-ask-gate.mjs";

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

// Host wiring: the ask handler enforces the gate on slug truth before
// anything persists — a refusal never pings the human. `--force` passes
// through the group parser untouched (unknown flags are ignored there).
const serverSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server.ts"), "utf8");
assert.match(serverSource, /contextAskGate\(\{/, "the ask handler decides through the shared gate");
assert.match(serverSource, /stage: gateCard \? await cardStageSlug\(gateCard\) : null/, "the gate reads slug truth");
assert.match(serverSource, /forced: argv\.includes\("--force"\)/, "the explicit override reaches the gate");

console.log("context ask gate test ok: context:5 reduced asks remain possible, force opts back in");
