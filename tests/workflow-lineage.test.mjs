import assert from "node:assert/strict";
import { applyLineage, mergeLineageFile, writeMergedFile } from "../lib/workflow-lineage.mjs";

const tracking = { workflows: [{ name: "w", dirHash: "abc123" }] };

// Unknown dirHash and malformed tracking never throw, never mutate.
assert.equal(applyLineage(tracking, "nope", { threadId: "t", presetId: null, endedReason: "initial" }), false);
assert.equal(applyLineage(null, "abc123", { threadId: "t", presetId: null, endedReason: "initial" }), false);
assert.equal(applyLineage({ workflows: [] }, "abc123", { threadId: "t", presetId: null, endedReason: "initial" }), false);

assert.equal(applyLineage(tracking, "abc123", { threadId: "thr_1", presetId: "p1", endedReason: "initial" }), true);
let workers = tracking.workflows[0].workers;
assert.equal(workers.length, 1, "first worker opens a row");
assert.equal(workers[0].ended_at, null, "first row stays open");
assert.equal(workers[0].preset, "p1", "preset recorded");

assert.equal(applyLineage(tracking, "abc123", { threadId: "thr_2", presetId: "p2", endedReason: "restart" }), true);
workers = tracking.workflows[0].workers;
assert.equal(workers.length, 2, "replacement appends");
assert.ok(workers[0].ended_at !== null, "previous row closed");
assert.equal(workers[0].ended_reason, "restart", "close reason is the transition that replaced it");
assert.equal(workers[1].ended_at, null, "exactly one open row");
assert.equal(workers.filter((row) => row.ended_at === null).length, 1, "open-row invariant holds");

console.log("workflow lineage test ok: lookup, rotation, open-row invariant, safe no-ops");

// mergeLineageFile: file-level round-trip, preservation, refusals.
const base = { version: 1, workflows: [{ name: "w", dirHash: "abc", config: { appetite: "Core" } }, { name: "other", dirHash: "zzz" }] };
const merged = mergeLineageFile(JSON.stringify(base), "abc", { threadId: "thr_9", presetId: "p9", endedReason: "restart" });
assert.ok(typeof merged === "string", "merge returns content");
const back = JSON.parse(merged);
assert.equal(back.version, 1, "unrelated top-level fields preserved");
assert.equal(back.workflows.length, 2, "other workflows untouched");
assert.equal(back.workflows[1].workers, undefined, "no workers invented elsewhere");
assert.equal(back.workflows[0].config.appetite, "Core", "workflow fields preserved");
assert.equal(back.workflows[0].workers[0].thread_id, "thr_9", "entry recorded");
assert.equal(mergeLineageFile("{oops", "abc", { threadId: "t", presetId: null, endedReason: "x" }), null, "invalid JSON refuses");
assert.equal(mergeLineageFile("   ", "abc", { threadId: "t", presetId: null, endedReason: "x" }), null, "blank refuses");
assert.equal(mergeLineageFile(JSON.stringify({ workflows: [] }), "abc", { threadId: "t", presetId: null, endedReason: "x" }), null, "unknown workflow refuses");
assert.equal(mergeLineageFile(null, "abc", { threadId: "t", presetId: null, endedReason: "x" }), null, "missing file refuses");

// writeMergedFile against a fake files backend: conflicts re-merge instead
// of overwriting, persistent conflict gives up, throw paths never throw.
function fakeFiles(store, script) {
  return {
    reads: 0,
    writes: [],
    async read({ path }) {
      this.reads += 1;
      const step = script.reads[Math.min(this.reads - 1, script.reads.length - 1)];
      if (step === "throw") throw new Error("gone");
      return { content: store[path] ?? null };
    },
    async write({ path, content }) {
      this.writes.push(content);
      const step = script.writes[Math.min(this.writes.length - 1, script.writes.length - 1)];
      if (step === "throw") throw new Error("disk gone");
      if (step === "conflict") return { outcome: "conflict" };
      store[path] = content;
      return { outcome: "ok" };
    },
  };
}
const seed = { workflows: [{ name: "w", dirHash: "abc" }] };
{
  // Conflict once, concurrent writer adds a field, retry preserves it.
  const store = { "/s.json": JSON.stringify(seed) };
  const files = fakeFiles(store, { reads: ["ok", "ok"], writes: ["conflict", "ok"] });
  const origRead = files.read.bind(files);
  let second = false;
  files.read = async (args) => {
    const out = await origRead(args);
    if (second) {
      const doc = JSON.parse(out.content);
      doc.workflows[0].bumpedByOtherWriter = true;
      return { content: JSON.stringify(doc) };
    }
    second = true;
    return out;
  };
  const res = await writeMergedFile(files, "/s.json", "/root", (existing) => mergeLineageFile(existing, "abc", { threadId: "t2", presetId: null, endedReason: "restart" }));
  assert.equal(res.written, true, "retry succeeds");
  assert.equal(res.attempts, 2, "exactly one retry");
  const final = JSON.parse(store["/s.json"]);
  assert.equal(final.workflows[0].bumpedByOtherWriter, true, "concurrent change preserved, not clobbered");
  assert.equal(final.workflows[0].workers[0].thread_id, "t2", "entry landed");
}
{
  const store = { "/s.json": JSON.stringify(seed) };
  const files = fakeFiles(store, { reads: ["ok", "ok", "ok"], writes: ["conflict", "conflict", "conflict"] });
  const res = await writeMergedFile(files, "/s.json", "/root", (existing) => mergeLineageFile(existing, "abc", { threadId: "t", presetId: null, endedReason: "x" }));
  assert.deepEqual(res, { written: false, attempts: 3 }, "persistent conflict gives up after max attempts");
}
{
  const store = {};
  const files = fakeFiles(store, { reads: ["throw"], writes: [] });
  const res = await writeMergedFile(files, "/s.json", "/root", (existing) => mergeLineageFile(existing, "abc", { threadId: "t", presetId: null, endedReason: "x" }));
  assert.deepEqual(res, { written: false, attempts: 1 }, "missing file writes nothing");
  assert.equal(files.writes.length, 0, "no write attempted without content");
}
{
  const store = { "/s.json": JSON.stringify(seed) };
  const files = fakeFiles(store, { reads: ["ok"], writes: ["throw"] });
  const res = await writeMergedFile(files, "/s.json", "/root", (existing) => mergeLineageFile(existing, "abc", { threadId: "t", presetId: null, endedReason: "x" }));
  assert.deepEqual(res, { written: false, attempts: 1 }, "write throw never propagates");
}

console.log("workflow lineage io test ok: merge round-trip, conflict retry, failure paths");
