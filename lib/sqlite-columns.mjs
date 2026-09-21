/**
 * Shared SQLite column migrations.
 *
 * Every "ensure these columns exist" call site repeated the same PRAGMA +
 * ALTER dance, once per column, across two modules. The table is always a
 * literal written at the call site (never user input), so it is
 * interpolated; the column names and their DDL come from the caller's spec.
 *
 * Idempotent by construction: a column that already exists is skipped, so
 * this is safe on every boot and on legacy databases that predate the
 * column. `present` is updated as we go, so two specs for the same table in
 * one call cannot collide.
 */
export function ensureColumns(db, table, specs) {
  const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
  for (const [name, ddl] of specs) {
    if (present.has(name)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
    present.add(name);
  }
}
