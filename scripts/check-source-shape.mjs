#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const sourceExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const maxLineLength = 160;
const args = process.argv.slice(2);
let trackedSourceFiles;

function git(...command) {
  return execFileSync("git", command, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
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
      throw new Error(`unknown source-shape option: ${argument}`);
    }
  }
}

function explicitFiles() {
  const baseIndex = args.indexOf("--base");
  return args.filter((argument, index) => {
    const isBaseOption = baseIndex >= 0 && (index === baseIndex || index === baseIndex + 1);
    return !isBaseOption && !argument.startsWith("--");
  });
}

function resolveComparisonBase() {
  return optionValue("--base") || process.env.SOURCE_SHAPE_BASE || "origin/master";
}

function assertCommit(ref, label) {
  try {
    git("rev-parse", "--verify", `${ref}^{commit}`);
  } catch {
    throw new Error(`${label} is not an available commit: ${ref}`);
  }
}

function isSource(file) {
  return sourceExtensions.has(extname(file));
}

function changedFiles(base) {
  const tracked = git("diff", "--name-only", "--diff-filter=ACMRT", base, "--").trim().split("\n");
  const untracked = git("status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .map((line) => line.slice(3))
    .filter((file) => file && !file.includes(" -> "));
  return [...new Set([...tracked, ...untracked])].filter(Boolean).filter(isSource);
}

function trackedFiles() {
  trackedSourceFiles ??= new Set(git("ls-files").trim().split("\n"));
  return trackedSourceFiles;
}

function readAddedLines(file, base) {
  if (!trackedFiles().has(file)) {
    return readFileSync(file, "utf8").split(/\r?\n/).map((line, index) => [index + 1, line]);
  }
  const patch = git("diff", "--unified=0", "--no-color", base, "--", file);
  const result = [];
  let lineNumber = 0;
  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      lineNumber = Number(hunk[1]);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      result.push([lineNumber, line.slice(1)]);
      lineNumber += 1;
    } else if (!line.startsWith("-") && !line.startsWith("\\")) {
      lineNumber += 1;
    }
  }
  return result;
}

function inspectFile(file, base) {
  const violations = [];
  for (const [lineNumber, line] of readAddedLines(file, base)) {
    if (line.length > maxLineLength) {
      violations.push(`${file}:${lineNumber}: ${line.length} characters`);
    }
  }
  return violations;
}

function main() {
  assertKnownArguments();
  const base = resolveComparisonBase();
  assertCommit(base, "comparison base");
  const requestedFiles = explicitFiles();
  const candidates = requestedFiles.length > 0 ? requestedFiles.filter(isSource) : changedFiles(base);
  const violations = candidates.flatMap((file) => inspectFile(file, base));
  report(candidates.length, base, violations);
}

function report(fileCount, base, violations) {
  if (violations.length > 0) {
    console.error(`Source shape failed against ${base}: changed lines over ${maxLineLength} characters:`);
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `source shape ok: ${fileCount} source file(s) from ${base}, `
    + `no changed line over ${maxLineLength} characters`,
  );
}

try {
  main();
} catch (error) {
  console.error(`Source shape could not run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
