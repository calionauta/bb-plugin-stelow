import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAgentsBudget, measureAgentsFile } from "../scripts/check-agents-budget.mjs";

/**
 * The AGENTS.md size ratchet.
 *
 * The validator caps the file at 150 lines; this repo is still far above
 * it, so the rule here is weaker and load-bearing in a different way:
 * the file must never grow. Each extraction lowers the stamped ceiling in
 * `scripts/agents-budget.json`; a commit that grows the file fails here
 * and in the pre-commit hook, and the fix is to extract, not to raise.
 *
 * Every case below is executed, including the negative controls: a
 * ceiling one unit below the measured value must fail, or the live test
 * below would pass on a budget nobody enforces.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentsText = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
const budget = JSON.parse(
  readFileSync(join(repoRoot, "scripts", "agents-budget.json"), "utf8"),
)["AGENTS.md"];

test("an over-budget file fails naming the dimension", () => {
  const over = checkAgentsBudget("word ".repeat(10), { maxLines: 1, maxWords: 5 });
  assert.deepEqual(over.violations, ["words: 10 > max 5"]);
  const tall = checkAgentsBudget("a\nb\nc\n", { maxLines: 2, maxWords: 100 });
  assert.deepEqual(tall.violations, ["lines: 3 > max 2"]);
  assert.deepEqual(
    checkAgentsBudget("a\nb\n", { maxLines: 1, maxWords: 1 }).violations,
    ["lines: 2 > max 1", "words: 2 > max 1"],
    "both dimensions are reported, not just the first",
  );
});

test("an at-budget file passes, and trailing newline is not a line", () => {
  assert.deepEqual(checkAgentsBudget("a\nb\n", { maxLines: 2, maxWords: 2 }).violations, []);
  assert.equal(measureAgentsFile("a\nb").lines, 2, "a missing trailing newline is not a free line either");
  assert.equal(measureAgentsFile("").words, 0, "blank input measures zero, not one");
});

test("the live AGENTS.md passes its stamped budget", () => {
  const result = checkAgentsBudget(agentsText, budget);
  assert.deepEqual(result.violations, [], "the checkout meets the stamped ceiling");
});

test("a ceiling one unit below the live file fails", () => {
  const measured = measureAgentsFile(agentsText);
  assert.ok(
    checkAgentsBudget(agentsText, { maxLines: measured.lines - 1, maxWords: measured.words }).violations.length > 0,
    "a lowered line ceiling catches the live file",
  );
  assert.ok(
    checkAgentsBudget(agentsText, { maxLines: measured.lines, maxWords: measured.words - 1 }).violations.length > 0,
    "and so does a lowered word ceiling",
  );
});

test("the stamped budget equals the live measurement", () => {
  const measured = measureAgentsFile(agentsText);
  assert.deepEqual(
    { maxLines: budget.maxLines, maxWords: budget.maxWords },
    { maxLines: measured.lines, maxWords: measured.words },
    "a shrink without a ceiling update fails here; lower both together",
  );
});

test("the CLI exits 0 on pass and 1 naming both violations on failure", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "agents-budget-"));
  try {
    mkdirSync(join(tmpRoot, "scripts"), { recursive: true });
    copyFileSync(
      join(repoRoot, "scripts", "check-agents-budget.mjs"),
      join(tmpRoot, "scripts", "check-agents-budget.mjs"),
    );
    writeFileSync(join(tmpRoot, "AGENTS.md"), "a\nb\n");
    writeFileSync(
      join(tmpRoot, "scripts", "agents-budget.json"),
      JSON.stringify({ "AGENTS.md": { maxLines: 2, maxWords: 2 } }),
    );

    const pass = spawnSync(process.execPath, [join(tmpRoot, "scripts", "check-agents-budget.mjs")], {
      encoding: "utf8",
    });
    assert.equal(pass.status, 0, `pass run exits 0, stderr was: ${pass.stderr}`);
    assert.match(pass.stdout, /budget ok: 2 lines, 2 words/);

    writeFileSync(
      join(tmpRoot, "scripts", "agents-budget.json"),
      JSON.stringify({ "AGENTS.md": { maxLines: 1, maxWords: 1 } }),
    );
    const fail = spawnSync(process.execPath, [join(tmpRoot, "scripts", "check-agents-budget.mjs")], {
      encoding: "utf8",
    });
    assert.equal(fail.status, 1, "over-budget run exits 1 so the hook blocks the commit");
    assert.match(fail.stderr, /lines: 2 > max 1/);
    assert.match(fail.stderr, /words: 2 > max 1/);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
