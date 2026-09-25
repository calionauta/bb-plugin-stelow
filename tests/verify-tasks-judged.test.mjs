import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveScoredVerdicts } from "../lib/score-verdicts.mjs";
import {
  resolveScopeVerdicts,
  resolveTaskVerdicts,
  taskVerifyCommand,
} from "../lib/task-evidence.mjs";

// Verify-tasks judged remainder: deterministic verify-first, then the
// judged remainder. Tasks carrying their own verify command resolve from
// the exit code alone (exit 0 met, else unmet) and skip the judge; the rest
// resolve through one atomic Score each against the point floor. Scope
// rollup is deterministic: met iff every task met, unmet iff any task
// unmet, else unverifiable — a judged remainder below the floor rolls up
// to unverifiable, never verified.

// Verify-command extraction is string-only: arrays/objects read as absent
// and fall back to the judge instead of executing something unexpected.
assert.equal(taskVerifyCommand({ verify: "npm test" }), "npm test", "a string verify command resolves");
assert.equal(taskVerifyCommand({ verify: "  " }), null, "a blank command reads absent");
assert.equal(taskVerifyCommand({ verify: ["npm", "test"] }), null, "an array command reads absent (never executed)");
assert.equal(taskVerifyCommand({}), null, "a missing command reads absent");
assert.equal(taskVerifyCommand(null), null, "junk reads absent");

const TASKS = [
  { id: "t1", name: "Add rate limiter" },
  { id: "t2", name: "Write migration" },
];

// A judge-pass (confident high Score) reads met — the judged path works.
const judgePass = resolveTaskVerdicts({
  tasks: TASKS,
  answers: { "task:t1": { type: "score", score: 1.9, confidence: 0.9 } },
  routeAt: 0.6,
});
assert.equal(judgePass.find((f) => f.id === "t1").verdict, "met", "a confident judge-pass reads met");
assert.equal(judgePass.find((f) => f.id === "t2").verdict, "unverifiable", "an unanswered task reads unverifiable, never met");

// Deterministic verify-fail refuses despite judge-pass: the scope rollup
// reads the merged command+judge findings, and any unmet (here from the
// authoritative verify command) rolls the scope to unmet.
const merged = [
  { id: "t1", name: "Add rate limiter", verdict: "unmet" },
  { id: "t2", name: "Write migration", verdict: "met" },
];
const refused = resolveScopeVerdicts({
  scopes: [{ id: "s1", name: "Scope one", status: "done", tasks: [{ id: "t1" }, { id: "t2" }] }],
  taskFindings: merged,
});
assert.equal(refused[0].verdict, "unmet", "one verify-fail refuses the scope despite a judge-pass beside it");

// Judged remainder below the floor rolls up to unverifiable — never
// verified, never met.
const judgedWeak = resolveTaskVerdicts({
  tasks: TASKS,
  answers: {
    "task:t1": { type: "score", score: 1.9, confidence: 0.2 },
    "task:t2": { type: "score", score: 1.0, confidence: 0.9 },
  },
  routeAt: 0.6,
});
assert.ok(judgedWeak.every((f) => f.verdict === "unverifiable"), "below-floor confidence and middling scores both abstain");
const rolled = resolveScopeVerdicts({
  scopes: [{ id: "s1", name: "Scope one", status: "done", tasks: [{ id: "t1" }, { id: "t2" }] }],
  taskFindings: judgedWeak,
});
assert.equal(rolled[0].verdict, "unverifiable", "an unevidenced remainder rolls up unverifiable, never verified");

// Pending scopes stay openly pending; taskless done scopes abstain.
assert.equal(
  resolveScopeVerdicts({ scopes: [{ id: "s1", name: "Open", status: "doing", tasks: [{ id: "t1" }] }], taskFindings: merged })[0].verdict,
  "open",
  "pending work is openly pending",
);
assert.equal(
  resolveScopeVerdicts({ scopes: [{ id: "s1", name: "Empty", status: "done", tasks: [] }], taskFindings: [] })[0].verdict,
  "unverifiable",
  "a taskless done scope abstains",
);

// The shared resolver degrades wrong shapes to unverifiable — a Choice or
// missing answer where a Score belongs never decides.
assert.equal(
  resolveScoredVerdicts({ items: TASKS, answers: { "task:t1": { type: "choice", choice: "x" } }, keyPrefix: "task", routeAt: 0.6 })[0].verdict,
  "unverifiable",
  "a wrong answer shape abstains",
);

// Server wiring: verify-first is authoritative (exit-code verdicts with
// full confidence), the judge covers only the remainder, and the rollup is
// the deterministic resolver — removing any of these fails here.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
assert.ok(server.includes('verdict: ran.ok ? "met" : "unmet"'), "verify commands resolve deterministically from the exit code");
assert.ok(server.includes("confidence: 1, verdict: ran.ok"), "command verdicts carry full confidence (authoritative over the judge)");
assert.match(server, /const judgedTasks = doneTasks\.filter\(\(task\) => task\.verify === null\)/, "only command-less tasks reach the judge");
assert.match(server, /if \(judgedTasks\.length === 0\) \{/, "a fully-declared board skips the judge entirely");
assert.ok(server.includes("resolveScopeVerdicts({ scopes: taskScopes, taskFindings })"), "scopes roll up through the deterministic resolver");
const verifiedShortcut =
  /taskFindings\.filter\(\(finding\) => finding\.verdict === "met"\)\.length === taskFindings\.length \? "verified"/;
assert.ok(!verifiedShortcut.test(server), "no shortcut ever seals verified from task findings");

console.log("verify tasks judged test ok: verify-fail refuses despite judge-pass, weak remainder rolls unverifiable");
