import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  getExecutionRun,
  listExecutionRuns,
  markExecutionNeedsInputSent,
  transitionExecutionRun,
  type ExecutionRun,
} from "../lib/execution-run-ledger.mjs";
import { isArchivedCard } from "../lib/worker-action-policy.mjs";
import { nativeNeedsInput } from "./bb-workflow-bridge.js";
import { requiredOutputPaths, validateExecutionArtifacts } from "../lib/execution-artifacts.mjs";
import { resolveInterfaceContrastRoute } from "../lib/interface-contrast.mjs";
import { humanStopRequest, humanStopMessage } from "../lib/execution-human-stop.mjs";
import { recipeById } from "../lib/recipe-catalog.mjs";
import { boundaryRunPatch } from "./execution-boundary.js";
import type { ExecutionLifecycle } from "./execution-lifecycle.js";
import type { ExecutionNative } from "./execution-native.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type PendingQuestion = { question: string };
type ReconcileResult = { run: ExecutionRun | null; error: string | null };
type Boundary = Record<string, unknown> & { question: string; questionId: string | null };

type ReconcileDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  randomId: (prefix: string) => string;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string } | null>;
  fetchPendingQuestions: (threadId: string | null) => Promise<PendingQuestion[]>;
  logComment: (cardId: string, targetId: string, body: string) => void;
  publishCard: (cardId: string) => void;
  native: ExecutionNative;
  lifecycle: Pick<ExecutionLifecycle, "stopOwned">;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function runKey(run: ExecutionRun | null): string {
  if (!run) return "missing";
  return [
    run.normalizedStatus,
    run.runId ?? "",
    run.completionEventId ?? "",
    run.needsInputSentAt ?? "",
    run.boundaryId ?? "",
  ].join(":");
}

