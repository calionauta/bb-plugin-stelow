// The edges of the preview lifecycle that the happy-path test cannot reach:
// a host that cannot spawn at all, a process that errors after spawning, a
// Connect that is missing or unpaired, a SIGTERM the server ignores, a dev
// server that exits and takes its share with it, and a session that failed and
// is started again. Each one used to be an unhandled throw or a silently stuck
// panel, and each is a promise the runtime makes to the user: a refusal names
// its reason, a preview never counts as live unless a process is really there,
// and nothing is claimed that did not happen.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPreviewRuntime } from "../lib/preview-runtime.mjs";
import { PREVIEW_KILL_GRACE_MS, createProcessSupervisor } from "../lib/preview-process.mjs";
import { previewView } from "../lib/preview-lifecycle.mjs";
import { createSessionStore } from "../lib/preview-session-store.mjs";

const VITE = JSON.stringify({ dependencies: { vite: "^9" }, scripts: { dev: "vite" } });

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.exitCode = null;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.signals = [];
  }

  kill(signal) {
    this.signals.push(signal);
    return true;
  }

  /** The process ends, like a dev server that crashed. */
  end(code) {
    this.exitCode = code;
    this.emit("close", code);
    return this;
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function harness({ spawn, connect, files = { "/app/package.json": VITE }, paired = true } = {}) {
  const connects = [];
  const runtime = createPreviewRuntime({
    readFile: async (path) => (path in files ? files[path] : null),
    listDirs: () => [],
    joinPath: (...parts) => parts.join("/"),
    spawnProcess: spawn ?? (() => new FakeChild()),
    runConnect: connect ?? (async (args) => {
      connects.push(args);
      if (args[0] === "status") return { paired };
      if (args[0] === "expose") return paired ? { url: `https://srv--${args[1]}.getbb.app` } : null;
      return {};
    }),
    now: () => 1_000,
    baseEnv: {},
  });
  return { runtime, connects };
}

// --- A host that cannot spawn answers, it does not throw. -------------------
// No command, no permission, no PATH: the RPC must return the host's own words
// and the panel must show why, instead of the request dying.
{
  const { runtime } = harness({
    spawn: () => {
      throw new Error("spawn npm ENOENT");
    },
  });
  const result = await runtime.start({ checkout: "/app", hostId: "host_a", slug: "app" });
  assert.deepEqual(result, { ok: false, error: "spawn npm ENOENT" });
  const view = await runtime.view({ checkout: "/app", hostId: "host_a" });
  assert.equal(view.state, "failed");
  assert.match(view.error, /ENOENT/);
}

// A spawn that never produced a process must not hold one of the three slots:
// the user retrying a fixed PATH has to be able to start, not be told to stop a
// preview that does not exist.
{
  const children = [];
  const { runtime } = harness({
    // Only the third directory is broken: a host with no npm on PATH, say.
    spawn: (_command, options) => {
      if (options.cwd === "/c") throw new Error("spawn npm ENOENT");
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    files: {
      "/a/package.json": VITE,
      "/b/package.json": VITE,
      "/c/package.json": VITE,
      "/d/package.json": VITE,
      "/e/package.json": VITE,
    },
  });
  await runtime.start({ checkout: "/a", hostId: "host_a" });
  await runtime.start({ checkout: "/b", hostId: "host_a" });
  const blocked = await runtime.start({ checkout: "/c", hostId: "host_a" });
  assert.match(blocked.error, /ENOENT/, "the refusal names the spawn failure");
  const third = await runtime.start({ checkout: "/d", hostId: "host_a" });
  assert.deepEqual(third, { ok: true, error: null }, "the slot a failed spawn never took is available");
  const ceiling = await runtime.start({ checkout: "/e", hostId: "host_a" });
  assert.match(ceiling.error, /Stop one of the 3 running previews first/, "the ceiling counts live previews only");
  assert.equal(children.length, 3, "the refused fourth preview spawned nothing");
}

// --- A process that errors after spawning reports that error. ----------------
{
  const child = new FakeChild();
  const { runtime } = harness({ spawn: () => child });
  await runtime.start({ checkout: "/app", hostId: "host_a" });
  child.emit("error", new Error("EACCES: permission denied"));
  const view = await runtime.view({ checkout: "/app", hostId: "host_a" });
  assert.equal(view.state, "failed");
  assert.match(view.error, /EACCES/);
}

// --- A session that failed can be started again. ----------------------------
{
  const children = [];
  const { runtime } = harness({ spawn: () => {
    const child = new FakeChild();
    children.push(child);
    return child;
  } });
  await runtime.start({ checkout: "/app", hostId: "host_a" });
  children[0].end(1);
  const failed = await runtime.view({ checkout: "/app", hostId: "host_a" });
  assert.equal(failed.state, "failed");
  const again = await runtime.start({ checkout: "/app", hostId: "host_a" });
  assert.deepEqual(again, { ok: true, error: null }, "a failed preview is restartable");
  assert.equal(children.length, 2, "a new process was spawned for the retry");
  const restarted = await runtime.view({ checkout: "/app", hostId: "host_a" });
  assert.equal(restarted.state, "starting", "the retry is starting, not still failed");
}

// --- An unpaired host cannot share a port, and the button says so. -----------
// A localhost preview is the real product on an unpaired server; the share
// button must not claim a URL that does not exist.
{
  const connects = [];
  const child = new FakeChild();
  const { runtime } = harness({
    spawn: () => child,
    paired: false,
    connect: async (args) => {
      connects.push(args);
      if (args[0] === "status") return { paired: false };
      if (args[0] === "expose") return null;
      return {};
    },
  });
  await runtime.start({ checkout: "/app", hostId: "host_a" });
  child.stdout.emit("data", "  ➜  Local:   http://localhost:5173/\n");
  await settle();
  assert.equal((await runtime.view({ checkout: "/app", hostId: "host_a" })).state, "running");
  const shared = await runtime.share({ checkout: "/app", hostId: "host_a" });
  assert.equal(shared.ok, false);
  assert.match(shared.error, /returned no share URL/);
  assert.deepEqual(
    connects.filter((args) => args[0] === "expose"),
    [["expose", "5173"], ["expose", "5173"]],
    "an unpaired host is asked twice and answers nothing both times",
  );
}

// --- A Connect that is missing entirely must not break the preview. ---------
// runConnect throwing is a CLI that is not installed, not a preview failure.
{
  const child = new FakeChild();
  const { runtime } = harness({
    spawn: () => child,
    connect: async () => {
      throw new Error("bb: command not found");
    },
  });
  const started = await runtime.start({ checkout: "/app", hostId: "host_a" });
  assert.deepEqual(started, { ok: true, error: null });
  child.stdout.emit("data", "  ➜  Local:   http://localhost:5173/\n");
  await settle();
  const view = await runtime.view({ checkout: "/app", hostId: "host_a" });
  assert.equal(view.state, "running", "a broken Connect does not fail a running server");
  assert.equal(view.url, "http://localhost:5173", "and the loopback address is what is shown");
  const shared = await runtime.share({ checkout: "/app", hostId: "host_a" });
  assert.equal(shared.ok, false, "sharing without Connect refuses honestly");
  await runtime.stop({ checkout: "/app", hostId: "host_a" });
  assert.deepEqual(child.signals, ["SIGTERM"], "stop still releases the process without Connect");
}

// --- SIGTERM first, SIGKILL only if the server ignores it. -------------------
// A dev server wedged in a compile must not survive a stop forever, and a
// server that exits politely must never be killed.
{
  const stubborn = new FakeChild();
  const supervisor = createProcessSupervisor({
    onReady: () => {},
    onSettled: () => {},
    startTimeoutMs: 1_000,
    killGraceMs: 10,
  });
  const session = { key: "host_a:/app", state: "running", port: 5173, child: stubborn, timer: null };
  supervisor.kill(session);
  assert.deepEqual(stubborn.signals, ["SIGTERM"], "the polite signal goes first");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(stubborn.signals, ["SIGTERM", "SIGKILL"], "a server that ignores SIGTERM is killed");

  const exited = new FakeChild();
  exited.exitCode = 0;
  const done = { key: "host_a:/b", state: "running", port: 5174, child: exited, timer: null };
  supervisor.kill(done);
  assert.deepEqual(exited.signals, [], "a process that already exited is not signalled at all");
  assert.equal(PREVIEW_KILL_GRACE_MS, 5_000, "the real grace is five seconds, not a test value");
}

// --- The identity rule, on the store itself. --------------------------------
// The store is what stops a card from inheriting a worktree's previous server,
// so it is worth asserting directly rather than only through a start.
{
  const store = createSessionStore();
  const live = { key: "host_a:/wt", state: "running", port: 5173 };
  const starting = { key: "host_a:/wt/web", state: "starting", port: 5174 };
  const other = { key: "host_a:/other", state: "running", port: 5175 };
  const elsewhere = { key: "host_b:/wt", state: "running", port: 5176 };
  for (const session of [live, starting, other, elsewhere]) store.set(session);

  assert.deepEqual(
    store.under("host_a", "/wt").map((session) => session.key),
    ["host_a:/wt", "host_a:/wt/web"],
    "a subdirectory app belongs to its checkout",
  );
  assert.deepEqual(
    store.under("host_a", "/other").map((session) => session.key),
    ["host_a:/other"],
    "a sibling checkout is not included",
  );
  assert.deepEqual(
    store.liveUnder("host_a", "/wt").map((session) => session.key),
    ["host_a:/wt", "host_a:/wt/web"],
    "starting counts as live — it still holds its port",
  );
  assert.deepEqual(
    store.under("host_b", "/wt").map((session) => session.key),
    ["host_b:/wt"],
    "the same path on another host is a different checkout",
  );
  assert.equal(store.under("host_a", "/missing").length, 0, "an unknown checkout has no sessions");
  store.delete("host_a:/other");
  assert.equal(store.has("host_a:/other"), false, "a stopped session is gone, not remembered");
  store.clear();
  assert.equal(store.all().length, 0, "dispose leaves nothing holding a port");
}

// --- A dev server that exits drops its share, however it exited. ------------
// Connect is told to drop the tunnel for a port nothing is listening on any
// more. A clean exit deletes the session; a crash keeps it, failed, so the log
// stays openable — and neither leaves a share behind. Dropping this call is
// invisible in the panel and permanent in Connect.
{
  for (const code of [0, 1]) {
    const child = new FakeChild();
    const { runtime, connects } = harness({ spawn: () => child });
    await runtime.start({ checkout: "/app", hostId: "host_a" });
    child.stdout.emit("data", "  ➜  Local:   http://localhost:5173/\n");
    await settle();
    connects.length = 0;
    child.end(code);
    await settle();
    const unexposed = connects.filter((args) => args[0] === "unexpose");
    assert.deepEqual(
      unexposed,
      [["unexpose", "5173"]],
      `a dev server exiting with ${code} releases the shared port`,
    );
    const view = await runtime.view({ checkout: "/app", hostId: "host_a" });
    if (code === 0) {
      assert.equal(
        view.state,
        "stopped",
        "a clean exit leaves no failed session behind — the panel offers a start again",
      );
    } else {
      assert.equal(view.state, "failed", "a crash keeps the session so the log stays openable");
      assert.match(view.error, /exited with code 1/);
    }
  }
}

// --- A stop is not a crash: the process is signalled and the port released. --
{
  const child = new FakeChild();
  const { runtime, connects } = harness({ spawn: () => child });
  await runtime.start({ checkout: "/app", hostId: "host_a" });
  child.stdout.emit("data", "  ➜  Local:   http://localhost:5173/\n");
  await settle();
  connects.length = 0;
  const stopped = await runtime.stop({ checkout: "/app", hostId: "host_a" });
  assert.deepEqual(stopped, { ok: true, error: null });
  assert.deepEqual(child.signals, ["SIGTERM"], "a stop signals the process it owns");
  assert.deepEqual(
    connects.filter((args) => args[0] === "unexpose"),
    [["unexpose", "5173"]],
    "a stop releases the shared port, not just the process",
  );
  assert.equal(
    (await runtime.view({ checkout: "/app", hostId: "host_a" })).state,
    "stopped",
    "a stopped preview is gone, so the panel offers a start rather than a stop",
  );
}

// --- The view answers for the live session, not the first one it finds. -----
// One checkout can hold a stopped session and a running one at once — a restart
// that raced, or an app directory under a checkout that is still up. Handing
// the panel the stopped one would show a dead server as live, which is the one
// thing the state honesty rule forbids.
{
  const detection = { framework: "vite", evidence: "package.json", command: "vite", portFlag: "flag" };
  const store = createSessionStore();
  const live = { key: "host_a:/app", state: "running", port: 5173, detection, declared: null, share: null };
  const dead = { key: "host_a:/app/web", state: "stopped", port: 5174, detection, declared: null, share: null, error: "gone" };
  // Insertion order puts the stopped session first: a view that took
  // candidates[0] would answer for the dead one and pass every other check in
  // this file.
  store.set(dead);
  store.set(live);
  const view = await previewView({ store, connect: { isPaired: async () => false } }, { hostId: "host_a", checkout: "/app" });
  assert.equal(view.port, 5173, "the live session answers the view, not the stopped one");
  assert.equal(view.state, "running");
  store.clear();
}

console.log(
  "preview runtime edges ok: spawn refusal, post-spawn error, restart, unpaired share, missing Connect, "
  + "kill escalation, share release, stop shape, live view, store identity",
);
