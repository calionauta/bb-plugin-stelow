import assert from "node:assert/strict";
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

// Executable tests for the triage intent seed: the seam that decides which
// intent a new card's prompt is triaged as. It is advisory, so the guard that
// matters is the one that keeps it from acting on a bad answer — every path
// fails soft to "unknown" rather than breaking card creation.

const saved = savedEnv();

try {
  clearDecisionEnv();

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

  // The point's routeAt is the only thing standing between a weak answer and
  // a seeded intent, and BOTH judges answer into the same resolver. Every
  // test above lands well above the default 0.6, so none of them can tell a
  // threshold that is enforced from one that is merely passed along: drop or
  // zero it on either path and the verdict seeds anyway.
  const verdict = (choice, confidence) =>
    `\`\`\`json\n{"choice":"${choice}","confidence":${confidence}}\n\`\`\``;
  // The trail is announced at info and only on acceptance, so the info lines
  // that name a seed are what separates "resolved and seeded" from
  // "rejected" — a count blind to the level would conflate the two, and an
  // accepted seed raised to warn would read as a failure that never happened.
  const seedTrails = () =>
    logs.filter(
      ([level, line]) => level === "info" && line.includes("seeded from"),
    );
  const seedTrail = () => seedTrails().length;

  store.savePoint(
    "triage-intent",
    pointWrite({
      mode: "preset",
      route: keylessRoute,
      presetId: "judge",
      thresholds: { routeAt: 0.95 },
    }),
    () => 1,
  );
  const timid = seedWith(neverApi, async () => ({
    ok: true,
    text: verdict("feature", 0.5),
    error: null,
  }));
  const beforeTimid = seedTrail();
  assert.equal(
    await timid.seedBuildIntent("add dark mode", "project"),
    "unknown",
    "a preset verdict under the point's routeAt fails soft instead of seeding",
  );
  assert.equal(
    seedTrail(),
    beforeTimid,
    "a verdict the threshold rejected is never announced as seeded",
  );

  // Same gate on the api route, so the shared resolver cannot be enforced for
  // one judge and skipped for the other. It takes its own baseline so the case
  // stands on its own rather than borrowing the preset case's count.
  store.savePoint(
    "triage-intent",
    pointWrite({ route: keylessRoute, thresholds: { routeAt: 0.99 } }),
    () => 1,
  );
  const underApi = seedWith(async () => ({
    ok: true,
    answers: { intent: { type: "choice", choice: "feature", confidence: 0.9 } },
  }));
  const beforeUnderApi = seedTrail();
  assert.equal(
    await underApi.seedBuildIntent("add dark mode", "project"),
    "unknown",
    "an api verdict under the point's routeAt fails soft too",
  );
  assert.equal(
    seedTrail(),
    beforeUnderApi,
    "a below-threshold api answer is silent, not a failure to warn about",
  );

  // Every accepted seed above happens to be a "feature", so a shared tail
  // that returned a hardcoded "feature" — or one that dropped which choice the
  // judge picked — would satisfy all of them. A non-feature verdict pins the
  // seeded intent to what the judge actually said, on each path.
  store.savePoint(
    "triage-intent",
    pointWrite({ mode: "preset", route: keylessRoute, presetId: "judge" }),
    () => 1,
  );
  const bugfixByPreset = seedWith(neverApi, async () => ({
    ok: true,
    text: verdict("bugfix", 0.9),
    error: null,
  }));
  assert.equal(
    await bugfixByPreset.seedBuildIntent("fix the crash", "project"),
    "bugfix",
    "the preset judge seeds the choice it named, not a fixed intent",
  );
  assert.ok(
    seedTrails().some(([, line]) =>
      line.includes("seeded from preset judge (judge): bugfix"),
    ),
    "the preset trail names the seeded intent at info, so the record shows the outcome",
  );

  store.savePoint("triage-intent", pointWrite({ route: keylessRoute }), () => 1);
  const bugfixByApi = seedWith(async () => ({
    ok: true,
    answers: { intent: { type: "choice", choice: "investigate", confidence: 0.8 } },
  }));
  assert.equal(
    await bugfixByApi.seedBuildIntent("work out why it broke", "project"),
    "investigate",
    "the api route seeds the choice it returned, not a fixed intent",
  );
  assert.ok(
    seedTrails().some(([, line]) =>
      line.includes("seeded from Decision API: investigate"),
    ),
    "the api trail names the seeded intent at info too",
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
} finally {
  restoreEnv(saved);
}

console.log(
  "decision seed runtime test ok: fail-soft, threshold, and the intent it seeds",
);
