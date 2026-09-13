import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPreviewRuntime } from "../lib/preview-runtime.mjs";

// The preview lifecycle, driven for real. Everything effectful is injected, so
// these assertions are about behaviour — what got spawned, in which directory,
// with which environment, what a log line does to the state, and what is
// released when a server stops. Nothing here greps server.ts for a string.

/** A Vite app on disk, as the workspace probe sees it. */
const VITE = JSON.stringify({ dependencies: { vite: "^9" }, scripts: { dev: "vite" } });

class FakeChild extends EventEmitter {
  constructor(command, options) {
    super();
    this.command = command;
    this.options = options;
    this.exitCode = null;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.signals = [];
  }

  kill(signal) {
    this.signals.push(signal);
    this.exitCode = 0;
    return true;
  }

  /** The dev server says something, like the real thing does. */
  say(text) {
    this.stdout.emit("data", text);
    return this;
  }

  /** The process ends. A signal leaves the code null, which is what SIGTERM does. */
  end(code = 0) {
    this.exitCode = code;
    this.emit("close", code);
    return this;
  }
}

function harness({ files = {}, dirs = {}, paired = true } = {}) {
  const spawns = [];
  const connects = [];
  const runtime = createPreviewRuntime({
    readFile: async (path) => {
      runtime.reads += 1;
      return path in files ? files[path] : null;
    },
    listDirs: (dir) => dirs[dir] ?? [],
    joinPath: (...parts) => parts.join("/").replace(/\/+$/, ""),
    spawnProcess: (command, options) => {
      const child = new FakeChild(command, options);
      spawns.push(child);
      return child;
    },
    runConnect: async (args) => {
      connects.push(args);
      if (args[0] === "status") return { paired };
      // Exposing is only possible on a paired server, exactly like connect.
      if (args[0] === "expose") return paired ? { url: `https://srv--${args[1]}.getbb.app`, port: Number(args[1]) } : null;
      return {};
    },
    now: () => 1_000,
    baseEnv: { PATH: "/usr/bin" },
  });
  runtime.reads = 0;
  return { runtime, spawns, connects };
}

