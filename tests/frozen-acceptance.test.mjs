import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FROZEN_ACCEPTANCE_FILE,
  frozenAcceptanceReadiness,
  parseFrozenAcceptance,
} from "../lib/audit-verification.mjs";
import { frozenAcceptanceGates } from "../lib/build-gates.mjs";
import { unmappedCriterionConditions } from "../lib/trackable-evidence.mjs";
import { frozenGatesEnabled } from "../server/scope-batch-gates.ts";
import {
  auditableBuildDone,
  callsNamed,
  cliHarness,
} from "./helpers/cli-harness.mjs";

/**
 * Gates do plugin: frozen technical acceptance (red-first r2).
 *
 * Human acceptance (card-acceptance receipt) and frozen technical acceptance
 * (baseline / test_map / red_proof / freeze_sha) are different facts. This
 * suite proves the technical side blocks `done` with one named refusal per
 * missing fact — MissingBaseline, UnmappedCriterion, NoRedProof,
 * FrozenAcceptance, first refusal wins — warns (never blocks) in `verify`,
 * and stays dormant behind the STELOW_FROZEN_GATES kill-switch and behind a
 * missing snapshot (old cards fail open).
 *
 * Every behavior below imports production: no helper or implementation lives
 * in this file. Source pins cover wiring/topology only (which gate consults
 * which module), never prose keywords.
 */

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);
const STATE = "/w/.stelow/state";
const FROZEN_PATH = `${STATE}/${FROZEN_ACCEPTANCE_FILE}`;

const greenFrozen = () => ({
  baseline: { "npm test": 0 },
  test_map: [
    { criterion: "checkout accepts a promo code", test: "node --test tests/promo.test.mjs" },
  ],
  red_proof: {
    failed_command: "node --test tests/promo.test.mjs",
    exit_code: 1,
    output_excerpt: "not ok 1 - promo applies",
  },
  freeze_sha: HEAD,
});

const withFrozen = (frozen) => {
  const base = auditableBuildDone();
  return { ...base, files: { ...base.files, [FROZEN_PATH]: JSON.stringify(frozen) } };
};

// Post-parse shape (camelCase): what parseFrozenAcceptance returns and what
// the readiness/gate layer reads. File-shape fixtures above stay snake_case
// so the parse boundary itself is covered.
const greenInput = () => ({ ...parseFrozenAcceptance(JSON.stringify(greenFrozen())), headSha: HEAD });

// --- Pure: readiness order is contractual (first refusal wins). ---

test("missing baseline refuses first, even when everything else is also bad", () => {
  const allBad = { baseline: {}, testMap: [], redProof: null, freezeSha: null, headSha: OTHER };
  assert.equal(frozenAcceptanceReadiness(allBad).code, "MissingBaseline");
  assert.equal(frozenAcceptanceReadiness({}).code, "MissingBaseline");
  assert.equal(frozenAcceptanceReadiness({ ...greenInput(), baseline: null }).code, "MissingBaseline");
  assert.match(frozenAcceptanceReadiness(allBad).error, /baseline/i);
});

test("an unmapped criterion refuses with the mapping redirect", () => {
  const empty = { ...greenInput(), testMap: [] };
  assert.equal(frozenAcceptanceReadiness(empty).code, "UnmappedCriterion");
  const unmapped = {
    ...greenInput(),
    testMap: [{ criterion: "checkout accepts a promo code" }],
  };
  const result = frozenAcceptanceReadiness(unmapped);
  assert.equal(result.code, "UnmappedCriterion");
  assert.match(result.error, /checkout accepts a promo code/);
  assert.match(result.error, /test_map/);
});

test("a frozen entry without red proof refuses instead of certifying unseen work", () => {
  const missing = { ...greenInput(), redProof: null };
  assert.equal(frozenAcceptanceReadiness(missing).code, "NoRedProof");
  const malformed = {
    ...greenInput(),
    redProof: { failed_command: "npm test", exit_code: 1, output_excerpt: "  " },
  };
  assert.equal(frozenAcceptanceReadiness(malformed).code, "NoRedProof");
  assert.match(frozenAcceptanceReadiness(missing).error, /red_proof/);
});

test("a stale or absent freeze refuses with the re-freeze redirect", () => {
  const stale = { ...greenInput(), headSha: OTHER };
  const staleResult = frozenAcceptanceReadiness(stale);
  assert.equal(staleResult.code, "FrozenAcceptance");
  assert.match(staleResult.error, /freeze/i);
  const absent = { ...greenInput(), freezeSha: null };
  assert.equal(frozenAcceptanceReadiness(absent).code, "FrozenAcceptance");
});

