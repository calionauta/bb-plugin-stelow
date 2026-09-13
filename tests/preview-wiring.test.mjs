import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Preview wiring: the preview's own modules are pure and unit-tested, but the
// effects live in server.ts, which the test harness never executes. These are
// the source-level invariants whose breach is a real bug — a dev server exposed
// past the account gate, an orphaned process after a reload, a stale public
// share, or a panel that blocks on a bonus. Each assertion names the bug it
// prevents, so a future edit that breaks one knows what it broke.
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

// --- The dev server binds loopback only. ------------------------------------
// A dev server on 0.0.0.0 is reachable without the account gate that makes a
// Connect share safe, and dev servers run with the user's own credentials.
const start = slice("async function previewStart(", "async function previewStop(");
assert.match(start, /HOST: "127\.0\.0\.1"/, "the dev server must be started on loopback");
assert.ok(!/HOST: "0\.0\.0\.0"/.test(source), "nothing may bind the dev server to every interface");

// --- Exposure is a bonus, never a gate. -------------------------------------
// If the share had to resolve first, an unpaired server would hang in
// "starting" forever instead of working at localhost.
assert.ok(
  start.indexOf('session.state = "running"') < start.indexOf("connectShareFor(port)"),
  "the preview must be running before the share is attempted",
);
assert.match(start, /connectShareFor\(port\)\.then\(\(url\) => \{ if \(url\) session\.exposed = true; \}\)/, "a failed share must leave the preview running anyway");

// --- Every exit path releases the share and the process. --------------------
// A share left behind keeps a private URL published after the user stopped the
// server; a process left behind keeps a port held after a reload.
const onClose = slice('child.on("close"', "});\n    return { ok: true");
assert.match(onClose, /connectUnexpose\(port\)/, "a dev server that exits must release its share");
const disposed = slice("bb.onDispose(() => {", "});\n");
assert.match(disposed, /killPreview\(session\)/, "a reload or disable must stop the dev servers it started");
assert.match(disposed, /connectUnexpose\(session\.port\)/, "a reload or disable must release the shares it created");

// --- A stop the user asked for is not a crash. ------------------------------
// SIGTERM closes with a signal, not code 0; reporting that as "failed" would
// tell the user their preview broke when they simply stopped it.
const stop = slice("async function previewStop(", "async function previewView(");
assert.ok(
  stop.indexOf('session.state = "stopped"') < stop.indexOf("killPreview(session)"),
  "the stop must be recorded before the process is signalled",
);
assert.match(onClose, /session\.state !== "stopped"/, "the close handler must not overwrite a deliberate stop");

// --- The app is found where it actually is. --------------------------------
// The workspace root is tried first, and discovery descends only when the root
// has nothing: descending first would let a stray example app outrank the real
// deliverable.
const appRoot = slice("async function previewAppRoot(", "async function previewStart(");
assert.ok(
  appRoot.indexOf("await previewDetectAt(checkout)") < appRoot.indexOf("readdirSync("),
  "the workspace root must be probed before any directory is searched",
);
assert.match(appRoot, /if \(atRoot\.detection\) return/, "a root detection must short-circuit the search");
assert.match(appRoot, /previewAppDirs\(names\)/, "candidate directories come from the shared filter");
assert.match(appRoot, /pickAppDir\(found, slug\)/, "the choice comes from the shared convention, not an ad-hoc first match");
assert.match(slice("async function previewDetectAt(", "async function previewAppRoot("), /allowStatic: true/, "a self-contained page is a deliverable and must be offered");
// The process must run in the directory that is served, or a subdirectory app
// would be started from the wrong cwd (and a static server would expose the
// whole workspace instead of just the page).
assert.match(start, /cwd: app\.root/, "the dev server must run in the resolved app directory");
assert.match(start, /previewKey\(target\.hostId, app\.root\)/, "sessions are keyed by the app directory, so two cards on one app share it");

// --- The worker's own checkout wins over the project source. ----------------
// A `new-worktree` preset runs the agent in a bb-managed worktree, while
// cardWorkspace() reports the project source. Reading files from the source
// would preview the wrong code, and the user would be looking at mainline.
const target = slice("async function previewTarget(", "function killPreview(");
assert.ok(
  target.indexOf("workerEnvironmentOf(card)") < target.indexOf("cardWorkspace(card)"),
  "the worker's environment must be tried before the project source",
);
assert.match(target, /environment\?\.path/, "a worker environment without a path must fall through, not win empty");
const workerEnv = slice("async function workerEnvironmentOf(", "async function previewTarget(");
assert.match(workerEnv, /status === "ready"/, "a retired or destroyed environment is not a checkout to preview");
assert.match(workerEnv, /\.catch\(\(\) => null\)|catch \{/, "a removed environment must fall back, not throw");

// --- The machine is never left holding servers nobody is watching. ----------
// Assert the COMPARISON, not the identifier: the identifier also appears in the
// refusal message, so matching the name alone would pass with the check deleted.
const ceiling = start.search(/length\s*>=\s*PREVIEW_MAX_SESSIONS/);
assert.notEqual(ceiling, -1, "a live-session count must be compared against the ceiling");
assert.ok(ceiling < start.indexOf("spawn("), "the ceiling must be checked before a process is started");
// Connect's answer moves only when the user pairs; the panel refreshes far more
// often than that, so a per-refresh subprocess would be pure waste.
const connect = slice("async function connectStatus(", "async function readConnectStatus(");
assert.match(connect, /connectCache/, "the connect probe must be cached");
assert.ok(connect.indexOf("connectCache") < connect.indexOf("readConnectStatus()"), "the cache must be consulted before the probe");

// --- One renderer, so the panel and the CLI cannot diverge. -----------------
// The join lives in lib/preview-session and is called from exactly one function.
// A second place that builds a view would be a second set of rules to keep in
// step, and the two would drift the first time one of them changed.
const view = slice("async function previewView(", "// Resolve a host binary:");
assert.equal(view.split("previewShape(").length - 1, 3, "previewView is the only place the view is joined");
assert.equal(source.split("previewShape(").length - 1, 3, "no other function joins a preview view");
assert.match(slice("async previewState({ cardId, appOrigin })", "async previewStart({ cardId })"), /previewView\(card, appOrigin \?\? null\)/, "the panel renders the shared view");
const cli = slice('if (argv[0] === "preview") {', 'if (argv[0] === "fan-out") {');
assert.match(cli, /previewView\(card\)/, "the CLI renders the same view the panel does");
assert.ok(!cli.includes("available:"), "the CLI must not build its own view");
assert.match(cli, /previewText\(view\)/, "the CLI prints the shared renderer's text");

// --- Detection cannot be silently skipped. ---------------------------------
for (const moduleName of ["preview-detect.mjs", "preview-reach.mjs", "preview-session.mjs"]) {
  assert.ok(source.includes(`./lib/${moduleName}`), `server.ts must import ${moduleName}`);
}

// --- The RPC contract and the shape agree on the lifecycle. -----------------
const contract = slice("  previewState: {", "  previewStart: {");
for (const state of ["stopped", "starting", "running", "failed"]) {
  assert.ok(contract.includes(`"${state}"`), `the preview RPC must accept the ${state} state`);
}
assert.ok(contract.includes("frameReason: z.string().nullable()"), "why a preview cannot be framed must reach the panel");

console.log("preview wiring test ok: loopback bind, exposure is a bonus, every exit releases, one renderer, contract agrees");
