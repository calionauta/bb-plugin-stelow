#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const sourceExtensions = new Set([".ts", ".tsx", ".mjs"]);
const maxLineLength = 160;
const args = process.argv.slice(2);
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1] : "HEAD";
const explicitFiles = args.filter((arg, index) =>
  (baseIndex < 0 || (index !== baseIndex && index !== baseIndex + 1)) && !arg.startsWith("--"),
);

function git(...command) {
  return execFileSync("git", command, { encoding: "utf8" });
}

function isSource(file) {
  return sourceExtensions.has(extname(file));
}

function changedFiles() {
  const tracked = git("diff", "--name-only", "--diff-filter=ACMRT", base).trim().split("\n").filter(Boolean);
  const untracked = git("status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .map((line) => line.slice(3))
    .filter((file) => file && !file.includes(" -> "));
  return [...new Set([...tracked, ...untracked])].filter(isSource);
}

function addedLines(file) {
  if (!trackedFiles().has(file)) {
    return readFileSync(file, "utf8").split("\n").map((line, index) => [index + 1, line]);
  }
  const patch = git("diff", "--unified=0", "--no-color", base, "--", file);
  const result = [];
  let lineNumber = 0;
  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      lineNumber = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      result.push([lineNumber, line.slice(1)]);
      lineNumber += 1;
    } else if (!line.startsWith("-") && !line.startsWith("\\")) {
      lineNumber += 1;
    }
  }
  return result;
}

function trackedFiles() {
  return new Set(git("ls-files").split("\n"));
}

const files = explicitFiles.length > 0 ? explicitFiles.filter(isSource) : changedFiles();
const violations = [];
for (const file of files) {
  for (const [lineNumber, line] of addedLines(file)) {
    if (line.length > maxLineLength) {
      violations.push(`${file}:${lineNumber}: ${line.length} characters`);
    }
  }
}

if (violations.length > 0) {
  console.error(`Source shape failed: changed lines over ${maxLineLength} characters:`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`source shape ok: ${files.length} changed source file(s), no added line over ${maxLineLength} characters`);
}
