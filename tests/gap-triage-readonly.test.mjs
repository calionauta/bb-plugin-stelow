import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateGapRegistry } from "../lib/gap-registry.mjs";
import { gapsToTriageBatch } from "../lib/gap-triage.mjs";
import { createGapTriageCommand } from "../server/runtime/cli/cli-gap-triage.ts";

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

// The verb is its own CLI family now. The read-only guarantee and the refusal
// order are DRIVEN against a stubbed runtime: every write path is a recorder
// that must stay untouched, so a command that started writing would fail here
// instead of behind a grep for the calls it used to omit.
const card = { id: "card-1", kind: "build", project_id: "project_1" };

function gapDeps({ failures = [], escalated = [] } = {}) {
  const calls = { sql: [], publishes: 0, comments: 0, judged: 0 };
  return {
    calls,
    deps: {
      db: {
        prepare(sql) {
          calls.sql.push(sql);
          return {
            get: () =>
              sql.includes("decision_points")
                ? { mode: "api", thresholds: "{}", provider: "pi", endpoint: null, api_key: null, model: null, preset_id: null }
                : { endpoint: "", api_key: "", model: "", provider: "pi" },
          };
        },
      },
      bb: { realtime: { publish: () => { calls.publishes += 1; } } },
      getCard: (id) => (id === card.id ? card : undefined),
      getCardByWorkerThread: () => undefined,
      cardWorkspace: async () => ({ path: "/repo" }),
      gapState: async () => ({ matched: true, failures, escalated, critiqueText: "the worker's critique" }),
      workingDiffFor: async () => "diff --git a b",
      decisionRoute: () => ({ provider: "pi", endpoint: null, apiKey: "test-key", model: null }),
      judgeScoredBatch: async () => {
        calls.judged += 1;
        return { ok: true, findings: [{ name: "gap-1", verdict: "met", confidence: 0.9 }] };
      },
      logCardComment: () => { calls.comments += 1; return "c"; },
    },
  };
}

const ctx = { threadId: "thr_worker" };

{
  const { deps } = gapDeps();
  assert.equal(await createGapTriageCommand(deps)(["storage"], ctx), null, "the gap-triage family claims exactly its verb");
}

{
  const { deps, calls } = gapDeps({ failures: ["gap-misclassified: high-impact gap marked fixed"] });
  const result = await createGapTriageCommand(deps)(["gap-triage", "--card", "card-1"], ctx);
  assert.equal(result.exitCode, 1, "deterministic registry failures refuse");
  assert.match(result.stderr, /gap-misclassified/, "the refusal names the registry failure");
  assert.equal(calls.judged, 0, "the refusal lands before any judge runs");
}

{
  const { deps, calls } = gapDeps({
    escalated: [{ type: "quality", area: "auth", description: "Missing rate-limit test", impact: "high", resolution: "escalate" }],
  });
  const result = await createGapTriageCommand(deps)(["gap-triage", "--card", "card-1"], ctx);
  assert.equal(result.exitCode, 0, "a matched critique with escalated gaps triages");
  assert.match(result.stdout, /routing stays deterministic/, "the report states routing is untouched");
  assert.equal(calls.judged, 1, "the judge runs once, after the deterministic gates");
  assert.equal(calls.comments, 0, "gap-triage leaves no comments");
  assert.equal(calls.publishes, 0, "gap-triage publishes nothing");
  assert.ok(
    calls.sql.every((sql) => !/(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql)),
    "gap-triage makes zero database writes (reads only)",
  );
}

// Misclassified/underfixed redirect to triage reshape: the failure detail
// names the fix (escalate / documented-or-escalate), never a bare refusal.
const mis = validateGapRegistry(row("high", "fixed", "Skipped rate limit"))[0];
assert.ok(mis.detail.includes("escalate"), "misclassification redirects to escalate");
const under = validateGapRegistry(row("medium", "fixed", "Needs more than inline", "significant"))[0];
assert.ok(under.detail.includes("documented or escalate"), "underfix redirects to documented-or-escalate");

console.log("gap triage readonly test ok: routing unchanged without judge, judge never reroutes");
