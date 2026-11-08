/**
 * Shared SQLite column migrations.
 *
 * Every "ensure these columns exist" call site repeated the same PRAGMA +
 * ALTER dance, once per column, across two modules. The table is always a
 * literal written at the call site (never user input), so it is
 * interpolated; the column names and their DDL come from the caller's spec.
 *
 * "Interpolated" still means quoted: the table and column identifiers are
 * wrapped in double quotes with embedded quotes rejected, so a hostile or
 * mistyped name fails closed with a named error instead of executing as
 * SQL. Identifiers are `[A-Za-z_][A-Za-z0-9_]*` — anything else is not a
 * column this plugin owns. The DDL fragment likewise refuses statement
 * stacking and comment smuggling (`;`, `--`, `/*`, NUL): it is one column
 * definition from a call-site literal, never a second statement.
 *
 * Idempotent by construction: a column that already exists is skipped, so
 * this is safe on every boot and on legacy databases that predate the
 * column. `present` is updated as we go, so two specs for the same table in
 * one call cannot collide.
 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quotedIdentifier(kind, value) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error(`sqlite-columns: refusing to migrate ${kind} with name ${JSON.stringify(value)}`);
  }
  return `"${value}"`;
}

// The DDL is a single column-definition fragment from a call-site literal,
// never caller input — but a fragment must still be one fragment: statement
// stacking (`;`), comment smuggling (`--`, `/*`), and NUL all refuse.
// Everything the plugin uses (CHECK (…) IN-lists, COLLATE, UNIQUE, quoted
// DEFAULTs) passes; a second statement never does.
function checkedDdl(ddl) {
  if (typeof ddl !== "string" || !ddl.trim() || /[;\0]/.test(ddl) || /--/.test(ddl) || /\/\*/.test(ddl)) {
    throw new Error(`sqlite-columns: refusing to migrate column with definition ${JSON.stringify(ddl)}`);
  }
  return ddl;
}

export function ensureColumns(db, table, specs) {
  const quotedTable = quotedIdentifier("table", table);
  const present = new Set(db.prepare(`PRAGMA table_info(${quotedTable})`).all().map((column) => column.name));
  for (const [name, ddl] of specs) {
    const quotedColumn = quotedIdentifier("column", name);
    if (present.has(name)) continue;
    db.exec(`ALTER TABLE ${quotedTable} ADD COLUMN ${quotedColumn} ${checkedDdl(ddl)}`);
    present.add(name);
  }
}
