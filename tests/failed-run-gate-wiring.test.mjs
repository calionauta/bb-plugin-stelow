import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { blockingFailedRun } from "../lib/failed-run-gate.mjs";

/**
 * The gate is only real if the advance reads it.
 *
 * `keepsCardRunning` was exported, documented, tested in isolation, and called
 * by nothing for months — a rule that existed and had no caller is the exact
 * shape of bug this repository keeps paying for. The failed-run hold is the
 * same kind of rule (a refusal that names a door), so the wiring is asserted
 * here rather than assumed: the preflight that both entry points share must
 * consult the gate BEFORE it does anything else, because it is the only check
 * on that path about something that already went wrong rather than about
 * whether the next stage may open.
 */
const preflight = readFileSync(
  new URL("../server/execution-advance-preflight.ts", import.meta.url),
  "utf8",
);

assert.match(
  preflight,
  /blockingFailedRun\(deps\.db, input\.card\.id, input\.card\.stage\)/,
  "the preflight reads the card's CURRENT stage, not the one being advanced to",
);
assert.match(
  preflight,
  /if \(failed\) return \{ error: failedRunRefusal\(failed\) \};/,
  "a blocking run refuses the advance with the sentence that names the door",
);

const guardAt = preflight.indexOf("blockingFailedRun(");
const mutationAt = preflight.indexOf("routePreflight(deps, input");
const scopeSyncAt = preflight.indexOf("syncExecutionScopes(");
assert.ok(guardAt > -1 && mutationAt > -1, "both the guard and the route are present");
assert.ok(guardAt < mutationAt, "the hold is taken before the route resolves");
assert.ok(guardAt < scopeSyncAt, "and before the execution scope sync runs");

// The gate needs the ledger. If the preflight's dependency slice stops
// declaring `db`, this stops compiling rather than quietly reading nothing.
assert.match(
  preflight,
  /type PreflightDeps = Pick<AdvanceDeps, "db"/,
  "the preflight declares the ledger it reads the hold from",
);

// And the door: a refusal that names Retry run is only honest while a Retry
// exists, is offered on a failed row, and is wired to an RPC that starts a run.
const section = readFileSync(
  new URL("../components/detail/execution-runs-section.tsx", import.meta.url),
  "utf8");
assert.match(section, /run\.normalizedStatus === "failed"/, "Retry is offered on a failed row");
assert.match(section, /onRetry\(run\.id\)/, "and it calls the retry action for that run");

const hook = readFileSync(
  new URL("../components/detail/use-execution-runs.ts", import.meta.url),
  "utf8");
assert.match(hook, /rpc\.call\("retryExecutionRun", \{ runId \}\)/, "the hook calls the retry RPC");
assert.match(hook, /toast\.error\(result\.error/, "a refusal is shown, not swallowed");

const contract = readFileSync(
  new URL("../server/execution-contract.ts", import.meta.url),
  "utf8");
assert.match(contract, /retryExecutionRun: \{/, "the RPC is declared");
assert.match(contract, /runId: z\.string\(\)\.nullable\(\)/, "and answers with the new run's id");

const gate = blockingFailedRun;
assert.equal(typeof gate, "function", "the rule the preflight imports is the one under test here");

console.log("failed-run gate wiring ok: preflight holds before it routes, and the door is wired end to end");
