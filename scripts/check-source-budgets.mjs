#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { censusKey, pathAffinity, provesMove, tokenList } from "./budget-lineage.mjs";

const roots = ["server/", "components/", "hooks/", "lib/", "scripts/", "tests/"];
const entrypoints = new Set(["server.ts", "app.tsx"]);
const extensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const maxFileLines = 400;
const maxFunctionLines = 50;
const debtLedger = fileURLToPath(new URL("source-debt.json", import.meta.url));
const args = process.argv.slice(2);
const tokenCache = new Map();

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

// Two bases, both on the requested ref: the merge base scopes which files the
// gate reads at all, the ref tip is the only tree debt is compared against. The
// fork's own line is deliberately not a third base — a 199-commit-stale copy of
// a file is not evidence about the branch's present debt.
function comparisonBases() {
  const requested = optionValue("--base") || process.env.SOURCE_SHAPE_BASE || "origin/master";
  git("rev-parse", "--verify", `${requested}^{commit}`);
  const target = git("rev-parse", requested).trim();
  if (target === "HEAD") {
    const parent = git("rev-parse", "HEAD^").trim();
    return { diff: parent, debt: parent };
  }
  return { diff: git("merge-base", target, "HEAD").trim(), debt: target };
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

// Recorded debt is the one waiver that needs no ancestor: the key and its
// ceiling are in the ledger, where a reviewer sees them in the diff. Fail fast
// when it is missing, because a silently absent ledger would report every
// recorded symbol as a fresh violation.
function readDebtLedger() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(debtLedger, "utf8"));
  } catch (error) {
    throw new Error(`debt ledger is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { files: parsed.files ?? {}, functions: parsed.functions ?? {} };
}

function indexBaseline(records) {
  const byFile = new Map();
  const byLabel = new Map();
  for (const record of records) {
    if (!byFile.has(record.file)) byFile.set(record.file, []);
    byFile.get(record.file).push(record);
    if (!byLabel.has(record.label)) byLabel.set(record.label, []);
    byLabel.get(record.label).push(record);
  }
  return { byFile, byLabel };
}

// Token lists are cached by their text: the same baseline function is compared
// against many candidates, and a moved file is compared against every baseline
// file in the tree.
function tokensOf(text) {
  if (!tokenCache.has(text)) tokenCache.set(text, tokenList(text));
  return tokenCache.get(text);
}

// Candidates are the same file and the same name, and nothing else: those are
// the only two ways a function can be recognised before its content is read.
function lineageCandidates(record, index) {
  const candidates = new Map();
  for (const candidate of index.byFile.get(record.file) ?? []) candidates.set(candidate, true);
  for (const candidate of index.byLabel.get(record.label) ?? []) candidates.set(candidate, true);
  return [...candidates.keys()];
}

function lineageKind(record, candidate) {
  if (record.file === candidate.file) return "same-file";
  return provesMove(tokensOf(record.text), tokensOf(candidate.text)) ? "relocated" : null;
}

function outranks(score, candidate, incumbent) {
  if (score !== incumbent.score) return score > incumbent.score;
  if (candidate.lines !== incumbent.record.lines) return candidate.lines > incumbent.record.lines;
  return candidate.file < incumbent.record.file;
}

// The proven ancestor, preferring identity in the same file over a proven move,
// then the longest shared path, then the largest baseline. Similarity plays no
// part: two candidates that are not proven are not candidates at all.
function bestLineage(record, index) {
  let best = null;
  for (const candidate of lineageCandidates(record, index)) {
    const kind = lineageKind(record, candidate);
    if (kind === null) continue;
    const score = (kind === "same-file" ? 2 : 0) + pathAffinity(record.path, candidate.path);
    if (best === null || outranks(score, candidate, best)) best = { kind, record: candidate, score };
  }
  return best;
}

function findingMessage(label, lines, detail) {
  return `${label}: ${lines} lines (${detail})`;
}

function functionFinding(record, index, ledger) {
  if (record.lines <= maxFunctionLines) return null;
  const label = `${record.file}:${record.path.join("/")}#${record.ordinal}`;
  // Proven lineage first: it says where the debt came from. The ledger is the
  // floor under it, for branch debt whose ancestor this gate cannot see.
  const match = bestLineage(record, index);
  if (match !== null && match.record.lines > maxFunctionLines && record.lines <= match.record.lines) {
    const detail = match.kind === "relocated"
      ? `relocated from ${match.record.file}: ${match.record.lines}`
      : `baseline ${match.record.lines}`;
    return { message: findingMessage(label, record.lines, detail), inherited: true };
  }
  const recorded = ledger.functions[censusKey(record)];
  if (recorded !== undefined) {
    return { message: findingMessage(label, record.lines, `recorded ${recorded}`), inherited: record.lines <= recorded };
  }
  return { message: findingMessage(label, record.lines, "no function baseline"), inherited: false };
}

function fileFinding(file, source, baselineSources, ledger) {
  const lines = sourceLines(source);
  if (lines <= maxFileLines) return null;
  const recorded = ledger.files[file];
  if (recorded !== undefined) {
    return { message: findingMessage(file, lines, `recorded ${recorded}`), inherited: lines <= recorded };
  }
  const previous = baselineSources.get(file);
  if (previous !== null && previous !== undefined) {
    const oldLines = sourceLines(previous);
    return {
      message: findingMessage(file, lines, `baseline ${oldLines}`),
      inherited: oldLines > maxFileLines && lines <= oldLines,
    };
  }
  const moved = relocatedSource(file, source, baselineSources);
  if (moved === null) return { message: findingMessage(file, lines, "no file baseline"), inherited: false };
  return { message: findingMessage(file, lines, `relocated from ${moved.file}`), inherited: lines <= moved.lines };
}

// A file that moved is proven the same way a function is: by a long shared run
// of tokens, and only ever from a baseline file that was itself over budget.
function relocatedSource(file, source, baselineSources) {
  let best = null;
  for (const [baseFile, baseSource] of baselineSources) {
    if (baseFile === file || baseSource === null) continue;
    const lines = sourceLines(baseSource);
    if (lines <= maxFileLines) continue;
    if (best !== null && lines <= best.lines) continue;
    if (!provesMove(tokensOf(source), tokensOf(baseSource))) continue;
    best = { file: baseFile, lines };
  }
  return best;
}

function reportFinding(finding, inherited, violations) {
  if (!finding) return;
  (finding.inherited ? inherited : violations).push(finding.message);
}

function baselineFunctions(baselineSources) {
  const records = [];
  for (const [file, source] of baselineSources) {
    if (source !== null) records.push(...functionRecords(file, source));
  }
  return records;
}

function main() {
  assertKnownArguments();
  const bases = comparisonBases();
  const ledger = readDebtLedger();
  const files = changedFiles(bases.diff);
  const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
  const baselineSources = new Map(
    baselineFiles(bases.debt).map((file) => [file, sourceAt(bases.debt, file)]),
  );
  const index = indexBaseline(baselineFunctions(baselineSources));
  const inherited = [];
  const violations = [];
  for (const [file, source] of sources) {
    reportFinding(fileFinding(file, source, baselineSources, ledger), inherited, violations);
    for (const record of functionRecords(file, source)) {
      reportFinding(functionFinding(record, index, ledger), inherited, violations);
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