test("a complete frozen snapshot is ready", () => {
  assert.deepEqual(frozenAcceptanceReadiness(greenInput()), {
    ready: true,
    code: null,
    error: null,
  });
});

test("the frozen snapshot parses snake_case and rejects junk", () => {
  assert.equal(FROZEN_ACCEPTANCE_FILE, "frozen-acceptance.json");
  const parsed = parseFrozenAcceptance(JSON.stringify(greenFrozen()));
  assert.deepEqual(parsed?.baseline, { "npm test": 0 });
  assert.equal(parsed?.testMap?.length, 1);
  assert.equal(parsed?.freezeSha, HEAD);
  assert.equal(parseFrozenAcceptance("{nope"), null);
  assert.equal(parseFrozenAcceptance(JSON.stringify({ foo: 1 })), null);
  assert.equal(parseFrozenAcceptance(null), null);
});

// --- Pure: gate formatting + the fail-open contract. ---

test("the frozen gate names its code and fails open without a snapshot", () => {
  assert.equal(frozenAcceptanceGates({ ...greenFrozen(), headSha: HEAD }), null);
  assert.equal(frozenAcceptanceGates(null), null);
  assert.equal(frozenAcceptanceGates(undefined), null);
  assert.match(frozenAcceptanceGates({}) ?? "", /\[MissingBaseline\]/);
  assert.match(
    frozenAcceptanceGates({ ...greenFrozen(), test_map: [], headSha: HEAD }) ?? "",
    /\[UnmappedCriterion\]/,
  );
  assert.match(
    frozenAcceptanceGates({ ...greenFrozen(), red_proof: null, headSha: HEAD }) ?? "",
    /\[NoRedProof\]/,
  );
  assert.match(
    frozenAcceptanceGates({ ...greenFrozen(), headSha: OTHER }) ?? "",
    /\[FrozenAcceptance\]/,
  );
});

test("unmapped criteria name exactly the offenders", () => {
  const conditions = unmappedCriterionConditions({
    criteria: ["promo applies", "total shows discount"],
    testMap: [{ criterion: "promo applies", test: "node --test tests/promo.test.mjs" }],
  });
  assert.equal(conditions.length, 1);
  assert.equal(conditions[0].type, "UnmappedCriterion");
  assert.match(conditions[0].message, /total shows discount/);
  assert.deepEqual(
    unmappedCriterionConditions({ criteria: ["a"], testMap: [{ criterion: "a", test: "t" }] }),
    [],
  );
  assert.deepEqual(unmappedCriterionConditions({ criteria: [] }), []);
  assert.deepEqual(unmappedCriterionConditions({}), []);
});

test("the frozen kill-switch defaults on and accepts the documented off words", () => {
  assert.equal(frozenGatesEnabled({}), true);
  assert.equal(frozenGatesEnabled({ STELOW_FROZEN_GATES: "1" }), true);
  for (const off of ["0", "off", "false", "no"]) {
    assert.equal(frozenGatesEnabled({ STELOW_FROZEN_GATES: off }), false, `${off} disables`);
  }
});

// --- Wiring pins (topology): the CLI consults the gates module. ---

test("done and verify consult the frozen gates; the toggle lives with the batch gates", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const doneBuild = readFileSync(join(root, "server/runtime/cli/cli-done-build.ts"), "utf8");
  assert.match(doneBuild, /frozenAcceptanceGates\(/, "done refuses through the frozen gate");
  assert.match(doneBuild, /FROZEN_ACCEPTANCE_FILE/, "done reads the frozen snapshot file");
  assert.match(doneBuild, /frozenGatesEnabled\(/, "done respects the frozen kill-switch");
  const verify = readFileSync(join(root, "server/runtime/cli/cli-verify.ts"), "utf8");
  assert.match(verify, /frozenAcceptanceReadiness\(/, "verify warns through the frozen readiness");
  assert.match(verify, /unmappedCriterionConditions\(/, "verify names unmapped criteria");
  const batch = readFileSync(join(root, "server/scope-batch-gates.ts"), "utf8");
  assert.match(batch, /export function frozenGatesEnabled/, "the toggle is exported from the batch gates");
});

// --- Behavioral: done refuses per code, completes when frozen, obeys the switch. ---

test("done refuses a frozen snapshot with no baseline and completes nothing", async () => {
  const frozen = { ...greenFrozen(), baseline: {} };
  const { invoke, calls } = cliHarness(withFrozen(frozen));
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /\[MissingBaseline\]/);
  assert.deepEqual(callsNamed(calls, "updateCard"), []);
});

test("done refuses an unmapped criterion and names it", async () => {
  const frozen = { ...greenFrozen(), test_map: [{ criterion: "checkout accepts a promo code" }] };
  const { invoke, calls } = cliHarness(withFrozen(frozen));
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /\[UnmappedCriterion\]/);
  assert.match(result.stderr, /checkout accepts a promo code/);
  assert.deepEqual(callsNamed(calls, "updateCard"), []);
});

test("done refuses a frozen snapshot with no red proof", async () => {
  const frozen = { ...greenFrozen(), red_proof: null };
  const { invoke, calls } = cliHarness(withFrozen(frozen));
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /\[NoRedProof\]/);
  assert.deepEqual(callsNamed(calls, "updateCard"), []);
});

