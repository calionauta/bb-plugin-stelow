import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  BRIEFING_MAX_CHARS,
  briefingResult,
  buildBriefingPrompt,
  commsDisabled,
  renderFacts,
  validateBriefingOutput,
} from "../lib/card-briefing.mjs";
import { createBriefingRuntime } from "../server/runtime/card-briefing-runtime.ts";

/**
 * A briefing may PHRASE the deterministic fact list and may never add to it.
 * That leash is the whole point of the feature, so these tests hold it from both
 * ends: the prompt tells the model the facts are all it has, and every failure
 * path — disabled, no preset, spawn failure, timeout, empty output — still
 * returns the list. A briefing that invents a change is worse than no briefing,
 * because the reader cannot tell it from the real ones.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = `CREATE TABLE cards (
  id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, name TEXT, display_name TEXT,
  status TEXT, stage TEXT, workspace_kind TEXT, worker_thread_id TEXT,
  created_at INTEGER, dir_hash TEXT
);
CREATE TABLE card_stage_events (id INTEGER PRIMARY KEY, card_id TEXT, stage TEXT, entered_at INTEGER);
CREATE TABLE inbox_events (
  id TEXT PRIMARY KEY, card_id TEXT, kind TEXT, summary TEXT, occurred_at INTEGER,
  read_at INTEGER, resolved_at INTEGER
);`;

function fixture() {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  db.prepare("INSERT INTO cards (id, project_id, kind, name, status, stage, workspace_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("c1", "p1", "build", "Card", "doing", "execution", "project", 100);
  const stage = db.prepare("INSERT INTO card_stage_events (card_id, stage, entered_at) VALUES (?, ?, ?)");
  stage.run("c1", "triage", 100);
  stage.run("c1", "execution", 300);
  db.prepare("INSERT INTO inbox_events (id, card_id, kind, summary, occurred_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("q1", "c1", "question", "which approach?", 200, null);
  return db;
}

/** A preset row, in the shape `presetParams` reads. */
const preset = (id, name) => ({
  id, name, provider_id: "p", model_id: "m", reasoning_level: "low", permission_mode: "accept-edits",
});

/** A runtime whose model half is replaced by whatever the test wants it to be. */
function runtime(db, overrides = {}) {
  const calls = { spawned: [], stopped: [], prompts: [] };
  const base = {
    db,
    bb: {
      sdk: {
        threads: {
          get: async () => ({ status: "idle" }),
          output: async () => ({ output: overrides.modelOutput ?? "The card moved to execution." }),
        },
      },
    },
    getCard: (cardId) => db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId),
    isArchivedCard: () => false,
    getPreset: () => preset("gen", "Cheap"),
    getPresetForBand: () => preset("band", "Band"),
    getGenerationPresetId: () => "gen",
    presetParams: () => ({
      providerId: "p", modelId: "m", reasoningLevel: "low",
      permissionMode: "accept-edits", environmentKind: "project-default", machineId: null,
    }),
    bandForCard: () => "build",
    cardWorkspace: async () => ({ path: "/tmp/w", hostId: "h" }),
    continuingEnvironment: async (_card, fallback) => fallback,
    spawnDisposable: async (args, site) => {
      calls.spawned.push(site);
      calls.prompts.push(args.prompt ?? "");
      return { id: "t1" };
    },
    stopThread: async (threadId) => { calls.stopped.push(threadId); },
    sleep: async () => {},
    env: () => ({}),
    ...overrides.deps,
  };
  return { runtime: createBriefingRuntime(base), calls };
}

test("the prompt says the facts are all the model has, and forbids inventing", () => {
  const prompt = buildBriefingPrompt({
    cardName: "Card",
    summary: "2 changes since you last looked. 1 still waiting on you.",
    facts: [{ kind: "stage", at: 300, stage: "execution" }],
  });
  assert.match(prompt, /the ONLY facts you have/, "the leash is stated, not implied");
  assert.match(prompt, /state no fact that is not in the list/, "inventing is refused by name");
  assert.match(prompt, /do not infer progress, quality, or intent/, "and so is inference");
  assert.match(prompt, /do not ask questions, run commands, write files, or advance anything/, "protocol work is refused");
  assert.match(prompt, /say plainly that nothing changed/, "an empty list has an answer, not a gap to fill");
  assert.match(prompt, /stage → execution/, "the facts ride the prompt verbatim");
});

test("facts render deterministically, and an empty list says so", () => {
  assert.equal(renderFacts([]), "(no changes recorded)", "no facts is stated, never an empty block");
  const once = renderFacts([{ kind: "question", at: 0, text: "q", open: true }]);
  assert.equal(once, renderFacts([{ kind: "question", at: 0, text: "q", open: true }]), "same facts, same text");
  assert.match(once, /\[open\]/, "an open item is marked where it is rendered");
});

test("the kill switch removes the model, never the facts", async () => {
  assert.equal(commsDisabled({ STELOW_COMMS: "0" }), true, "0 disables");
  assert.equal(commsDisabled({ STELOW_COMMS: "1" }), false, "1 does not");
  assert.equal(commsDisabled({}), false, "unset means on, like every other switch");

  const db = fixture();
  const { runtime: rt, calls } = runtime(db, { deps: { env: () => ({ STELOW_COMMS: "0" }) } });
  const result = await rt.catchUp("c1");
  assert.equal(calls.spawned.length, 0, "a disabled switch spawns nothing");
  assert.equal(result.prose, null, "no phrasing");
  assert.equal(result.source, "disabled", "and the source says why");
  assert.equal(result.facts.length, 2, "the facts are still there — the switch removes the prose, not the answer");
  assert.match(result.summary, /2 changes/, "and so is the summary");
  db.close();
});

