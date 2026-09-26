import assert from "node:assert/strict";
import {
  DECISION_POINTS,
  PRESET_JUDGE_POINTS,
} from "../lib/decision-points.mjs";
import { resolvePointWrite } from "../server/decision-point-rules.ts";
import { createDecisionRoute } from "../server/decision-route.ts";
import {
  clearDecisionEnv,
  decisionHarness,
  pointRow,
  presetExists,
  restoreEnv,
  savedEnv,
} from "./fixtures/decision-harness.mjs";

// Executable tests for the decision slices that decide rather than call out:
// the store's normalization, the point-write rules, and the route every
// api-mode judgment resolves through. A regression has to break a named
// behavior here, not a copy pin elsewhere.

const saved = savedEnv();

try {
  clearDecisionEnv();

  // --- persistence: reads normalize, malformed JSON degrades ---------------
  {
    const { store } = decisionHarness();
    assert.deepEqual(
      store.parsedThresholds(
        pointRow({ thresholds: "{not json" }),
        "auto-continue",
      ),
      { routeAt: 0.7 },
      "unparsable stored thresholds fall back to the registry default, never throw",
    );
    assert.deepEqual(
      store.parsedThresholds(
        pointRow({ thresholds: '{"routeAt":0.95}' }),
        "auto-continue",
      ),
      { routeAt: 0.95 },
    );
    const def = {
      id: "triage-intent",
      defaultMode: "rules",
      modes: ["rules", "api", "preset"],
    };
    assert.deepEqual(
      store.pointView(def, pointRow({ mode: "quantum", model: "  " })),
      {
        mode: "rules",
        thresholds: { routeAt: 0.6 },
        route: null,
        presetId: null,
      },
      "an unknown stored mode reads as rules and an all-blank route reads as no override",
    );
    assert.deepEqual(
      store.pointView(def, undefined),
      { mode: "rules", thresholds: { routeAt: 0.6 }, route: null, presetId: null },
      "an unconfigured point reads as the registry default, not as an error",
    );
  }

  // --- criteria evaluation: refusals in order, every one with a redirect --
  {
    const unknownPoint = resolvePointWrite(
      { point: "mystery", mode: "api" },
      undefined,
      { presetExists },
    );
    assert.equal(unknownPoint.ok, false);
    assert.match(
      unknownPoint.error,
      /^Unknown decision point "mystery"\. Available: /,
    );
    assert.match(
      unknownPoint.error,
      /artifact-criteria/,
      "the refusal names a valid point",
    );

    const unknownMode = resolvePointWrite(
      { point: "triage-intent", mode: "mystery" },
      undefined,
      { presetExists },
    );
    assert.match(
      unknownMode.error,
      /^Unknown mode "mystery" for triage-intent/,
    );
    assert.match(unknownMode.error, /Available: rules, api, preset/);

    // Ordering: the first wrong field is the one reported, and the modes
    // named are the ones that point actually offers.
    const both = resolvePointWrite(
      { point: "mystery", mode: "mystery" },
      undefined,
      { presetExists },
    );
    assert.equal(
      both.error,
      unknownPoint.error,
      "an unknown point outranks an unknown mode",
    );

    const hotPath = resolvePointWrite(
      { point: "auto-continue", mode: "preset", presetId: "judge" },
      undefined,
      { presetExists },
    );
    assert.equal(hotPath.ok, false);
    assert.match(
      hotPath.error,
      /Unknown mode "preset" for auto-continue\. Available: rules, api\./,
      "a hot path never even offers preset mode",
    );
    assert.ok(
      DECISION_POINTS.every((def) =>
        def.modes.includes("preset") ? PRESET_JUDGE_POINTS.includes(def.id) : true,
      ),
      "a point that offers preset mode is a point that may spend a judge turn",
    );

    const missingJudge = resolvePointWrite(
      { point: "triage-intent", mode: "preset" },
      undefined,
      { presetExists },
    );
    assert.match(missingJudge.error, /needs a judge preset/);
    const unknownJudge = resolvePointWrite(
      { point: "triage-intent", mode: "preset", presetId: "ghost" },
      undefined,
      { presetExists },
    );
    assert.equal(unknownJudge.error, 'Unknown preset "ghost".');
    assert.ok(!missingJudge.ok && !unknownJudge.ok);

    // The kill switch refuses an api-mode write naming the variable, even
    // though the same write's judge preset is also unknown. The two checks
    // cannot actually race — the switch only fires on mode "api" and the
    // preset refusals only on mode "preset" — so this is not an ordering
    // assertion. It pins that the switch is not a preset-mode concern.
    process.env.STELOW_DECISION_API = "0";
    const disabled = resolvePointWrite(
      { point: "triage-intent", mode: "api", presetId: "ghost" },
      undefined,
      { presetExists },
    );
    assert.equal(disabled.ok, false);
    assert.match(disabled.error, /STELOW_DECISION_API=0/);
    delete process.env.STELOW_DECISION_API;
    assert.equal(
      resolvePointWrite(
        { point: "triage-intent", mode: "api" },
        undefined,
        { presetExists },
      ).ok,
      true,
      "clearing the kill switch lets the same write through",
    );

    // Merging: an absent field keeps what the point already stored, an
    // explicit null clears it, and absent thresholds fall back to the point's
    // registry default.
    const existing = pointRow({
      mode: "preset",
      provider: "simplejev",
      endpoint: "https://pinned.test/v1",
      api_key: "pinned-key",
      model: "pinned-model",
      preset_id: "judge",
    });
    const flipped = resolvePointWrite(
      { point: "triage-intent", mode: "api" },
      existing,
      { presetExists },
    );
    assert.equal(flipped.ok, true);
    assert.deepEqual(flipped.write.route, {
      provider: "simplejev",
      endpoint: "https://pinned.test/v1",
      apiKey: "pinned-key",
      model: "pinned-model",
    });
    assert.equal(
      flipped.write.presetId,
      "judge",
      "flipping modes keeps the stored judge",
    );
    assert.deepEqual(flipped.write.thresholds, { routeAt: 0.6 });

    const cleared = resolvePointWrite(
      { point: "triage-intent", mode: "api", route: null, presetId: null },
      existing,
      { presetExists },
    );
    assert.deepEqual(cleared.write.route, {
      provider: null,
      endpoint: null,
      apiKey: null,
      model: null,
    });
    assert.equal(
      cleared.write.presetId,
      null,
      "an explicit null clears the stored judge",
    );
    assert.deepEqual(
      resolvePointWrite(
        { point: "auto-continue", mode: "api", thresholds: { routeAt: 0.9 } },
        undefined,
        { presetExists },
      ).write.thresholds,
      { routeAt: 0.9 },
      "a supplied threshold is normalized, not dropped",
    );
  }

  // --- routing: one route per point, filled from the shared settings ------
  {
    const configRow = () => ({
      endpoint: "https://shared.test/v1",
      api_key: "shared-key",
      model: "shared-model",
      provider: "jev",
    });
    const route = createDecisionRoute({ configRow });
    const filled = route.routeConfig(pointRow({ model: "point-model" }));
    assert.equal(
      filled.endpoint,
      "https://shared.test/v1",
      "omitted fields fill from the shared settings row",
    );
    assert.equal(
      filled.model,
      "point-model",
      "a pinned model wins field by field",
    );
    assert.equal(filled.provider, "jev");
    assert.equal(
      filled.apiKey,
      "shared-key",
      "the key saved in settings fills a point that pinned none",
    );

    const call = route.callRoute(
      pointRow({ model: "point-model", api_key: "pinned-key" }),
    );
    assert.equal(call.provider, "jev");
    assert.equal(call.endpoint, "https://shared.test/v1");
    assert.equal(call.model, "point-model");
    assert.equal(
      call.key,
      "pinned-key",
      "a pinned key wins over the shared one",
    );
    assert.equal(call.apiKey, "pinned-key");
    assert.equal(call.usable, true);

    const shared = route.callRoute(pointRow({ model: "point-model" }));
    assert.equal(
      shared.key,
      "shared-key",
      "a point that pins no key uses the one saved in settings",
    );
    assert.equal(shared.usable, true);

    process.env.DECISION_API_KEY = "env-key";
    const keylessConfig = createDecisionRoute({
      configRow: () => ({ ...configRow(), api_key: "" }),
    }).callRoute(pointRow({ model: "point-model" }));
    assert.equal(
      keylessConfig.key,
      "env-key",
      "with no stored key the host environment answers",
    );
    assert.equal(keylessConfig.usable, true);
    delete process.env.DECISION_API_KEY;

    const unconfigured = createDecisionRoute({ configRow: () => undefined });
    const keyless = unconfigured.callRoute(
      pointRow({
        provider: "classifier",
        endpoint: null,
        api_key: null,
        model: null,
      }),
    );
    assert.equal(
      keyless.usable,
      true,
      "a keyless provider stays usable with no key anywhere",
    );
    assert.equal(keyless.apiKey, "");
    assert.equal(
      keyless.endpoint,
      "https://classifier.dev",
      "a keyless provider defaults its own endpoint",
    );

    const unkeyed = unconfigured.callRoute(
      pointRow({
        provider: "jev",
        endpoint: null,
        api_key: null,
        model: null,
      }),
    );
    assert.equal(
      unkeyed.usable,
      false,
      "a keyed provider with no key is not usable",
    );
    assert.equal(unkeyed.endpoint, "https://api.typesafe.ai/v1/systemone");
    assert.equal(
      route.routeConfig(undefined).endpoint,
      "https://shared.test/v1",
      "a point with no stored route resolves through the shared config",
    );
  }
} finally {
  restoreEnv(saved);
}

console.log(
  "decision slice runtime test ok: store normalization, refusal order, route fill",
);
