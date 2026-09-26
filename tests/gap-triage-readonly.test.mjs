import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gapsToTriageBatch, validateGapRegistry } from "../lib/gap-registry.mjs";

// Gap-triage genuineness: read-only second opinion over the worker's own
// classification. validateGapRegistry routing (gap-misclassified,
// gap-underfixed) stays fully deterministic — high/critical without
// escalate still misclassifies, medium+moderate/significant fixed still
// underfixes — whether or not any judge is configured. The judge shapes
// the report; it never reroutes.

const row = (impact, resolution, desc, effort) => [
  "---",
  "gaps:",
  '  - type: quality',
  '    area: "auth"',
  `    description: "${desc}"`,
  `    impact: ${impact}`,
  ...(effort ? [`    effort: ${effort}`] : []),
  `    resolution: ${resolution}`,
  "---",
  "",
].join("\n");

// Routing fires with no judge involved: these are pure sync calls, and the
// module has no outbound path at all (no fetch, no env reads).
assert.equal(
  validateGapRegistry(row("high", "fixed", "Skipped rate limit")).filter((f) => f.code === "gap-misclassified").length,
  1,
  "high impact fixed without a judge still misclassifies",
);
assert.equal(
  validateGapRegistry(row("critical", "documented", "No session expiry")).filter((f) => f.code === "gap-misclassified").length,
  1,
  "critical documented without a judge still misclassifies",
);
assert.equal(
  validateGapRegistry(row("medium", "fixed", "Needs more than inline", "moderate")).filter((f) => f.code === "gap-underfixed").length,
  1,
  "medium moderate fixed without a judge still underfixes",
);
assert.deepEqual(
  validateGapRegistry(row("high", "escalate", "Login rate limiter")),
  [],
  "a properly escalated high gap passes with no judge",
);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gapLib = readFileSync(join(root, "lib", "gap-registry.mjs"), "utf8");
assert.ok(!gapLib.includes("process.env"), "gap routing reads no environment — disabling the API cannot change it");
assert.ok(!gapLib.includes("fetch"), "gap routing makes no outbound calls");
assert.ok(!gapLib.includes("evaluateDecisionCall"), "gap routing never consults the Decision API");

// The judge input is shaped once (ids and questions cannot drift), and the
// triage report refuses deterministically before any judge runs.
const batch = gapsToTriageBatch([{ description: "Missing rate-limit test" }]);
assert.deepEqual(Object.keys(batch.questions), ["gap:gap-1"], "one atomic Score per gap, keyed once");
assert.equal(batch.questions["gap:gap-1"].type, "score", "genuineness is a Score judgment");

const server = readFileSync(join(root, "server.ts"), "utf8");
const gapAt = server.indexOf('if (argv[0] === "gap-triage") {');
assert.ok(gapAt >= 0, "the gap-triage branch exists");
const gapEnd = server.indexOf('if (argv[0] === "draft") {', gapAt);
assert.ok(gapEnd > gapAt, "the gap-triage branch is bounded");
const gapBody = server.slice(gapAt, gapEnd);
assert.ok(gapBody.includes("if (gapState.failures.length > 0) return { exitCode: 1"), "deterministic registry failures refuse before any judge runs");
assert.ok(gapBody.includes("routing stays deterministic"), "the report states routing is untouched");
assert.ok(!/db\.prepare\("(INSERT|UPDATE|DELETE|REPLACE)/.test(gapBody), "gap-triage makes zero database writes (reads only)");
assert.ok(!gapBody.includes("realtime.publish"), "gap-triage publishes nothing");
assert.ok(!gapBody.includes("logCardComment"), "gap-triage leaves no comments");

// Misclassified/underfixed redirect to triage reshape: the failure detail
// names the fix (escalate / documented-or-escalate), never a bare refusal.
const mis = validateGapRegistry(row("high", "fixed", "Skipped rate limit"))[0];
assert.ok(mis.detail.includes("escalate"), "misclassification redirects to escalate");
const under = validateGapRegistry(row("medium", "fixed", "Needs more than inline", "significant"))[0];
assert.ok(under.detail.includes("documented or escalate"), "underfix redirects to documented-or-escalate");

console.log("gap triage readonly test ok: routing unchanged without judge, judge never reroutes");
