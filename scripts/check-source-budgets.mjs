#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import ts from "typescript";

const roots = ["server/", "components/", "hooks/", "lib/", "scripts/", "tests/"];
const entrypoints = new Set(["server.ts", "app.tsx"]);
const extensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const baseline = JSON.parse(readFileSync("source-shape-budget-baseline.json", "utf8")).commit;
const maxFileLines = 400;
const maxFunctionLines = 50;

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function isOwnedSource(file) {
  return extensions.has(extname(file)) && (entrypoints.has(file) || roots.some((root) => file.startsWith(root)));
}

function sourceLines(source) {
  return source.split(/\r?\n/).length - (source.endsWith("\n") ? 1 : 0);
}

function functionLabel(node) {
  if (node.name) return node.name.getText();
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) return parent.name.getText();
  if (ts.isCallExpression(parent)) return "callback";
  return "anonymous";
}

function isFunction(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}

function functionSizes(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const sizes = new Map();
  const occurrences = new Map();
  function visit(node, parentKey = "") {
    let key = parentKey;
    if (isFunction(node)) {
      const label = functionLabel(node);
      const stem = `${parentKey}/${label}`;
      const ordinal = (occurrences.get(stem) ?? 0) + 1;
      occurrences.set(stem, ordinal);
      key = `${stem}#${ordinal}`;
      const start = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line;
      const end = tree.getLineAndCharacterOfPosition(node.end - 1).line;
      sizes.set(key, end - start + 1);
    }
    ts.forEachChild(node, (child) => visit(child, key));
  }
  visit(tree);
  return sizes;
}

function baselineSource(file) {
  try {
    return git("show", `${baseline}:${file}`);
  } catch {
    return null;
  }
}

function inspect(file, inherited, violations) {
  const source = readFileSync(file, "utf8");
  const previous = baselineSource(file);
  const currentLines = sourceLines(source);
  const oldLines = previous === null ? 0 : sourceLines(previous);
  if (currentLines > maxFileLines) {
    const message = `${file}: ${currentLines} lines (baseline ${oldLines})`;
    (oldLines > maxFileLines && currentLines <= oldLines ? inherited : violations).push(message);
  }
  const oldFunctions = previous === null ? new Map() : functionSizes(file, previous);
  for (const [key, lines] of functionSizes(file, source)) {
    if (lines <= maxFunctionLines) continue;
    const oldSize = oldFunctions.get(key) ?? 0;
    const message = `${file}:${key}: ${lines} lines (baseline ${oldSize})`;
    (oldSize > maxFunctionLines && lines <= oldSize ? inherited : violations).push(message);
  }
}

function main() {
  if (!/^[0-9a-f]{40,64}$/.test(baseline)) throw new Error("budget baseline must be a full commit SHA");
  git("merge-base", "--is-ancestor", baseline, "HEAD");
  const files = git("ls-files", "--cached", "--others", "--exclude-standard")
    .trim().split("\n").filter(isOwnedSource);
  const inherited = [];
  const violations = [];
  for (const file of files) inspect(file, inherited, violations);
  console.log(`source budgets: ${files.length} owned files; ${inherited.length} inherited oversize item(s)`);
  for (const item of inherited) console.log(`  inherited ${item}`);
  for (const item of violations) console.error(`  over budget ${item}`);
  if (violations.length > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`Source budgets could not run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
