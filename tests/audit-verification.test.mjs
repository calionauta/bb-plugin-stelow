import assert from "node:assert/strict";
import { detectedTestCommand, sameGitEvidence, verificationReadiness, verifyCommandEnv } from "../lib/audit-verification.mjs";

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

// The verification command must never inherit the host's environment.
//
// Measured: with NODE_ENV=production, react-dom resolves its production build and
// `React.act` does not exist, so every rendering band dies and a build card can
// never be marked done - it parks at `audit` with six failed verification runs,
// on a clean origin/master. Inheriting was the bug; stating the environment is
// the fix.
{
  const env = verifyCommandEnv({ NODE_ENV: "production", PATH: "/usr/bin" });
  assert.equal(env.NODE_ENV, "test", "the verification command always runs as a test run");
  assert.equal(env.PATH, "/usr/bin", "and the rest of the environment is preserved");
  assert.equal(verifyCommandEnv({}).NODE_ENV, "test", "even when the host sets nothing");
}
