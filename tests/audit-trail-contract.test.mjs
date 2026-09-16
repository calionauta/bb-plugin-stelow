import assert from "node:assert/strict";
import { AUDIT_TRAIL_CONTRACT, auditTrailGate, auditTrailOutcome, parseAuditTrailResult } from "../lib/audit-trail-contract.mjs";

const HEAD = "a".repeat(40);
const ROOT = "/repo";
const snapshot = { root: ROOT, head: HEAD, tracked: "b".repeat(64), untracked: "c".repeat(64), untracked_count: 3 };
const okRun = (extra = {}) => ({ code: 0, stdout: JSON.stringify({ ok: true, contract: AUDIT_TRAIL_CONTRACT, path: "/repo/.stelow/x/audit-trail.md", artifacts: 2, snapshot, ...extra }), stderr: "" });
const failRun = (error) => ({ code: 1, stdout: JSON.stringify({ ok: false, contract: AUDIT_TRAIL_CONTRACT, path: "/repo/.stelow/x/audit-trail.md", error }), stderr: "" });
const crashRun = (code, stderr = "") => ({ code, stdout: "", stderr });
const git = { gitRoot: ROOT, headSha: HEAD };

// --- parsing -----------------------------------------------------------------
assert.equal(parseAuditTrailResult(""), null, "empty stdout is not a result");
assert.equal(parseAuditTrailResult("   \n"), null, "whitespace-only stdout is not a result");
assert.equal(parseAuditTrailResult("{"), null, "malformed JSON is not a result");
assert.equal(parseAuditTrailResult('"ok"'), null, "a bare JSON scalar is not a result");
assert.equal(parseAuditTrailResult("[1,2]"), null, "a JSON array is not a result");
assert.equal(parseAuditTrailResult('{"path":"x"}'), null, "a result without an ok flag is not a result");
assert.equal(parseAuditTrailResult(JSON.stringify({ ok: false, error: "x" })).ok, false);
assert.equal(parseAuditTrailResult(`\n${JSON.stringify({ ok: true })}\n`).ok, true, "surrounding whitespace is tolerated");

// --- outcome classification ---------------------------------------------------
assert.equal(auditTrailOutcome(okRun()).state, "verified");
assert.equal(auditTrailOutcome(failRun("audit-trail.md is stale; run audit-trail build")).state, "changed");
assert.equal(auditTrailOutcome(failRun("audit-trail.md is missing; run audit-trail build")).state, "missing");
assert.equal(auditTrailOutcome(crashRun(2, "usage")).state, "unavailable", "a helper that never emitted a result is unavailable");
assert.equal(auditTrailOutcome(failRun("unregistered workflow documents: .stelow/x/lessons.md")).state, "refused", "--strict's refusal is a named decision, not a crash");
assert.equal(auditTrailOutcome(crashRun(null, "spawn failed")).state, "unavailable");
assert.equal(auditTrailOutcome(null).state, "unavailable");
assert.match(auditTrailOutcome(crashRun(1, "bash: data/stelow: No such file")).detail, /No such file/, "stderr is preserved as the detail");

// A shape this plugin cannot read must never read as verified — including the
// older helper that reports no contract version at all.
const otherContract = auditTrailOutcome({ code: 0, stdout: JSON.stringify({ ok: true, contract: "v3", snapshot }), stderr: "" });
assert.equal(otherContract.state, "unsupported");
assert.match(otherContract.detail, /v3/);
assert.match(otherContract.detail, /Update this plugin, or pin the vendored Stelow helper/);
const noContract = auditTrailOutcome({ code: 0, stdout: JSON.stringify({ ok: true, path: "x", artifacts: 1 }), stderr: "" });
assert.equal(noContract.state, "unsupported");
assert.match(noContract.detail, /no audit-trail contract version/);

// --- completion gate ----------------------------------------------------------
assert.deepEqual(auditTrailGate({ build: okRun(), check: okRun(), verifiedGit: git }), {
  ready: true, error: null, trailer: { head: HEAD, root: ROOT, artifacts: 2, path: "/repo/.stelow/x/audit-trail.md", contract: AUDIT_TRAIL_CONTRACT },
}, "a current trail at the verified commit completes");

const unbuilt = auditTrailGate({ build: crashRun(1, "boom"), check: crashRun(1, "boom"), verifiedGit: git });
assert.equal(unbuilt.ready, false);
assert.match(unbuilt.error, /Could not generate the portable audit trail/);
assert.match(unbuilt.error, /boom/);

// The --strict refusal must reach the worker with the offending path intact.
const refused = auditTrailGate({ build: failRun("unregistered workflow documents: .stelow/x/lessons.md"), check: null, verifiedGit: git });
assert.equal(refused.ready, false);
assert.match(refused.error, /\(refused\)/);
assert.match(refused.error, /lessons\.md/);

const unvalidated = auditTrailGate({ build: okRun(), check: failRun("audit-trail.md is stale; run audit-trail build"), verifiedGit: git });
assert.equal(unvalidated.ready, false);
assert.match(unvalidated.error, /did not validate \(changed\)/);

const unsupported = auditTrailGate({ build: { code: 0, stdout: JSON.stringify({ ok: true, contract: "v3" }), stderr: "" }, check: okRun(), verifiedGit: git });
assert.equal(unsupported.ready, false);
assert.match(unsupported.error, /contract "v3"/, "an unreadable contract blocks completion without a generic wrapper");

// The receipt and the portable trail must attest one tree. A checkout that
// moved while the trail was written is the window this closes.
const movedHead = auditTrailGate({ build: okRun(), check: okRun(), verifiedGit: { ...git, headSha: "d".repeat(40) } });
assert.equal(movedHead.ready, false);
assert.match(movedHead.error, /HEAD a{12} but this card's audit receipt was verified at d{12}/);
assert.match(movedHead.error, /Re-run the audit, then done/);

const otherRepo = auditTrailGate({ build: okRun(), check: okRun(), verifiedGit: { gitRoot: "/other", headSha: HEAD } });
assert.equal(otherRepo.ready, false);
assert.match(otherRepo.error, /repository at \/repo but the verified checkout is \/other/);

const noSnapshot = auditTrailGate({ build: okRun(), check: { code: 0, stdout: JSON.stringify({ ok: true, contract: AUDIT_TRAIL_CONTRACT }), stderr: "" }, verifiedGit: git });
assert.equal(noSnapshot.ready, false);
assert.match(noSnapshot.error, /no repository snapshot/);

// Non-Git workflows still complete: no host evidence means nothing to bind to.
const nonGit = auditTrailGate({ build: okRun({ snapshot: { root: "not a Git repository", head: "not a Git repository" } }), check: okRun({ snapshot: { root: "not a Git repository", head: "not a Git repository" } }), verifiedGit: { isGit: false, gitRoot: null, headSha: null } });
assert.equal(nonGit.ready, true, "a workflow without Git evidence is not blocked by a Git comparison");

console.log("audit trail contract test ok: unreadable or moved receipts block Build completion, current ones complete");