export function createExecutionReconcile(deps: ReconcileDeps) {
  let inFlight = false;

  function sendToCard(card: WorkerCard, text: string): void {
    if (!card.worker_thread_id) return;
    void deps.bb.sdk.threads.send({
      threadId: card.worker_thread_id,
      mode: "auto",
      input: [{ type: "text", text, mentions: [] }],
    }).catch(() => undefined);
  }

  async function reconcileBoundary(
    run: ExecutionRun,
    card: WorkerCard,
    boundary: Boundary,
  ): Promise<void> {
    if (run.normalizedStatus !== "needs_input") {
      const boundaryId = deps.randomId("boundary");
      const boundaryPatch = boundaryRunPatch(boundary, boundaryId);
      if (boundaryPatch.issues.length) {
        transitionExecutionRun(deps.db, run.id, "failed", {
          nativeStatus: run.nativeStatus,
          errorCode: "invalid-native-boundary",
        });
        deps.logComment(
          card.id,
          run.id,
          `Native ${run.recipeId} returned an invalid human boundary: ${boundaryPatch.issues.join("; ")}.`,
        );
        return;
      }
      run = transitionExecutionRun(deps.db, run.id, "needs_input", {
        nativeStatus: run.nativeStatus,
        ...boundaryPatch.patch,
      });
      deps.logComment(
        card.id,
        run.id,
        `Native ${run.recipeId} run needs input. Boundary: ${boundaryPatch.patch.boundaryQuestion}`,
      );
      sendToCard(
        card,
        [
          `The native ${run.recipeId} run is waiting for input.`,
          "Ask this exact question on the card with the structured question tool,",
          `include the marker [Stelow boundary ${boundaryId}] in the question text, then stop.`,
          `Do not invent an answer or resume the run yourself: ${boundaryPatch.patch.boundaryQuestion}`,
        ].join(" "),
      );
    } else if (!run.needsInputSentAt) {
      sendToCard(
        card,
        [
          `Create the pending card question for native ${run.recipeId}`,
          `and include the marker [Stelow boundary ${run.boundaryId}].`,
          "Do not resume until it is answered.",
        ].join(" "),
      );
    }
    const pending = await deps.fetchPendingQuestions(card.worker_thread_id);
    const marker = run.boundaryId;
    if (marker && pending.some((question) => question.question.includes(`[Stelow boundary ${marker}]`))) {
      markExecutionNeedsInputSent(deps.db, run.id);
    }
  }

  async function readArtifactContents(run: ExecutionRun, paths: string[]): Promise<Record<string, string>> {
    const entries = await Promise.all(paths.map(async (path) => {
      const file = await deps.bb.sdk.files.read({ path: join(run.artifactRoot, path) }).catch(() => null);
      return [path, file?.content ?? ""] as const;
    }));
    return Object.fromEntries(entries);
  }

  function registrationRecorded(
    run: ExecutionRun,
    paths: string[],
  ): Promise<boolean> {
    return deps.bb.sdk.files.read({ path: join(run.artifactRoot, ".registered.json") })
      .then((file) => {
        try {
          const receipt = record(JSON.parse(file.content));
          const outputs = Array.isArray(receipt.outputs) ? receipt.outputs.filter((path): path is string => typeof path === "string") : [];
          if (receipt.runId !== run.id) return false;
          const registered = new Set(outputs);
          return paths.every((path) => registered.has(path));
        } catch {
          return false;
        }
      })
      .catch(() => false);
  }

  function failArtifacts(card: WorkerCard, run: ExecutionRun, missing: string[], malformed: string[], issues: string[] = []): void {
    transitionExecutionRun(deps.db, run.id, "failed", {
      errorCode: missing.length > 0 ? "artifact-missing" : "artifact-malformed",
    });
    const evidence = `Missing: ${missing.join(", ") || "none"}. Malformed: ${malformed.join(", ") || "none"}.`;
    // Name the FIELDS, not just the file: "malformed: contrast.json" costs a
    // whole run and tells the worker nothing it can act on.
    const detail = issues.length > 0 ? ` Problems: ${issues.join("; ")}.` : "";
    deps.logComment(card.id, run.id, `Native ${run.recipeId} failed artifact validation. ${evidence}${detail}`);
    sendToCard(
      card,
      `The native ${run.recipeId} run finished but its required artifacts are not valid. Do not advance the card. ${evidence}${detail}`,
    );
  }

  function requestRegistration(
    card: WorkerCard,
    run: ExecutionRun,
    paths: string[],
    note = "",
  ): void {
    transitionExecutionRun(deps.db, run.id, run.normalizedStatus, {
      nativeStatus: run.nativeStatus,
      completionEventId: `registration-requested:${run.id}`,
    });
    deps.logComment(card.id, run.id, `Native ${run.recipeId} artifacts validated in staging; registration receipt requested for ${paths.join(", ")}.`);
    sendToCard(
      card,
      [
        `The native ${run.recipeId} run produced validated staging artifacts under ${run.artifactRoot}.`,
        "Register them at their canonical paths, then write",
        `${join(run.artifactRoot, ".registered.json")} with {"runId":"${run.id}","outputs":${JSON.stringify(paths)}}.`,
        "Do not advance the card before that receipt exists.",
        note,
      ].join(" "),
    );
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

  function humanStopFrom(contents: Record<string, string>) {
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

  /**
   * A run that named a decision is `needs_input`, not `failed`. Recording the
   * question on the card is what makes the wait honest: the person can see
   * what is being asked instead of watching a spinner.
   */
  async function recordHumanStop(card: WorkerCard, run: ExecutionRun, stop: { question: string; route: string }): Promise<void> {
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
    sendToCard(
      card,
      [
        humanStopMessage(stop),
        `Ask it on the card with the structured question tool, include the marker [Stelow boundary ${boundaryId}] in the question text, then stop.`,
        "Do not resume the run yourself and do not advance the card.",
      ].join(" "),
    );
  }

  async function reconcileArtifacts(card: WorkerCard, run: ExecutionRun): Promise<void> {
    const recipe = recipeById(run.recipeId);
    if (!recipe) return;
    const context = record(record(JSON.parse(run.argsText)).context);
    const paths = requiredOutputPaths(recipe, context);
    const contents = await readArtifactContents(run, paths);
    // A run that stopped to NAME a decision did the right thing. Checking
    // this before artifact validation keeps a deliberate stop from being
    // recorded as a malformed artifact, which parked the card in "Working"
    // with the question nowhere on screen.
    const stop = humanStopFrom(contents);
    if (stop) {
      await recordHumanStop(card, run, stop);
      return;
    }
    const validation = validateExecutionArtifacts({ recipe, contents, context });
    if (!validation.ok) {
      failArtifacts(card, run, validation.missing, validation.malformed, validation.issues);
      return;
    }
    const route = interfaceRouteNote(run.recipeId, contents);
    if (route.error) {
      transitionExecutionRun(deps.db, run.id, "failed", {
        nativeStatus: run.nativeStatus,
        errorCode: "invalid-interface-route",
      });
      deps.logComment(
        card.id,
        run.id,
        `Native interface-contrast produced an invalid route: ${route.error}.`,
      );
      return;
    }
    if (await registrationRecorded(run, paths)) {
      deps.logComment(card.id, run.id, `Native ${run.recipeId} completed with registered artifacts: ${paths.join(", ")}.`);
      transitionExecutionRun(deps.db, run.id, "succeeded", {
        nativeStatus: run.nativeStatus,
        completionEventId: `registered:${run.id}`,
      });
    } else if (!run.completionEventId) {
      requestRegistration(card, run, paths, route.note);
    }
  }

  function reconcileSimpleState(
    card: WorkerCard,
    run: ExecutionRun,
    state: "queued" | "running" | "failed" | "cancelled",
  ): void {
    if (state === run.normalizedStatus) return;
    transitionExecutionRun(deps.db, run.id, state, {
      nativeStatus: state,
      errorCode: state === "failed" ? "unknown-native-state" : null,
    });
    if (state === "failed") {
      deps.logComment(
        card.id,
        run.id,
        `Native ${run.recipeId} failed with native status ${run.nativeStatus}. The card remains available for retry.`,
      );
    }
  }

  async function reconcileOne(runId: string): Promise<ReconcileResult> {
    let run = getExecutionRun(deps.db, runId);
    if (!run) return { run: null, error: "Execution run not found." };
    if (["succeeded", "failed", "cancelled"].includes(run.normalizedStatus)) {
      return { run, error: null };
    }
    if (!run.runId) {
      if (deps.now() - run.createdAt > 60_000) {
        run = transitionExecutionRun(deps.db, run.id, "failed", { errorCode: "native-start-timeout" });
      }
      return { run, error: null };
    }
    const card = deps.getCard(run.cardId);
    if (!card?.worker_thread_id) return { run, error: null };
    const before = runKey(run);
    try {
      const native = await deps.native.adapterFor(run).status({ runId: run.runId });
      const normalized = native.state;
      if (normalized === "needs_input") {
        await reconcileBoundary(run, card, nativeNeedsInput(native) ?? {
          question: `The ${run.recipeId} workflow needs a human decision before it can continue.`,
          questionId: null,
        });
      } else {
        const boundary = nativeNeedsInput(native);
        if (boundary) {
          await reconcileBoundary(run, card, boundary);
        } else if (normalized === "succeeded" && run.normalizedStatus !== "needs_input") {
          run = getExecutionRun(deps.db, run.id) ?? run;
          await reconcileArtifacts(card, run);
        } else if (normalized === "queued" || normalized === "running" || normalized === "failed" || normalized === "cancelled") {
          reconcileSimpleState(card, run, normalized);
        }
      }
      const current = getExecutionRun(deps.db, run.id);
      if (current && runKey(current) !== before) deps.publishCard(current.cardId);
      return { run: current, error: null };
    } catch (error) {
      return { run, error: error instanceof Error ? error.message : "Unable to reconcile native execution." };
    }
  }

  async function reconcileStageEntries(): Promise<void> {
    const cards = deps.db.prepare(
      "SELECT id FROM cards WHERE worker_thread_id IS NOT NULL AND status NOT IN ('completed','archived','blocked')",
    ).all() as Array<{ id: string }>;
    for (const { id } of cards) {
      const card = deps.getCard(id);
      if (!card?.worker_thread_id) continue;
      const workspace = await deps.cardWorkspace(card).catch(() => null);
      if (!workspace?.path) continue;
      const route = await deps.native.resolveStageExecutionRoute(card, card.stage, workspace.path);
      if (!route || route.route.mode === "refused") continue;
      if (route.route.mode === "coordinator-sequential") {
        deps.native.recordCoordinatorSequentialRoute(card.id, card.stage, route.recipeId, route.route);
        deps.publishCard(card.id);
        continue;
      }
      const existing = listExecutionRuns(deps.db, card.id)
        .some((run) => run.stage === card.stage && run.recipeId === route.recipeId);
      if (existing) continue;
      const started = await deps.native.startNativeStageForCard(
        card,
        route.recipeId,
        { prompt: card.prompt },
        card.stage,
      ).catch(() => null);
      if (started?.run) deps.publishCard(card.id);
    }
  }

  async function reconcileRuns(): Promise<void> {
    const cards = deps.db.prepare(
      "SELECT DISTINCT card_id FROM execution_runs WHERE normalized_status IN ('queued','running','needs_input')",
    ).all() as Array<{ card_id: string }>;
    for (const { card_id: cardId } of cards) {
      const card = deps.getCard(cardId);
      if (!card || isArchivedCard(card)) {
        await deps.lifecycle.stopOwned(cardId, "origin-unavailable");
        continue;
      }
      const active = listExecutionRuns(deps.db, cardId)
        .filter((run) => ["queued", "running", "needs_input"].includes(run.normalizedStatus));
      for (const run of active) await reconcileOne(run.id);
    }
  }

  async function reconcile(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      await reconcileRuns();
      await reconcileStageEntries();
    } finally {
      inFlight = false;
    }
  }

  return {
    reconcile,
    reconcileOne,
    handlers: {
      executionRunStatus: async ({ runId }: { runId: string }) => reconcileOne(runId),
    },
  };
}

export type ExecutionReconcile = ReturnType<typeof createExecutionReconcile>;
