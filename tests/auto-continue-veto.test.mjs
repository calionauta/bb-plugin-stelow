import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldAutoContinue } from "../lib/auto-continue.mjs";
import {
  autoContinueQuestions,
  getDecisionPoint,
  resolveAutoContinue,
} from "../lib/decision-points.mjs";

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

// The veto cannot invent a resume: the resolver has no path that returns
// proceed:true from a low signal, and the call site only consults the veto
// after the heuristic already allowed the resume.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The call site lives in the build thread sync that resumes a worker.
const sync = readFileSync(join(root, "server/runtime/build-thread-sync.ts"), "utf8");
const heuristicAt = sync.indexOf("const decision = shouldAutoContinue({");
const vetoAt = sync.indexOf("const vetoed = decision.proceed &&");
assert.ok(heuristicAt >= 0 && vetoAt > heuristicAt, "the heuristic gate runs before the veto is ever consulted");
assert.match(
  sync,
  /const vetoed = decision\.proceed &&\s*!\(await deps\.vetContinuation\(/,
  "the veto is short-circuited behind the heuristic — a heuristic refusal never reaches the model",
);
assert.match(
  sync,
  /if \(decision\.proceed && !vetoed && await resumeWorker\(/,
  "a resume needs the heuristic AND the absence of a veto",
);
assert.match(
  sync,
  /persistStandardIdle\(deps, snapshot, transitioning, vetoed\);/,
  "a veto falls through to the paused path with no writes of its own",
);

// Kill-switch and mode gates keep the heuristic: the seam returns true
// (proceed) without calling out when disabled or not in api mode.
const seams = readFileSync(join(root, "server", "decision-auto-continue.ts"), "utf8");
assert.ok(seams.includes("isDecisionApiDisabled(process.env)"), "the kill switch covers the veto");
assert.ok(seams.includes('ignores preset mode'), "preset mode is refused on the hot path with the cost reason");
assert.ok(
  (seams.slice(seams.indexOf("async function vetAutoContinue("), seams.length).match(/return true/g) ?? []).length >= 3,
  "empty output, mode/kill-switch gates, and catch-all all keep the heuristic standing",
);

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
