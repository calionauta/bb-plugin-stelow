/**
 * A hand-written `.d.mts` is a claim about what the sibling `.mjs` exports, and
 * nothing checked the claim.
 *
 * Found while deleting `isScopeTrackingMissing`: the function went, its
 * declaration stayed. `lib/card-checks.d.mts` still advertised a rule that no
 * longer existed, and no gate failed — `tsc` reads the `.d.mts` for types and
 * never opens the `.mjs` to compare, so a declaration file can describe a module
 * that has drifted away from it without a single complaint.
 *
 * That is the shape of a lie that costs nothing to maintain and something to
 * find: the next caller imports a rule the panel no longer uses, the type checks,
 * and the behaviour is gone. There are 190 declaration files and 718 declared
 * names here, so "remember to delete the declaration too" is not a practice, it
 * is a hope.
 *
 * The check is deliberately narrow: a declared name must be bound in the sibling
 * module, and a name that arrives by import must also leave by export. Both
 * halves are claims a `.d.mts` makes, and both are checkable without running the
 * module.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libDir = join(root, "lib");

/** Names a module declares as its own: functions, classes, bindings. */
function locallyBound(source) {
  const names = new Set();
  for (const match of source.matchAll(
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1]);
  }
  return names;
}

/** Names a module pulls in from elsewhere: `import { A, B } from "…"`. */
function importedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const name of aliasSides(match[1])) names.add(name);
  }
  return names;
}

/**
 * Both sides of every name in an import/export list. `export { a as b }` puts
 * `b` on the module's surface and keeps `a` local, so a declaration may name
 * either; `export { a as b } from "…"` puts only `b` out, but recording both is
 * the conservative read and cannot invent a pass.
 */
function aliasSides(list) {
  const names = [];
  for (const part of list.split(",")) {
    const sides = part.trim().split(/\s+as\s+/).map((side) => side.trim()).filter(Boolean);
    for (const side of sides) names.push(side);
  }
  return names;
}

/** Names a module hands on: `export { A }`, `export { a as b } from "…"`. */
function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s*(?:const\s+)?\{([^}]*)\}/g)) {
    for (const name of aliasSides(match[1])) names.add(name);
  }
  for (const match of source.matchAll(
    /(?:^|\n)\s*export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1]);
  }
  return names;
}

const declarations = readdirSync(libDir).filter((name) => name.endsWith(".d.mts"));
assert.ok(declarations.length > 100, `expected the declaration corpus, found ${declarations.length} files`);

const lies = [];
for (const file of declarations) {
  const sibling = file.replace(/\.d\.mts$/, ".mjs");
  // A declaration with no module beside it is the same lie one level up: it
  // describes a file that does not exist. Reading it should not be how that is
  // discovered.
  assert.ok(
    existsSync(join(libDir, sibling)),
    `${file} declares types for ${sibling}, which does not exist`,
  );
  const declared = readFileSync(join(libDir, file), "utf8");
  const source = readFileSync(join(libDir, sibling), "utf8");
  const local = locallyBound(source);
  const imported = importedNames(source);
  const exported = exportedNames(source);

  for (const match of declared.matchAll(/export declare (?:function|const) (\w+)/g)) {
    const name = match[1];
    // Three honest ways for a declaration to be true: the module defines the
    // name, the module hands it on (`export {…}` / `export {…} from`), or the
    // module defines and exports it in one statement. Anything else is a
    // declaration describing something the module does not have.
    if (local.has(name) || exported.has(name)) continue;
    if (imported.has(name)) {
      lies.push(`${file} declares ${name}, which ${sibling} imports but does not re-export`);
      continue;
    }
    lies.push(`${file} declares ${name}, which ${sibling} does not define or export`);
  }
}

// The whole point: a declaration left behind by a deleted function is a lie
// about a module that no longer has it, and it must fail rather than ship.
assert.deepEqual(lies, [], `declaration files describe modules that drifted:\n  ${lies.join("\n  ")}`);

console.log(`declaration surface test ok: ${declarations.length} files, no orphan declaration`);
