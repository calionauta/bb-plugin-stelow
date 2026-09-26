// Debt baseline: the recorded size of every oversized owned file and function,
// plus the exact inherited set the budget gate reports. Every ceiling lives in
// scripts/source-debt.json, which the gate reads too, so a record is one edited
// fact rather than two that can drift apart. A ceiling may be lowered, never
// raised, and lowering one is a deliberate edit rather than a side effect. The
// gate that produces the inherited set is diff-scoped, so the whole-tree census
// below is the only place the debt it cannot see is recorded.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { censusKey } from "../scripts/budget-lineage.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ownedRoots = ["server/", "components/", "hooks/", "lib/", "scripts/", "tests/"];
const ownedEntrypoints = ["server.ts", "app.tsx"];
const extensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const maxFileLines = 400;
const maxFunctionLines = 50;

// The debt this branch is working through: the two named areas (GitHub
// automation, the decision API) plus the rest of the tree the diff-scoped gate
// never sees. The ledger is the whole census — a rename, a deletion, or growth
// in any recorded symbol fails below and has to be recorded deliberately.
const ledger = JSON.parse(readFileSync(join(repositoryRoot, "scripts/source-debt.json"), "utf8"));
const fileBaseline = new Map(Object.entries(ledger.files));
const functionBaseline = new Map(Object.entries(ledger.functions));

// What the gate reports today, verbatim, in the order the gate prints. Each
// entry has to name why it is inherited — a baseline it still has, a proven
// move, or a record in the ledger — so a waiver can be checked by reading the
// line. The "baseline" wording is the gate's own for anything the ledger
// records, however new the code is.
const inheritedBaseline = [
  "components/creation/create-build-dialog.tsx:useCreateBuildSubmit#1: 65 lines (baseline 65)",
  "components/settings/plugin-update-status.tsx:PluginUpdateStatus#1: 54 lines (baseline 54)",
  "components/settings/preset-onboarding.tsx:PresetOnboardingDialog#1: 53 lines (baseline 53)",
  "components/settings/workflow-dependency-card.tsx:WorkflowDependencyCard#1: 67 lines (baseline 67)",
  "lib/card-claims.mjs:acquireScopeClaims#1: 68 lines (baseline 68)",
  "lib/execution-route.mjs:evaluateScopeBatchPilot#1: 78 lines (baseline 78)",
  "lib/scope-batch-cancel.mjs:cancelBatch#1: 76 lines (baseline 76)",
  "lib/scope-batch-cleanup.mjs:finishScope#1: 51 lines (baseline 51)",
  "lib/scope-map.mjs:validateScopeMap#1: 54 lines (baseline 54)",
  "lib/scope-merge.mjs:mergeScopesAtomically#1: 71 lines (baseline 71)",
  "lib/scope-retry.mjs:claimScopeRetry#1: 61 lines (baseline 61)",
  "lib/trackable-evidence.mjs:evidenceConditions#1: 74 lines (baseline 74)",
  "server/bb-workflow-bridge.ts:renderInlineWorkflowScript#1: 54 lines (baseline 57)",
  "server/runtime/cli/cli-bundle-writer.ts:writeBundle#1: 68 lines (recorded 68)",
  "server/runtime/cli/cli-review-subject.ts:deliverableSubject#1: 69 lines (recorded 69)",
  "server/runtime/cli/cli-split.ts:reportSplit#1: 61 lines (recorded 61)",
  "server/runtime/workflow-seeding.ts:seedWorkflow#1: 72 lines (relocated from server.ts: 74)",
  "server/scopes.ts:runScopeCommand#1: 87 lines (baseline 87)",
  "tests/server-cards.test.mjs:callback#4: 82 lines (baseline 84)",
];

