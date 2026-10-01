import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  createPresetServer,
  PRESET_MIGRATION_STATEMENTS,
  runPresetMigrations,
} from "../server/presets.ts";

/**
 * The host's provider roster, in the shape `providers.list()` answers. Every
 * provider declares a SUBSET of the eight-level host enum — `pi` has no
 * `ultra`/`ultracode`, `acp-opencode` has no `none`/`ultra`/`ultracode` — which
 * is the whole reason the enum check alone was not enough.
 */
const ROSTER = [
  { id: "pi", reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"] },
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

test("upsertPreset refuses a level no host will spawn, and writes nothing", async () => {
  const { db, server } = harness();
  await assert.rejects(
    addPreset(server, { reasoningLevel: "banana" }),
    /Preset reasoning level "banana" is not one of: low, medium, high, xhigh, max, none, ultra, ultracode\./,
    "the refusal names the levels that are accepted",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM presets WHERE name = 'Custom'").get().count,
    0,
    "a refused level leaves no row behind, so no card can inherit it",
  );
  assert.equal(
    (await addPreset(server, { reasoningLevel: "xhigh" })).preset.name,
    "Custom",
    "a real level from the same CLI-shaped input is accepted",
  );
});

test("a level the provider never declared is refused, and writes nothing", async () => {
  const { db, server } = harness();
  await assert.rejects(
    addPreset(server, { providerId: "acp-opencode", reasoningLevel: "ultracode" }),
    /acp-opencode.*does not support reasoning level "ultracode"/,
    "the refusal names the provider and the level",
  );
  await assert.rejects(
    addPreset(server, { providerId: "acp-opencode", reasoningLevel: "ultracode" }),
    /It supports: low, medium, high, xhigh, max\./,
    "and the levels that ARE supported, which is where the reader has to go next",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM presets WHERE name = 'Custom'").get().count,
    0,
    "the refused row is never written, so no card can inherit a level nobody chose",
  );
  assert.equal(
    (await addPreset(server, { providerId: "acp-opencode", reasoningLevel: "high" })).preset.name,
    "Custom",
    "a level inside that same provider's declared ladder is accepted",
  );
});

test("the same level is refused for one provider and accepted for another", async () => {
  const { server } = harness();
  await assert.doesNotReject(
    addPreset(server, { name: "On pi", providerId: "pi", reasoningLevel: "none" }),
    "pi declares none",
  );
  await assert.rejects(
    addPreset(server, { name: "On acp", providerId: "acp-opencode", reasoningLevel: "none" }),
    /does not support/,
    "acp-opencode does not, and the level is in the host enum either way",
  );
});

test("an unreadable roster never makes a preset unsavable, and never claims support", async () => {
  const { db, server } = harness({ roster: new Error("host down") });
  assert.equal(
    (await addPreset(server, { providerId: "acp-opencode", reasoningLevel: "ultracode" })).preset.name,
    "Custom",
    "an unavailable roster is not evidence of an unsupported level, so the save goes through",
  );
  const listed = await server.handlers.listPresets();
  const custom = listed.presets.find((preset) => preset.name === "Custom");
  assert.equal(
    custom.reasoningLevelSupported,
    null,
    "and the list says unverified rather than true, so no surface renders it as honoured",
  );
  assert.ok(
    db.prepare("SELECT id FROM presets WHERE name = 'Custom'").get(),
    "the row is there to be repaired once the host answers",
  );
});

test("listPresets reports each preset's level against the host's own ladder", async () => {
  const { db, server } = harness();
  db.prepare(`
    INSERT INTO presets VALUES ('p_ok','Ok','acp-opencode','m','high','full','project-default',NULL,NULL,'',0,0,1,1)
  `).run();
  db.prepare(`
    INSERT INTO presets VALUES ('p_bad','Bad','acp-opencode','m','ultracode','full','project-default',NULL,NULL,'',0,0,1,1)
  `).run();
  const byName = new Map(
    (await server.handlers.listPresets()).presets.map((preset) => [preset.name, preset]),
  );
  assert.equal(
    byName.get("Ok").reasoningLevelSupported,
    true,
    "a declared level is reported supported",
  );
  assert.equal(
    byName.get("Bad").reasoningLevelSupported,
    false,
    "an undeclared level is reported unsupported, which is what the row has to render",
  );
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
