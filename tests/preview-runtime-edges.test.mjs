// The edges of the preview lifecycle that the happy-path test cannot reach:
// a host that cannot spawn at all, a process that errors after spawning, a
// Connect that is missing or unpaired, a SIGTERM the server ignores, and a
// session that failed and is started again. Each one used to be an unhandled
// throw or a silently stuck panel, and each is a promise the runtime makes to
// the user: a refusal names its reason, a preview never counts as live unless
// a process is really there, and nothing is claimed that did not happen.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPreviewRuntime } from "../lib/preview-runtime.mjs";
import { PREVIEW_KILL_GRACE_MS, createProcessSupervisor } from "../lib/preview-process.mjs";
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

console.log(
  "preview runtime edges ok: spawn refusal, post-spawn error, restart, unpaired share, missing Connect, kill escalation, store identity",
);
