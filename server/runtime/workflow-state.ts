/**
 * Where a workflow's state lives, and whether the workspace can be advanced
 * at all.
 *
 * A project can hold several workflows (one per card), so state.md is never
 * found by name: it is resolved through the ownership records in
 * stelow.json, and a state file is only trusted when it names the same
 * owner. Stage vocabulary comes from the canonical JSON catalog
 * (data/stelow-stage-catalog.json via lib/workflow-catalog.mjs) — the
 * advance path never parses the vendored prose mirror. That mirror remains
 * for workers to read, and lib/transition-facts.mjs audits offline that it
 * matches the catalog.
 */
import { existsSync, readdirSync } from "node:fs";
import { sep } from "node:path";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { OWNERSHIP_UNVERIFIED } from "../../lib/ownership-refusal.mjs";
import {
  ownsWorkflowState,
  workflowEntryForOwner,
  workflowStateRelativeDir,
} from "../../lib/workflow-state-identity.mjs";
import { legalMoves } from "../../lib/workflow-moves.mjs";
import { array } from "./values.js";
import type { WorkerCard } from "../workers-types.js";
import { join } from "./root-paths.js";

/**
 * Cardless `advance` re-root. `seed` writes per-workflow dirs
 * `.stelow/<date>/<dir>/state.md`, but the cardless path ran the helper in
 * project-root mode, so every seeded legacy workflow read as "missing state —
 * reseed". Exactly one match re-roots to it; zero keeps the old project-root
 * behavior; several refuse — guessing would advance the wrong workflow.
 */
export type LegacyStateSearch =
  | { kind: "single"; stateDir: string }
  | { kind: "ambiguous"; count: number }
  | { kind: "none" };

