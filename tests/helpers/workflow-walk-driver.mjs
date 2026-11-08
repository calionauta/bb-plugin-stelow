/**
 * Drive the pinned workflow helper over a whole route, on a throwaway workspace.
 *
 * The helper (`data/stelow`) is the state machine every host and the CLI
 * execute, and it is the only thing that can answer "does this workflow let a
 * card through". Reading its transition table answers a different question:
 * totality is not passability. A stage can have a legal exit and still refuse
 * every card that reaches it because the artifact the precondition demands is
 * not the artifact the methodology declares.
 *
 * So the driver builds the smallest workspace the workflow describes — one
 * `state.md` plus exactly the artifacts the catalog declares for the stage
 * being left — and asks the real script to advance. It spawns processes, which
 * is why it lives in `tests/helpers/` and not in `lib/`: the projection in
 * `lib/workflow-walk.mjs` stays pure, and `.auto/measure.sh` reuses both so the
 * loop's number and CI's number are the same number.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardTarget, plannedRoute, refusalDoor, refusalKind } from "../../lib/workflow-walk.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const HELPER = join(root, "data", "stelow");
export const TRANSITIONS = join(root, "skills", "stelow-workflow-orchestrator", "references", "transitions.md");
export const CATALOG = JSON.parse(readFileSync(join(root, "data", "stelow-stage-catalog.json"), "utf8"));

/** A breadboard the precondition's own `check breadboard` accepts. It is a
 * fixture of the contract, not a product: one place, one affordance rendered
 * there, which is the smallest graph the schema calls valid. */
const BREADBOARD = JSON.stringify(
  {
    schemaVersion: 1,
    interfaceId: "walk",
    places: [{ id: "P1", name: "Walk" }],
    affordances: [{ id: "U1", kind: "ui", name: "Walk view", place: "P1", control: "render" }],
  },
  null,
  2,
);

export function stateTemplate({
  intent = "feature",
  reviewMode = "Auto",
  stage = "triage",
  status = "active",
  quality = "production",
  explorationCount = 3,
}) {
  return [
    "---",
    "name: walk",
    `intent: ${intent}`,
    `current_stage: ${stage}`,
    `status: ${status}`,
    "config:",
    `  quality: ${quality}`,
    `  exploration_count: ${explorationCount}`,
    `  review_mode: ${reviewMode}`,
    "  product_type: software",
    "stages:",
    `  ${stage}: in-progress`,
    "artifacts: []",
    "history: []",
    "---",
    "# walk",
    "",
  ].join("\n");
}

/** The stage's declared artifacts, written where the precondition looks. */
export function writeDeclaredArtifacts(stateDir, stage) {
  const declared = CATALOG.stages.find((entry) => entry.id === stage)?.artifacts ?? [];
  for (const pattern of declared) {
    const path = pattern.endsWith("breadboard.json")
      ? "interfaces/breadboard.json"
      : pattern.replace("*", "v1");
    const file = join(stateDir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, path.endsWith("breadboard.json") ? BREADBOARD : `# ${pattern}\n`);
  }
}

/** Run the helper once. Never throws: a refusal is data, not an error. */
export function runHelper(args, env) {
  try {
    const out = execFileSync("bash", [HELPER, ...args], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, code: 0, text: out.trim() };
  } catch (error) {
    return { ok: false, code: error.status ?? 1, text: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() };
  }
}

/** The stage the state machine actually recorded, read from the file it wrote. */
export function observedStage(stateDir) {
  const blob = readFileSync(join(stateDir, "state.md"), "utf8");
  return blob.match(/^current_stage:\s*(\S+)\s*$/m)?.[1] ?? null;
}

