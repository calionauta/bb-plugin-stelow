import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  createPresetServer,
  PRESET_MIGRATION_STATEMENTS,
  runPresetMigrations,
} from "../server/presets.ts";

/**
 * The two new server refusals: a built-in keeps its environment, and the
 * board default cannot be deleted out from under the card-resolution
 * fallback.
 *
 * Same harness as `server-presets.test.mjs` (in-memory DB, seeded card-1,
 * stubbed provider roster): a refusal that writes nothing is the property
 * under test, so every refusal below snapshots the row first and proves it
 * survives. Run with:
 *
 *   node --experimental-strip-types --import ./tests/register-ts-source.mjs \
 *     --test tests/server-preset-delete-refs.test.mjs
 *
 * NOTE: this file needs `better-sqlite3`, which is a devDependency that was
 * not installed in the authoring environment, so it could not be executed
 * here. It follows the `server-presets.test.mjs` harness statement for
 * statement; execute it wherever `npm run test:presets` runs.
 */

// The host's provider roster, in the shape `providers.list()` answers. Copied
// from server-presets.test.mjs so this file runs standalone.
const ROSTER = [
  { id: "pi", reasoningLevels: ["low", "medium", "high", "xhigh", "max"] },
  { id: "acp-opencode", reasoningLevels: ["low", "medium", "high", "xhigh", "max"] },
].map((provider) => ({
  id: provider.id,
  reasoningLevels: provider.reasoningLevels.map((id) => ({ id, label: id })),
}));

