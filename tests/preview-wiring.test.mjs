import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Preview wiring: the lifecycle itself is NOT tested here — it lives in
// lib/preview-runtime and is driven for real by preview-runtime.test.mjs. What
// remains is the handful of invariants only server/plugin-runtime.ts can break, because they
// are about what the host provides and how the host is torn down. Each
// assertion names the bug it prevents.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = [
  readFileSync(join(root, "server/plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server/platform-rpc-contract.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/platform.ts"), "utf8"),
].join("\n");
const workersSource = readFileSync(join(root, "server/workers.ts"), "utf8");
const appSource = readFileSync(join(root, "app.tsx"), "utf8");
const researchSource = readFileSync(join(root, "components/detail/research-detail-content.tsx"), "utf8");
const exploreSource = readFileSync(join(root, "components/detail/explore-detail-content.tsx"), "utf8");
const buildSource = readFileSync(join(import.meta.dirname, "../components/detail/build-detail-workspace.tsx"), "utf8");
const detailSource = `${appSource}\n${buildSource}\n${researchSource}\n${exploreSource}`;
const previewSource = readFileSync(join(root, "components/detail/preview-section.tsx"), "utf8");

/** The text between two markers, failing loudly if either is gone. */
function slice(start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `server/plugin-runtime.ts no longer contains ${JSON.stringify(start)} — this contract needs updating, not deleting`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `${start} no longer ends at ${end}`);
  return source.slice(from, to);
}

// --- The host hands the runtime real effects, or nothing works. -------------
const wiring = slice("const preview = createPreviewRuntime({", "bb.onDispose(");
assert.match(wiring, /readFile:\s*\(path\)\s*=>\s*bb\.sdk\.files\s*\.read\(\{\s*path\s*\}\)/, "the runtime must read files through the host");
assert.match(wiring, /listDirs: \(dir\) =>/, "the runtime must be able to list a directory");
assert.match(
  wiring,
  /spawnProcess:\s*\(command, options\)\s*=>\s*spawn\("bash", \["-lc", command\]/,
  "the dev server runs through a login shell in the app directory",
);
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
  assert.ok(!source.includes(leaked), `server/plugin-runtime.ts must not re-implement the lifecycle (${leaked})`);
}

// --- The worker's own checkout wins over the project source. --------------
// A `new-worktree` preset runs the agent in a bb-managed worktree, while
// cardWorkspace() reports the project source. Reading files from the source
// would preview the wrong code, and the user would be looking at mainline.
const checkout = slice("async function cardCheckout(", "async function cardStageSlug(");
// Both markers are required to exist first: a missing one makes indexOf -1,
// and -1 < n would pass the comparison below with the call deleted entirely.
const workerFirst = checkout.indexOf("workers.workerEnvironmentOf(card)");
const sourceFallback = checkout.indexOf("cardWorkspace(card)");
assert.notEqual(workerFirst, -1, "cardCheckout must consult the worker's environment");
assert.notEqual(sourceFallback, -1, "cardCheckout must fall back to the project source");
assert.ok(workerFirst < sourceFallback, "the worker's environment must be tried before the project source");
assert.match(checkout, /environment\?\.path/, "a worker environment without a path must fall through, not win empty");
assert.match(checkout, /environmentId: environment\.id/, "the exact BB environment must travel with the checkout");
const workerEnv = workersSource.slice(
  workersSource.indexOf("async function workerEnvironmentOf("),
  workersSource.indexOf("async function continuingEnvironment("),
);
assert.match(workerEnv, /status === "ready"/, "a retired or destroyed environment is not a checkout to preview");
assert.match(workerEnv, /\?\.catch\(\(\) => null\)|catch \{/, "a removed environment must fall back, not throw");

// --- One renderer, so the panel and the CLI cannot diverge. ---------------
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
assert.match(
  slice("    previewStart: ({ cardId }", "    previewStop: ({ cardId }"),
  /deps\.preview\.start\(cardId\)/,
  "the RPC must reach the runtime's start",
);
assert.match(
  slice("    previewStop: ({ cardId }", "    previewShare: ({ cardId }"),
  /deps\.preview\.stop\(cardId\)/,
  "the RPC must reach the runtime's stop",
);
assert.match(source, /createPreviewRuntime/, "server/plugin-runtime.ts must construct the runtime");

// --- The extracted panel owns its complete preview seam. ------------------
// These are topology guards, not snapshots: a copy left in app.tsx would split
// the polling/action state machine, while deleting one RPC would strand a live
// control even though both files would still typecheck.
assert.match(researchSource, /import \{ PreviewSection \} from "\.\/preview-section"/, "the extracted research body must consume the preview seam");
assert.match(exploreSource, /import \{ PreviewSection \} from "\.\/preview-section"/, "the extracted explore body must consume the preview seam");
assert.equal((detailSource.match(/<PreviewSection/g) ?? []).length, 3, "Build, Research, and Explore must each mount one preview section");
assert.doesNotMatch(detailSource, /function PreviewSection|const PreviewFrame|function PreviewAddress/, "preview implementation must not be copied into a detail route module");
for (const rpcName of ["previewState", "previewStart", "previewStop", "previewShare"]) {
  assert.ok(previewSource.includes(`"${rpcName}"`), `the preview panel must keep its ${rpcName} seam`);
}
assert.match(previewSource, /previewAction\(info\.state, info\.available\)/, "the button must use the canonical runtime action decision");
assert.match(previewSource, /tries >= 30/, "starting preview polling must stay bounded");

console.log("preview wiring test ok: host effects wired, dispose wired, lifecycle in lib, worker checkout first, one renderer, shared state list, panel seam intact");
