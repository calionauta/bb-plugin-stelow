#!/usr/bin/env node
/**
 * Measure drift between a hand-written `.d.mts` and the `.mjs` it describes.
 *
 * The surface test binds NAMES, of `export declare function|const` only. The spike
 * measured what that leaves outside (250 `export function`s, 118 types, 184
 * interfaces), and `tsc --listFiles` shows 0 `lib/*.mjs` in the program: the
 * implementation is never compiled, so the declaration IS the type surface and
 * only a name of it is tested. A declaration may also lie about a signature and
 * both gates stay green.
 *
 * Parsed with the TypeScript compiler, not regexes. A first attempt with regexes
 * reported 238 arity drifts; nearly all were artifacts of multi-line signatures
 * and `export { ... }` lists. A measurement that cannot be defended is worse than
 * no measurement, because someone will act on it.
 *
 * Kinds:
 *   ORPHAN-EXPORT  implemented and exported, absent from the declaration: a TS
 *                  caller cannot see it and nothing says so.
 *   ORPHAN-DECL    declared, not exported by the implementation.
 *   ARITY          both sides declare a function and the parameter counts differ.
 *   UNCHECKED      one side is a function but the shape is not comparable (barrel
 *                  re-export, computed export), so arity is not claimed either way.
 *
 * Usage: node scripts/audit-declarations.mjs [--json] [--dir <path>]
 */
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parse(fileName, text) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function hasExport(node) {
  return Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

/** The function type a `.d.mts` annotation spells, or null.
 *
 * `export const f: (a: A, b: B) => R` and `export const f: { (a: A): R }` are
 * both function declarations written as types. Returns the node whose
 * `parameters` is the declared signature, so arity can be compared against the
 * implementation instead of guessed from the kind name alone. */
function functionTypeOf(type) {
  if (!type) return null;
  if (ts.isFunctionTypeNode(type)) return type;
  if (ts.isTypeLiteralNode(type)) {
    const call = type.members.find((member) => ts.isCallSignatureDeclaration(member));
    return call ?? null;
  }
  return null;
}

/** name -> { kind, arity|null } for values the module exports. */
export function exportedValues(sourceFile, options = {}) {
  const dir = options.dir ?? null;
  const cache = options.cache ?? new Map();
  const out = new Map();
  const local = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const arity = node.parameters.length;
      local.set(node.name.text, { kind: "function", arity });
      if (hasExport(node)) out.set(node.name.text, { kind: "function", arity });
    }
    if (ts.isVariableStatement(node)) {
      const exported = hasExport(node);
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;
        const init = decl.initializer;
        // A `.d.mts` spells a function as `export const f: (a: A) => R`, so the
        // arrow lives in the type annotation, not in an initializer. Reading only
        // `initializer` classified every such declaration as an opaque `value`,
        // which both raised a false `UNCHECKED` and — worse — skipped the arity
        // comparison entirely: `TREE_URL` could be declared with three parameters
        // against a one-parameter implementation and every gate stayed green.
        const fn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
          ? init
          : functionTypeOf(decl.type);
        const meta = fn ? { kind: "function", arity: fn.parameters.length } : { kind: "value", arity: null };
        local.set(name, meta);
        if (exported) out.set(name, meta);
      }
    }
    if (ts.isClassDeclaration(node) && node.name) {
      local.set(node.name.text, { kind: "class", arity: null });
      if (hasExport(node)) out.set(node.name.text, { kind: "class", arity: null });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  applyReExports(sourceFile, { out, local, dir, cache });
  return out;
}

/** Fold every `export { a, b as c }[ from "./x"]` statement into `out`.
 *
 * A name re-exported from a module keeps the shape that module declares; a name
 * re-exported from the same file keeps whatever `local` already resolved. Only
 * a shape nobody could read stays `unknown` — overwriting a known one with
 * `unknown` silently disabled the arity check on every re-exported function. */
function applyReExports(sourceFile, { out, local, dir, cache }) {
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      const exported = element.name.text;
      const localName = element.propertyName?.text ?? exported;
      const known = statement.moduleSpecifier
        ? dir
          ? resolveReExport(statement, localName, dir, cache)
          : null
        : local.get(localName);
      out.set(exported, known ?? out.get(exported) ?? { kind: "unknown", arity: null });
    }
  }
}

/** The local-name shape a re-export pulls in, read from its target module.
 *
 * `export { a } from "./x.mjs"` is a real export whose shape lives in `x.mjs`.
 * Leaving it `unknown` is honest but unverified: it is why 22 re-exports in
 * `workflow-vocabulary.mjs` never had their kind compared to the declaration.
 * The target is resolved relative to the exporting module and parsed with the
 * same reader, so an arrow exported from `workflow-catalog.mjs` arrives as a
 * function with its real arity instead of "unknown".
 *
 * A target that cannot be read (missing file, a package specifier) stays
 * `unknown` — the audit must never invent a shape it did not see. */
