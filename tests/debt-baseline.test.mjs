// Debt baseline: the recorded size of every oversized owned file and function,
// plus the exact inherited set the budget gate reports. Every number here is a
// ratchet — a change may lower it, never raise it, and lowering one is a
// deliberate edit rather than a side effect. The gate that produces the
// inherited set is diff-scoped, so the whole-tree census below is the only
// place the debt it cannot see is recorded.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ownedRoots = ["server/", "components/", "hooks/", "lib/", "scripts/", "tests/"];
const ownedEntrypoints = ["server.ts", "app.tsx"];
const extensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const maxFileLines = 400;
const maxFunctionLines = 50;

const fileBaseline = new Map([
  ["components/ui/dialog.tsx", 541],
  ["components/ui/icon.tsx", 450],
  ["lib/artifact-contracts.mjs", 428],
  ["server/github-issues.ts", 942],
  ["tests/kanban-layout.test.mjs", 401],
]);

// The debt this branch is working through, in the two named areas (GitHub
// automation and the decision API) plus the rest of the tree the diff-scoped
// gate never sees. Keys are the census identifiers, so a refactor that renames
// one of these fails here and has to be recorded deliberately.
const functionBaseline = new Map([
  // Github
  ["server/github-issues.ts:createGithubAutomation", 701],
  ["server/github-issues.ts:createGithubAutomation/postGithubCompletion", 59],
  ["server/github-issues.ts:createGithubAutomation/listGithubCandidates", 58],
  ["server/github-issues.ts:createGithubAutomation/runSingleAutomationRule", 53],
  ["server/github-issues.ts:runGithubMigrations", 64],
  ["components/github/github-dialog-state.ts:useGithubDialogState", 229],
  // DecisionApi
  ["server/decision-api.ts:createDecisionApi", 319],
  ["server/decision-api.ts:createDecisionApi/setDecisionPoint", 84],
  ["server/decision-api-seams.ts:createDecisionApiSeams", 271],
  ["server/decision-api-seams.ts:createDecisionApiSeams/vetAutoContinue", 55],
  // Elsewhere in the tree
  ["lib/preview-runtime.mjs:createPreviewRuntime", 264],
  ["lib/preview-runtime.mjs:createPreviewRuntime/start", 77],
  ["lib/trackable-evidence.mjs:evidenceConditions", 74],
  ["server/execution-reconcile.ts:createExecutionReconcile", 261],
  ["server/execution-native.ts:createExecutionNative", 249],
  ["server/execution-native.ts:createExecutionNative/prepareStart", 69],
  ["server/execution-lifecycle.ts:createExecutionLifecycle", 223],
  ["server/execution-lifecycle.ts:createExecutionLifecycle/resumeAfterAnswers", 53],
  ["server/execution-advance.ts:createExecutionAdvance", 203],
  ["server/runtime/workflow-seeding.ts:seedWorkflow", 72],
  ["server/runtime/cli/cli-review-subject.ts:deliverableSubject", 69],
  ["server/runtime/cli/cli-bundle-writer.ts:writeBundle", 68],
  ["server/runtime/cli/cli-split.ts:reportSplit", 61],
  ["components/creation/create-build-dialog.tsx:useCreateBuildSubmit", 65],
  ["components/github/github-done-draft-dialog.tsx:GithubDoneDraftDialog", 89],
  ["components/github/github-completion-dialog.tsx:GithubCompletionDialog", 60],
  ["components/panels/inbox-panel.tsx:InboxPanel", 119],
  ["components/settings/preset-manager-shell.tsx:PresetManagerDialog", 223],
  ["components/ui/dialog.tsx:callback#5", 76],
  ["components/ui/dialog.tsx:Dialog", 62],
  ["app.tsx:callback", 56],
  ["tests/server-cards.test.mjs:callback#4", 82],
]);

const functionCountBaseline = 56;

const inheritedBaseline = [
  "components/creation/create-build-dialog.tsx:useCreateBuildSubmit#1: 65 lines (baseline 65)",
  "lib/trackable-evidence.mjs:evidenceConditions#1: 74 lines (baseline 74)",
  "server/github-issues.ts: 942 lines (baseline 942)",
  "server/github-issues.ts:runGithubMigrations#1: 64 lines (baseline 64)",
  "server/github-issues.ts:createGithubAutomation#1: 701 lines (baseline 709)",
  "server/github-issues.ts:createGithubAutomation/runSingleAutomationRule#1: 53 lines (baseline 53)",
  "server/github-issues.ts:createGithubAutomation/listGithubCandidates#1: 58 lines (baseline 58)",
  "server/github-issues.ts:createGithubAutomation/postGithubCompletion#1: 59 lines (baseline 59)",
  "server/runtime/cli/cli-bundle-writer.ts:writeBundle#1: 68 lines (baseline 104)",
  "server/runtime/cli/cli-review-subject.ts:deliverableSubject#1: 69 lines (baseline 66)",
  "server/runtime/cli/cli-split.ts:reportSplit#1: 61 lines (baseline 59)",
  "server/runtime/workflow-seeding.ts:seedWorkflow#1: 72 lines (baseline 74)",
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

function isFunction(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}

function functionLabel(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.getText();
  if (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) {
    return node.parent.name.getText();
  }
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
      found.push({
        key: `${file}:${path.join("/")}${ordinal > 1 ? `#${ordinal}` : ""}`,
        lines: end - start + 1,
      });
    }
    ts.forEachChild(node, (child) => visit(child, path));
  }
  visit(tree, []);
  return found.filter((entry) => entry.lines > maxFunctionLines);
}

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

assert.ok(
  oversized.length <= functionCountBaseline,
  `oversized functions grew to ${oversized.length}, past the recorded baseline of ${functionCountBaseline}`,
);

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

console.log(
  `debt baseline ok: ${observedFiles.length} oversized file(s) and ${oversized.length} oversized function(s), `
  + `${inheritedBaseline.length} inherited entries`,
);