test("done refuses a stale freeze and names the re-freeze", async () => {
  const frozen = greenFrozen();
  const { invoke, calls } = cliHarness({
    ...withFrozen(frozen),
    gitEvidence: { isGit: true, gitRoot: "/w", branch: "main", headSha: OTHER },
  });
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /\[FrozenAcceptance\]/);
  assert.deepEqual(callsNamed(calls, "updateCard"), []);
});

test("done completes when the frozen snapshot is green at this HEAD", async () => {
  const { invoke, calls } = cliHarness(withFrozen(greenFrozen()));
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(
    callsNamed(calls, "updateCard").map(([, , fields]) => fields.status),
    ["completed"],
  );
});

test("done obeys the kill-switch: off means the frozen snapshot does not block", async () => {
  const previous = process.env.STELOW_FROZEN_GATES;
  process.env.STELOW_FROZEN_GATES = "0";
  try {
    const frozen = { ...greenFrozen(), baseline: {}, test_map: [], red_proof: null };
    const { invoke, calls } = cliHarness(withFrozen(frozen));
    const result = await invoke(["done"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(
      callsNamed(calls, "updateCard").map(([, , fields]) => fields.status),
      ["completed"],
    );
  } finally {
    if (previous === undefined) delete process.env.STELOW_FROZEN_GATES;
    else process.env.STELOW_FROZEN_GATES = previous;
  }
});

// --- Behavioral: verify warns (never blocks) on frozen drift. ---

test("verify warns on a stale freeze but still records the passing run", async () => {
  const frozen = greenFrozen();
  const { invoke } = cliHarness({
    testCommand: { command: "npm", args: ["test"], display: "npm test" },
    hostTests: { exitCode: 0, output: "3 passing" },
    files: { [FROZEN_PATH]: JSON.stringify(frozen) },
    gitEvidence: { isGit: true, gitRoot: "/w", branch: "main", headSha: OTHER },
  });
  const result = await invoke(["verify", "--tests"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(`${result.stdout}${result.stderr}`, /frozen/i);
});

test("verify stays silent about frozen acceptance when the snapshot is green", async () => {
  const { invoke } = cliHarness({
    testCommand: { command: "npm", args: ["test"], display: "npm test" },
    hostTests: { exitCode: 0, output: "3 passing" },
    files: { [FROZEN_PATH]: JSON.stringify(greenFrozen()) },
  });
  const result = await invoke(["verify", "--tests"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /frozen/i);
});

test("frozenDetailView maps a snapshot to the row the hero renders", async () => {
  const { frozenDetailView } = await import("../lib/audit-verification.mjs");
  const view = frozenDetailView(
    {
      baseline: { "npm test": 0 },
      testMap: ["node tests/a.test.mjs", { test: "node tests/b.test.mjs", criterion: "b works" }],
      redProof: { failed_command: "node tests/a.test.mjs", exit_code: 1, output_excerpt: "not ok" },
      freezeSha: HEAD,
    },
    HEAD,
  );
  assert.equal(view.freezeSha, HEAD);
  assert.equal(view.currentHeadSha, HEAD);
  assert.equal(view.frozenTestMap.length, 2);
  assert.equal(view.frozenTestMap[0].test, "node tests/a.test.mjs");
  assert.equal(view.frozenTestMap[0].frozen, true);
  assert.deepEqual(view.frozenTestMap[0].redProof, { failed_command: "node tests/a.test.mjs", exit_code: 1, output_excerpt: "not ok" });
  assert.equal(view.frozenTestMap[1].test, "node tests/b.test.mjs");
});

test("frozenDetailView drops entries with no proving test and nulls empty maps", async () => {
  const { frozenDetailView } = await import("../lib/audit-verification.mjs");
  assert.equal(frozenDetailView(null, HEAD), null);
  assert.equal(frozenDetailView({}, HEAD), null);
  assert.equal(frozenDetailView({ testMap: [{ criterion: "no test" }, ""], freezeSha: HEAD }, HEAD), null);
});