function harness({ roster = ROSTER } = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      worker_thread_id TEXT,
      worker_preset_id TEXT,
      preset_restart_pending INTEGER
    )
  `);
  db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "card-1", "build", "build", "running", "thread-1", "preset_default", null,
  );
  for (const statement of PRESET_MIGRATION_STATEMENTS) db.exec(statement);
  runPresetMigrations(db, () => 100);
  const events = [];
  const cards = new Map([
    ["card-1", {
      id: "card-1",
      kind: "build",
      stage: "build",
      status: "running",
      worker_thread_id: "thread-1",
      worker_preset_id: "preset_default",
    }],
  ]);
  const bb = {
    realtime: { publish: (event, payload) => events.push({ event, payload }) },
    sdk: {
      providers: {
        list: async () => {
          if (roster instanceof Error) throw roster;
          return roster;
        },
      },
    },
  };
  const server = createPresetServer({
    db,
    bb,
    now: () => 200,
    errors: { cardNotFound: "Card not found.", presetNotFound: "Preset not found." },
    getCard: (id) => cards.get(id),
  });
  return { db, server, events };
}

async function addPreset(server, overrides = {}) {
  const input = {
    name: "Custom",
    providerId: "pi",
    modelId: "bifrost/custom",
    reasoningLevel: "medium",
    permissionMode: "full",
    environmentKind: "project-default",
    instructions: "",
    ...overrides,
  };
  const result = await server.handlers.upsertPreset(input);
  return { ...result, input };
}

function builtInInput(overrides = {}) {
  return {
    id: "preset_default",
    name: "Default",
    providerId: "pi",
    modelId: "bifrost/harness-coding",
    reasoningLevel: "medium",
    permissionMode: "full",
    environmentKind: "project-default",
    instructions: "",
    ...overrides,
  };
}

test("a built-in environment flip is refused with its exit, and writes nothing", async () => {
  const { db, server } = harness();
  const before = db.prepare("SELECT * FROM presets WHERE id = 'preset_default'").get();
  assert.equal(before.built_in, 1, "the seeded default is the built-in row under test");
  assert.equal(before.environment_kind, "project-default", "and it starts on the checkout kind");

  await assert.rejects(
    server.handlers.upsertPreset(builtInInput({ environmentKind: "new-worktree" })),
    /^Built-in presets keep their own environment\. Duplicate it to change this\.$/,
    "the refusal names the constraint and the way out, exactly as the dialog's help sentence does",
  );
  assert.deepEqual(
    db.prepare("SELECT * FROM presets WHERE id = 'preset_default'").get(),
    before,
    "a refused flip leaves the row byte-for-byte alone, so no auto-started worker re-routes",
  );
});

test("a built-in edit that keeps its environment succeeds", async () => {
  const { db, server } = harness();
  const result = await server.handlers.upsertPreset(
    builtInInput({ instructions: "edited" }),
  );
  assert.equal(result.preset.id, "preset_default", "the same row is updated, not replaced");
  assert.equal(
    db.prepare("SELECT instructions FROM presets WHERE id = 'preset_default'").get().instructions,
    "edited",
    "the edit lands because only the environment kind is guarded",
  );
});

test("a built-in edit of other fields still succeeds", async () => {
  const { db, server } = harness();
  await server.handlers.upsertPreset(builtInInput({
    modelId: "bifrost/other",
    permissionMode: "accept-edits",
  }));
  assert.deepEqual(
    db.prepare(
      "SELECT model_id, permission_mode, environment_kind FROM presets WHERE id = 'preset_default'",
    ).get(),
    {
      model_id: "bifrost/other",
      permission_mode: "accept-edits",
      environment_kind: "project-default",
    },
    "model and permission edits land while the environment stays put",
  );
});

test("deleting the custom board default is refused with its exit", async () => {
  const { db, server } = harness();
  const created = await addPreset(server);
  assert.deepEqual(
    await server.handlers.setDefaultPreset({ id: created.preset.id }),
    { ok: true, error: null },
    "the custom preset becomes the board default first",
  );
  assert.deepEqual(
    await server.handlers.deletePreset({ id: created.preset.id }),
    {
      deleted: false,
      error: "Preset is the board default. Set another preset as default first.",
    },
    "the refusal names the exit instead of silently promoting the oldest row",
  );
  assert.ok(
    db.prepare("SELECT id FROM presets WHERE id = ?").get(created.preset.id),
    "the refused default survives, so the board still resolves to it",
  );
});

test("a preset that is both default and card-assigned reports the default first", async () => {
  const { db, server } = harness();
  const created = await addPreset(server);
  await server.handlers.setDefaultPreset({ id: created.preset.id });
  await server.handlers.assignPreset({ cardId: "card-1", presetId: created.preset.id });
  assert.deepEqual(
    await server.handlers.deletePreset({ id: created.preset.id }),
    {
      deleted: false,
      error: "Preset is the board default. Set another preset as default first.",
    },
    "the default check runs before the card-assignment check, so the reader gets one exit, not a count",
  );
  assert.ok(
    db.prepare("SELECT id FROM presets WHERE id = ?").get(created.preset.id),
    "and the row survives the refused delete",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM card_presets WHERE preset_id = ?")
      .get(created.preset.id).count,
    1,
    "with the card pin still in place behind it",
  );
});

test("the older refusals still read as before", async () => {
  const { db, server } = harness();
  assert.deepEqual(
    await server.handlers.deletePreset({ id: "preset_default" }),
    { deleted: false, error: "Built-in presets cannot be deleted." },
    "the built-in delete refusal is unchanged and still runs before the default check",
  );
  const created = await addPreset(server);
  await server.handlers.assignPreset({ cardId: "card-1", presetId: created.preset.id });
  assert.deepEqual(
    await server.handlers.deletePreset({ id: created.preset.id }),
    { deleted: false, error: "Preset is assigned to 1 card(s). Unassign first." },
    "the card-assignment refusal still names its count for a non-default preset",
  );
  assert.ok(db.prepare("SELECT id FROM presets WHERE id = ?").get(created.preset.id));
});

test("an ordinary preset still deletes, so the refusals above refuse rather than block", async () => {
  const { db, server } = harness();
  const created = await addPreset(server);
  assert.deepEqual(
    await server.handlers.deletePreset({ id: created.preset.id }),
    { deleted: true, error: null },
    "an unassigned, non-default custom preset deletes cleanly",
  );
  assert.equal(
    db.prepare("SELECT id FROM presets WHERE id = ?").get(created.preset.id),
    undefined,
    "and the row is gone",
  );
});
