import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Preview wiring: the lifecycle itself is NOT tested here — it lives in
// lib/preview-runtime and is driven for real by preview-runtime.test.mjs. What
// remains is the handful of invariants only server.ts can break, because they
// are about what the host provides and how the host is torn down. Each
// assertion names the bug it prevents.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "server.ts"), "utf8");

/** The text between two markers, failing loudly if either is gone. */
function slice(start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `server.ts no longer contains ${JSON.stringify(start)} — this contract needs updating, not deleting`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `${start} no longer ends at ${end}`);
  return source.slice(from, to);
}

// --- The host hands the runtime real effects, or nothing works. -------------
const wiring = slice("const preview = createPreviewRuntime({", "bb.onDispose(");
assert.match(wiring, /readFile: \(path\) => bb\.sdk\.files\.read\(\{ path \}\)/, "the runtime must read files through the host");
assert.match(wiring, /listDirs: \(dir\) =>/, "the runtime must be able to list a directory");
assert.match(wiring, /spawnProcess: \(command, options\) => spawn\("bash", \["-lc", command\]/, "the dev server runs through a login shell in the app directory");
assert.match(wiring, /runConnect,/);
assert.match(wiring, /baseEnv: process\.env/, "the dev server inherits the server's own environment");

// --- A reload or disable must not leave a dev server behind. ---------------
// The runtime cannot know when the plugin goes away, so this wiring is the
// only thing standing between a plugin update and an orphaned process holding
// a port.
assert.match(source, /bb\.onDispose\(\(\) => preview\.dispose\(\)\)/, "dispose must be wired to the plugin lifetime");

// --- The lifecycle lives in the library, not back in a handler. ------------
// AGENTS.md: new state logic belongs in lib/ with a node test. A second state
// machine here would be untestable and would drift from the tested one.
for (const leaked of ["previewSessions", "killPreview", "connectUnexpose", "absorb"]) {
  assert.ok(!source.includes(leaked), `server.ts must not re-implement the lifecycle (${leaked})`);
}

// --- The worker's own checkout wins over the project source. --------------
// A `new-worktree` preset runs the agent in a bb-managed worktree, while
// cardWorkspace() reports the project source. Reading files from the source
// would preview the wrong code, and the user would be looking at mainline.
const checkout = slice("async function cardCheckout(", "async function previewTarget(");
// Both markers are required to exist first: a missing one makes indexOf -1,
// and -1 < n would pass the comparison below with the call deleted entirely.
const workerFirst = checkout.indexOf("workerEnvironmentOf(card)");
const sourceFallback = checkout.indexOf("cardWorkspace(card)");
assert.notEqual(workerFirst, -1, "cardCheckout must consult the worker's environment");
assert.notEqual(sourceFallback, -1, "cardCheckout must fall back to the project source");
assert.ok(workerFirst < sourceFallback, "the worker's environment must be tried before the project source");
assert.match(checkout, /environment\?\.path/, "a worker environment without a path must fall through, not win empty");
assert.match(checkout, /environmentId: environment\.id/, "the exact BB environment must travel with the checkout");
const target = slice("async function previewTarget(", "async function previewTargetFor(");
assert.match(target, /cardCheckout\(card\)/, "preview must use the shared checkout resolver");
assert.match(target, /source: checkout\.source/, "the target must carry the shared source label the panel shows");
assert.match(target, /slug: card\.name/, "the card's own name is the convention that picks between app directories");
const workerEnv = slice("async function workerEnvironmentOf(", "async function previewTarget(");
assert.match(workerEnv, /status === "ready"/, "a retired or destroyed environment is not a checkout to preview");
assert.match(workerEnv, /\?\.catch\(\(\) => null\)|catch \{/, "a removed environment must fall back, not throw");

// --- One renderer, so the panel and the CLI cannot diverge. ---------------
const view = slice("async function previewView(", "async function previewStart(");
assert.equal(view.split("previewShape(").length - 1, 1, "the missing-workspace answer is the only view built here");
assert.match(view, /preview\.view\(target, appOrigin\)/, "the panel renders the shared view");
const cli = slice('if (argv[0] === "preview") {', 'if (argv[0] === "fan-out") {');
assert.match(cli, /previewView\(card\.id\)/, "the CLI renders the same view the panel does");
assert.match(cli, /previewText\(view\)/, "the CLI prints the shared renderer's text");
assert.ok(!cli.includes("available:"), "the CLI must not build its own view");
assert.match(cli, /--card/, "a worker must be able to name the card it is previewing");
assert.match(cli, /--json/, "the CLI must offer machine-readable output to the worker that asked");

// --- The RPC contract and the shape agree on the lifecycle. ---------------
// The state list has one definition (PREVIEW_STATES); a hand-copied literal
// here would let the two drift, and the panel would validate a state the view
// never produces.
const contract = slice("  previewState: {", "  previewStart: {");
assert.match(contract, /state: z\.enum\(\[\.\.\.PREVIEW_STATES\]\)/, "the RPC must validate against the shared state list");
assert.ok(contract.includes("frameReason: z.string().nullable()"), "why a preview cannot be framed must reach the panel");
for (const field of ["url", "command", "checkout", "log", "hints"]) {
  assert.ok(contract.includes(`${field}:`), `the panel needs ${field}`);
}

// --- The public surface is reachable from both callers. -------------------
assert.match(slice("    async previewStart({ cardId }) {", "    async previewStop({ cardId }) {"), /previewStart\(cardId\)/, "the RPC must reach the runtime's start");
assert.match(slice("    async previewStop({ cardId }) {", "  });"), /previewStop\(cardId\)/, "the RPC must reach the runtime's stop");
assert.match(source, /\{ name: "preview", summary:/, "the CLI must document the subcommand");
assert.match(source, /createPreviewRuntime/, "server.ts must construct the runtime");

console.log("preview wiring test ok: host effects wired, dispose wired, lifecycle in lib, worker checkout first, one renderer, shared state list");