/** A started, announced, running preview. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

// --- Start: the command, the directory, and a loopback-only bind. ------------
{
  const { runtime, spawns } = harness({ files: { "/app/package.json": VITE } });
  const result = await runtime.start({ checkout: "/app", hostId: "host_a", slug: "app" });
  assert.deepEqual(result, { ok: true, error: null });
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, "npm run dev --port 5173", "the stack's own command runs");
  assert.equal(spawns[0].options.cwd, "/app", "the server runs in the app directory");
  // A dev server on 0.0.0.0 is reachable without the account gate that makes a
  // share safe, and it runs with the user's own credentials.
  assert.equal(spawns[0].options.env.HOST, "127.0.0.1");
  assert.equal(spawns[0].options.env.PORT, "5173");
  assert.equal(spawns[0].options.env.BROWSER, "none", "the dev server must not try to open a browser");
  assert.equal(spawns[0].options.env.PATH, "/usr/bin", "the parent environment is inherited");

  const starting = await runtime.view({ checkout: "/app", hostId: "host_a" });
  assert.equal(starting.state, "starting");
  assert.equal(starting.available, true);
  assert.equal(starting.command, "npm run dev --port 5173", "the exact command is shown while it starts");
}

// --- Ready: one state transition, one share, and no re-probing. --------------
{
  const { runtime, spawns, connects } = harness({ files: { "/app/package.json": VITE } });
  await runtime.start({ checkout: "/app", hostId: "host_a" });
  spawns[0].say("VITE v9.0.0  ready in 132 ms\n\n  ➜  Local:   http://localhost:5173/\n");
  await settle();

  const running = await runtime.view({ checkout: "/app", hostId: "host_a" });
  assert.equal(running.state, "running");
  assert.equal(running.port, 5173);
  assert.equal(running.url, "https://srv--5173.getbb.app", "a paired server shows its share URL");
  assert.equal(running.provider, "share");
  assert.deepEqual(connects.filter((args) => args[0] === "expose"), [["expose", "5173"]], "the port is exposed exactly once");

  // Refreshing a running preview must not re-read the workspace: that is what
  // makes the panel's poll cheap, and it is why the session is the cache.
  const reads = runtime.reads;
  await runtime.view({ checkout: "/app", hostId: "host_a" });
  await runtime.view({ checkout: "/app", hostId: "host_a" });
  assert.equal(runtime.reads, reads, "a running preview answers from the session, not the disk");
}

// --- Exposure is a bonus, never a gate. -------------------------------------
// If the share had to resolve, an unpaired server would hang in "starting"
// instead of working at localhost.
{
  const { runtime, spawns } = harness({ files: { "/app/package.json": VITE }, paired: false });
  await runtime.start({ checkout: "/app", hostId: null });
  spawns[0].say("  ➜  Local:   http://localhost:5173/\n");
  await settle();
  const view = await runtime.view({ checkout: "/app", hostId: null });
  assert.equal(view.state, "running", "an unpaired server still runs");
  assert.equal(view.url, "http://localhost:5173", "it falls back to loopback");
  assert.equal(view.hints[0].action, "Pair bb connect", "and says how to become reachable");
}

// --- A failure is reported, with the line that caused it. -------------------
{
  const { runtime, spawns } = harness({ files: { "/app/package.json": VITE } });
  await runtime.start({ checkout: "/app", hostId: "host_a" });
  spawns[0].say("Error: listen EADDRINUSE: address already in use :::5173\n");
  const failed = await runtime.view({ checkout: "/app", hostId: "host_a" });
  assert.equal(failed.state, "failed");
  assert.match(failed.error, /EADDRINUSE/, "the reason is the server's own words");
  assert.equal(failed.available, true, "a failure still shows what would have run");
}

// --- A running server is not failed by a later log line. --------------------
// Once it is up, output is a log, not a verdict: a request or warning line that
// happens to match the failure pattern must not flip a working preview.
{
  const { runtime, spawns } = harness({ files: { "/app/package.json": VITE } });
  await runtime.start({ checkout: "/app", hostId: "host_a" });
  spawns[0].say("  ➜  Local:   http://localhost:5173/\n");
  await settle();
  spawns[0].say("GET /api/things 404 - not found: /api/things\n");
  const still = await runtime.view({ checkout: "/app", hostId: "host_a" });
  assert.equal(still.state, "running", "a log line after startup cannot fail a running preview");
  assert.equal(still.error, null);
  assert.match(still.log, /not found/, "but the line is still in the log the user can read");
}

// --- A stop the user asked for is not a crash. ------------------------------
// SIGTERM closes with a signal, not code 0; reporting that as "failed" would
// tell the user their preview broke when they simply stopped it.
{
  const { runtime, spawns, connects } = harness({ files: { "/app/package.json": VITE } });
  await runtime.start({ checkout: "/app", hostId: "host_a" });
  spawns[0].say("  ➜  Local:   http://localhost:5173/\n");
  await settle();
  await runtime.stop({ checkout: "/app", hostId: "host_a" });
  assert.deepEqual(spawns[0].signals, ["SIGTERM"], "the process is asked to exit, not killed outright first");
  spawns[0].exitCode = null;
  spawns[0].emit("close", null);

  const stopped = await runtime.view({ checkout: "/app", hostId: "host_a" });
  assert.equal(stopped.state, "stopped", "a deliberate stop reads as stopped, not failed");
  assert.equal(stopped.error, null);
  assert.ok(
    connects.some((args) => args[0] === "unexpose" && args[1] === "5173"),
    "a stopped server must release its share",
  );
}

// --- A process that dies on its own is a failure. ---------------------------
{
  const { runtime, spawns } = harness({ files: { "/app/package.json": VITE } });
  await runtime.start({ checkout: "/app", hostId: "host_a" });
  spawns[0].end(1);
  const crashed = await runtime.view({ checkout: "/app", hostId: "host_a" });
  assert.equal(crashed.state, "failed");
  assert.match(crashed.error, /exited with code 1/);
}

// --- Two cards on one checkout share one server. ----------------------------
// The identity is the checkout, not the card: the same code must not race
// itself for the same port.
{
  const { runtime, spawns } = harness({ files: { "/app/package.json": VITE } });
  await runtime.start({ checkout: "/app", hostId: "host_a", slug: "one" });
  await runtime.start({ checkout: "/app", hostId: "host_a", slug: "two" });
  assert.equal(spawns.length, 1, "a second card on the same checkout reuses the running server");
}

// --- A card whose checkout moved does not get the old server. --------------
// A recreated worktree is a different directory. Handing the card the previous
// checkout's server would show the wrong code, and stopping would leave the
// real one running.
{
  const { runtime, spawns } = harness({
    files: { "/wt/one/package.json": VITE, "/wt/two/package.json": VITE },
  });
  await runtime.start({ checkout: "/wt/one", hostId: "host_a", slug: "a" });
  await runtime.start({ checkout: "/wt/two", hostId: "host_a", slug: "a" });
  assert.equal(spawns.length, 2, "the new checkout gets its own server");
  assert.equal(spawns[1].options.cwd, "/wt/two");
}

// --- The app is found where it actually is. --------------------------------
// Agents routinely put the deliverable in a subdirectory; a root-only search
// would answer "nothing to preview" for a finished product.
{
  const { runtime, spawns } = harness({
    files: { "/app/web/package.json": VITE },
    dirs: { "/app": ["web"], "/app/web": [] },
  });
  const result = await runtime.start({ checkout: "/app", hostId: "host_a", slug: "web" });
  assert.equal(result.ok, true);
  assert.equal(spawns[0].options.cwd, "/app/web", "the server runs in the directory that is served");
}

// Between several candidates the card's own name decides, by convention.
{
  const { runtime, spawns } = harness({
    files: { "/app/api/package.json": VITE, "/app/chess/package.json": VITE },
    dirs: { "/app": ["api", "chess"], "/app/api": [], "/app/chess": [] },
  });
  await runtime.start({ checkout: "/app", hostId: "host_a", slug: "Chess" });
  assert.equal(spawns[0].options.cwd, "/app/chess", "the directory named after the card wins");
}

// A library with nothing to serve is an honest "no", and nothing is spawned.
{
  const { runtime, spawns } = harness({ files: { "/lib/README.md": "hi" } });
  const refused = await runtime.start({ checkout: "/lib", hostId: "host_a" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /No web app detected/);
  assert.equal(spawns.length, 0, "nothing is started when there is nothing to serve");
  const view = await runtime.view({ checkout: "/lib", hostId: "host_a" });
  assert.equal(view.available, false);
  assert.equal(view.url, null);
}

// --- The machine is never left holding servers nobody is watching. ----------
{
  const { runtime, spawns } = harness({
    files: { "/a/package.json": VITE, "/b/package.json": VITE, "/c/package.json": VITE, "/d/package.json": VITE },
  });
  for (const dir of ["/a", "/b", "/c"]) await runtime.start({ checkout: dir, hostId: "host_a" });
  const refused = await runtime.start({ checkout: "/d", hostId: "host_a" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Stop one of the 3 running previews first/);
  assert.equal(spawns.length, 3, "the ceiling is enforced before another process is started");
}

// --- A reload or disable stops what this plugin started, and releases it. ---
{
  const { runtime, connects } = harness({
    files: { "/a/package.json": VITE, "/b/package.json": VITE },
  });
  await runtime.start({ checkout: "/a", hostId: "host_a" });
  await runtime.start({ checkout: "/b", hostId: "host_a" });
  runtime.dispose();
  const released = connects.filter((args) => args[0] === "unexpose").map((args) => args[1]).sort();
  assert.deepEqual(released, ["5173", "5174"], "every share is released when the plugin goes away");
}

// --- Nothing is running: the workspace is asked what it is. ----------------
// `view` at rest still shows what WOULD run, because that is what the user
// decides from — and it must offer loopback when there is no share.
{
  const { runtime } = harness({ files: { "/app/package.json": VITE } });
  const view = await runtime.view({ checkout: "/app", hostId: "host_a", slug: "app", source: "Project source" });
  assert.equal(view.available, true);
  assert.equal(view.state, "stopped");
  assert.equal(view.label, "Vite");
  assert.equal(view.command, "npm run dev --port 5173", "the command is shown before it is run");
  assert.equal(view.url, "http://localhost:5173");
  assert.equal(view.source, "Project source", "the panel names which checkout this is");
  assert.equal(runtime.reads > 0, true, "the workspace was actually probed");
}

console.log("preview runtime test ok: start/cwd/loopback, ready+share, exposure is a bonus, failures, stop-vs-crash, shared checkout, moved checkout, subdirectory app, ceiling, dispose, at-rest view");
