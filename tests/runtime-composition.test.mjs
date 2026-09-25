import assert from "node:assert/strict";
import test from "node:test";
import {
  registerAutomationSchedule,
  registerPreviewDisposal,
  registerRpcHandlers,
  registerRuntimeLifecycle,
  registerStelowCli,
  registerWorkerSkills,
} from "../server/runtime/composition.ts";

function lifecycleHost() {
  const events = new Map();
  const disposals = [];
  const timers = [];
  const cleared = [];
  const cards = [
    { id: "card-live", worker_thread_id: "thread-live", status: "in-progress" },
    { id: "card-archived", worker_thread_id: "thread-archived", status: "archived" },
  ];
  const db = {
    open: true,
    prepare(sql) {
      if (sql.includes("SELECT id FROM cards WHERE worker_thread_id IS NOT NULL")) {
        return { all: () => cards.filter((card) => card.status !== "archived") };
      }
      if (sql.includes("SELECT id FROM cards WHERE worker_thread_id = ?")) {
        return {
          get: (threadId) => cards.find(
            (card) => card.worker_thread_id === threadId && card.status !== "archived",
          ),
        };
      }
      return { all: () => [] };
    },
  };
  const bb = {
    events: { on: (name, run) => events.set(name, run) },
    onDispose: (run) => disposals.push(run),
    log: { warn: () => {} },
    realtime: { publish: () => {} },
  };
  return { bb, cleared, db, disposals, events, timers };
}

function registerLifecycleFixture(host) {
  const calls = { execution: 0, failed: [], severity: 0, sync: [], workersDisposed: 0 };
  const scheduler = {
    setInterval(run, delay) {
      const timer = { delay, run };
      host.timers.push(timer);
      return timer;
    },
    clearInterval: (timer) => host.cleared.push(timer),
  };
  registerRuntimeLifecycle({
    bb: host.bb,
    db: host.db,
    syncThreadState: async (cardId) => calls.sync.push(cardId),
    applyFailed: async (...args) => calls.failed.push(args),
    executionReconcile: {
      reconcile: async () => {
        calls.execution += 1;
      },
    },
    getCard: () => undefined,
    cardWorkspace: async () => null,
    maybeBumpSeverity: async () => {
      calls.severity += 1;
    },
    notifyClaimWaiters: async () => {},
    disposeWorkers: () => {
      calls.workersDisposed += 1;
    },
    scheduler,
  });
  return calls;
}

async function assertLifecycleBehavior(host, calls) {
  assert.deepEqual([...host.events.keys()], [
    "thread.idle",
    "thread.active",
    "thread.failed",
  ]);
  assert.deepEqual(calls.sync, ["card-live"]);
  assert.equal(calls.execution, 1);
  assert.equal(host.timers.length, 2);
  assert.ok(host.timers.every(({ delay }) => delay === 45_000));
  host.events.get("thread.idle")({ thread: { id: "thread-live" } });
  host.events.get("thread.failed")({
    thread: { id: "thread-live" },
    error: "failed",
  });
  await Promise.resolve();
  assert.deepEqual(calls.sync, ["card-live", "card-live"]);
  assert.deepEqual(calls.failed, [["card-live", "thread-live", "failed"]]);
}

async function assertTimerAndDisposalBehavior(host, calls) {
  host.db.open = true;
  host.timers[0].run();
  await Promise.resolve();
  assert.equal(calls.execution, 2);
  host.db.open = false;
  host.timers[0].run();
  await Promise.resolve();
  assert.equal(calls.execution, 2, "closed databases do not reconcile");
  host.db.open = true;
  host.timers[1].run();
  assert.equal(calls.severity, 1, "the reconciler tick drives severity");
  host.disposals[0]();
  assert.deepEqual(host.cleared, host.timers, "disposal clears both timers");
  assert.equal(calls.workersDisposed, 1);
  assert.equal(host.disposals.length, 1, "workers are disposed exactly once");
}

test("runtime lifecycle registration wires events, timers, and disposal", async () => {
  const host = lifecycleHost();
  const calls = registerLifecycleFixture(host);
  await assertLifecycleBehavior(host, calls);
  await assertTimerAndDisposalBehavior(host, calls);
});

function registerSurfaceFixture() {
  const registrations = {};
  const schedule = {};
  const disposals = [];
  const bb = {
    agents: { configure: (run) => (registrations.skills = run) },
    background: { schedule: (...args) => (schedule.args = args) },
    cli: { register: (definition) => (registrations.cli = definition) },
    onDispose: (run) => disposals.push(run),
    rpc: { register: (...args) => (registrations.rpc = args) },
  };
  registerWorkerSkills(bb);
  registerAutomationSchedule(bb, async () => undefined);
  const contract = { ping: {} };
  const handlers = { ping: async () => ({ ok: true }) };
  registerRpcHandlers(bb, contract, handlers);
  const state = { bb, contract, disposals, handlers, registrations, schedule };
  state.implementationCalls = registerCliFixture(state);
  registerPreviewDisposal(bb, () => {
    state.previewDisposals = (state.previewDisposals ?? 0) + 1;
  });
  return state;
}

function registerCliFixture(state) {
  let implementationCalls = 0;
  registerStelowCli(state.bb, async () => {
    implementationCalls += 1;
    return { exitCode: 0 };
  });
  return () => implementationCalls;
}

async function assertSurfaceBehavior(state) {
  const { registrations } = state;
  const worker = registrations.skills({ thread: { title: "Stelow: Build" } });
  const ordinary = registrations.skills({ thread: { title: "Ordinary" } });
  assert.ok(worker.skills.length > 0);
  assert.deepEqual(ordinary.skills, [], "ordinary threads receive no workflow skills");
  assert.deepEqual(state.schedule.args.slice(0, 2), [
    "stelow-automation-rules",
    "*/5 * * * *",
  ]);
  state.schedule.args[2]();
  assert.deepEqual(registrations.rpc, [
    state.contract,
    state.handlers,
    { experimental_discoverable: true },
  ]);
  assert.equal(registrations.cli.name, "stelow");
  const help = await registrations.cli.run(["help", "export"], {});
  assert.equal(help.exitCode, 0);
  assert.equal(state.implementationCalls(), 0);
  await registrations.cli.run(["status"], {});
  assert.equal(state.implementationCalls(), 1);
  assert.equal(state.previewDisposals, undefined);
  state.disposals[0]();
  assert.equal(state.previewDisposals, 1);
}

test("composition registration preserves plugin surface boundaries", async () => {
  await assertSurfaceBehavior(registerSurfaceFixture());
});
