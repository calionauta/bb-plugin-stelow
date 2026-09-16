import assert from "node:assert/strict";
import { detectedTestCommand, sameGitEvidence, verificationReadiness } from "../lib/audit-verification.mjs";

assert.deepEqual(detectedTestCommand(["package.json", "pnpm-lock.yaml"], { scripts: { test: "vitest run" } }), { command: "pnpm", args: ["test"], display: "pnpm test" });
assert.deepEqual(detectedTestCommand(["go.mod"]), { command: "go", args: ["test", "./..."], display: "go test ./..." });
assert.equal(detectedTestCommand(["README.md"]), null);
const evidence = { gitRoot: "/repo", headSha: "a".repeat(40) };
assert.equal(sameGitEvidence(evidence, { ...evidence }), true, "independent samples of the same checkout agree");
assert.equal(sameGitEvidence(evidence, { ...evidence, headSha: "b".repeat(40) }), false, "a moved checkout cannot agree");
assert.equal(verificationReadiness({ exit_code: 0, git_root: "/repo", head_sha: "a".repeat(40) }, evidence).ready, true);
assert.match(verificationReadiness({ exit_code: 0, git_root: "/repo", head_sha: "b".repeat(40) }, evidence).error, /different checkout or HEAD/);
assert.match(verificationReadiness(null, evidence).error, /verify --tests/);
console.log("audit verification test ok: completion accepts only a host-recorded test run at the audited HEAD");
