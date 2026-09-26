/**
 * Where a workflow's state lives, and whether the workspace can be advanced
 * at all.
 *
 * A project can hold several workflows (one per card), so state.md is never
 * found by name: it is resolved through the ownership records in
 * stelow.json, and a state file is only trusted when it names the same
 * owner. The transitions table is read from the same vendored copy the
 * seeder installs, so the stage vocabulary a worker sees and the one the
 * host validates can never come from two different files.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  ownsWorkflowState,
  workflowEntryForOwner,
  workflowStateRelativeDir,
} from "../../lib/workflow-state-identity.mjs";
import { TRANSITIONS_REF } from "../plugin-paths.js";
import { array } from "./values.js";
import { join, readJson } from "./root-paths.js";

/** The transitions table as installed inside a workspace. */
const WORKSPACE_TRANSITIONS =
  "skills/stelow-workflow-orchestrator/references/transitions.md";

/**
 * Resolve a card's state directory only when both persisted ownership records
 * agree. A matching name or dirHash alone is deliberately insufficient:
 * projects can contain repeated requests and converted exploratory
 * workspaces.
 */
export async function workflowStateDir(
  bb: BbPluginApi,
  rootPath: string,
  workflowId: string,
  dirHash: string,
): Promise<string | null> {
  try {
    const tracking = await readJson(
      bb.sdk.files,
      join(rootPath, "stelow.json"),
    );
    const workflow = workflowEntryForOwner(
      array(tracking?.workflows),
      workflowId,
      dirHash,
    );
    const relativeDir = workflowStateRelativeDir(workflow);
    if (!relativeDir) return null;
    const stateDir = join(rootPath, relativeDir);
    const state = await bb.sdk.files
      .read({ path: join(stateDir, "state.md") })
      .then((file) => file.content)
      .catch(() => null);
    return ownsWorkflowState(state, workflowId) ? stateDir : null;
  } catch {
    return null;
  }
}

/**
 * Every stage the installed transitions table routes the current one to.
 * Used to offer the human the moves the workflow actually allows, so the
 * panel never advertises a stage the vendored table rejects.
 */
export function parseNextStages(
  rootPath: string | null,
  currentStage: string,
): string[] {
  if (!rootPath) return [];
  const transitionsPath = join(rootPath, WORKSPACE_TRANSITIONS);
  if (!existsSync(transitionsPath)) return [];
  let content: string;
  try {
    content = readFileSync(transitionsPath, "utf8");
  } catch {
    return [];
  }
  // NOTE: do not use a `(?=^### |\Z)`-style regex here — `\Z` is an
  // end-of-string anchor in Python but a literal "Z" in JavaScript, which
  // silently broke parsing of the last stage block (`audit`). Splitting on
  // headers avoids the dialect trap and any regex injection via stage names.
  const sections = content.split(/^### /m);
  const section = sections.find(
    (entry) =>
      entry === currentStage ||
      entry.startsWith(`${currentStage}\n`) ||
      entry.startsWith(`${currentStage} `),
  );
  if (!section) return [];
  const stages = new Set<string>();
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    for (const key of ["next", "accept", "reject", "rework"] as const) {
      const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
      if (!match) continue;
      // Trailing "(...)" segments are human comments ("(none — stays at
      // triage)", "shape (shape rework — same stage)"), not stages. Without
      // stripping, a comment either leaks words (comma split keeps them) or
      // hides a real target (the whole token contains "(" and is dropped).
      const value = match[1].split("(")[0];
      for (const token of value.split(",")) {
        const stage = token.replace(/[[\]\s"']/g, "");
        if (stage && /^[a-z][a-z0-9-]*$/.test(stage)) stages.add(stage);
      }
    }
  }
  return Array.from(stages);
}

/**
 * The workspace is advanceable when its state and tracking files are both
 * present and its transitions copy is installed from the vendored upstream
 * contract. Returns the refusal to show, or null when the move may proceed.
 *
 * `requireOwnedState` is the card-worker guard: a worker whose state dir
 * cannot be verified must reseed rather than fall back to the project-root
 * state, which may belong to a different workflow entirely.
 */
export async function ensureProjectArtifacts(
  bb: BbPluginApi,
  rootPath: string,
  stateDir?: string | null,
  requireOwnedState = false,
): Promise<string | null> {
  const tracking = join(rootPath, "stelow.json");
  const transitions = join(rootPath, WORKSPACE_TRANSITIONS);
  if (requireOwnedState && !stateDir) {
    return "This card's workflow state cannot be verified. Reseed the card; Stelow will not use project-root state as a fallback.";
  }
  const state = stateDir
    ? join(stateDir, "state.md")
    : join(rootPath, "state.md");
  if (!existsSync(transitions)) {
    mkdirSync(dirname(transitions), { recursive: true });
    writeFileSync(transitions, readFileSync(TRANSITIONS_REF, "utf8"), "utf8");
  }
  if (
    !existsSync(state) ||
    !(await bb.sdk.files
      .read({ path: state })
      .then((file) => file.content.includes("current_stage:"))
      .catch(() => false))
  ) {
    return "state.md is missing for the Stelow workflow. Reseed the workflow.";
  }
  if (!existsSync(tracking)) {
    return "stelow.json is missing for the Stelow workflow. Reseed the workflow.";
  }
  return null;
}
