import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

// Fresh-install contract: a brand-new user installs from the marketplace
// (git semver tag) and bb builds with `bb plugin build` only — postbuild
// never runs there. So every file the server reads from the source root
// must be (a) tracked in git, (b) carried by the package, and (c) present
// here. Anything else is a first-boot ENOENT for a lay user.
const root = new URL("../", import.meta.url);
const exists = (path) => existsSync(new URL(path, root));
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

// Entry points the marketplace build consumes.
assert.equal(exists("server.ts"), true, "server entry is tracked");
assert.equal(exists("app.tsx"), true, "app entry is tracked");
assert.deepEqual(manifest.bb.server, "./server.ts", "manifest server entry resolves");
assert.deepEqual(manifest.bb.app, "./app.tsx", "manifest app entry resolves");
for (const dir of manifest.bb.skills) {
  assert.equal(exists(dir), true, `manifest skills dir ${dir} is tracked`);
}

// Runtime reads from the unified plugin root (lib/plugin-paths.mjs):
// the transitions marker, the helper script, the upstream version, the
// strategy registry, and the About logo.
for (const file of [
  "skills/stelow-workflow-orchestrator/references/transitions.md",
  "data/stelow",
  "data/stelow-package.json",
  "data/product-strategies.json",
  "assets/stelow-logo.png",
]) {
  assert.equal(exists(file), true, `first-boot read ${file} is tracked`);
}

// The same set must survive packaging (git installs carry the tree;
// npm installs carry only `files`).
const packed = new Set(manifest.files);
const covered = (file) => [...packed].some((entry) => file === entry || file.startsWith(entry + "/"));
for (const file of ["server.ts", "app.tsx", "skills/", "data/", "assets/", "lib/", "components/", "hooks/"]) {
  assert.equal(covered(file), true, `first-boot read ${file} survives packaging`);
}

