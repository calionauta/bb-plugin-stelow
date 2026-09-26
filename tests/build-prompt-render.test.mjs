import assert from "node:assert/strict";
import { buildBuildPrompt } from "../server/cards-create-prompt.ts";

// Behavior first: the initial build prompt is the only thing that tells a card
// worker what was asked, which state dir it owns, and which gates it must
// keep. A template that renders with every clause empty produces a worker
// that opens a question about a request it never received — the exact failure
// this asserts against. Topology pins on the template cannot catch it: the
// tokens were all present while the rendered prompt was blank.

const context = {
  stateDir: "/repo/.stelow/2026-09-26/sw-card_probe",
  intent: "feature",
  managedWorktree: true,
  appetite: "Core",
  reviewGates: "Product Spec, Interface, Scopes",
  reviewRung: "Product Spec + Interface + Scopes",
  instructions: "Preset instructions:\nstay narrow\n",
  prompt: "Add a read-only Scope Map view to an existing Build card.",
};

const rules = {
  cardOwnerRules: "OWNER_RULES_SENTINEL",
  neverSeed: "NEVER_SEED_SENTINEL",
  cliEquivalents: "CLI_EQUIVALENTS_SENTINEL",
  reconProtocol: "RECON_PROTOCOL_SENTINEL",
  draftProtocol: "DRAFT_PROTOCOL_SENTINEL",
  turnDiscipline: "TURN_DISCIPLINE_SENTINEL",
  commitStyle: "COMMIT_STYLE_SENTINEL",
  interfacePick: "INTERFACE_PICK_SENTINEL",
  doneProtocol: "DONE_PROTOCOL_SENTINEL",
  splitProtocol: "SPLIT_PROTOCOL_SENTINEL",
};

const prompt = buildBuildPrompt(context, rules);

// The request reaches the worker.
assert.ok(prompt.includes(context.prompt), "the request body reaches the worker prompt");
assert.ok(
  prompt.trimEnd().endsWith(context.prompt),
  "the request is the last thing in the prompt, under its own Request heading",
);

// Card identity and gates are stated, not implied.
assert.ok(prompt.includes(context.stateDir), "the owned state dir is named");
assert.ok(prompt.includes("intent=`feature`"), "the seeded intent is stated");
assert.ok(prompt.includes("Appetite=`Core`"), "the recorded appetite is stated");
assert.ok(prompt.includes("Product Spec, Interface, Scopes"), "the recorded review gates are stated");
assert.ok(prompt.includes("stay narrow"), "preset instructions are forwarded");
assert.ok(
  prompt.includes("BB provisioned the managed worktree"),
  "a managed worktree tells the worker where code belongs",
);

// Every protocol clause survives rendering, not just authoring.
for (const [name, sentinel] of Object.entries(rules)) {
  assert.ok(prompt.includes(sentinel), `${name} reaches the rendered prompt`);
}

// No token is left unresolved and none was rendered as an empty hole.
assert.equal(prompt.match(/%[A-Z_]+%/g), null, "no template token survives rendering");
assert.ok(!prompt.includes("state dir()"), "the state dir placeholder rendered a value");
assert.ok(!/Request:\s*$/.test(prompt), "the request heading is not left empty");

// A worktree-free card drops only the workspace note, never the request.
const plain = buildBuildPrompt({ ...context, managedWorktree: false }, rules);
assert.ok(plain.includes(context.prompt), "the request survives without a managed worktree");
assert.ok(!plain.includes("BB provisioned the managed worktree"), "no worktree, no worktree note");

console.log("build prompt render test ok: request, state dir, intent, appetite, gates, instructions and every protocol clause reach the worker");
