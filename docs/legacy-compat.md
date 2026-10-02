# Legacy compatibility ledger

Every backward-compatibility branch in the boot path, tracked for the v1
cleanup. Schema migrations (`CREATE`/`ALTER` ensures) and one-time data
backfills exist because marketplace updates run in place on the user's
persisted SQLite file — a migration removed silently bricks every database
that predates it (`table X has no column named Y` on the next write).

Rules:

- Never remove a tracked entry silently. Removal is allowed only behind a
  v1 schema gate that either migrates older databases once or refuses them
  with an assisted path (the 0.3 line precedent: archive plus reinstall,
  never a crash).
- Each entry pins literal code anchors below. `tests/legacy-compat.test.mjs`
  parses this file and fails when an anchor disappears without a ledger
  update, so the inventory cannot rot quietly. That test is the reason the
  anchors are literal substrings of the named file: it reads the file named
  by `- file:` and asserts each `- anchor:` appears in it. An anchor that no
  longer matches is a red test, not a stale note.
- Every claim in a `- legacy:` line is about a database state, and the
  anchors above it are about the code that serves that state. When code
  moves, the anchor moves with it; when code is deleted, the entry is
  deleted in the same commit, which is what the parser enforces.
- Helpers that `CREATE` their own tables (`ensureTrackableEventsTable`,
  `ensureCardClaimsTables`, the `CREATE` halves of `runGithubMigrations`,
  `ask_contracts` and friends) carry no legacy state and are not listed —
  only their `ALTER`/backfill halves appear.
- Entry format is load-bearing for the test: `## L-NN title`, one
  `- file:`, one or more `- anchor:`, plus `- legacy:` and `- remove-when:`.

## L-01 cards columns

- file: `server/core-migrations.ts`
- anchor: `["display_name", "TEXT"]`
- legacy: databases created before each card column existed (`display_name`,
  `last_idle_at`, `dir_hash`, `worker_preset_id`, `preset_restart_pending`,
  `attachments`, `workspace_kind`, `workspace_path`, `workspace_host_id`,
  `kind`, `research_strategy`, `research_strategies`, `explore_stage`,
  `spawn_retry_count`, `spawn_retry_thread`, `environment_label`,
  `split_from`).
- remove-when: v1 schema gate only. Dropping any `ALTER` breaks inserts and
  reads on databases that predate that column.

## L-02 expired_questions columns

- file: `server/core-migrations.ts`
- anchor: `["kind", "TEXT NOT NULL DEFAULT 'standard'"]`
- legacy: databases predating the `kind` and `locale` columns.
- remove-when: v1 schema gate only.

## L-03 inbox resolution reason and severity columns

- file: `server/inbox.ts`
- anchor: `ensureInboxResolvedReasonColumn(db);`
- anchor: `ensureInboxSeverityColumns(db);`
- legacy: `inbox_events` tables created before `resolved_reason`, `severity`,
  and `severity_reasons` existed. Writes list these columns explicitly, so a
  missing column crashes inserts, not just reads.
- remove-when: v1 schema gate only. The calls must also stay positioned
  after the `CREATE TABLE inbox_events` in the same function, which
  `tests/core-migrations.test.mjs` pins from the other side: it runs the
  whole boot against an empty database and fails if any of these columns is
  absent afterwards.

## L-04 inbox resolved_at column

- file: `server/inbox.ts`
- anchor: `ALTER TABLE inbox_events ADD COLUMN resolved_at INTEGER`
- legacy: `inbox_events` tables from before resolution timestamps existed.
- remove-when: v1 schema gate only.

## L-05 research duplicate-completion cleanup

- file: `server/inbox.ts`
- anchor: `AND summary = 'Completed. Review the final outcome.'`
- legacy: research cards carrying two completion events from the historical
  double-emit bug (generic transition plus research-specific one). Converges
  on first run; the duplicate-insert path is fixed upstream.
- remove-when: earliest data-backfill candidate — only once every live
  database has booted past the fixing version. Still v1 at the earliest;
  the statement is idempotent and costs one indexed delete per boot.

## L-06 decision_api_config provider column

- file: `server/decision-store.ts`
- anchor: `ALTER TABLE decision_api_config ADD COLUMN provider TEXT`
- legacy: installs created before provider adapters; `jev` keeps old rows
  working unchanged.
- remove-when: v1 schema gate only.

## L-07 decision_points routing rebuild

- file: `server/decision-store.ts`
- anchor: `ALTER TABLE decision_points_new RENAME TO decision_points`
- legacy: `decision_points` tables created with the old
  `CHECK (mode IN ('rules', 'api'))` and without route-override columns and
  `preset_id`. The guarded rebuild widens the check and preserves rows.
- remove-when: v1 schema gate only.

## L-08 stage_presets band-check rebuild

