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
import { readdirSync, readFileSync } from "node:fs";
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

/** name -> { kind, arity|null } for values the module exports. */
export function exportedValues(sourceFile) {
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
        const fn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : null;
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
  // `export { a, b as c }` and `export { a } from "./x"`: the name is exported,
  // its shape may or may not be known locally. Never guess the arity.
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      const exported = element.name.text;
      const localName = element.propertyName?.text ?? exported;
      const known = statement.moduleSpecifier ? null : local.get(localName);
      out.set(exported, known ?? { kind: "unknown", arity: null });
    }
  }
  return out;
}

/** Drift between one `.mjs` and its `.d.mts`. */
export function auditPair(implText, declText, file) {
  const impl = exportedValues(parse(`${file}.mjs`, implText));
  const decl = exportedValues(parse(`${file}.d.mts`, declText));
  const findings = [];
  for (const [name, meta] of impl) {
    const declared = decl.get(name);
    if (!declared) {
      findings.push({ file, name, kind: "ORPHAN-EXPORT", detail: `${meta.kind} exported, not declared` });
      continue;
    }
    if (meta.kind === "function" && declared.kind === "function") {
      if (meta.arity !== declared.arity) {
        findings.push({ file, name, kind: "ARITY", detail: `implementation ${meta.arity}, declaration ${declared.arity}` });
      }
    } else if (meta.kind !== declared.kind && declared.kind !== "unknown") {
      findings.push({ file, name, kind: "UNCHECKED", detail: `${meta.kind} implemented, ${declared.kind} declared` });
    }
  }
  for (const [name, meta] of decl) {
    const implemented = impl.get(name);
    if (!implemented) findings.push({ file, name, kind: "ORPHAN-DECL", detail: `${meta.kind} declared, not exported` });
  }
  return findings;
}

/** Every `lib/*.mjs` with a sibling `.d.mts`. */
export function auditTree(dir) {
  const findings = [];
  let pairs = 0;
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".mjs"))) {
    const declPath = join(dir, name.replace(/\.mjs$/, ".d.mts"));
    let declText;
    try {
      declText = readFileSync(declPath, "utf8");
    } catch {
      continue;
    }
    pairs += 1;
    findings.push(...auditPair(readFileSync(join(dir, name), "utf8"), declText, `lib/${name}`));
  }
  return { pairs, findings };
}

export function summarize(findings) {
  const counts = {};
  for (const finding of findings) counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
  return counts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
