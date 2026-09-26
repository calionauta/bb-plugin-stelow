/**
 * The artifact rule. A native run that reports success has proved nothing about
 * the card: the artifacts it wrote in staging are the claim, and the run is only
 * done once the recipe's required outputs validate AND the worker has written
 * the registration receipt naming them. Missing, malformed, and unregistered are
 * three different stalls with three different messages, so they stay three rules
 * rather than one "artifacts failed" branch.
 *
 * Two deliberate stops are read before validation, because a run that NAMED a
 * decision did the right thing: recording it as a malformed artifact parked the
 * card in "Working" with the question nowhere on screen. A human stop becomes
 * `needs_input` with the question on the card; an Interface Contrast receipt
 * becomes a route note on the registration request.
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
import { humanStopMessage, humanStopRequest } from "../lib/execution-human-stop.mjs";
import { resolveInterfaceContrastRoute } from "../lib/interface-contrast.mjs";
import { recipeById } from "../lib/recipe-catalog.mjs";
import type { CardNotifier } from "./execution-reconcile-deps.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type HumanStop = { question: string; route: string };

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
  const contents = await readArtifactContents(deps, run, paths);
  const stop = humanStopFrom(contents);
  if (stop) {
    await recordHumanStop(deps, card, run, stop);
    return;
  }
  const validation = validateExecutionArtifacts({ recipe, contents, context });
  if (!validation.ok) {
    failArtifacts(deps, card, run, validation.missing, validation.malformed, validation.issues);
    return;
  }
  const route = interfaceRouteNote(run.recipeId, contents);
  if (route.error) {
    failInterfaceRoute(deps, card, run, route.error);
    return;
  }
  if (await registrationRecorded(deps, run, paths)) {
    completeRegistered(deps, card, run, paths);
    return;
  }
  if (!run.completionEventId) requestRegistration(deps, card, run, paths, route.note);
}

/**
 * A run that named a decision is `needs_input`, not `failed`. Recording the
 * question on the card is what makes the wait honest: the person can see what is
 * being asked instead of watching a spinner.
 */
async function recordHumanStop(
  deps: ArtifactDeps,
  card: WorkerCard,
  run: ExecutionRun,
  stop: HumanStop,
): Promise<void> {
  const boundaryId = `human-stop:${run.id}`;
  transitionExecutionRun(deps.db, run.id, "needs_input", {
    nativeStatus: run.nativeStatus,
    boundaryId,
    boundaryQuestion: stop.question,
  });
  deps.logComment(
    card.id,
    run.id,
    `Native ${run.recipeId} stopped to ask a decision (${stop.route}); it is waiting, not failed. Question: ${stop.question}`,
  );
  deps.notify.sendToCard(
    card,
    [
      humanStopMessage(stop),
      `Ask it on the card with the structured question tool, include the marker [Stelow boundary ${boundaryId}] in the question text, then stop.`,
      "Do not resume the run yourself and do not advance the card.",
    ].join(" "),
  );
}

/** The first JSON artifact that reads as a deliberate human stop wins. */
function humanStopFrom(contents: Record<string, string>): HumanStop | null {
  for (const [path, text] of Object.entries(contents)) {
    if (!path.endsWith(".json") || typeof text !== "string" || !text.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const stop = humanStopRequest(path, parsed);
    if (stop.stop) return stop;
  }
  return null;
}

function interfaceRouteNote(
  recipeId: string,
  contents: Record<string, string>,
): { note: string; error: string | null } {
  if (recipeId !== "interface-contrast") return { note: "", error: null };
  try {
    const receipt = JSON.parse(contents["interfaces/contrast.json"]) as unknown;
    const route = resolveInterfaceContrastRoute(receipt);
    const stale = route.staleArtifacts.join(", ") || "none";
    return {
      note: `Interface Contrast route: ${route.destination}; stale artifacts: ${stale}.`,
      error: null,
    };
  } catch (error) {
    return {
      note: "",
      error: error instanceof Error ? error.message : "Interface Contrast route is invalid.",
    };
  }
}

function failInterfaceRoute(
  deps: ArtifactDeps,
  card: WorkerCard,
  run: ExecutionRun,
  error: string,
): void {
  transitionExecutionRun(deps.db, run.id, "failed", {
    nativeStatus: run.nativeStatus,
    errorCode: "invalid-interface-route",
  });
  deps.logComment(
    card.id,
    run.id,
    `Native interface-contrast produced an invalid route: ${error}.`,
  );
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
  issues: string[] = [],
): void {
  transitionExecutionRun(deps.db, run.id, "failed", {
    errorCode: missing.length > 0 ? "artifact-missing" : "artifact-malformed",
  });
  const evidence = `Missing: ${missing.join(", ") || "none"}. Malformed: ${malformed.join(", ") || "none"}.`;
  // Name the FIELDS, not just the file: "malformed: contrast.json" costs a
  // whole run and tells the worker nothing it can act on.
  const detail = issues.length > 0 ? ` Problems: ${issues.join("; ")}.` : "";
  deps.logComment(
    card.id,
    run.id,
    `Native ${run.recipeId} failed artifact validation. ${evidence}${detail}`,
  );
  deps.notify.sendToCard(
    card,
    `The native ${run.recipeId} run finished but its required artifacts are not valid. `
    + `Do not advance the card. ${evidence}${detail}`,
  );
}

function requestRegistration(
  deps: ArtifactDeps,
  card: WorkerCard,
  run: ExecutionRun,
  paths: string[],
  note = "",
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
  deps.notify.sendToCard(card, registrationRequest(run, paths, note));
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

function registrationRequest(run: ExecutionRun, paths: string[], note = ""): string {
  return [
    `The native ${run.recipeId} run produced validated staging artifacts under ${run.artifactRoot}.`,
    "Register them at their canonical paths, then write",
    `${join(run.artifactRoot, ".registered.json")} with `
    + `{"runId":"${run.id}","outputs":${JSON.stringify(paths)}}.`,
    "Do not advance the card before that receipt exists.",
    note,
  ].join(" ");
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
