/**
 * Behavioural tests for the title burst: rename wins, terminality holds, one
 * record per burst.
 *
 * The earlier tests/title-path.test.mjs pinned this behaviour with source-text
 * regexes; an independent red-teamer showed 8 of 9 kept passing under
 * logic-breaking mutations, which AGENTS.md bans. These drive the real server
 * through a scripted fixture, so a broken decision fails the behaviour rather
 * than the wording of the source.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createDraftingServer } from "../server/drafting.ts";

function fixture(options = {}) {
  const rows = new Map();
  const row = {
    id: "card-1", project_id: "p1", kind: "build", status: "active",
    prompt: "A long request about cards", name: "card-1", display_name: "Prompt slice",
  };
  rows.set(row.id, { ...row });
  const comments = [];
  const events = [];
  const stops = [];
  const spawns = [];
  const logs = [];
  const card = () => rows.get("card-1");
  const status = (index) => {
    const script = options.statuses ?? ["idle"];
    return script[Math.min(index, script.length - 1)] ?? "idle";
  };
  options.gets = 0;
  const server = createDraftingServer(stubs(options, rows, { comments, events, stops, spawns, status, logs }));
  return { server, card, comments, events, stops, spawns, rows, logs };
}

test("a human rename landing mid-burst is NOT overwritten by the retry", async () => {
  // The regression: completion used to be classified before the rename, so a
  // timeout fired a retry that took its original title from the already-renamed
  // card, saw equality, and wrote over the human's name.
  const f = fixture({ statuses: ["__rename__", "__rename__", "idle"] });
  await f.server.suggestCardName("card-1");
  assert.equal(f.card().display_name, "Human title", "the human's name survives a timeout and a retry");
});

test("a rename wins even when the burst also times out", async () => {
  const f = fixture({ statuses: ["__rename__", "running"] });
  await f.server.suggestCardName("card-1");
  assert.equal(f.card().display_name, "Human title");
  assert.equal(f.comments.length, 0, "a card the human just named gets no record");
});

test("an archived card receives no record and no publish", async () => {
  // deps.comment bypasses addCardComment's ERR_CARD_ARCHIVED refusal, so the
  // record needs its own guard or a terminal card takes a write.
  const f = fixture({ statuses: ["__archive__"], spawnThrows: true, spawnThrowsAt: 1 });
  await f.server.suggestCardName("card-1");
  assert.equal(f.card().status, "archived");
  assert.equal(f.comments.length, 0, "an archived card must not receive an agent record");
});

test("a delivered burst writes exactly one title and no comment", async () => {
  // The rule a reader learns: a comment on a burst-titled card means the burst
  // did not land. If delivery commented, that rule would be false.
  const f = fixture({ statuses: ["idle"] });
  await f.server.suggestCardName("card-1");
  assert.equal(f.card().display_name, "Burst generated title");
  assert.equal(f.comments.length, 0, "delivery must stay silent");
  assert.equal(f.events.length, 1, "a write still refreshes the surface");
});

test("a timeout retried into a success records delivered_after_retry", async () => {
  // The case whose test was missing: the success-after-retry branch must be
  // reachable, and it must still leave a countable record.
  const f = fixture({ statuses: [...Array(24).fill("running"), "idle"] });
  await f.server.suggestCardName("card-1");
  assert.equal(f.card().display_name, "Burst generated title", "the retry's title lands");
  assert.equal(f.comments.length, 1, "exactly one record for the whole burst");
  assert.match(f.comments[0].body, /timed out on the first attempt/);
});

test("a timeout with no retry success still records once, naming the retry", async () => {
  const f = fixture({ statuses: Array(40).fill("running") });
  await f.server.suggestCardName("card-1");
  assert.equal(f.comments.length, 1, "one record, not one per attempt");
  assert.match(f.comments[0].body, /after one retry/);
  assert.equal(f.card().display_name, "Prompt slice", "a failure never renames the card");
});

function stubs(options, rows, sink) {
  const preset = (id, name) => ({ id, name, providerId: "p", modelId: "m", reasoningLevel: "low", permissionMode: "auto" });
  const next = async () => {
    const next = sink.status(options.gets++);
    if (next === "__rename__") { rows.get("card-1").display_name = "Human title"; return { status: "running" }; }
    if (next === "__archive__") { rows.get("card-1").status = "archived"; return { status: "running" }; }
    return { status: next };
  };
  return {
    // A fresh copy per read: a shared object would let a later mutation be
    // visible to an earlier snapshot and hide the very race under test.
    getCard: (id) => { const r = rows.get(id); return r ? { ...r } : undefined; },
    isArchivedCard: (c) => c.status === "archived",
    getCardByWorkerThread: () => undefined,
    getGenerationPresetId: () => (options.generationPreset === null ? null : "gen-1"),
    getPreset: (id) => preset(id, id === "gen-1" ? "Generation" : "Band"),
    getPresetForBand: () => preset("band-1", "Band"),
    presetParams: (p) => ({ ...p, name: p.name }),
    spawnDisposable: async (args, site) => {
      sink.spawns.push({ site, args });
      if (options.spawnThrows && sink.spawns.length > (options.spawnThrowsAt ?? 0)) throw new Error("spawn refused");
      return { id: `draft-${sink.spawns.length}` };
    },
    stopThread: async (id) => { sink.stops.push(id); },
    comment: (id, body) => sink.comments.push({ id, body }),
    log: (m) => sink.logs.push(m),
    publish: (event, payload) => sink.events.push({ event, payload }),
    stateDir: async () => null,
    workspaceRelative: () => null,
    db: { prepare: () => ({ run: (title) => { rows.get("card-1").display_name = title; } }) },
    now: () => 1,
    sleep: async () => undefined,
    cardWorkspace: async () => ({ path: "/repo" }),
    continuingEnvironment: async () => ({ type: "project-default" }),
    bb: {
      log: { warn: (m) => sink.logs.push(m) },
      storage: { kv: { set: async () => {} } },
      sdk: { threads: { get: next, output: async () => ({ output: options.output ?? "Burst generated title" }) } },
    },
  };
}

test("the unrecordable outcomes are logged, so no exit is uncountable", () => {
  // GAP-1: FEATURES.md and lib/title-outcome.mjs both promise these three go to
  // the daemon log. Before this, no log line was ever emitted and three exits
  // were countable by neither a comment nor a log.
  const renamed = fixture({ statuses: ["__rename__", "__rename__"] });
  return renamed.server.suggestCardName("card-1").then(() => {
    assert.equal(renamed.comments.length, 0, "a human-renamed card takes no write");
    assert.ok(
      renamed.logs.some((line) => line.includes("renamed_mid_burst")),
      "renamed_mid_burst is still logged",
    );
  });
});

test("an archived card's refusal is logged, not silent", () => {
  const f = fixture({ statuses: ["__archive__"] });
  return f.server.suggestCardName("card-1").then(() => {
    assert.equal(f.comments.length, 0);
    assert.ok(f.logs.length > 0, "the archived path leaves a record somewhere");
  });
});

test("a rename landing in the retry-guard window is not overwritten", () => {
  // GAP-2: the pre-retry guard is load-bearing and was untested. The rename
  // lands after attempt 1 classified, so only the guard can stop the retry.
  const f = fixture({ statuses: [...Array(24).fill("running"), "__rename__", "idle"] });
  return f.server.suggestCardName("card-1").then(() => {
    assert.equal(f.card().display_name, "Human title", "the retry must not overwrite a human's name");
  });
});
