import assert from "node:assert/strict";
import test from "node:test";
import { shouldAutoContinue } from "../lib/auto-continue.mjs";
import {
  autoContinueQuestions,
  getDecisionPoint,
  resolveAutoContinue,
} from "../lib/decision-points.mjs";
import { createAutoContinueVeto } from "../server/decision-auto-continue.ts";
import { card, harness, pausedSummary } from "./helpers/build-thread-sync-harness.mjs";

// Auto-continue veto: veto-only over the deterministic shouldAutoContinue
// (idle-edge + progressed + MAX_AUTO_CONTINUES=10 + non-terminal + no
// pending question). The heuristic decides; only a confident low noul
// vetoes. Never auto-resumes on model output — the veto path is reachable
// only after the heuristic already allowed the resume.

const ROUTE_AT = getDecisionPoint("auto-continue")?.defaultThresholds?.routeAt ?? 0.7;
assert.equal(ROUTE_AT, 0.7, "the veto floor prices worker turns above the free triage seed");

// The question is exactly one noul: did the finished turn move forward?
const questions = autoContinueQuestions();
assert.deepEqual(Object.keys(questions), ["progress"], "the veto asks exactly one question");
assert.equal(questions.progress.type, "noul", "progress is a yes/no judgment");

// Non-api outcomes keep the heuristic standing (fail-soft to rules).
assert.deepEqual(
  resolveAutoContinue({ apiNoul: null, routeAt: ROUTE_AT }),
  { proceed: true, source: "rules" },
  "a missing answer keeps the heuristic standing",
);
assert.deepEqual(
  resolveAutoContinue({ apiNoul: "yes", routeAt: ROUTE_AT }),
  { proceed: true, source: "rules" },
  "a non-numeric answer keeps the heuristic standing",
);
assert.deepEqual(
  resolveAutoContinue({ apiNoul: undefined, routeAt: ROUTE_AT }),
  { proceed: true, source: "rules" },
  "an undefined answer keeps the heuristic standing",
);

// Confident progress keeps the resume; confident halt vetoes it.
assert.deepEqual(
  resolveAutoContinue({ apiNoul: 0.95, routeAt: ROUTE_AT }),
  { proceed: true, source: "api", confidence: 0.95 },
  "confident progress keeps the heuristic resume",
);
const vetoed = resolveAutoContinue({ apiNoul: 0.1, routeAt: ROUTE_AT });
assert.equal(vetoed.proceed, false, "a confident halt vetoes the resume");
assert.equal(vetoed.source, "api", "the veto is named as a model judgment");

// The call site, DRIVEN. The heuristic gate runs first and the veto is only
// consulted after it allows the resume — so a heuristic refusal never reaches
// the model, and a veto only ever subtracts a resume. The old readFileSync pins
// proved a line of code existed; they passed when the veto was reachable before
// the heuristic, which is the mutation a reader can make in ten seconds.

/** The idle-edge fixture the heuristic RESUMES: new text is progress. */
function progressing() {
  return card({ status: "in-progress", stage: "shape", activity: "running" });
}

test("a permissive veto keeps the resume the heuristic allowed", async () => {
  const fixture = harness(progressing(), { status: "idle", output: "fresh progress" });
  await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.some(([name]) => name === "vet"),
    true,
    "the veto is consulted once the heuristic allows the resume",
  );
  assert.equal(
    fixture.calls.some(([name]) => name === "thread.send"),
    true,
    "a permissive veto leaves the resume in place",
  );
});

test("a confident halt vetoes the resume and parks the card", async () => {
  // A turn that only ran a command advances the stage, so the heuristic
  // resumes on the trailing verb while the prose is identical — which is also
  // what makes the park land: a card whose text did not move is idle past the
  // attention window, so the paused receipt (and the veto note in it) is
  // written rather than withheld.
  const fixture = harness(
    card({
      status: "in-progress",
      stage: "shape",
      activity: "running",
      last_assistant_text: "same output",
    }),
    {
      status: "idle",
      output: "same output",
      state: "name: Useful\ncurrent_stage: shape\n",
      vet: false,
      events: [
        { type: "turn/completed", data: { status: "completed" } },
        {
          type: "item/completed",
          data: {
            item: { type: "commandExecution", command: "bb stelow advance shape", status: "completed", exitCode: 0 },
          },
        },
      ],
    },
  );
  await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.some(([name]) => name === "vet"),
    true,
    "the veto is asked",
  );
  assert.equal(
    fixture.calls.some(([name]) => name === "thread.send"),
    false,
    "a veto means no resume",
  );
  assert.ok(
    pausedSummary(fixture.calls, /Auto-continue vetoed the resume/),
    "the park names the veto rather than leaving the reader to infer a silent stop",
  );
});

test("a heuristic refusal never reaches the model veto", async () => {
  // The negative control: if a heuristic refusal still consulted the veto, the
  // "veto-only" contract would be false and a model call would burn on a turn
  // the rules already refused.
  const fixture = harness(
    card({
      status: "in-progress",
      stage: "shape",
      activity: "running",
      last_assistant_text: "same output",
    }),
    { status: "idle", output: "same output", state: "name: Useful\ncurrent_stage: shape\n" },
  );
  await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.some(([name]) => name === "vet"),
    false,
    "the heuristic's own refusal short-circuits the veto",
  );
  assert.equal(fixture.calls.some(([name]) => name === "thread.send"), false, "and no resume happens");
});