// Migrations must be fresh-safe and upgrade-safe: conditional creates plus
// guarded ALTERs only — never a bare CREATE TABLE that crashes reinstalls.
const server = readFileSync(new URL("server.ts", root), "utf8");
assert.doesNotMatch(server, /"CREATE TABLE (?!IF NOT EXISTS)/, "migrations never crash a fresh database");
assert.match(server, /CREATE TABLE IF NOT EXISTS cards/, "first boot creates the cards table");
assert.match(server, /CREATE TABLE IF NOT EXISTS presets/, "first boot creates the presets table");

// Boot-order contract, generalized: on a fresh database no statement may
// touch a table before its CREATE TABLE runs. Fresh installs crash with
// "no such table: <t>" while upgrades keep working, so every ALTER, index,
// or read/write on table t must be preceded by t's CREATE on the boot path —
// whether the statement sits inline in server.ts or inside an ensure*
// helper in lib/ or server/.
//
// Static boot simulation with the TypeScript parser (comments and string
// hazards excluded by construction): walk the plugin() body in source order
// tracking created tables. Nested function bodies are deferred to runtime
// and skipped, except db.transaction callbacks, which execute at boot when
// invoked. prepare() without a terminal run/get/all executes nothing and is
// ignored; PRAGMA and sqlite_master reads never throw on missing tables.
const created = new Set();
const stash = new Map();
const resolving = [];
const unitCache = new Map();
function parseUnit(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
}
function unitFor(file) {
  if (!unitCache.has(file)) unitCache.set(file, parseUnit(file, readFileSync(new URL(file, root), "utf8")));
  return unitCache.get(file);
}
function sqlEvents(sql, where) {
  const patterns = [
    { re: /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?)(\w+)\1/gi, kind: "create", op: "CREATE TABLE", group: 2 },
    { re: /ALTER\s+TABLE\s+("?)(\w+)\1\s+RENAME\s+TO\s+("?)(\w+)\3/gi, kind: "rename", op: "ALTER TABLE", group: 0 },
    { re: /ALTER\s+TABLE\s+("?)(\w+)\1(?!\w)(?!\s+RENAME\b)/gi, kind: "use", op: "ALTER TABLE", group: 2 },
    { re: /DROP\s+TABLE\s+(?!IF\s+EXISTS\s+)("?)(\w+)\1/gi, kind: "use", op: "DROP TABLE", group: 2 },
    { re: /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?("?)[\w$]+\1\s+ON\s+("?)(\w+)\2/gi, kind: "use", op: "CREATE INDEX", group: 3 },
    { re: /DELETE\s+FROM\s+("?)(\w+)\1/gi, kind: "use", op: "DELETE FROM", group: 2 },
    { re: /UPDATE\s+("?)(\w+)\1\s+SET/gi, kind: "use", op: "UPDATE", group: 2 },
    { re: /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+("?)(\w+)\1/gi, kind: "use", op: "INSERT INTO", group: 2 },
    { re: /\bFROM\s+("?)(\w+)\1/gi, kind: "use", op: "SELECT..FROM", group: 2 },
    { re: /\bJOIN\s+("?)(\w+)\1/gi, kind: "use", op: "JOIN", group: 2 },
  ];
  const events = [];
  for (const { re, kind, op, group } of patterns) {
    let match;
    while ((match = re.exec(sql)) !== null) {
      if (kind === "rename") {
        events.push({ index: match.index, order: 0, kind: "use", op, table: match[2], where });
        events.push({ index: match.index, order: 1, kind: "create", op: "ALTER TABLE..RENAME TO", table: match[4], where });
      } else {
        events.push({ index: match.index, order: kind === "create" ? 1 : 0, kind, op, table: match[group], where });
      }
    }
  }
  events.sort((a, b) => a.index - b.index || a.order - b.order);
  return events;
}
function checkSql(sql, where) {
  for (const event of sqlEvents(sql, where)) {
    if (event.table === "sqlite_master" || event.table === "sqlite_sequence") continue;
    if (event.kind === "create") created.add(event.table);
    else {
      assert.ok(
        created.has(event.table),
        `boot migration touches table before its CREATE: ${event.op} ${event.table} via ${where} — on a fresh database this crashes with "no such table: ${event.table}"`,
      );
    }
  }
}
function collectPrepares(node, sourceFile, trail) {
  if (ts.isCallExpression(node)) {
    let target = null;
    try {
      target = node.expression.getText(sourceFile);
    } catch { /* synthetic node; nothing resolvable */ }
    if (target === "db.prepare" && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      checkSql(node.arguments[0].text, `db.prepare terminal in ${trail}`);
    }
  }
  ts.forEachChild(node, (child) => collectPrepares(child, sourceFile, trail));
}
const libFiles = readdirSync(new URL("lib/", root)).filter((file) => file.endsWith(".mjs")).map((file) => `lib/${file}`);
const helperSearchFiles = ["server.ts", "server/github-issues.ts", ...libFiles];
function findHelper(name) {
  for (const file of helperSearchFiles) {
    const sourceFile = unitFor(file);
    let found = null;
    ts.forEachChild(sourceFile, (node) => {
      if (found) return;
      if (ts.isFunctionDeclaration(node) && node.name && node.name.text === name && node.body) {
        found = { body: node.body, sourceFile };
      }
      if (!found && ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer &&
            (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
            found = { body: declaration.initializer.body, sourceFile };
          }
        }
      }
    });
    if (found) return found;
  }
  return null;
}
function expandHelper(name, trail) {
  assert.ok(!resolving.includes(name), `circular migration helper: ${[...resolving, name].join(" > ")}`);
  const found = findHelper(name);
  assert.ok(found, `migration helper ${name}(db) runs at boot but is defined nowhere in lib/ or server/ — extend helperSearchFiles in this test`);
  resolving.push(name);
  walk(found.body, found.sourceFile, `${trail} > ${name}(db)`);
  resolving.pop();
}
function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessor(node) ||
    ts.isSetAccessor(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node);
}
function handleCall(node, sourceFile, trail) {
  const expression = node.expression;
  let target = null;
  try {
    target = expression.getText(sourceFile);
  } catch { return; }
  const first = node.arguments[0];
  if (target === "db.exec" && first && ts.isStringLiteralLike(first)) {
    checkSql(first.text, `db.exec in ${trail}`);
  } else if (target === "bb.storage.migrate" && node.arguments.length > 1 && ts.isArrayLiteralExpression(node.arguments[1])) {
    for (const element of node.arguments[1].elements) {
      if (ts.isStringLiteralLike(element)) checkSql(element.text, `migrate array in ${trail}`);
    }
  } else if (ts.isPropertyAccessExpression(expression) && ["run", "get", "all"].includes(expression.name.text)) {
    collectPrepares(expression.expression, sourceFile, trail);
  } else if (target === "ensureColumns" && node.arguments.length > 1 && ts.isStringLiteralLike(node.arguments[1])) {
    checkSql(`ALTER TABLE ${node.arguments[1].text} ADD COLUMN _probe_ TEXT`, `ensureColumns in ${trail}`);
  }
}
function walk(node, sourceFile, trail) {
  if (isFunctionLike(node)) return;
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (declaration.initializer && ts.isCallExpression(declaration.initializer)) {
        let target = null;
        try {
          target = declaration.initializer.expression.getText(sourceFile);
        } catch { /* synthetic node; nothing resolvable */ }
        const callback = declaration.initializer.arguments[0];
        if (target === "db.transaction" && callback &&
          (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && ts.isIdentifier(declaration.name)) {
          stash.set(declaration.name.text, { body: callback.body, sourceFile });
          return;
        }
      }
    }
  }
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
    const name = node.expression.expression.text;
    if (stash.has(name)) {
      const stashed = stash.get(name);
      walk(stashed.body, stashed.sourceFile, `${trail} > ${name}()`);
      return;
    }
    // ensureColumns is a leaf with dedicated handling in handleCall below —
    // expanding it would walk its dynamic SQL (unresolvable templates) and
    // silently skip the very ALTER this test must check.
    if (name === "ensureColumns") {
      handleCall(node.expression, sourceFile, trail);
      return;
    }
    const first = node.expression.arguments[0];
    if (first && ts.isIdentifier(first) && first.text === "db") {
      expandHelper(name, trail);
      return;
    }
  }
  if (ts.isCallExpression(node)) handleCall(node, sourceFile, trail);
  ts.forEachChild(node, (child) => walk(child, sourceFile, trail));
}
const serverUnit = unitFor("server.ts");
let pluginBody = null;
ts.forEachChild(serverUnit, (node) => {
  if (pluginBody || !ts.isFunctionDeclaration(node) || !node.body) return;
  let hasMigrate = false;
  const find = (inner) => {
    if (ts.isCallExpression(inner)) {
      try {
        if (inner.expression.getText(serverUnit).endsWith(".migrate")) hasMigrate = true;
      } catch { /* synthetic node; nothing resolvable */ }
    }
    ts.forEachChild(inner, find);
  };
  find(node.body);
  if (hasMigrate) pluginBody = node.body;
});
assert.ok(pluginBody, "the plugin boot function holds the migration block");
walk(pluginBody, serverUnit, "server.ts");

// Sync safety: a truncated GitHub tree must refuse the whole sync instead
// of pruning valid local skills as "retired".
const syncLib = readFileSync(new URL("lib/workflow-skills-sync.mjs", root), "utf8");
assert.match(syncLib, /if \(data\.truncated\) throw/, "truncated upstream tree refuses the sync");

// Engine floors must stay satisfiable: the marketplace entry resolves only
// compatible tags, and managed installs validate these ranges.
assert.match(manifest.engines.bb, />=\d+\.\d+/, "bb engine floor is declared");
assert.match(manifest.engines.bbPluginSdk, />=\d+\.\d+/, "SDK engine floor is declared");

// Legacy-compat ledger: docs/legacy-compat.md tracks every backward-
// compatibility branch for the v1 cleanup. Each entry pins literal code
// anchors; a migration removed without a ledger update fails here. Removal
// itself is allowed only behind a v1 schema gate, never silently.
const ledger = readFileSync(new URL("docs/legacy-compat.md", root), "utf8");
const ledgerBlocks = ledger.split(/^## /m).filter((part) => /^L-\d+\b/.test(part));
assert.ok(ledgerBlocks.length > 0, "the ledger holds compat entries");
for (const block of ledgerBlocks) {
  const id = block.match(/^L-\d+/)[0];
  const file = block.match(/^- file: `([^`]+)`/m)?.[1];
  assert.ok(file, `${id} names its file`);
  const anchors = [...block.matchAll(/^- anchor: `([^`]+)`/gm)].map((match) => match[1]);
  assert.ok(anchors.length > 0, `${id} pins at least one code anchor`);
  const code = readFileSync(new URL(file, root), "utf8");
  for (const anchor of anchors) {
    assert.ok(
      code.includes(anchor),
      `legacy-compat ${id} anchor missing — if the migration was removed, update docs/legacy-compat.md (removal allowed only behind a v1 schema gate)`,
    );
  }
}

console.log("fresh install test ok: entries, first-boot reads, packaging, and migrations");
