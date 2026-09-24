import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = mkdtempSync(join(tmpdir(), "stelow-source-shape-"));
symlinkSync(join(repositoryRoot, "node_modules"), join(fixtureRoot, "node_modules"), "dir");
let comparisonBase;

function git(...command) {
  const result = spawnSync("git", command, {
    cwd: fixtureRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `git ${command.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function runChecker() {
  return spawnSync(process.execPath, [join(fixtureRoot, "scripts/check-source-shape.mjs")], {
    cwd: fixtureRoot,
    encoding: "utf8",
    env: { ...process.env, SOURCE_SHAPE_BASE: comparisonBase },
  });
}

function runBudgetChecker() {
  return spawnSync(process.execPath, [join(fixtureRoot, "scripts/check-source-budgets.mjs")], {
    cwd: fixtureRoot,
    encoding: "utf8",
  });
}

try {
  git("init", "--initial-branch=master");
  git("config", "user.email", "source-shape@example.invalid");
  git("config", "user.name", "Source Shape Test");
  writeFileSync(join(fixtureRoot, "README.md"), "fixture\n");
  mkdirSync(join(fixtureRoot, "lib"));
  writeFileSync(
    join(fixtureRoot, "lib", "copy-source.mjs"),
    `export const copied = "${"z".repeat(170)}";\n`,
  );
  writeFileSync(
    join(fixtureRoot, "lib", "budget-copy-source.mjs"),
    "export const value = 1;\n".repeat(401),
  );
  git("add", "README.md", "lib/copy-source.mjs", "lib/budget-copy-source.mjs");
  git("commit", "-m", "base");
  const baseCommit = git("rev-parse", "HEAD");
  comparisonBase = baseCommit;

  git("switch", "-c", "feature");
  const debtFunction = `export function inherited() {\n${"  void 0;\n".repeat(49)}}\n`;
  const debtFile = `${debtFunction}${"// inherited debt\n".repeat(350)}`;
  const masterDebtFile = `${debtFile}// master debt\n`;
  writeFileSync(join(fixtureRoot, "lib/debt.mjs"), debtFile);
  git("add", "lib/debt.mjs");
  git("commit", "-m", "add inherited debt");

  git("switch", "master");
  writeFileSync(join(fixtureRoot, "lib/legacy.mjs"), `export const legacy = "${"x".repeat(170)}";\n`);
  writeFileSync(join(fixtureRoot, "lib/upstream.mjs"), `export const upstream = "${"u".repeat(170)}";\n`);
  writeFileSync(join(fixtureRoot, "lib/debt.mjs"), masterDebtFile);
  git("add", "lib/legacy.mjs", "lib/upstream.mjs", "lib/debt.mjs");
  git("commit", "-m", "advance origin master");
  git("update-ref", "refs/remotes/origin/master", "master");
  comparisonBase = git("rev-parse", "master");
  git("switch", "feature");

  mkdirSync(join(fixtureRoot, "scripts"));
  copyFileSync(
    join(repositoryRoot, "scripts/check-source-shape.mjs"),
    join(fixtureRoot, "scripts/check-source-shape.mjs"),
  );
  copyFileSync(
    join(repositoryRoot, "scripts/check-source-budgets.mjs"),
    join(fixtureRoot, "scripts/check-source-budgets.mjs"),
  );
  git("add", "scripts/check-source-shape.mjs", "scripts/check-source-budgets.mjs");
  git("commit", "-m", "activate source shape gate");

  const clean = runChecker();
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, new RegExp(`from ${comparisonBase}`));
  assert.doesNotMatch(clean.stdout, /inherited legacy/);
  assert.match(clean.stdout, /no changed line over 160 characters/);
  const cleanBudget = runBudgetChecker();
  assert.equal(cleanBudget.status, 0, cleanBudget.stderr);
  assert.match(cleanBudget.stdout, /inherited lib\/debt.mjs: 401 lines/);
  assert.match(cleanBudget.stdout, /inherited lib\/debt.mjs:\/inherited#1: 51 lines/);

  copyFileSync(
    join(fixtureRoot, "lib/copy-source.mjs"),
    join(fixtureRoot, "lib/copied-long-source.mjs"),
  );
  copyFileSync(
    join(fixtureRoot, "lib/budget-copy-source.mjs"),
    join(fixtureRoot, "lib/copied-budget-debt.mjs"),
  );
  const copiedShapeDebt = runChecker();
  assert.equal(copiedShapeDebt.status, 1, copiedShapeDebt.stdout);
  assert.match(copiedShapeDebt.stderr, /copied-long-source\.mjs:1: \d+ characters/);
  const copiedBudgetDebt = runBudgetChecker();
  assert.equal(copiedBudgetDebt.status, 1, copiedBudgetDebt.stdout);
  assert.match(copiedBudgetDebt.stderr, /over budget lib\/copied-budget-debt\.mjs: 401 lines/);
  rmSync(join(fixtureRoot, "lib/copied-long-source.mjs"));
  rmSync(join(fixtureRoot, "lib/copied-budget-debt.mjs"));

  writeFileSync(join(fixtureRoot, "lib/debt.mjs"), debtFile.replace("  void 0;\n", "  void 0;\n  void 1;\n"));
  const grownDebt = runBudgetChecker();
  assert.equal(grownDebt.status, 1, grownDebt.stdout);
  assert.doesNotMatch(grownDebt.stderr, /over budget lib\/debt.mjs: 402 lines/);
  assert.match(grownDebt.stderr, /over budget lib\/debt.mjs:\/inherited#1: 52 lines/);
  git("checkout", "--", "lib/debt.mjs");

  writeFileSync(join(fixtureRoot, "lib/new-large.mjs"), "export const value = 1;\n".repeat(401));
  const newLarge = runBudgetChecker();
  assert.equal(newLarge.status, 1, newLarge.stdout);
  assert.match(newLarge.stderr, /over budget lib\/new-large.mjs: 401 lines/);

  writeFileSync(join(fixtureRoot, "lib/legacy.mjs"), `  export const legacy = "${"x".repeat(170)}";\n`);
  const rewrittenDebt = runChecker();
  assert.equal(rewrittenDebt.status, 1, rewrittenDebt.stdout);
  assert.match(rewrittenDebt.stderr, /lib\/legacy\.mjs:1: \d+ characters/);
  rmSync(join(fixtureRoot, "lib/legacy.mjs"));

  writeFileSync(join(fixtureRoot, "scripts/new-workflow.js"), `const fresh = "${"y".repeat(171)}";\n`);
  const dirty = runChecker();
  assert.equal(dirty.status, 1, dirty.stdout);
  assert.match(dirty.stderr, /scripts\/new-workflow\.js:1: \d+ characters/);

  git("add", "scripts/new-workflow.js");
  git("commit", "-m", "add a newly minified workflow");
  const cleanCiFailure = runChecker();
  assert.equal(cleanCiFailure.status, 1, cleanCiFailure.stdout);
  assert.match(cleanCiFailure.stderr, /changed lines over 160 characters/);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("source shape test ok: merge-base debt is reported and new minification fails");
