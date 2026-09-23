import assert from "node:assert/strict";
import { gapSummaryPresentation, qualitySealPresentation, summarizeScopeProgress } from "../lib/build-progress-presentation.mjs";

const scopes = [
  { name: "Finished", status: "done", tasks: [{ name: "Task done", status: "completed" }] },
  { name: "Doing", status: "in-progress", tasks: [{ name: "Task doing", status: "in-progress" }] },
  { name: "Waiting", status: "pending", tasks: [] },
  { name: "Blocked", status: "blocked", tasks: [] },
  { name: "Failed", status: "failed", tasks: [] },
  { name: "Escalated", status: "escalated", tasks: [] },
  { name: "Skipped", status: "skipped", tasks: [] },
];
const progress = summarizeScopeProgress(scopes);
assert.deepEqual(progress.scopes, { done: 1, total: 7, percent: 14 }, "only terminal-good scopes count as complete");
assert.deepEqual(progress.tasks, { done: 1, total: 2, percent: 50 }, "task completion uses the same terminal-good contract");
assert.deepEqual(progress.blockedNames, ["Blocked", "Failed", "Escalated"], "all actionable blocked states surface without suppressing doing work");
assert.deepEqual(progress.doingNames, ["Doing"], "a task inside a doing scope is not listed twice");
assert.equal(progress.allComplete, false, "skipped and pending scopes do not claim completion");
assert.deepEqual(summarizeScopeProgress([]), {
  scopes: { done: 0, total: 0, percent: 0 },
  tasks: { done: 0, total: 0, percent: 0 },
  doingNames: [], doingCount: 0, blockedNames: [], allComplete: false,
}, "empty work has no progress and never claims completion");
assert.equal(summarizeScopeProgress([{ name: "Done", status: "completed", tasks: [] }]).allComplete, true, "nonempty terminal-good work completes");

const combined = gapSummaryPresentation({ matched: true, escalated: 2, unscoped: 1, pendingScopes: 2, done: false });
assert.equal(combined.blocked, true, "unscoped and open rework scopes both block unfinished done state");
assert.match(combined.waitCopy, /Done waits on 1 escalated gap without a rework scope/, "missing rework scope names the actionable loop");
assert.match(combined.waitCopy, /2 rework scopes still open/, "open rework scopes remain visible beside the missing-scope warning");
assert.deepEqual(
  gapSummaryPresentation({ matched: true, escalated: 1, unscoped: 0, pendingScopes: 1, done: false }),
  { blocked: true, waitCopy: "1 rework scope still open.", resolvedCopy: null },
  "an open rework scope blocks Done independently of a missing rework scope",
);
assert.equal(gapSummaryPresentation({ matched: true, escalated: 1, unscoped: 1, pendingScopes: 0, done: true }).waitCopy, null, "terminal cards suppress the live blocker warning");
assert.deepEqual(
  gapSummaryPresentation({ matched: true, escalated: 1, unscoped: 0, pendingScopes: 0, done: false }),
  { blocked: false, waitCopy: null, resolvedCopy: "Every escalation links a finished rework scope." },
  "a resolved escalation reads as history, not a live blocker",
);
assert.equal(gapSummaryPresentation({ matched: false, escalated: 0, unscoped: 0, pendingScopes: 0, done: false }), null, "unmatched gaps stay absent before the first critique");

assert.deepEqual(
  ["verified", "hypothesis-only", "needs-revision", "unknown"].map((status) => qualitySealPresentation({ status }, "file.ts").text),
  ["verified", "hypothesis", "needs work", "unverified"],
  "quality keeps loading distinct from every live and unknown verdict",
);
assert.equal(qualitySealPresentation(null, "file.ts").text, "quality…", "quality starts in an honest loading state");
assert.equal(
  qualitySealPresentation({ status: "needs-revision", failures: ["No test", "No evidence"], label: "Seal" }, "file.ts").title,
  "Seal: No test; No evidence",
  "quality failures remain inspectable in the control title",
);

console.log("build progress presentation test ok: progress, rework, and quality states");
