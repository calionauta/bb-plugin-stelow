// Behavior: the wiring seams the composition root depends on answer for
// themselves. Every test here fails if a rule moves back into the root, or if
// the root's late-bound seam is smuggled through a module-level variable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCardByWorkerThread } from "../server/runtime/thread-card-lookup.ts";
import { startWorkflowPrompt } from "../server/runtime/start-workflow-prompt.ts";
import { deferred } from "../server/runtime/wiring/deferred.ts";
import { githubUnavailableStatus } from "../server/github-status.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wiring = (name) =>
  readFileSync(join(root, "server", "runtime", "wiring", name), "utf8");

// --- the thread→card link survives archiving ---
const link = createCardByWorkerThread((threadId) => (
  threadId === "thr_archived"
    ? { id: "card_archived", kind: "build", status: "archived" }
    : undefined
));
assert.deepEqual(
  link({ threadId: "thr_archived" }),
  { cardId: "card_archived", kind: "build" },
  "a stopped thread on an archived card still links back to its card",
);
assert.deepEqual(
  link({ threadId: "thr_unknown" }),
  { cardId: null, kind: null },
  "a thread that never had a card names none, rather than guessing",
);
assert.deepEqual(
  createCardByWorkerThread(() => ({ id: "card_research", kind: "research" }))({
    threadId: "thr_1",
  }),
  { cardId: "card_research", kind: "research" },
  "the link reports the card's track, not a stored kind the caller must normalize",
);
assert.deepEqual(
  createCardByWorkerThread(() => ({ id: "card_odd", kind: "research-odd" }))({
    threadId: "thr_2",
  }),
  { cardId: "card_odd", kind: "build" },
  "an unmigrated kind is normalized once, here, rather than leaking the old vocabulary to the caller",
);

// --- the workflow spawn prompt routes the request it is handed ---
const prompt = startWorkflowPrompt("add a dark mode toggle");
assert.match(prompt, /add a dark mode toggle/, "the request is the prompt's payload");
assert.match(prompt, /stelow-workflow-entry/, "the entry skill is named before anything is fetched");
assert.match(prompt, /do NOT hand-write stage transitions/, "the advance command is the only route");
assert.match(
  prompt,
  /Preserve every gate \(product, interface, tech plan, diff\)/,
  "the gates are named in the prompt, not left to the worker's judgment",
);
assert.match(
  startWorkflowPrompt(""),
  /\nRequest:\n$/,
  "even an empty request leaves the payload labelled, so the worker is told where its work is",
);

// --- the deferred seam names the late binding instead of hiding it ---
const pending = deferred();
assert.equal(pending.read(), undefined, "an unbound seam reads nothing rather than throwing");
pending.bind("automation");
assert.equal(pending.read(), "automation", "a bound seam reads the value it was given");
assert.throws(
  () => pending.bind("second"),
  /already bound/,
  "binding the late value twice is a wiring mistake, not a silent overwrite",
);

// --- the late-bound status shape has exactly one owner ---
// The board's GitHub column must answer before the automation exists, and a
// switched-off feature must refuse the same way. Both need the same shape, so
// it has one owner — a duplicate once appeared in the composition root.
const unavailable = githubUnavailableStatus();
assert.deepEqual(
  unavailable,
  { ok: false, pluginAvailable: false, ghOk: false, repos: [] },
  "the fallback is the shape the board contract publishes",
);
assert.notEqual(
  githubUnavailableStatus().repos,
  unavailable.repos,
  "each read gets its own repo list; a shared array would leak between boards",
);
for (const file of [
  "server/plugin-runtime.ts",
  "server/cards.ts",
  "server/github-issues.ts",
  "server/runtime/wiring/card-surfaces.ts",
]) {
  assert.doesNotMatch(
    readFileSync(join(root, file), "utf8"),
    /pluginAvailable: false/,
    `${file} asks the owner for the unavailable status instead of restating it`,
  );
}

// --- topology: the layers depend downward only, and the root only assembles ---
const LAYERS = {
  "gate-surfaces.ts": ["runtime-core.js"],
  "execution-surfaces.ts": ["runtime-core.js", "gate-surfaces.js"],
  "card-surfaces.ts": ["runtime-core.js", "execution-surfaces.js", "card-creator.js"],
  "host-surfaces.ts": ["runtime-core.js", "card-surfaces.js"],
  "cli-surfaces.ts": ["runtime-core.js", "card-surfaces.js", "execution-surfaces.js", "gate-surfaces.js"],
  "rpc-surfaces.ts": ["runtime-core.js", "gate-surfaces.js", "execution-surfaces.js", "card-surfaces.js", "host-surfaces.js"],
};
for (const [file, allowed] of Object.entries(LAYERS)) {
  const source = wiring(file);
  const wiringImports = [
    ...source.matchAll(/from "\.\/([a-z-]+)\.js"/g),
  ].map((match) => match[1])
    .filter((name) => LAYERS[`${name}.ts`] !== undefined);
  for (const name of wiringImports) {
    assert.ok(
      allowed.includes(`${name}.js`),
      `${file} may import ${name}.js only when it is a layer it already depends on`,
    );
  }
}
const host = wiring("host-surfaces.ts");
assert.doesNotMatch(
  host,
  /from "\.\/rpc-surfaces\.js"/,
  "the host layer never reaches up to the registry that publishes it",
);
const gates = wiring("gate-surfaces.ts");
assert.doesNotMatch(
  gates,
  /from "\.\/(?:execution|card|host|rpc)-surfaces\.js"/,
  "the gate layer is the bottom of the stack and depends on none of the layers above it",
);

console.log(
  "runtime wiring behavior ok: thread link, spawn prompt, late binding, one status owner, layer direction",
);
