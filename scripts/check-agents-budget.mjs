#!/usr/bin/env node
// AGENTS.md size ratchet: the file only shrinks from here.
//
// The validator caps the file at 150 lines and this repo is still far
// above it, so every edit must leave the file no larger than it found
// it. The stamped ceiling in `scripts/agents-budget.json` is the
// enforcement: lower it with each extraction, never raise it without a
// reason stated in the commit.
//
// Pure node:fs, no dependencies — fast enough for the pre-commit hook,
// which runs it next to lint and shape.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const budgetPath = join(repoRoot, "scripts", "agents-budget.json");
const agentsPath = join(repoRoot, "AGENTS.md");

export function measureAgentsFile(text) {
  const lines = text.split("\n");
  return {
    lines: text.endsWith("\n") ? lines.length - 1 : lines.length,
    words: text.split(/\s+/).filter(Boolean).length,
  };
}

export function checkAgentsBudget(text, budget) {
  const measured = measureAgentsFile(text);
  const violations = [];
  if (measured.lines > budget.maxLines) {
    violations.push(`lines: ${measured.lines} > max ${budget.maxLines}`);
  }
  if (measured.words > budget.maxWords) {
    violations.push(`words: ${measured.words} > max ${budget.maxWords}`);
  }
  return { ...measured, violations };
}

function main() {
  const budget = JSON.parse(readFileSync(budgetPath, "utf8"))["AGENTS.md"];
  const result = checkAgentsBudget(readFileSync(agentsPath, "utf8"), budget);
  if (result.violations.length > 0) {
    console.error(`AGENTS.md over budget:\n  ${result.violations.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`AGENTS.md budget ok: ${result.lines} lines, ${result.words} words`);
}

// `realpathSync` on both sides: macOS resolves `/var` to `/private/var`, so a
// tmpdir fixture invokes this file by a path that is correct but not equal to
// `import.meta.url`. Comparing them unresolved made the entrypoint silently not
// run — exit 0 with no output, which a test reads as a pass.
function isEntrypoint() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) main();
