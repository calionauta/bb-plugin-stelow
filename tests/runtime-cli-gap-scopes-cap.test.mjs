import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { callsNamed, cliHarness, NO_GAPS } from "./helpers/cli-harness.mjs";

/** The rework-round budget at the CLI seam: the cap refuses with three exits
 * and writes nothing, spending the last unit bumps the counter and names the
 * round on the card, and an idempotent re-run spends nothing. */

function seedWorkspace(entry) {
  const dir = mkdtempSync(join(tmpdir(), "stelow-gap-cap-"));
  writeFileSync(join(dir, "stelow.json"), JSON.stringify({ workflows: [entry] }), "utf8");
  return dir;
}

function gapStateFor(descriptions, linked = []) {
  return {
    ...NO_GAPS,
    matched: true,
    totals: { total: descriptions.length, fixed: 0, documented: 0, escalated: descriptions.length },
    escalated: descriptions.map((description) => ({ description })),
    auditGapScopes: linked.map((gap, index) => ({
      id: `scope-${index + 1}`,
      name: gap.slice(0, 80),
      status: "pending",
      gap,
    })),
  };
}

test("a capped card refuses gap-scopes with three exits and writes nothing", async () => {
  const dir = seedWorkspace({ workflowId: "card_1", scopes: [], rework_rounds: 3 });
  try {
    const { invoke, calls } = cliHarness({
      workspacePath: dir,
      gapState: gapStateFor(["promo codes ignored"]),
    });
    const result = await invoke(["gap-scopes"]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Rework budget reached \(3\/3/);
    assert.match(result.stderr, /promo codes ignored/);
    assert.match(result.stderr, /fixed/);
    assert.match(result.stderr, /skipped/);
    assert.match(result.stderr, /bb stelow split/);
    const data = JSON.parse(readFileSync(join(dir, "stelow.json"), "utf8"));
    assert.equal(data.workflows[0].rework_rounds, 3, "a refusal spends no rounds");
    assert.deepEqual(data.workflows[0].scopes, [], "a refusal creates no scopes");
    assert.equal(callsNamed(calls, "comment").length, 1, "the cap leaves an openable record on the card");
    assert.ok(callsNamed(calls, "publish").length >= 1, "the card refreshes past the refusal");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("spending the last round bumps the counter and names it on the card", async () => {
  const dir = seedWorkspace({ workflowId: "card_1", scopes: [], rework_rounds: 2 });
  try {
    const { invoke, calls } = cliHarness({
      workspacePath: dir,
      gapState: gapStateFor(["promo codes ignored"]),
    });
    const result = await invoke(["gap-scopes"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /rework round 3\/3/i);
    const data = JSON.parse(readFileSync(join(dir, "stelow.json"), "utf8"));
    assert.equal(data.workflows[0].rework_rounds, 3, "creating scopes spends one round");
    assert.equal(data.workflows[0].scopes.length, 1, "one scope per unlinked gap");
    assert.equal(data.workflows[0].scopes[0].source, "audit-gap");
    const bodies = callsNamed(calls, "comment").map(([, , , , , body]) => String(body));
    assert.equal(bodies.length, 1);
    assert.match(bodies[0], /rework round 3\/3/i, "the card comment carries the round, not just the prose");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an idempotent re-run below the cap spends nothing", async () => {
  const dir = seedWorkspace({ workflowId: "card_1", scopes: [], rework_rounds: 2 });
  try {
    const { invoke } = cliHarness({
      workspacePath: dir,
      gapState: gapStateFor(["promo codes ignored"], ["promo codes ignored"]),
    });
    const result = await invoke(["gap-scopes"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /already links a rework scope/);
    const data = JSON.parse(readFileSync(join(dir, "stelow.json"), "utf8"));
    assert.equal(data.workflows[0].rework_rounds, 2, "linking nothing spends nothing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a capped card with an oscillating finding names the human exit", async () => {
  const dir = seedWorkspace({ workflowId: "card_1", scopes: [], rework_rounds: 3 });
  try {
    const { invoke } = cliHarness({
      workspacePath: dir,
      gapState: {
        ...gapStateFor(["flaky window"]),
        critiqueRounds: [
          [{ description: "flaky window", resolution: "fixed" }],
          [{ description: "flaky window", resolution: "escalate" }],
          [{ description: "flaky window", resolution: "fixed" }],
          [{ description: "flaky window", resolution: "escalate" }],
        ],
      },
    });
    const result = await invoke(["gap-scopes"]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Rework budget reached \(3\/3/);
    assert.match(result.stderr, /Oscillation: /);
    assert.match(result.stderr, /flaky window/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a conversion counts how many escalations cite measurements", async () => {
  const dir = seedWorkspace({ workflowId: "card_1", scopes: [], rework_rounds: 0 });
  try {
    const { invoke, calls } = cliHarness({
      workspacePath: dir,
      gapState: {
        ...NO_GAPS,
        matched: true,
        totals: { total: 2, fixed: 0, documented: 0, escalated: 2 },
        escalated: [
          { description: "rate limiter missing", evidence: { symbols: ["RateLimiter"], files: [], callers: 38, tests: [], reversible: null, check: null } },
          { description: "unmeasured hunch" },
        ],
        auditGapScopes: [],
      },
    });
    const result = await invoke(["gap-scopes"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /2 escalated \(1 with evidence\)/);
    const bodies = callsNamed(calls, "comment").map(([, , , , , body]) => String(body));
    assert.match(bodies[0], /1 cite measurements/, "the card comment carries the evidence count");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
