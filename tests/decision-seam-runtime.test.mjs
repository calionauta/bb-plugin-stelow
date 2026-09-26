import assert from "node:assert/strict";
import { createAutoContinueVeto } from "../server/decision-auto-continue.ts";
import { createDecisionRoute } from "../server/decision-route.ts";
import { createDecisionSeed } from "../server/decision-seed.ts";
import {
  clearDecisionEnv,
  decisionHarness,
  pointWrite,
  restoreEnv,
  savedEnv,
  warnedAbout,
} from "./fixtures/decision-harness.mjs";

// Executable tests for the two seams that ask a judge: the auto-continue
// veto and the triage intent seed. Both are advisory, so the guard that
// matters is the one that keeps them from acting on a bad answer.

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

  // --- triage intent seeding: fail-soft to unknown on every path ---------
  {
    const { bb, logs, store } = decisionHarness();
    const route = createDecisionRoute({ configRow: store.configRow });
    const keylessRoute = {
      provider: "classifier",
      endpoint: null,
      apiKey: null,
      model: null,
    };
    const neverApi = async () => {
      throw new Error("this point must not reach the api route");
    };
    const seedWith = (impl, judge) =>
      createDecisionSeed({
        bb,
        route,
        pointRow: store.pointRow,
        parsedThresholds: store.parsedThresholds,
        evaluateCall: impl,
        judgeViaPreset:
          judge ?? (async () => ({ ok: true, text: "unused", error: null })),
      });

    store.savePoint("triage-intent", pointWrite({ route: keylessRoute }), () => 1);
    const failed = seedWith(async () => ({ ok: false, error: "upstream 500" }));
    assert.equal(
      await failed.seedBuildIntent("add dark mode", "project"),
      "unknown",
    );
    assert.ok(
      warnedAbout(logs, "fell back to built-in rules"),
      "a failed seed names the fallback it took",
    );

    const confident = seedWith(async () => ({
      ok: true,
      answers: { intent: { type: "choice", choice: "feature", confidence: 0.95 } },
    }));
    assert.equal(
      await confident.seedBuildIntent("add dark mode", "project"),
      "feature",
    );
    assert.ok(
      logs.some(([, line]) => line.includes("seeded from Decision API")),
    );

    store.savePoint(
      "triage-intent",
      pointWrite({ mode: "rules", route: keylessRoute }),
      () => 1,
    );
    const rules = seedWith(neverApi);
    assert.equal(
      await rules.seedBuildIntent("add dark mode", "project"),
      "unknown",
      "rules mode never calls out",
    );

    store.savePoint(
      "triage-intent",
      pointWrite({ mode: "preset", route: keylessRoute, presetId: "judge" }),
      () => 1,
    );
    const garbage = seedWith(neverApi, async () => ({
      ok: true,
      text: "no verdict here",
      error: null,
    }));
    assert.equal(
      await garbage.seedBuildIntent("add dark mode", "project"),
      "unknown",
    );
    assert.ok(
      warnedAbout(logs, "no fenced verdict block"),
      "an unparsable judge answer names why the seed fell back",
    );

    const judge = seedWith(neverApi, async () => ({
      ok: true,
      text: '```json\n{"choice":"feature","confidence":0.9}\n```',
      error: null,
    }));
    assert.equal(
      await judge.seedBuildIntent("add dark mode", "project"),
      "feature",
    );
    assert.ok(
      logs.some(([, line]) => line.includes("seeded from preset judge (judge)")),
    );

    const refused = seedWith(neverApi, async () => ({
      ok: false,
      text: null,
      error: "judge thread timed out",
    }));
    assert.equal(
      await refused.seedBuildIntent("add dark mode", "project"),
      "unknown",
    );
    assert.ok(
      warnedAbout(logs, "judge thread timed out"),
      "a failed judge names its own error in the fallback line",
    );

    process.env.STELOW_DECISION_API = "0";
    const disabled = seedWith(neverApi, async () => {
      throw new Error("the kill switch must block seeding before any judge");
    });
    assert.equal(
      await disabled.seedBuildIntent("add dark mode", "project"),
      "unknown",
    );
    delete process.env.STELOW_DECISION_API;

    // The seam documents that every path fails soft to "unknown", so a
    // collaborator that REJECTS has to land there too — a bare `return
    // promise` inside the try would let it escape into card creation.
    const rejecting = seedWith(neverApi, async () => {
      throw new Error("judge bridge is down");
    });
    assert.equal(
      await rejecting.seedBuildIntent("add dark mode", "project"),
      "unknown",
      "a rejecting judge fails soft instead of throwing into card creation",
    );
  }
} finally {
  restoreEnv(saved);
}

console.log(
  "decision seam runtime test ok: veto gates, seed fail-soft, preset judging",
);
