import assert from "node:assert/strict";
import { requiredOutputPaths, safeArtifactPath, validateExecutionArtifacts } from "../lib/execution-artifacts.mjs";

const recipe = { id: "plan-critique", tasks: [{ output: "critiques/report.md" }, { output: "critiques/report.json" }] };
assert.equal(safeArtifactPath("critiques/report.md"), true);
assert.equal(safeArtifactPath("../escape"), false);
assert.deepEqual(requiredOutputPaths(recipe), ["critiques/report.md", "critiques/report.json"]);
// The fan-out gate resolves ONE rule: an explicit exploration count wins
// (hybrid whenever count >= 2), and the legacy appetite is the fallback for
// a context that does not carry a count. This layer used to read the
// appetite only, which made it disagree with the route layer and the native
// renderer about the same task — three copies of one vocabulary, and this
// one was the odd one out.
const fanoutTask = { output: "fanout.json", when: "appetite_supports_fanout" };
assert.deepEqual(
  requiredOutputPaths({ tasks: [{ output: "always.json" }, fanoutTask] }, { appetite: "Lean", explorationCount: 1 }),
  ["always.json"],
  "a count of 1 does not support fan-out, so the task's output is not required",
);
assert.deepEqual(
  requiredOutputPaths({ tasks: [{ output: "always.json" }, fanoutTask] }, { appetite: "Lean", explorationCount: 3 }),
  ["always.json", "fanout.json"],
  "a count of 3 supports fan-out, so the task's output is required",
);
// `issues` names the FIELDS that failed, not just the file: "malformed:
// contrast.json" costs a run and tells the worker nothing actionable.
assert.deepEqual(
  validateExecutionArtifacts({ recipe, contents: { "critiques/report.md": "report" } }),
  {
    ok: false,
    missing: ["critiques/report.json"],
    malformed: [],
    issues: ["critiques/report.json is missing or empty"],
    paths: ["critiques/report.md", "critiques/report.json"],
  },
);
const badJson = validateExecutionArtifacts({
  recipe,
  contents: { "critiques/report.md": "report", "critiques/report.json": "{ not json" },
});
assert.equal(badJson.ok, false, "unparseable JSON still fails");
assert.match(badJson.issues[0], /^critiques\/report\.json is not valid JSON: /, "the issue says WHY, naming the file and the parse error");
assert.equal(validateExecutionArtifacts({ recipe, contents: { "critiques/report.md": "report", "critiques/report.json": JSON.stringify({ findings: [], questions: [], verdict: "pass" }) } }).ok, true);
assert.equal(validateExecutionArtifacts({ recipe, contents: { "critiques/report.md": "report", "critiques/report.json": "not-json" } }).malformed[0], "critiques/report.json");
console.log("execution artifact contract test ok: path confinement, required outputs, JSON validation");
