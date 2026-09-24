import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  createPresetServer,
  PRESET_MIGRATION_STATEMENTS,
  runPresetMigrations,
} from "../server/presets.ts";

function harness() {
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

test("fresh preset migrations create every designation table and the built-in default", () => {
  const { db } = harness();
  const tables = new Set(db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  ).all().map((row) => row.name));
  for (const table of [
    "presets", "card_presets", "stage_presets",
    "review_preset", "generation_preset", "reliable_preset",
  ]) {
    assert.equal(tables.has(table), true, `${table} exists`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM presets").get().count, 1);
  assert.doesNotThrow(() => runPresetMigrations(db, () => 300), "migrations are idempotent");
});

test("CRUD preserves optional nulls and refuses duplicate, built-in, and assigned deletes", async () => {
  const { db, server } = harness();
  const created = await addPreset(server);
  const row = db.prepare("SELECT * FROM presets WHERE id = ?").get(created.preset.id);
  assert.equal(row.base_branch, null);
  assert.equal(row.machine_id, null);
  assert.equal(row.built_in, 0);

  await assert.rejects(
    addPreset(server, { name: " custom " }),
    /already exists/,
  );
  assert.deepEqual(
    await server.handlers.deletePreset({ id: "preset_default" }),
    { deleted: false, error: "Built-in presets cannot be deleted." },
  );

  await server.handlers.assignPreset({ cardId: "card-1", presetId: created.preset.id });
  assert.deepEqual(
    await server.handlers.deletePreset({ id: created.preset.id }),
    { deleted: false, error: "Preset is assigned to 1 card(s). Unassign first." },
  );
  assert.ok(db.prepare("SELECT id FROM presets WHERE id = ?").get(created.preset.id));
});

test("card, band, and reliable resolution follow the full fallback cascade", async () => {
  const { db, server } = harness();
  const band = await addPreset(server, { name: "Band" });
  const reliable = await addPreset(server, { name: "Reliable" });
  const pinned = await addPreset(server, { name: "Pinned" });
  await server.handlers.setBandPreset({ band: "execution", presetId: band.preset.id });
  assert.equal(server.getPresetForCard("card-1").id, "preset_default");
  assert.equal(server.getPresetForBand("execution", "card-1").id, band.preset.id);
  assert.equal(server.getReliablePresetForBand("execution", "card-1").id, band.preset.id);

  await server.handlers.assignReliablePreset({ presetId: reliable.preset.id });
  assert.equal(server.getReliablePresetForBand("execution", "card-1").id, reliable.preset.id);
  await server.handlers.assignPreset({ cardId: "card-1", presetId: pinned.preset.id });
  assert.equal(server.getPresetForBand("execution", "card-1").id, pinned.preset.id);
  assert.equal(
    server.getReliablePresetForBand("execution", "card-1").id,
    pinned.preset.id,
    "the card pin must beat the reliable override",
  );

  db.prepare("DELETE FROM card_presets WHERE card_id = ?").run("card-1");
  db.prepare("DELETE FROM stage_presets WHERE band = ?").run("execution");
  db.prepare("DELETE FROM reliable_preset WHERE id = 1").run();
  assert.equal(server.getPresetForBand("execution", "card-1").id, "preset_default");
});

test("card creation accessors preserve the base environment and assignment timestamp", async () => {
  const { db, server } = harness();
  const custom = await addPreset(server, {
    name: "Custom base",
    environmentKind: "new-worktree",
  });
  const base = db.prepare("SELECT * FROM presets WHERE id = ?").get(custom.preset.id);
  const override = server.createCardOverride("card-1", base, {
    providerId: "acp-opencode",
    modelId: "opencode-go/muse-spark",
    reasoningLevel: "high",
    permissionMode: "accept-edits",
  });
  assert.equal(override.id, "card-override-card-1");
  assert.equal(override.environment_kind, "new-worktree");
  assert.equal(override.base_branch, null);
  assert.equal(server.pinCardPreset("card-1", override.id, 250), true);
  assert.deepEqual(
    db.prepare("SELECT preset_id, assigned_at FROM card_presets WHERE card_id = ?").get("card-1"),
    { preset_id: override.id, assigned_at: 250 },
  );
  assert.equal(server.pinCardPreset("card-1", "missing"), false);
  server.removeCardPreset("card-1");
  assert.equal(server.hasCardPreset("card-1"), false);
  assert.equal(server.getPresetById(override.id), null);
});

test("band, singleton, default, and unassignment mutations persist and publish", async () => {
  const { db, server, events } = harness();
  const review = await addPreset(server, { name: "Reviewer" });
  const generation = await addPreset(server, { name: "Generation" });
  const worktree = await addPreset(server, {
    name: "Worktree",
    environmentKind: "new-worktree",
  });

  assert.deepEqual(await server.handlers.setBandPreset({
    band: "execution",
    presetId: worktree.preset.id,
  }), { ok: true, error: null });
  await server.handlers.assignReviewPreset({ presetId: review.preset.id });
  assert.deepEqual((await server.handlers.getReviewPreset()).preset.id, review.preset.id);
  await server.handlers.assignGenerationPreset({ presetId: generation.preset.id });
  assert.equal(server.getGenerationPresetId(), generation.preset.id);
  assert.equal(server.getWorktreePresetId(), worktree.preset.id);
  assert.equal(server.getEffectiveBuildEnvironmentKind(), "new-worktree");

  assert.deepEqual(await server.handlers.setBandPreset({ band: "unknown", presetId: null }), {
    ok: false,
    error: "Unknown band: unknown",
  });
  assert.deepEqual(await server.handlers.setDefaultPreset({ id: worktree.preset.id }), {
    ok: true,
    error: null,
  });
  assert.equal(db.prepare(
    "SELECT COUNT(*) AS count FROM presets WHERE is_default = 1",
  ).get().count, 1);

  await server.handlers.assignPreset({ cardId: "card-1", presetId: null });
  assert.equal(server.hasCardPreset("card-1"), false);
  assert.ok(events.some((event) => event.event === "card-state"));
  assert.ok(events.some((event) => event.event === "board-changed"));
});