- file: `server/preset-migrations.ts`
- anchor: `ALTER TABLE stage_presets RENAME TO stage_presets_rebuild;`
- legacy: `stage_presets` tables created with the build-only band allowlist
  `CHECK (band IN ...)`. Rebuilt once without the check, rows preserved.
- remove-when: v1 schema gate only.

## L-09 presets current shape (no longer a column ensure)

- file: `server/preset-migrations.ts`
- anchor: `function ensureCurrentPresets(`
- anchor: `function assertPresetsShape(`
- legacy: **deleted from the write path, deliberately.** This entry used to
  anchor an `ensureColumns` ALTER adding `environment_kind`, `base_branch`,
  and `machine_id` to an existing `presets` table. That repair is gone: a
  `presets` table predating the current DDL now either has no rows and is
  recreated, or has rows and boot is REFUSED with `PresetSchemaError` naming
  the missing constraint and the `ALTER TABLE presets RENAME TO
  presets_legacy` that unblocks it. Stelow does not maintain backward
  compatibility for user-authored configuration, so there is no entry to
  keep for the old column-add path — what is tracked here is the refusal and
  the shape check, which stay.
- remove-when: never. The assertion is current behavior; removing it lets an
  unsupported table boot with the wrong column order.

## L-10 codex provider backfill (deleted)

- file: `server/preset-migrations.ts`
- anchor: `function ensureDefaultPreset(`
- legacy: **deleted.** Two backfills used to run here on every boot:
  repointing the built-in default preset from the uninstalled Codex CLI at
  the `pi` provider, and deleting non-built-in presets still referencing
  `codex`. Both silently undid an operator's chosen configuration on an
  install that was otherwise current, so both were removed. The entry is kept
  because its history is the reason `ensureDefaultPreset` writes nothing when
  `preset_default` already exists — there is no code to delete now, and the
  anchor records the seed that is the reason no backfill returned.
- remove-when: never; nothing left to remove. This line is a tombstone, and
  the parser below still requires its anchor to exist, which is what stops
  the seed from being quietly replaced by a backfill again.

## L-11 default preset seed

- file: `server/preset-migrations.ts`
- anchor: `function ensureDefaultPreset(`
- legacy: not legacy state — a guarded seed (inserts only when
  `preset_default` is absent). Listed so the v1 cleanup does not mistake it
  for a backfill; seeds stay.
- remove-when: never; seeds are current behavior, not compatibility.

## L-12 automation_rules autostart column

- file: `server/core-migrations.ts`
- anchor: `["autostart", "INTEGER NOT NULL DEFAULT 0"]`
- legacy: `automation_rules` tables (created inside `runGithubMigrations`)
  predating the autostart flag.
- remove-when: v1 schema gate only. The table is owned by
  `server/github-migrations.ts`; the column ensure remains in the core
  migration sequence after `runGithubMigrations(db)`.

## L-13 github_imports columns

- file: `server/github-migrations.ts`
- anchor: `addColumnIfMissing(db, "github_imports", "commented_at", "INTEGER")`
- anchor: `addColumnIfMissing(db, "github_imports", "claimed_by", "TEXT")`
- legacy: `github_imports` tables predating comment tracking and claiming.
- remove-when: v1 schema gate only.

## L-14 automation_rules columns and labels backfill

- file: `server/github-migrations.ts`
- anchor: `addColumnIfMissing(db, "automation_rules", "labels", "TEXT")`
- anchor: `UPDATE automation_rules SET labels = ? WHERE id = ?`
- legacy: rules predating `labels`, `start_immediate`, `prompt_template`,
  and `trusted_authors`, plus the best-effort backfill deriving `labels`
  from the legacy singular `label`. The backfill reads `row.label` and
  `row.labels` unguarded and runs only after the ALTER above it, so it is
  safe by ordering alone; its `catch {}` would swallow a real failure. Left
  as-is on purpose — the fix is a v1 schema gate, not a guard here.
- remove-when: v1 schema gate only.

## L-15 automation_rule_fires outcome column

- file: `server/github-migrations.ts`
- anchor: `addColumnIfMissing(db, "automation_rule_fires", "outcome", "TEXT")`
- legacy: fire ledgers predating outcome recording.
- remove-when: v1 schema gate only.

## L-16 migrate array frozen

- file: `server/core-migrations.ts`
- anchor: `bb.storage.migrate(db, BASE_MIGRATION_STATEMENTS)`
- legacy: BB records applied migration indexes per installation, and older
  local installs recorded different lengths — including a legacy-unknown row
  before hash tracking existed that refuses index 6+. New tables must go
  through direct idempotent `exec`, never by appending here.
- remove-when: never. The recorded lengths live on user machines and cannot
  be rewritten from this side. The array's text is additionally frozen by
  hash in `tests/migration-statement-hashes.test.mjs`; that test and this
  entry guard the same thing from two directions — the hash test catches an
  edited statement, this one catches an added one.
