// What the budget gate may and may not call inherited, exercised against the
// real checker on a throwaway repository. The four cases that matter are a debt
// that really is inherited, a debt that really moved, a debt that grew, and a
// debt that only *looks* like an ancestor — the last two are the ones a
// similarity score used to wave through.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = mkdtempSync(join(tmpdir(), "stelow-source-budgets-"));
symlinkSync(join(repositoryRoot, "node_modules"), join(fixtureRoot, "node_modules"), "dir");
const ledger = join(fixtureRoot, "scripts", "source-debt.json");

function git(...command) {
  const result = spawnSync("git", command, { cwd: fixtureRoot, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${command.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function statements(count, prefix) {
  return Array.from(
    { length: count },
    (_, index) => `  const ${prefix}${index} = ${prefix}Step(${index});`,
  ).join("\n");
}

function functionSource(name, count, prefix) {
  return `export function ${name}(input) {\n${statements(count, prefix)}\n  return input;\n}\n`;
}

function write(relative, source) {
  writeFileSync(join(fixtureRoot, relative), source);
}

function writeLedger(entries) {
  writeFileSync(ledger, `${JSON.stringify({ files: {}, functions: entries }, null, 2)}\n`);
}

function budget() {
  const result = spawnSync(process.execPath, ["scripts/check-source-budgets.mjs"], {
    cwd: fixtureRoot,
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function expectClean(name, expected) {
  const { status, output } = budget();
  assert.equal(status, 0, `${name} must stay green:\n${output}`);
  for (const line of expected) assert.ok(output.includes(line), `${name} must report ${line}:\n${output}`);
}

function expectOverBudget(name, expected) {
  const { status, output } = budget();
  assert.equal(status, 1, `${name} must be reported as over budget:\n${output}`);
  for (const line of expected) assert.ok(output.includes(line), `${name} must report ${line}:\n${output}`);
}

function restore(...files) {
  git("checkout", "--", ...files);
}

try {
  git("init", "--initial-branch=master");
  git("config", "user.email", "source-budgets@example.invalid");
  git("config", "user.name", "Source Budgets Test");
  mkdirSync(join(fixtureRoot, "lib"), { recursive: true });
  mkdirSync(join(fixtureRoot, "scripts"), { recursive: true });
  write("README.md", "fixture\n");
  write("lib/legacy.mjs", `${functionSource("alphaHandler", 52, "alpha")}${functionSource("relocatableHandler", 52, "relocate")}`);
  write("lib/oversized-source.mjs", "export const value = 1;\n".repeat(401));
  git("add", "README.md", "lib");
  git("commit", "-m", "base");
  git("update-ref", "refs/remotes/origin/master", "master");
  git("switch", "-c", "feature");
  for (const script of ["check-source-budgets.mjs", "budget-lineage.mjs"]) {
    copyFileSync(join(repositoryRoot, "scripts", script), join(fixtureRoot, "scripts", script));
  }
  writeLedger({});

  // 1. Debt the base tree already carried, edited but not grown, is inherited.
  write("lib/legacy.mjs", readFileSync(join(fixtureRoot, "lib/legacy.mjs"), "utf8")
    .replace("alphaStep", "alphaCompute"));
  expectClean("same-file inherited debt", [
    "inherited lib/legacy.mjs:alphaHandler#1: 55 lines (baseline 55)",
  ]);
  restore("lib/legacy.mjs");

  // 2. The same debt one line longer is this branch's own, however old it is.
  write("lib/legacy.mjs", readFileSync(join(fixtureRoot, "lib/legacy.mjs"), "utf8")
    .replace("  const alpha51 = alphaStep(51);", "  const alpha51 = alphaStep(51);\n  const extra = alphaStep(52);"));
  expectOverBudget("grown inherited debt", ["over budget lib/legacy.mjs:alphaHandler#1: 56 lines"]);
  restore("lib/legacy.mjs");

  // 3. A rewrite is the same symbol in the same place, so it is only debt if it
  // grew. Same length, different body: still inherited.
  write("lib/legacy.mjs", functionSource("alphaHandler", 52, "alpha")
    .concat(functionSource("relocatableHandler", 52, "relocate"))
    .replaceAll("alphaStep", "alphaRewrite"));
  expectClean("rewritten debt of the same size", [
    "inherited lib/legacy.mjs:alphaHandler#1: 55 lines (baseline 55)",
  ]);
  restore("lib/legacy.mjs");

  // 4. A new function that happens to reuse a name from the base tree, in a
  // different file, with a different body, has no ancestor. The name match
  // alone used to waive it.
  write("lib/collide.mjs", functionSource("alphaHandler", 52, "collect"));
  expectOverBudget("name collision with no lineage", [
    "over budget lib/collide.mjs:alphaHandler#1: 55 lines",
  ]);
  rmSync(join(fixtureRoot, "lib/collide.mjs"));

  // 5. A new function whose body is a verbatim copy of a base-tree function is
  // still a new symbol: the copy is caught as new debt, and jscpd reports the
  // duplication itself. Sharing a vocabulary is not descent.
  write("lib/lookalike.mjs", functionSource("lookalikeHandler", 52, "alpha"));
  expectOverBudget("copied body under a new name", [
    "over budget lib/lookalike.mjs:lookalikeHandler#1: 55 lines",
  ]);
  rmSync(join(fixtureRoot, "lib/lookalike.mjs"));

  // 6. Debt that moved to another file keeps its name and its body, so the run
  // of identical tokens is the proof. The file it left is under budget, so only
  // the function can carry the debt across, and the report has to say where it
  // came from rather than quoting a line count.
  write("lib/moved.mjs", functionSource("relocatableHandler", 52, "relocate"));
  expectClean("relocated debt", [
    "inherited lib/moved.mjs:relocatableHandler#1: 55 lines (relocated from lib/legacy.mjs: 55)",
  ]);
  rmSync(join(fixtureRoot, "lib/moved.mjs"));

  // 7. Debt with no ancestor anywhere is recorded, and the record is a ceiling
  // rather than a licence.
  writeLedger({ "lib/recorded.mjs:recordedHandler": 55 });
  write("lib/recorded.mjs", functionSource("recordedHandler", 52, "record"));
  expectClean("recorded debt", [
    "inherited lib/recorded.mjs:recordedHandler#1: 55 lines (recorded 55)",
  ]);
  write("lib/recorded.mjs", functionSource("recordedHandler", 53, "record"));
  expectOverBudget("recorded debt that grew", [
    "over budget lib/recorded.mjs:recordedHandler#1: 56 lines (recorded 55)",
  ]);
  rmSync(join(fixtureRoot, "lib/recorded.mjs"));
  writeLedger({});

  // 8. Files follow the same rule: a moved oversized file is inherited, a new
  // oversized file written in the same shape is not.
  copyFileSync(join(fixtureRoot, "lib/oversized-source.mjs"), join(fixtureRoot, "lib/oversized-copy.mjs"));
  expectClean("relocated oversized file", [
    "inherited lib/oversized-copy.mjs: 401 lines (relocated from lib/oversized-source.mjs)",
  ]);
  rmSync(join(fixtureRoot, "lib/oversized-copy.mjs"));
  write("lib/oversized-lookalike.mjs", "export const other = 2;\n".repeat(401));
  expectOverBudget("oversized file with no ancestor", [
    "over budget lib/oversized-lookalike.mjs: 401 lines",
  ]);
  rmSync(join(fixtureRoot, "lib/oversized-lookalike.mjs"));

  // 9. A committed move, not an untracked one: the same relocation has to be
  // inherited when the new file is on the branch rather than in the worktree.
  write("lib/moved.mjs", functionSource("relocatableHandler", 52, "relocate"));
  git("add", "lib/moved.mjs");
  git("commit", "-m", "move the handler");
  expectClean("committed relocation", [
    "inherited lib/moved.mjs:relocatableHandler#1: 55 lines (relocated from lib/legacy.mjs: 55)",
  ]);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("source budgets ok: inherited debt needs an ancestor, a record, or nothing at all");
