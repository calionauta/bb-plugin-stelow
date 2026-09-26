/**
 * Seeding a workflow: the one writer of a card's state dir and its stelow.json
 * entry.
 *
 * The identity rule is what makes a reseed safe. A name is a label, not an
 * identity, so reuse is reserved for this exact immutable owner (a card id)
 * and requires the index entry AND the state file to agree. An entry with no
 * owner id is never adopted, and neither is a state file naming someone else.
 * The path shape itself is derived by one function (`workflowStateRelativeDir`),
 * so what is written here is exactly what the reader later resolves, and
 * `created` pins the date segment to the first seed so a reseed never moves a
 * directory out from under a running worker.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { STATE_TEMPLATE } from "../../lib/state-template.mjs";
import { withRuntimeIgnoreEntry } from "../../lib/card-seed-guard.mjs";
import {
  ownsWorkflowState,
  upsertWorkflowEntry,
  workflowDirHash,
  workflowEntryForOwner,
  workflowStateRelativeDir,
} from "../../lib/workflow-state-identity.mjs";
import {
  formatReviewGates,
  legacyLabelForGates,
  normalizeReviewGates,
} from "../../lib/review-gates.mjs";
import { TRANSITIONS_REF } from "../plugin-paths.js";
import { record, text, type LooseRecord } from "./values.js";
import { join } from "./root-paths.js";

export type SeedResult = {
  statePath: string | null;
  stateDir: string | null;
  dirHash: string | null;
  error: string | null;
};

const ORCHESTRATOR_REFERENCES =
  "skills/stelow-workflow-orchestrator/references";

/** Directories every seeded workspace needs before any state is written. */
function prepareWorkspace(rootPath: string): void {
  mkdirSync(join(rootPath, ".stelow/approvals"), { recursive: true });
  mkdirSync(join(rootPath, ORCHESTRATOR_REFERENCES), { recursive: true });
}

/**
 * Keep live runs out of git: a worker `git add -A` must never sweep
 * `.stelow/` into the project history — the committed record is the exported
 * docs/runs/<card>/ bundle. Best-effort, git checkouts only, never blocks
 * seeding.
 */
function ignoreRuntimeState(rootPath: string): void {
  try {
    if (!existsSync(join(rootPath, ".git"))) return;
    const ignorePath = join(rootPath, ".gitignore");
    let current = "";
    try {
      current = readFileSync(ignorePath, "utf8");
    } catch {
      /* created below */
    }
    const next = withRuntimeIgnoreEntry(current);
    if (next !== null) writeFileSync(ignorePath, next, "utf8");
  } catch {
    /* hygiene never blocks seeding */
  }
}

/** The workspace's tracking file, or an empty one to create. */
function readTracking(trackingPath: string): LooseRecord {
  let trackingData: LooseRecord = {};
  try {
    trackingData = JSON.parse(readFileSync(trackingPath, "utf8")) as LooseRecord;
  } catch {
    /* create fresh */
  }
  if (!Array.isArray(trackingData.workflows)) trackingData.workflows = [];
  return trackingData;
}

/**
 * The paths of an already-seeded owner, or null when this seed must (re)write
 * one. Seeding an owner that is already seeded is otherwise a no-op: it
 * returns the workflow's own paths and leaves its entry, stage, and progress
 * alone.
 */
async function existingSeed(
  bb: BbPluginApi,
  rootPath: string,
  workflowId: string,
  entry: unknown,
  fresh: boolean,
): Promise<SeedResult | null> {
  const entryDir = workflowStateRelativeDir(entry);
  const reusable =
    !fresh &&
    entry &&
    entryDir &&
    (await bb.sdk.files
      .read({ path: join(rootPath, `${entryDir}/state.md`) })
      .then((file) => ownsWorkflowState(file.content, workflowId))
      .catch(() => false));
  if (reusable && entryDir) {
    const existingDir = join(rootPath, entryDir);
    return {
      statePath: join(existingDir, "state.md"),
      stateDir: existingDir,
      dirHash: text(record(entry).dirHash),
      error: null,
    };
  }
  return null;
}

/**
 * Write a canonical state file, unless one already holds a stage and names
 * this owner.
 *
 * Canonical storage is the gate set (`review_gates: [spec, …]`, empty ≡ Auto).
 * The legacy `review_mode:` ladder label is kept for upstream readers; novel
 * sets have no rung, so they read back as Auto there — the worker prompt
 * names `review_gates` first.
 */
