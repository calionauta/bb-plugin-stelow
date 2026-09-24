import assert from "node:assert/strict";
import { requiredOutputPaths, safeArtifactPath, validateExecutionArtifacts } from "../lib/execution-artifacts.mjs";

const recipe = { id: "plan-critique", tasks: [{ output: "critiques/report.md" }, { output: "critiques/report.json" }] };
assert.equal(safeArtifactPath("critiques/report.md"), true);
assert.equal(safeArtifactPath("../escape"), false);
assert.deepEqual(requiredOutputPaths(recipe), ["critiques/report.md", "critiques/report.json"]);
assert.deepEqual(requiredOutputPaths({ tasks: [{ output: "always.json" }, { output: "fanout.json", when: "appetite_supports_fanout" }] }, { appetite: "Lean" }), ["always.json"]);
assert.deepEqual(validateExecutionArtifacts({ recipe, contents: { "critiques/report.md": "report" } }), { ok: false, missing: ["critiques/report.json"], malformed: [], paths: ["critiques/report.md", "critiques/report.json"] });
assert.equal(validateExecutionArtifacts({ recipe, contents: { "critiques/report.md": "report", "critiques/report.json": JSON.stringify({ findings: [], questions: [], verdict: "pass" }) } }).ok, true);
assert.equal(validateExecutionArtifacts({ recipe, contents: { "critiques/report.md": "report", "critiques/report.json": "not-json" } }).malformed[0], "critiques/report.json");
console.log("execution artifact contract test ok: path confinement, required outputs, JSON validation");