function git(...command) {
  const result = spawnSync("git", command, { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${command.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function isOwnedSource(file) {
  return extensions.has(extname(file)) && (
    ownedEntrypoints.includes(file) || ownedRoots.some((root) => file.startsWith(root))
  );
}

function ownedSourceFiles() {
  return git("ls-files", "server", "components", "hooks", "lib", "scripts", "tests", ...ownedEntrypoints)
    .split("\n")
    .filter((file) => isOwnedSource(file));
}

function sourceLines(source) {
  return source.split(/\r?\n/).length - (source.endsWith("\n") ? 1 : 0);
}

// These two must stay the same width as the budget checker's own copies in
// scripts/check-source-budgets.mjs: the census is the only gate that sees an
// untouched file, so a node kind it fails to count is a debt nothing reports.
// `syntheticNodeKinds` below is the control for that width.
function isFunction(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node);
}

function functionLabel(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.getText();
  if (node.name && ts.isIdentifier(node.name)) return node.name.getText();
  if (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) {
    return node.parent.name.getText();
  }
  if (ts.isExportAssignment(node.parent)) return "default";
  if (ts.isCallExpression(node.parent)) return "callback";
  return "anonymous";
}

// The census mirrors the budget checker's own traversal, but runs over every
// owned file instead of the changed ones. Ordinals disambiguate repeated
// labels so a second `callback` cannot silently inherit the first one's entry.
function oversizedFunctions(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found = [];
  const seen = new Map();
  function visit(node, parentPath) {
    let path = parentPath;
    if (isFunction(node)) {
      const label = functionLabel(node);
      const stem = [...parentPath, label].join("/");
      const ordinal = (seen.get(stem) ?? 0) + 1;
      seen.set(stem, ordinal);
      path = [...parentPath, label];
      const start = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
      const end = tree.getLineAndCharacterOfPosition(node.end - 1).line + 1;
      found.push({ key: censusKey({ file, path, ordinal }), lines: end - start + 1 });
    }
    ts.forEachChild(node, (child) => visit(child, path));
  }
  visit(tree, []);
  return found.filter((entry) => entry.lines > maxFunctionLines);
}

function padded(count, expression) {
  return Array.from({ length: count }, (_, index) => `    ${expression}${index} = ${index};`).join("\n");
}

// The owned tree happens to hold no oversized constructor, accessor, or default
// export today, so a census that quietly dropped those node kinds would still
// report 56 and look correct. This synthetic source is the only thing that
// fails when it does: every member below is over the function budget and each
// one needs a node kind of its own to be counted.
function syntheticNodeKinds() {
  const source = [
    "export default (input) => {", padded(60, "const line"), "  return input;", "};",
    "class Synthetic {",
    "  constructor(value) {", padded(60, "this.step"), "    this.value = value;", "  }",
    "  get large() {", padded(60, "const read"), "    return this.value;", "  }",
    "  set large(value) {", padded(60, "const write"), "    this.value = value;", "  }",
    "  small() {", padded(4, "const tiny"), "    return this.value;", "  }",
    "}",
  ].join("\n");
  return oversizedFunctions("synthetic.ts", source).map((entry) => entry.key.replace("synthetic.ts:", ""));
}

assert.deepEqual(
  syntheticNodeKinds(),
  ["default", "anonymous", "large", "large#2"],
  "the census must count the same node kinds as scripts/check-source-budgets.mjs",
);

const files = ownedSourceFiles();
const sources = new Map(files.map((file) => [file, readFileSync(join(repositoryRoot, file), "utf8")]));
const oversized = files.flatMap((file) => oversizedFunctions(file, sources.get(file)));

const observedFiles = [...sources.entries()]
  .map(([file, source]) => [file, sourceLines(source)])
  .filter(([, lines]) => lines > maxFileLines)
  .sort(([left], [right]) => left.localeCompare(right));

assert.deepEqual(
  observedFiles.map(([file]) => file),
  [...fileBaseline.keys()].sort(),
  "a new owned file crossed the 400-line budget; add it to the baseline only after splitting it",
);
for (const [file, lines] of observedFiles) {
  assert.ok(
    lines <= fileBaseline.get(file),
    `${file} grew to ${lines} lines, past its recorded baseline of ${fileBaseline.get(file)}`,
  );
}

const observedKeys = new Map(oversized.map((entry) => [entry.key, entry.lines]));

// Every oversized function has to be recorded, which is what makes the count
// redundant: an unrecorded one is new debt, and a recorded one that stopped
// being oversized is caught by the loop below.
assert.deepEqual(
  [...observedKeys.keys()].filter((key) => !functionBaseline.has(key)),
  [],
  "an oversized function is not recorded in scripts/source-debt.json; record it only after splitting it",
);

function assertRecordedOverBudget(entries, budget, kind) {
  for (const [key, ceiling] of entries) {
    assert.ok(
      Number.isInteger(ceiling) && ceiling > budget,
      `${kind} ${key} is recorded at ${ceiling}, which is not over the ${budget}-line budget`,
    );
  }
}

assertRecordedOverBudget(fileBaseline, maxFileLines, "file");
assertRecordedOverBudget(functionBaseline, maxFunctionLines, "function");

for (const [key, lines] of functionBaseline) {
  const current = observedKeys.get(key);
  assert.notEqual(current, undefined, `${key} is no longer oversized; drop it from the baseline`);
  assert.ok(
    current <= lines,
    `${key} grew to ${current} lines, past its recorded baseline of ${lines}`,
  );
}

const budget = spawnSync(process.execPath, ["scripts/check-source-budgets.mjs"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (budget.status === 0) {
  const reported = budget.stdout.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("inherited "))
    .map((line) => line.slice("inherited ".length));
  assert.deepEqual(
    reported,
    inheritedBaseline,
    "the inherited debt set changed; a split or a new violation must be recorded here",
  );
} else {
  assert.fail(`the budget gate must stay runnable for this baseline: ${budget.stderr || budget.stdout}`);
}

// The census above cannot see line length, and the shape gate only ran in CI
// (`quality:shape`), so a single over-long line reached a green local `npm test`
// and only failed the merge. Running it here makes a phase unable to end with
// the shape gate red. It shares this script's diff-scoped base, so a file that
// is not a changed line is still never reported.
const shape = spawnSync(process.execPath, ["scripts/check-source-shape.mjs"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (shape.status === 0) {
  const line = shape.stdout.trim();
  assert.match(
    line,
    /no changed line over 160 characters$/,
    `the shape gate reported an unexpected success line: ${line}`,
  );
} else {
  assert.fail(
    `the shape gate must stay green: ${shape.stderr.trim() || shape.stdout.trim()}`,
  );
}

console.log(
  `debt baseline ok: ${observedFiles.length} oversized file(s) and ${oversized.length} oversized function(s), `
  + `${inheritedBaseline.length} inherited entries, shape gate green`,
);