function resolveReExport(statement, localName, dir, cache) {
  const specifier = statement.moduleSpecifier;
  if (!specifier || !ts.isStringLiteral(specifier)) return null;
  const raw = specifier.text;
  if (!raw.startsWith(".")) return null;
  const targetPath = join(dir, raw);
  let target = cache.get(targetPath);
  if (target === undefined) {
    try {
      // `dir` and `cache` forward: a re-export chain (`a` -> `b` -> `c`) must
      // resolve to the module that actually declares the shape, and a diamond
      // must parse each target once rather than once per path.
      target = exportedValues(parse(targetPath, readFileSync(targetPath, "utf8")), { dir, cache });
    } catch {
      target = null;
    }
    cache.set(targetPath, target);
  }
  if (!target) return null;
  const found = target.get(localName);
  return found && found.kind !== "unknown" ? found : null;
}

/** `export * from "./x.mjs"` re-exports names this reader never enumerates.
 *
 * Both loops below walk the names they can see, so a star export contributed
 * nothing to either side: an implementation that re-exported a dozen functions
 * and a declaration that re-exported none compared equal, and the gate stayed
 * green. Reported as its own kind instead of silently passing, because the
 * shape genuinely is not resolvable here — a name is visible only by looking
 * at the target, and `tsc` (now covering `lib/`) is the thing that checks it.
 */
function starExports(sourceFile) {
  const found = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    if (statement.exportClause !== undefined) continue;
    if (!statement.moduleSpecifier) continue;
    found.push(statement.moduleSpecifier.text ?? "?");
  }
  return found;
}

/** Drift between one `.mjs` and its `.d.mts`. */
export function auditPair(implText, declText, file, options = {}) {
  const dir = options.dir ?? null;
  const cache = options.cache ?? new Map();
  const implSource = parse(`${file}.mjs`, implText);
  const declSource = parse(`${file}.d.mts`, declText);
  const impl = exportedValues(implSource, { dir, cache });
  const decl = exportedValues(declSource, { dir, cache });
  const findings = [];
  for (const target of starExports(implSource)) {
    findings.push({ file, name: target, kind: "STAR-EXPORT", detail: `export * re-exports ${target}, names not enumerated` });
  }
  for (const target of starExports(declSource)) {
    findings.push({ file, name: target, kind: "STAR-EXPORT", detail: `declaration re-exports ${target}, names not enumerated` });
  }
  for (const [name, meta] of impl) {
    const declared = decl.get(name);
    if (!declared) {
      findings.push({ file, name, kind: "ORPHAN-EXPORT", detail: `${meta.kind} exported, not declared` });
      continue;
    }
    // A shape read through a re-export is not `unknown` any more: the target
    // module was parsed, so the same arity and kind checks apply to it.
    if (meta.kind === "function" && declared.kind === "function") {
      if (meta.arity !== declared.arity) {
        findings.push({ file, name, kind: "ARITY", detail: `implementation ${meta.arity}, declaration ${declared.arity}` });
      }
    } else if (meta.kind !== declared.kind && declared.kind !== "unknown" && meta.kind !== "unknown") {
      findings.push({ file, name, kind: "UNCHECKED", detail: `${meta.kind} implemented, ${declared.kind} declared` });
    }
  }
  for (const [name, meta] of decl) {
    const implemented = impl.get(name);
    if (!implemented) findings.push({ file, name, kind: "ORPHAN-DECL", detail: `${meta.kind} declared, not exported` });
  }
  return findings;
}

/** Every `lib/*.mjs` with a sibling `.d.mts`.
 *
 * A module with no declaration is reported as `ORPHAN-MODULE` rather than
 * skipped: `checkJs` only reaches a `.mjs` through the `.mjs` file itself, so
 * this pass is the only gate that sees it. Skipping silently made 16 modules
 * (including `export-evidence.mjs`) invisible to both the orphan-export and the
 * arity check while the baseline read as if they were covered. */
export function auditTree(dir) {
  const findings = [];
  // One cache per tree: re-export targets are parsed once, not once per module.
  const cache = new Map();
  let pairs = 0;
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".mjs"))) {
    const declPath = join(dir, name.replace(/\.mjs$/, ".d.mts"));
    let declText;
    try {
      declText = readFileSync(declPath, "utf8");
    } catch {
      findings.push({ file: `lib/${name}`, name: null, kind: "ORPHAN-MODULE", detail: "no sibling .d.mts declaration" });
      continue;
    }
    pairs += 1;
    findings.push(...auditPair(readFileSync(join(dir, name), "utf8"), declText, `lib/${name}`, { dir, cache }));
  }
  return { pairs, findings };
}

export function summarize(findings) {
  const counts = {};
  for (const finding of findings) counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
  return counts;
}

// Same resolved-path entrypoint check as `check-agents-budget.mjs`: a symlinked
// temp dir (macOS `/var` -> `/private/var`) otherwise reads as "not the entry".
function isEntrypoint() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  const dirIndex = process.argv.indexOf("--dir");
  const dir = dirIndex > 0 ? process.argv[dirIndex + 1] : join(root, "lib");
  const { pairs, findings } = auditTree(dir);
  const counts = summarize(findings);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ pairs, counts, findings }, null, 1));
  } else {
    console.log(`declaration audit: ${pairs} pairs`);
    for (const kind of ["ORPHAN-EXPORT", "ORPHAN-DECL", "ARITY", "UNCHECKED"]) {
      if (counts[kind]) console.log(`  ${kind}: ${counts[kind]}`);
    }
    for (const f of findings.slice(0, 10)) console.log(`  ${f.kind} ${f.file} ${f.name}: ${f.detail}`);
  }
}
