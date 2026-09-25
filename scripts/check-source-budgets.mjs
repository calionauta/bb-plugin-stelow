#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import ts from "typescript";

const roots = ["server/", "components/", "hooks/", "lib/", "scripts/", "tests/"];
const entrypoints = new Set(["server.ts", "app.tsx"]);
const extensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const maxFileLines = 400;
const maxFunctionLines = 50;
const relocationSimilarity = 0.4;
const functionSimilarityFloor = 0.15;
const args = process.argv.slice(2);
let trackedSourceFiles;

function git(...command) {
  return execFileSync("git", command, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function optionValue(name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a git ref`);
  return value;
}

function assertKnownArguments() {
  const known = new Set(["--base"]);
  for (const argument of args) {
    if (argument.startsWith("--") && !known.has(argument)) {
      throw new Error(`unknown source-budget option: ${argument}`);
    }
  }
}

function isOwnedSource(file) {
  return extensions.has(extname(file)) && (entrypoints.has(file) || roots.some((root) => file.startsWith(root)));
}

function sourceLines(source) {
  return source.split(/\r?\n/).length - (source.endsWith("\n") ? 1 : 0);
}

function sourceAt(ref, file) {
  try {
    return git("show", `${ref}:${file}`);
  } catch {
    return null;
  }
}

function comparisonBases() {
  const requested = optionValue("--base") || process.env.SOURCE_SHAPE_BASE || "origin/master";
  git("rev-parse", "--verify", `${requested}^{commit}`);
  const target = git("rev-parse", requested).trim();
  if (target === "HEAD") {
    const parent = git("rev-parse", "HEAD^").trim();
    return { diff: parent, debt: parent, branchBase: parent };
  }
  const mergeBase = git("merge-base", target, "HEAD").trim();
  return { diff: mergeBase, debt: target, branchBase: mergeBase };
}

function trackedFiles() {
  trackedSourceFiles ??= new Set(git("ls-files").trim().split("\n"));
  return trackedSourceFiles;
}

function untrackedFiles() {
  return git("status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .map((line) => line.slice(3))
    .filter((file) => file && !file.includes(" -> "));
}

function changedFiles(base) {
  const tracked = git("diff", "--name-only", "--diff-filter=ACMRT", base, "--").trim().split("\n");
  return [...new Set([...tracked, ...untrackedFiles()].filter(Boolean))].filter(isOwnedSource);
}

function baselineFiles(ref) {
  return git("ls-tree", "-r", "--name-only", ref)
    .split("\n")
    .filter(Boolean)
    .filter(isOwnedSource);
}

function functionLabel(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.getText();
  if (node.name && ts.isIdentifier(node.name)) return node.name.getText();
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) return parent.name.getText();
  if (ts.isExportAssignment(parent)) return "default";
  if (ts.isCallExpression(parent)) return "callback";
  return "anonymous";
}

function isFunction(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}

function functionRecords(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const records = [];
  const occurrences = new Map();
  function visit(node, parentPath = []) {
    let path = parentPath;
    if (isFunction(node)) {
      const label = functionLabel(node);
      const stem = [...parentPath, label].join("/");
      const ordinal = (occurrences.get(stem) ?? 0) + 1;
      occurrences.set(stem, ordinal);
      path = [...parentPath, label];
      const start = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line;
      const end = tree.getLineAndCharacterOfPosition(node.end - 1).line;
      records.push({ file, label, ordinal, path, lines: end - start + 1, text: node.getText(tree) });
    }
    ts.forEachChild(node, (child) => visit(child, path));
  }
  visit(tree);
  return records;
}

function lexicalFeatures(text) {
  const tokens = text.match(/[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`|\S/g) ?? [];
  const unigrams = new Map();
  const significant = [];
  for (const token of tokens) {
    if (token === "\\") continue;
    significant.push(token);
    unigrams.set(token, (unigrams.get(token) ?? 0) + 1);
  }
  const bigrams = new Map();
  for (let index = 1; index < significant.length; index += 1) {
    const token = `${significant[index - 1]}__${significant[index]}`;
    bigrams.set(token, (bigrams.get(token) ?? 0) + 1);
  }
  return { unigrams, bigrams };
}

function multisetScore(left, right, includeBigrams) {
  let overlap = 0;
  let total = 0;
  for (const [token, count] of left) {
    total += count;
    if (includeBigrams) overlap += Math.min(count, right.get(token) ?? 0);
  }
  for (const count of right.values()) total += count;
  return total === 0 ? 1 : (2 * overlap) / total;
}

function featureCount(text) {
  return [...lexicalFeatures(text).unigrams.values()]
    .reduce((total, count) => total + count, 0);
}

function functionSimilarity(current, baseline) {
  const currentFeatures = lexicalFeatures(current.text);
  const baselineFeatures = lexicalFeatures(baseline.text);
  return (
    multisetScore(currentFeatures.unigrams, baselineFeatures.unigrams, false) * 0.25
    + multisetScore(currentFeatures.bigrams, baselineFeatures.bigrams, true) * 0.75
  );
}

function pathAffinity(current, baseline) {
  let shared = 0;
  const length = Math.min(current.path.length, baseline.path.length);
  for (let index = 0; index < length; index += 1) {
    if (current.path[index] !== baseline.path[index]) break;
    shared += 1;
  }
  return shared / Math.max(current.path.length, baseline.path.length);
}

function bestFunction(current, baseline) {
  let best = null;
  const candidates = baseline.filter((record) => record.label === current.label);
  if (candidates.length === 0) {
    for (const record of baseline) {
      const similarity = functionSimilarity(current, record);
      if (!best || similarity > best.similarity) best = { record, similarity, score: similarity };
    }
  }
  for (const candidate of candidates) {
    const similarity = functionSimilarity(current, candidate);
    const score = pathAffinity(current, candidate) * 0.35 + similarity * 0.65;
    if (!best || score > best.score) best = { record: candidate, similarity, score };
  }
  return best;
}

function sourceSimilarity(source, baseline) {
  const current = lexicalFeatures(source);
  const previous = lexicalFeatures(baseline);
  return (
    multisetScore(current.unigrams, previous.unigrams, false) * 0.25
    + multisetScore(current.bigrams, previous.bigrams, true) * 0.75
  );
}

function bestSource(file, source, baselineSources) {
  let best = null;
  for (const [baseFile, baseSource] of baselineSources) {
    if (baseFile === file) continue;
    const similarity = sourceSimilarity(source, baseSource);
    if (!best || similarity > best.similarity) best = { file: baseFile, similarity, lines: sourceLines(baseSource) };

  }
  return best;
}

function fileFinding(file, source, baselineSources) {
  const lines = sourceLines(source);
  if (lines <= maxFileLines) return null;
  const previous = baselineSources.get(file);
  if (previous !== null && previous !== undefined) {
    const oldLines = sourceLines(previous);
    const message = `${file}: ${lines} lines (baseline ${oldLines})`;
    return { message, inherited: oldLines > maxFileLines && lines <= oldLines };
  }
  const match = bestSource(file, source, baselineSources);
  const inherited = match && match.similarity >= relocationSimilarity && match.lines > maxFileLines;
  return {
    message: `${file}: ${lines} lines (${inherited ? `relocated from ${match.file}` : "no file baseline"})`,
    inherited,
    baselineFile: match?.file,
  };
}

function functionFinding(record, baselineFunctions) {
  if (record.lines <= maxFunctionLines) return null;
  const match = bestFunction(record, baselineFunctions);
  if (!match) return violationFinding(record, 0);
  const sameLogicalPath = pathAffinity(record, match.record) === 1;
  const noLineGrowth = record.lines <= match.record.lines;
  const noFeatureGrowth = featureCount(record.text) <= featureCount(match.record.text);
  const inherited = match.record.lines > maxFunctionLines && (
    sameLogicalPath && noLineGrowth
    || match.similarity >= functionSimilarityFloor && (noLineGrowth || noFeatureGrowth)
    || sameLogicalPath && noFeatureGrowth
  );
  return {
    message: `${record.file}:${record.path.join("/")}#${record.ordinal}: `
      + `${record.lines} lines (baseline ${inherited ? match.record.lines : 0})`,
    inherited,
  };
}

function violationFinding(record, baseline) {
  const message = `${record.file}:${record.path.join("/")}#${record.ordinal}: `
    + `${record.lines} lines (baseline ${baseline})`;
  return { message, inherited: false };
}

function reportFinding(finding, inherited, violations) {
  if (!finding) return;
  (finding.inherited ? inherited : violations).push(finding.message);
}

function main() {
  assertKnownArguments();
  const bases = comparisonBases();
  const files = changedFiles(bases.diff);
  const sources = new Map();
  for (const file of files) sources.set(file, readFileSync(file, "utf8"));
  const baselineSources = new Map(
    baselineFiles(bases.debt).map((file) => [file, sourceAt(bases.debt, file)]),
  );
  const baselineFunctions = [];
  for (const [file, source] of baselineSources) {
    if (source !== null) baselineFunctions.push(...functionRecords(file, source));
  }
  const inherited = [];
  const violations = [];
  for (const [file, source] of sources) {
    const fileResult = fileFinding(file, source, baselineSources);
    reportFinding(fileResult, inherited, violations);
    const branchSource = fileResult?.baselineFile
      ? sourceAt(bases.branchBase, fileResult.baselineFile)
      : null;
    const functions = branchSource === null
      ? baselineFunctions
      : [...baselineFunctions, ...functionRecords(fileResult.baselineFile, branchSource)];
    for (const record of functionRecords(file, source)) {
      reportFinding(functionFinding(record, functions), inherited, violations);
    }
  }
  console.log(
    `source budgets: ${files.length} changed owned files from ${bases.diff}; `
    + `debt baseline ${bases.debt}`,
  );
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
