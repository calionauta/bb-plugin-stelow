/**
 * The artifact rule. A native run that reports success has proved nothing about
 * the card: the artifacts it wrote in staging are the claim, and the run is only
 * done once the recipe's required outputs validate AND the worker has written
 * the registration receipt naming them. Missing, malformed, and unregistered are
 * three different stalls with three different messages, so they stay three rules
 * rather than one "artifacts failed" branch.
 *
 * Module-level over the dependency slice, for the same reason as the boundary
 * rule: a test drives the rule with a stub host, not with a whole reconciler.
 */
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  transitionExecutionRun,
  type ExecutionRun,
} from "../lib/execution-run-ledger.mjs";
import { requiredOutputPaths, validateExecutionArtifacts } from "../lib/execution-artifacts.mjs";
import { recipeById } from "../lib/recipe-catalog.mjs";
import type { CardNotifier } from "./execution-reconcile-deps.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type ArtifactDeps = {
  db: Db;
  bb: BbPluginApi;
  logComment: (cardId: string, targetId: string, body: string) => void;
  notify: CardNotifier;
};

export function createArtifactReconciler(deps: ArtifactDeps) {
  return {
    reconcileArtifacts: (card: WorkerCard, run: ExecutionRun) =>
      reconcileArtifacts(deps, card, run),
  };
}

export async function reconcileArtifacts(
  deps: ArtifactDeps,
  card: WorkerCard,
  run: ExecutionRun,
): Promise<void> {
  const recipe = recipeById(run.recipeId);
  if (!recipe) return;
  const context = record(record(JSON.parse(run.argsText)).context);
  const paths = requiredOutputPaths(recipe, context);
  const validation = validateExecutionArtifacts({
    recipe,
    contents: await readArtifactContents(deps, run, paths),
    context,
  });
  if (!validation.ok) {
    failArtifacts(deps, card, run, validation.missing, validation.malformed);
    return;
  }
  if (await registrationRecorded(deps, run, paths)) {
    completeRegistered(deps, card, run, paths);
    return;
  }
  if (!run.completionEventId) requestRegistration(deps, card, run, paths);
}

async function readArtifactContents(
  deps: ArtifactDeps,
  run: ExecutionRun,
  paths: string[],
): Promise<Record<string, string>> {
  const entries = await Promise.all(paths.map(async (path) => {
    const file = await deps.bb.sdk.files.read({ path: join(run.artifactRoot, path) })
      .catch(() => null);
    return [path, file?.content ?? ""] as const;
  }));
  return Object.fromEntries(entries);
}

function registrationRecorded(
  deps: ArtifactDeps,
  run: ExecutionRun,
  paths: string[],
): Promise<boolean> {
  return deps.bb.sdk.files.read({ path: join(run.artifactRoot, ".registered.json") })
    .then((file) => receiptNamesRun(file.content, run.id, paths))
    .catch(() => false);
}

function failArtifacts(
  deps: ArtifactDeps,
  card: WorkerCard,
  run: ExecutionRun,
  missing: string[],
  malformed: string[],
): void {
  transitionExecutionRun(deps.db, run.id, "failed", {
    errorCode: missing.length > 0 ? "artifact-missing" : "artifact-malformed",
  });
  const evidence = `Missing: ${missing.join(", ") || "none"}. Malformed: ${malformed.join(", ") || "none"}.`;
  deps.logComment(card.id, run.id, `Native ${run.recipeId} failed artifact validation. ${evidence}`);
  deps.notify.sendToCard(
    card,
    `The native ${run.recipeId} run finished but its required artifacts are not valid. `
    + `Do not advance the card. ${evidence}`,
  );
}

function requestRegistration(
  deps: ArtifactDeps,
  card: WorkerCard,
  run: ExecutionRun,
  paths: string[],
): void {
  transitionExecutionRun(deps.db, run.id, run.normalizedStatus, {
    nativeStatus: run.nativeStatus,
    completionEventId: `registration-requested:${run.id}`,
  });
  deps.logComment(
    card.id,
    run.id,
    `Native ${run.recipeId} artifacts validated in staging; registration receipt requested for ${paths.join(", ")}.`,
  );
  deps.notify.sendToCard(card, registrationRequest(run, paths));
}

function completeRegistered(
  deps: ArtifactDeps,
  card: WorkerCard,
  run: ExecutionRun,
  paths: string[],
): void {
  deps.logComment(
    card.id,
    run.id,
    `Native ${run.recipeId} completed with registered artifacts: ${paths.join(", ")}.`,
  );
  transitionExecutionRun(deps.db, run.id, "succeeded", {
    nativeStatus: run.nativeStatus,
    completionEventId: `registered:${run.id}`,
  });
}

/**
 * The receipt is the worker's own claim, so it is read defensively: an
 * unreadable or malformed receipt is an absent receipt, never a success.
 */
function receiptNamesRun(content: string, runId: string, paths: string[]): boolean {
  try {
    const receipt = record(JSON.parse(content));
    const outputs = Array.isArray(receipt.outputs)
      ? receipt.outputs.filter((path): path is string => typeof path === "string")
      : [];
    if (receipt.runId !== runId) return false;
    const registered = new Set(outputs);
    return paths.every((path) => registered.has(path));
  } catch {
    return false;
  }
}

function registrationRequest(run: ExecutionRun, paths: string[]): string {
  return [
    `The native ${run.recipeId} run produced validated staging artifacts under ${run.artifactRoot}.`,
    "Register them at their canonical paths, then write",
    `${join(run.artifactRoot, ".registered.json")} with `
    + `{"runId":"${run.id}","outputs":${JSON.stringify(paths)}}.`,
    "Do not advance the card before that receipt exists.",
  ].join(" ");
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