test("a spawn failure, a timeout and empty output all degrade to the facts", async () => {
  const db = fixture();
  for (const [label, deps] of [
    ["spawn fails", { spawnDisposable: async () => { throw new Error("boom"); } }],
    ["empty output", { bb: { sdk: { threads: { get: async () => ({ status: "idle" }), output: async () => ({ output: "" }) } } } }],
    ["never settles", { bb: { sdk: { threads: { get: async () => ({ status: "active" }), output: async () => ({ output: "late" }) } } } }],
    ["no preset", { getPreset: () => null, getPresetForBand: () => { throw new Error("no band preset"); } }],
  ]) {
    const { runtime: rt } = runtime(db, { deps });
    const result = await rt.catchUp("c1");
    assert.equal(result.ok, true, `${label}: the answer still arrives`);
    assert.equal(result.prose, null, `${label}: no prose is claimed`);
    assert.equal(result.facts.length, 2, `${label}: the deterministic facts survive`);
    assert.ok(result.summary.length > 0, `${label}: and so does the summary`);
  }
  db.close();
});

test("an unknown or archived card refuses in the same shape, never a partial answer", async () => {
  const db = fixture();
  const { runtime: rt } = runtime(db);
  const missing = await rt.catchUp("nope");
  assert.equal(missing.ok, false, "an unknown card refuses");
  assert.deepEqual(
    Object.keys(missing).sort(),
    ["anchor", "error", "facts", "ok", "prose", "since", "source", "summary"],
    "a refusal carries every field the contract declares — a client never branches on missing keys",
  );
  const { runtime: archived } = runtime(db, { deps: { isArchivedCard: () => true } });
  assert.equal((await archived.catchUp("c1")).ok, false, "an archived card refuses");
  db.close();
});

test("the anchor is the card's own read state, and the delta starts there", async () => {
  const db = fixture();
  const { runtime: rt, calls } = runtime(db);
  const first = await rt.catchUp("c1");
  assert.equal(first.anchor, "created", "never read means the whole card is the delta");
  assert.equal(first.facts.length, 2, "both changes are reported");
  assert.equal(calls.spawned[0], "card-briefing", "the site is the registered briefing site");

  db.prepare("INSERT INTO inbox_events (id, card_id, kind, summary, occurred_at, read_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("c1r", "c1", "completed", "done", 400, 350);
  const second = await rt.catchUp("c1");
  assert.equal(second.anchor, "last-read", "a recorded read becomes the anchor");
  assert.equal(second.since, 350, "and it is the anchor's time");
  assert.deepEqual(
    second.facts.map((fact) => fact.kind),
    ["completed"],
    "only what changed after the read — the completion at 400, not the stage moves at 100 and 300",
  );
  db.close();
});

test("the briefing never writes a card, an artifact, or a state file", async () => {
  const source = readFileSync(join(ROOT, "server/runtime/card-briefing-runtime.ts"), "utf8");
  assert.doesNotMatch(source, /files\.write|files\.mkdir|UPDATE cards|INSERT INTO cards/, "no write path exists here");
  // Code shapes, not the word: the runtime's docstring says nothing advances,
  // and a guard on the word would forbid saying so.
  assert.doesNotMatch(source, /advanceCard|runHelper\(|requestGatePreReview\(/, "and nothing advances");
  const db = fixture();
  const { runtime: rt } = runtime(db);
  const before = db.prepare("SELECT * FROM cards WHERE id = 'c1'").get();
  await rt.catchUp("c1");
  assert.deepEqual(db.prepare("SELECT * FROM cards WHERE id = 'c1'").get(), before, "the card is byte-identical after a briefing");
  db.close();
});

test("usable output is accepted, oversized output is capped, empty is refused", () => {
  assert.equal(validateBriefingOutput("The card moved on.").ok, true, "plain prose is usable");
  assert.equal(validateBriefingOutput("   ").ok, false, "whitespace is not a briefing");
  const huge = validateBriefingOutput("x".repeat(BRIEFING_MAX_CHARS + 10));
  assert.equal(huge.ok, true, "an oversized briefing is capped, not discarded");
  assert.ok(huge.text.length < BRIEFING_MAX_CHARS + 100, "and the cap holds");
  assert.match(huge.text, /truncated/, "the cut is stated inside the text");
});

test("the result carries both halves and names where the prose came from", () => {
  const fact = { kind: "stage", at: 1, text: null, stage: "execution", open: null };
  const withProse = briefingResult({ prose: "It moved.", facts: [fact], summary: "1 change.", source: "generation" });
  assert.equal(withProse.prose, "It moved.", "usable prose is carried");
  assert.equal(withProse.source, "generation", "with its source");
  // The source names WHY there is no prose. A switch someone turned off is not
  // an outage, and a briefing that cannot say which is one nobody can debug.
  for (const source of ["disabled", "no-preset", "spawn-failed", "no-output"]) {
    const factsOnly = briefingResult({ prose: "", facts: [fact], summary: "1 change.", source });
    assert.equal(factsOnly.prose, null, `${source}: empty prose is null, not an empty string`);
    assert.equal(factsOnly.source, source, `${source}: the reason survives into the result`);
    assert.deepEqual(factsOnly.facts, [fact], `${source}: the facts are the whole answer`);
  }
});

console.log("card briefing test ok: fact leash, kill switch, degradation, no writes");