export function findSingleLegacyStateDir(rootPath: string): LegacyStateSearch {
  // NOTE: the local join() takes exactly (root, relative) — build multi-level
  // paths as one relative string, or segments are silently dropped.
  let dates: string[];
  try {
    dates = readdirSync(join(rootPath, ".stelow"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return { kind: "none" };
  }
  const hits: string[] = [];
  for (const date of dates) {
    let dirs: string[];
    try {
      dirs = readdirSync(join(rootPath, `.stelow/${date}`), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const dir of dirs) {
      const stateDir = join(rootPath, `.stelow/${date}/${dir}`);
      if (existsSync(join(stateDir, "state.md"))) hits.push(stateDir);
    }
  }
  if (hits.length === 1) return { kind: "single", stateDir: hits[0] };
  if (hits.length > 1) return { kind: "ambiguous", count: hits.length };
  return { kind: "none" };
}

/**
 * What a state-directory lookup learned, kept apart because "the records
 * disagree" and "the host would not answer" are different facts and only one
 * of them is a verdict about the card.
 *
 * `unreadable` is the fail-open direction on purpose. Every read here goes
 * through the host, and the host can be slow, busy or mid-restart — a stalled
 * event loop turns every file read into a timeout. Reporting that as a
 * verdict accuses a card of losing its state when the truth is that nobody
 * asked successfully, so a caller that only wants the path gets null (as
 * before) and a caller that must name a reason gets to say which of the two
 * happened.
 */
export type WorkflowStateResolution =
  | { kind: "resolved"; path: string; state: string }
  | { kind: "unreadable" }
  | { kind: "unowned" };

/**
 * Resolve a card's state directory only when both persisted ownership records
 * agree. A matching name or dirHash alone is deliberately insufficient:
 * projects can contain repeated requests and converted exploratory
 * workspaces.
 *
 * The state blob travels with the verdict because the ownership check has
 * already read it, and a caller that wants the blob should not have to ask
 * the host a second time for a file that can change between the two reads.
 */
export async function resolveWorkflowStateDir(
  bb: BbPluginApi,
  rootPath: string,
  workflowId: string,
  dirHash: string,
): Promise<WorkflowStateResolution> {
  const workflows = await bb.sdk.files
    .read({ path: join(rootPath, "stelow.json") })
    .then((file) => trackingWorkflows(file.content))
    .catch(() => null);
  if (!workflows) return { kind: "unreadable" };
  const workflow = workflowEntryForOwner(workflows, workflowId, dirHash);
  const relativeDir = workflowStateRelativeDir(workflow);
  if (!relativeDir) return { kind: "unowned" };
  const path = join(rootPath, relativeDir);
  const state = await bb.sdk.files
    .read({ path: join(path, "state.md") })
    .then((file) => file.content)
    .catch(() => null);
  if (state === null) return { kind: "unreadable" };
  return ownsWorkflowState(state, workflowId)
    ? { kind: "resolved", path, state }
    : { kind: "unowned" };
}

/**
 * The `workflows` array of a tracking file, or null when it cannot be read as
 * one. A file the host refused, a truncated write and a JSON scalar are all
 * "we do not know what this project recorded" — none of them is evidence that
 * a card lost its owner.
 */
function trackingWorkflows(content: string): unknown[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return array((parsed as { workflows?: unknown }).workflows);
}

/** The path half of `resolveWorkflowStateDir`, for callers that only need it. */
export async function workflowStateDir(
  bb: BbPluginApi,
  rootPath: string,
  workflowId: string,
  dirHash: string,
): Promise<string | null> {
  const resolution = await resolveWorkflowStateDir(bb, rootPath, workflowId, dirHash);
  return resolution.kind === "resolved" ? resolution.path : null;
}

/**
 * The checkout completion binds to: the one holding the card's state.
 *
 * A card whose worker wrote into a linked worktree keeps its state there, and
 * one whose worker wrote into the project checkout keeps it there. Sampling
 * Git evidence or running tests at any other checkout binds the completion to
 * a tree the card's artifacts were never read from — so the state dir decides,
 * and the managed checkout is only the fallback when the state cannot be
 * resolved. A card with neither keeps the previous behaviour: no root, and
 * the caller refuses exactly as before.
 */
export async function completionRoot(
  deps: {
    cardWorkspace: (card: WorkerCard) => Promise<{ path: string } | null>;
    workflowStateDir: (
      rootPath: string,
      workflowId: string,
      dirHash: string,
    ) => Promise<string | null>;
    cardCheckout: (card: WorkerCard) => Promise<{ path: string } | null>;
  },
  card: WorkerCard,
): Promise<string | null> {
  const [workspace, checkout] = await Promise.all([
    deps.cardWorkspace(card).catch(() => null),
    deps.cardCheckout(card).catch(() => null),
  ]);
  if (workspace?.path && card.dir_hash) {
    const stateDir = await deps
      .workflowStateDir(workspace.path, card.id, card.dir_hash)
      .catch(() => null);
    const root = stateRootOf(stateDir);
    if (root) return root;
  }
  return checkout?.path ?? null;
}

/**
 * The checkout containing a state directory.
 *
 * `.stelow/<date>/sw-<card>` is a fixed shape, so the parent of its `.stelow`
 * names the root the helper must use. A linked worktree and the project are
 * different directories, so the helper cannot assume either fixed checkout.
 */
export function stateRootOf(stateDir: string | null): string | null {
  if (!stateDir) return null;
  const marker = `${sep}.stelow${sep}`;
  const at = stateDir.lastIndexOf(marker);
  return at > 0 ? stateDir.slice(0, at) : null;
}

/**
 * Every stage the workflow may actually move to from the current one.
 *
 * Used to offer the human the moves the workflow allows, so the panel never
 * advertises a stage the state machine refuses.
 *
 * The projection used to read the catalog's transition rows and offer every
 * target — no intent route, no review mode. So the panel offered
 * `diff-gate` in Auto, where the stage does not exist, and `planning` at
 * `context` on a bugfix, where the route does not go; the worker was
 * refused by the helper seconds later. `lib/workflow-moves.mjs` applies the
 * same rule the helper enforces, and a parity test runs the pinned helper
 * over every triple to keep the two from drifting.
 */
export function parseNextStages(
  currentStage: string,
  options: {
    intent?: string | null;
    reviewPolicy?: string | string[] | null;
    quality?: string | null;
    explorationCount?: string | number | null;
  } = {},
): string[] {
  return legalMoves({
    intent: options.intent ?? "",
    reviewPolicy: options.reviewPolicy ?? null,
    stage: currentStage,
    quality: options.quality ?? null,
    explorationCount: options.explorationCount ?? null,
  }).allowed;
}

/**
 * The workspace is advanceable when its state and tracking files are both
 * present. The transitions mirror is worker reading material, not an
 * advance precondition: the host validates against the canonical catalog,
 * so a missing mirror never blocks a move. Returns the refusal to show,
 * or null when the move may proceed.
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
  // The card-worker guard, and the same verdict every other surface reaches, so
  // it reads the shared sentence: a reader who got it from `stelow advance` and
  // a reader who got it from the card's Failed chip were being told two
  // different things about the same broken card, and only one of them named the
  // action that clears it.
  if (requireOwnedState && !stateDir) return OWNERSHIP_UNVERIFIED;
  const state = stateDir
    ? join(stateDir, "state.md")
    : join(rootPath, "state.md");
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