async function writeStateFile(
  bb: BbPluginApi,
  statePath: string,
  workflowId: string,
  name: string,
  intent: string,
  appetite: string,
  reviewMode: string | string[],
): Promise<void> {
  const stateBlob = await bb.sdk.files
    .read({ path: statePath })
    .then((file) => file.content)
    .catch(() => "");
  if (stateBlob.includes("current_stage:") && ownsWorkflowState(stateBlob, workflowId)) {
    return;
  }
  const gates = normalizeReviewGates(reviewMode);
  const rung = legacyLabelForGates(gates) ?? "Auto";
  const body = STATE_TEMPLATE.replace("<workflow-id>", workflowId)
    .replace("<workflow-name>", name)
    .replace(
      "<new-product|feature|bugfix|refactor|investigate|unknown>",
      intent,
    );
  writeFileSync(
    statePath,
    body
      .replace("appetite: Core", `appetite: ${appetite}`)
      .replace(
        "review_mode: Auto",
        `review_gates: ${formatReviewGates(gates)}\n  review_mode: ${rung}`,
      ),
    "utf8",
  );
}

/** Install the vendored transitions contract when the workspace lacks it. */
function installTransitions(transitionsPath: string): void {
  if (existsSync(transitionsPath)) return;
  writeFileSync(transitionsPath, readFileSync(TRANSITIONS_REF, "utf8"), "utf8");
}

/** Point the tracking entry at the fresh triage stage and persist it. */
function trackSeededWorkflow(
  trackingData: LooseRecord,
  rootPath: string,
  workflowId: string,
  name: string,
  dirHash: string,
  created: string,
  appetite: string,
  reviewMode: string | string[],
): void {
  const at = new Date().toISOString();
  const gates = normalizeReviewGates(reviewMode);
  trackingData.workflows = upsertWorkflowEntry(
    trackingData.workflows as unknown[],
    {
      workflowId,
      name,
      description: "",
      status: "in-progress",
      cwd: rootPath,
      dirHash,
      created,
      updated: at,
      stage: {
        current_stage: "triage",
        previous_stage: null,
        transitioned_at: at,
        history: [{ stage: "triage", entered_at: at }],
      },
      phases: [],
      config: {
        appetite,
        review_mode: legacyLabelForGates(gates) ?? "Auto",
        review_gates: gates,
      },
    },
  );
}

export async function seedWorkflow(
  bb: BbPluginApi,
  rootPath: string,
  workflowId: string,
  name: string,
  intent: string,
  appetite = "Core",
  reviewMode: string | string[] = "Auto",
  fresh = false,
): Promise<SeedResult> {
  const transitionsPath = join(rootPath, `${ORCHESTRATOR_REFERENCES}/transitions.md`);
  const trackingPath = join(rootPath, "stelow.json");
  try {
    prepareWorkspace(rootPath);
    ignoreRuntimeState(rootPath);
    const trackingData = readTracking(trackingPath);
    const workflows = trackingData.workflows as unknown[];
    const entry = workflowEntryForOwner(workflows, workflowId);
    const existing = await existingSeed(
      bb,
      rootPath,
      workflowId,
      entry,
      fresh,
    );
    if (existing) return existing;
    const dirHash = workflowDirHash(workflowId, fresh);
    const created = text(record(entry).created) || new Date().toISOString();
    const relativeDir = workflowStateRelativeDir({ created, dirHash });
    if (!relativeDir) {
      return {
        statePath: null,
        stateDir: null,
        dirHash: null,
        error: "Unable to derive the workflow state directory.",
      };
    }
    const stateDir = join(rootPath, relativeDir);
    mkdirSync(stateDir, { recursive: true });
    const statePath = join(stateDir, "state.md");
    await writeStateFile(
      bb,
      statePath,
      workflowId,
      name,
      intent,
      appetite,
      reviewMode,
    );
    installTransitions(transitionsPath);
    trackSeededWorkflow(
      trackingData,
      rootPath,
      workflowId,
      name,
      dirHash,
      created,
      appetite,
      reviewMode,
    );
    writeFileSync(trackingPath, JSON.stringify(trackingData, null, 2), "utf8");
    return { statePath, stateDir, dirHash, error: null };
  } catch (error) {
    return {
      statePath: null,
      stateDir: null,
      dirHash: null,
      error:
        error instanceof Error ? error.message : "Unable to seed workflow.",
    };
  }
}