// The seam the sync calls, DRIVEN: empty output, rules/preset mode, the kill
// switch, a keyless or unusable provider, a failed call, and a throw all return
// true (heuristic stands); only a confident noul halt returns false.

function vetoContext(overrides = {}) {
  const events = { warns: [], infos: [], calls: [] };
  const ctx = {
    bb: { log: { warn: (m) => events.warns.push(m), info: (m) => events.infos.push(m) } },
    route: {
      callRoute: () => {
        events.calls.push("callRoute");
        return overrides.call ?? { usable: false };
      },
    },
    pointRow: () => overrides.point,
    parsedThresholds: () => ({ routeAt: ROUTE_AT }),
    evaluateCall: async () => {
      events.calls.push("evaluateCall");
      if (overrides.throws) throw new Error("provider down");
      return overrides.result ?? { ok: false, error: "no key" };
    },
  };
  return { ...events, veto: createAutoContinueVeto(ctx) };
}

test("an empty or missing state text keeps the heuristic without a model call", async () => {
  for (const text of [null, "", "   "]) {
    const f = vetoContext();
    assert.equal(await f.veto.vetAutoContinue(text), true, "no state is no judgment");
    assert.deepEqual(f.calls, [], "and no provider is contacted");
  }
});

test("preset mode is refused on the hot path with the cost reason", async () => {
  const f = vetoContext({ point: { mode: "preset" } });
  assert.equal(await f.veto.vetAutoContinue("Stage shape. Worker output:\nprogress"), true);
  assert.deepEqual(f.calls, [], "preset mode never reaches the provider");
  assert.ok(
    f.warns.some((m) => /ignores preset mode/.test(m) && /burn worker turns/.test(m)),
    "the refusal names the cost it is protecting",
  );
});

test("the kill switch covers the veto", async () => {
  const previous = process.env.STELOW_DECISION_API;
  process.env.STELOW_DECISION_API = "0";
  try {
    const f = vetoContext({ point: { mode: "api" }, call: { usable: true } });
    assert.equal(await f.veto.vetAutoContinue("Stage shape. Worker output:\nprogress"), true);
    assert.deepEqual(f.calls, [], "the disabled decision API is never called");
  } finally {
    if (previous === undefined) delete process.env.STELOW_DECISION_API;
    else process.env.STELOW_DECISION_API = previous;
  }
});

test("an unusable route, a failed call and a throw all keep the heuristic standing", async () => {
  const unusable = vetoContext({ point: { mode: "api" }, call: { usable: false } });
  assert.equal(await unusable.veto.vetAutoContinue("Stage shape. Worker output:\nprogress"), true);
  assert.deepEqual(unusable.calls, ["callRoute"], "an unusable route stops before the call");

  const failed = vetoContext({ point: { mode: "api" }, call: { usable: true } });
  assert.equal(await failed.veto.vetAutoContinue("Stage shape. Worker output:\nprogress"), true);
  assert.deepEqual(failed.calls, ["callRoute", "evaluateCall"], "a failed call keeps the rules verdict");

  const thrown = vetoContext({ point: { mode: "api" }, call: { usable: true }, throws: true });
  assert.equal(await thrown.veto.vetAutoContinue("Stage shape. Worker output:\nprogress"), true, "a throw is caught");
});

test("only a confident noul halt votes against the resume", async () => {
  const halt = vetoContext({
    point: { mode: "api" },
    call: { usable: true, provider: "pi", endpoint: "e", apiKey: "k", model: "m" },
    result: { ok: true, answers: { progress: { type: "noul", noul: 0.1 } } },
  });
  assert.equal(
    await halt.veto.vetAutoContinue("Stage shape. Worker output:\nprogress"),
    false,
    "a confident halt vetoes",
  );
  assert.ok(halt.infos.some((m) => /vetoed by Decision API/.test(m)), "the veto is named as a model judgment");

  const move = vetoContext({
    point: { mode: "api" },
    call: { usable: true, provider: "pi", endpoint: "e", apiKey: "k", model: "m" },
    result: { ok: true, answers: { progress: { type: "noul", noul: 0.95 } } },
  });
  assert.equal(
    await move.veto.vetAutoContinue("Stage shape. Worker output:\nprogress"),
    true,
    "confident progress keeps the resume",
  );
});

// Deterministic gate unchanged: a silent idle worker still pauses even
// with the veto fully enabled — the veto only subtracts resumes.
assert.equal(
  shouldAutoContinue({
    status: "idle", stage: "shape", questionPending: false,
    transitioningIntoIdle: true, progressed: false, autoCount: 0, autoStage: null,
  }).proceed,
  false,
  "a silent stop stays paused regardless of the veto",
);

console.log("auto-continue veto test ok: heuristic stands when disabled, confident-halt vetoes, never auto-resumes");
