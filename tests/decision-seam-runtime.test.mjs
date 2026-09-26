import assert from "node:assert/strict";
import { createAutoContinueVeto } from "../server/decision-auto-continue.ts";
import { createDecisionRoute } from "../server/decision-route.ts";
import {
  clearDecisionEnv,
  decisionHarness,
  pointWrite,
  restoreEnv,
  savedEnv,
  warnedAbout,
} from "./fixtures/decision-harness.mjs";

// Executable tests for the auto-continue veto: the seam that may stop a
// worker turn from being resumed. It is advisory and veto-only, so the guard
// that matters is the one that keeps it from spending a resume decision on a
// bad answer — the heuristic has to stand on every failure.
// The triage intent seed is tested alongside it in decision-seed-runtime.test.mjs.

const saved = savedEnv();

try {
  clearDecisionEnv();

  // A route that IS usable without a key, so "no call went out" can only mean
  // the mode gate stopped it — never that the provider was unresolvable.
  const keylessRoute = {
    provider: "classifier",
    endpoint: null,
    apiKey: null,
    model: null,
  };

  // --- auto-continue: the router may only hold the heuristic back --------
  {
    const { bb, logs, store } = decisionHarness();
    const shared = {
      bb,
      route: createDecisionRoute({ configRow: store.configRow }),
      pointRow: store.pointRow,
      parsedThresholds: store.parsedThresholds,
    };
    const seen = [];
    const withCall = (impl) =>
      createAutoContinueVeto({
        ...shared,
        evaluateCall: async (args) => {
          seen.push(args);
          return impl(args);
        },
      });
    const noul = (value) => async () => ({
      ok: true,
      answers: { progress: { type: "noul", noul: value } },
    });

    // Rules mode on a usable route: the gate, not an unresolvable key, is what
    // keeps the worker turn in-house. Delete the gate and this calls out and
    // vetoes on the built-in rules' behalf.
    store.savePoint(
      "auto-continue",
      pointWrite({
        mode: "rules",
        thresholds: { routeAt: 0.7 },
        route: keylessRoute,
      }),
      () => 1,
    );
    const rules = withCall(noul(0.2));
    assert.equal(
      await rules.vetAutoContinue("worker output"),
      true,
      "rules mode never calls out",
    );
    assert.equal(seen.length, 0, "rules mode on a usable route spends no call");

    store.savePoint(
      "auto-continue",
      pointWrite({
        thresholds: { routeAt: 0.7 },
        route: keylessRoute,
      }),
      () => 1,
    );
    const vetoed = withCall(noul(0.2));
    assert.equal(
      await vetoed.vetAutoContinue("still no progress"),
      false,
      "a low progress score vetoes the resume",
    );
    assert.equal(
      seen.at(-1).endpoint,
      "https://classifier.dev",
      "the call goes out on the point's own route",
    );
    assert.ok(
      logs.some(([, line]) => line.includes("vetoed by Decision API")),
    );

    const quiet = withCall(noul(0.9));
    assert.equal(
      await quiet.vetAutoContinue("made real progress"),
      true,
      "a confident progress score leaves the heuristic standing",
    );

    const failed = withCall(async () => ({ ok: false, error: "upstream 500" }));
    assert.equal(
      await failed.vetAutoContinue("idle"),
      true,
      "a failed call never spends a resume decision",
    );
    assert.ok(
      warnedAbout(logs, "heuristic stands"),
      "a failed call says the heuristic stands",
    );

    const thrown = withCall(async () => {
      throw new Error("transport");
    });
    assert.equal(
      await thrown.vetAutoContinue("idle"),
      true,
      "a thrown evaluator fails soft to the heuristic",
    );

    const attempted = seen.length;
    const empty = withCall(noul(0.2));
    assert.equal(
      await empty.vetAutoContinue("   "),
      true,
      "empty output never reaches the judge",
    );
    assert.equal(
      seen.length,
      attempted,
      "empty output reaches no judge at all",
    );

    // A keyed provider with no key anywhere is not usable: the veto keeps
    // the heuristic standing without spending an outbound call.
    store.savePoint(
      "auto-continue",
      pointWrite({
        thresholds: { routeAt: 0.7 },
        route: { provider: "jev", endpoint: null, apiKey: null, model: null },
      }),
      () => 1,
    );
    const unkeyed = createAutoContinueVeto({
      ...shared,
      evaluateCall: async (args) => {
        seen.push(args);
        throw new Error("a keyed provider with no key must never call out");
      },
    });
    const before = seen.length;
    assert.equal(await unkeyed.vetAutoContinue("idle"), true);
    assert.equal(seen.length, before, "an unresolvable key never reaches the provider");

    store.savePoint(
      "auto-continue",
      pointWrite({ mode: "preset", thresholds: { routeAt: 0.7 } }),
      () => 1,
    );
    const presetMode = withCall(noul(0.2));
    assert.equal(
      await presetMode.vetAutoContinue("idle"),
      true,
      "preset mode never burns a worker turn",
    );
    assert.ok(
      warnedAbout(logs, "ignores preset mode"),
      "the ignored preset mode is named in the log",
    );

    // The kill switch outranks a perfectly good api route: a host that turned
    // api mode off must make no outbound call at all, on any point, in any mode.
    store.savePoint(
      "auto-continue",
      pointWrite({ thresholds: { routeAt: 0.7 }, route: keylessRoute }),
      () => 1,
    );
    process.env.STELOW_DECISION_API = "0";
    const beforeSwitch = seen.length;
    const warnsBefore = logs.length;
    const switched = withCall(async () => {
      throw new Error("a host with the kill switch on must never call out");
    });
    assert.equal(
      await switched.vetAutoContinue("idle"),
      true,
      "the kill switch keeps the heuristic standing",
    );
    assert.equal(seen.length, beforeSwitch, "the kill switch spends no call");
    assert.equal(
      logs.length,
      warnsBefore,
      "the kill switch is not a failure, so it says nothing",
    );
    delete process.env.STELOW_DECISION_API;
  }

} finally {
  restoreEnv(saved);
}

console.log(
  "decision veto runtime test ok: the router may only hold the heuristic back",
);
