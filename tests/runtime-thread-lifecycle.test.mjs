import assert from "node:assert/strict";
import test from "node:test";
import { registerThreadLifecycle, reconcileLiveCardsOnStartup } from "../server/runtime/thread-lifecycle.ts";

function dbWith(rows) {
  return {
    prepare(sql) {
      return {
        get(id) {
          if (sql.includes("status != 'archived'")) return rows.find((row) => row.worker_thread_id === id && row.status !== "archived");
          return undefined;
        },
        all() { return sql.includes("status != 'archived'") ? rows.filter((row) => row.status !== "archived") : rows; },
      };
    },
  };
}

test("thread lifecycle maps idle and active events to card sync", () => {
  const calls = [];
  const handlers = new Map();
  const bb = { events: { on(name, handler) { handlers.set(name, handler); } } };
  registerThreadLifecycle(bb, {
    db: dbWith([{ id: "card-1", worker_thread_id: "thread-1", status: "in-progress" }]),
    syncThreadState: async (id) => calls.push(id),
    applyFailed: async () => { throw new Error("must not run"); },
  });
  handlers.get("thread.idle")({ thread: { id: "thread-1" } });
  handlers.get("thread.active")({ thread: { id: "thread-1" } });
  return new Promise((resolve) => setImmediate(() => {
    assert.deepEqual(calls, ["card-1", "card-1"]);
    resolve();
  }));
});

test("startup reconciliation only returns live worker cards", async () => {
  const calls = [];
  const count = reconcileLiveCardsOnStartup(
    dbWith([
      { id: "live", worker_thread_id: "thread-1", status: "in-progress" },
      { id: "archived", worker_thread_id: "thread-2", status: "archived" },
    ]),
    async (id) => calls.push(id),
  );
  assert.equal(count, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["live"]);
});
