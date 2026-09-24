import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import plugin from "../server.ts";

function startupHost() {
  const db = new Database(":memory:");
  const schedules = new Map();
  const events = new Map();
  const disposals = [];
  const registrations = {};
  const calls = { updateChecks: 0 };
  const bb = {
    pluginId: "stelow",
    storage: {
      database: () => db,
      migrate: (_db, statements) => statements.forEach((statement) => db.exec(statement)),
    },
    sdk: {
      plugins: { checkUpdates: async () => {
        calls.updateChecks += 1;
        throw new Error("offline fixture");
      } },
      projects: { list: async () => [{ id: "project-1", name: "Fixture" }] },
      providers: { list: async () => [] },
      threads: { stop: () => { throw new Error("disposal stopped a live thread"); } },
    },
    log: { warn: () => {}, info: () => {}, error: () => {} },
    background: { schedule: (name, cron, run) => schedules.set(name, { cron, run }) },
    onDispose: (run) => disposals.push(run),
    events: { on: (name, run) => events.set(name, run) },
    agents: { configure: (run) => { registrations.agents = run; } },
    rpc: { register: (contract, handlers) => { registrations.rpc = { contract, handlers }; } },
    cli: { register: (definition) => { registrations.cli = definition; } },
    ui: { registerMentionProvider: () => {} },
    realtime: { publish: () => {} },
  };
  return { bb, db, schedules, events, disposals, registrations, calls };
}

test("plugin startup registers dispatch and disposes idempotently without stopping live threads", async () => {
  const host = startupHost();
  try {
    await plugin(host.bb);
    assert.equal(host.db.prepare("SELECT name FROM sqlite_master WHERE name = 'cards'").get().name, "cards");
    assert.equal(host.db.prepare("SELECT name FROM sqlite_master WHERE name = 'inbox_events'").get().name, "inbox_events");
    assert.equal(host.registrations.cli.name, "stelow");
    assert.equal(host.registrations.rpc.contract.projects !== undefined, true);
    for (const name of Object.keys(host.registrations.rpc.contract)) {
      assert.equal(typeof host.registrations.rpc.handlers[name], "function", `RPC ${name} is registered`);
    }
    assert.deepEqual(await host.registrations.rpc.handlers.projects(), {
      projects: [{ id: "project-1", name: "Fixture" }],
    });
    assert.deepEqual((await host.registrations.rpc.handlers.flowMetrics({})).items, []);
    assert.equal((await host.registrations.rpc.handlers.buildInfo()).pluginUpdate.outcome, "unavailable");
    assert.equal((await host.registrations.cli.run(["help"], {})).exitCode, 0);
    const unknown = await host.registrations.cli.run(["no-such-command"], {});
    assert.equal(unknown.exitCode, 2);
    assert.match(unknown.stderr, /Unknown command/);
    assert.equal((await host.registrations.cli.run(["preset", "list"], {})).exitCode, 0);
    assert.equal(host.schedules.has("stelow-plugin-update-check"), true);
    assert.equal(host.schedules.has("stelow-automation-rules"), true);
    assert.equal(host.events.has("thread.failed"), true);
    host.events.get("thread.failed")({ thread: { id: "unowned" }, error: new Error("offline") });
    const updatesBeforeTick = host.calls.updateChecks;
    await host.schedules.get("stelow-plugin-update-check").run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(host.calls.updateChecks, updatesBeforeTick + 1);
    await host.schedules.get("stelow-automation-rules").run();
    assert.deepEqual(host.registrations.agents({ thread: { title: "Ordinary thread" } }).skills, []);
    assert.ok(host.disposals.length >= 2, "preview and worker lifecycle register cleanup");
  } finally {
    await Promise.all(host.disposals.map((dispose) => dispose()));
    await Promise.all(host.disposals.map((dispose) => dispose()));
    host.db.close();
  }
});