/** One throwaway workspace, removed when `done` is called. */
export function workspace({ state = {}, files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "stelow-walk-"));
  const stateDir = join(dir, ".stelow", "2026-01-01", "sw-walk");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "state.md"), stateTemplate(state));
  for (const [path, body] of Object.entries(files)) {
    const file = join(stateDir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return {
    stateDir,
    env: { ...process.env, STELOW_STATEDIR: stateDir, STELOW_TRANSITIONS: TRANSITIONS },
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Walk one `{intent, reviewMode}` route from triage to audit.
 *
 * The walk targets the PLANNED stage, not the helper's `next` answer: the
 * question is whether the documented route is passable, and asking the helper
 * where to go next would make the route whatever the helper says. That the
 * helper and the projection agree about the next move is `workflow-moves`' job;
 * here a wrong plan is a refusal, which is exactly the failure this counts.
 *
 * `trail` is every stage the card actually entered. `failure` is the first
 * refusal, with its classified kind and named door, or `null` when the card
 * reached `audit`. The walk stops at the failure instead of skipping past it:
 * a route that cannot leave one stage says nothing about the stages after it.
 */
export function walkRoute({ intent, reviewMode, quality = "production", explorationCount = 3, maxSteps = 30 }) {
  const expected = plannedRoute({ intent, reviewMode, quality, explorationCount });
  if (!expected) return { expected: null, trail: [], failure: { kind: "unknown-route", door: null } };
  const space = workspace({ state: { intent, reviewMode, quality, explorationCount, stage: "triage" } });
  const trail = ["triage"];
  let current = "triage";
  try {
    while (current !== "audit" && trail.length <= maxSteps) {
      const target = forwardTarget(expected, current);
      if (!target) break;
      writeDeclaredArtifacts(space.stateDir, current);
      const advance = runHelper(["advance", target, "--json"], space.env);
      if (!advance.ok) {
        return { expected, trail, failure: { stage: current, target, ...describe(advance.text) } };
      }
      // Read the mutation back. `trail` built from the plan would assert
      // `route == route`: an advance that prints success without writing the
      // stage would pass every sweep assertion while the card never moved.
      const observed = observedStage(space.stateDir);
      if (observed !== target) {
        return {
          expected,
          trail,
          failure: { stage: current, target, kind: "state-diverged", observed, door: null, text: advance.text },
        };
      }
      current = observed;
      trail.push(observed);
    }
    const reached = current === "audit";
    return { expected, trail, failure: reached ? null : { stage: current, kind: "step-budget", door: null } };
  } finally {
    space.dispose();
  }
}

function describe(text) {
  return { text: text.split("\n").slice(0, 3).join(" | "), kind: refusalKind(text), door: refusalDoor(text).door };
}

/**
 * The adversarial cells, fixed on purpose.
 *
 * Half of what makes a workflow trustworthy is that it refuses the wrong move,
 * and refuses it with a door. These cells are the refusal classes the state
 * machine can produce; the list does not grow inside the loop, because a metric
 * that can be improved by adding cells measures its own author, not the
 * workflow.
 */
/**
 * The adversarial cells, fixed on purpose.
 *
 * Half of what makes a workflow trustworthy is that it refuses the wrong move,
 * and refuses it with a door. These cells are the refusal classes the state
 * machine can produce; the list does not grow inside the loop, because a metric
 * that can be improved by adding cells measures its own author, not the
 * workflow.
 */
const CELLS = Object.freeze([
  {
    label: "missing artifact on the stage being left",
    state: { stage: "shape" },
    args: ["advance", "critique"],
    // The door is the artifact the catalog declares, not the mirror's wording:
    // catalog, mirror and helper have to name the same file for this to hold.
    expect: { ok: false, kind: "missing-artifact", door: "plans/spec-product*.md" },
  },
  {
    label: "a stage the review mode does not run",
    state: { stage: "gate", reviewMode: "Auto" },
    args: ["advance", "plan-gate"],
    expect: { ok: false, kind: "policy-skip", door: "execution" },
  },
  {
    label: "a stage the run policy excludes",
    state: { stage: "setup", quality: "experimental", explorationCount: 1 },
    args: ["advance", "context"],
    expect: { ok: false, kind: "policy-skip", door: "shape" },
  },
  {
    label: "a stage off the intent route",
    state: { stage: "context", intent: "bugfix" },
    args: ["advance", "planning"],
    expect: { ok: false, kind: "off-route" },
  },
  {
    label: "an unknown review mode",
    state: { stage: "shape", reviewMode: "Product Spec + Interface + Tech Reviews" },
    args: ["advance", "critique"],
    expect: { ok: false, kind: "unknown-mode" },
  },
  {
    label: "an artifact that exists but breaks its contract",
    state: { stage: "selection" },
    args: ["advance", "architecture"],
    files: { "interfaces/selected-interface.md": "# selected\n", "interfaces/breadboard.json": "{}\n" },
    expect: { ok: false, kind: "artifact-invalid", doorEndsWith: "interfaces/breadboard.json" },
  },
  {
    label: "the reject door is still a door",
    state: { stage: "interface" },
    args: ["advance", "scope"],
    files: { "interfaces/interface-v1.md": "# interface\n", "interfaces/contrast.json": "{}\n" },
    expect: { ok: true },
  },
  {
    label: "the terminal stage refuses the next move",
    state: { stage: "audit" },
    args: ["advance", "triage"],
    expect: { ok: false, kind: "off-route", door: ["execution"] },
  },
]);

export function adversarialCells() {
  return CELLS;
}

/** Run one adversarial cell and explain what actually happened. */
export function runCell(cell) {
  const space = workspace({ state: cell.state, files: cell.files ?? {} });
  try {
    const result = runHelper(cell.args, space.env);
    return {
      label: cell.label,
      expect: cell.expect,
      ok: result.ok,
      code: result.code,
      text: result.text.split("\n").slice(0, 3).join(" | "),
      kind: result.ok ? "allowed" : refusalKind(result.text),
      door: result.ok ? null : refusalDoor(result.text).door,
    };
  } finally {
    space.dispose();
  }
}
