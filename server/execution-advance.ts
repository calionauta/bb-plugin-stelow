import { advanceExecutionGates } from "../lib/build-gates.mjs";
import { isDoneStatus } from "../lib/trackables.mjs";
import { buildRegistry, canStart, dependencyCycles } from "../lib/trackable-relations.mjs";
import { STAGE_TO_BAND } from "../lib/workflow-vocabulary.mjs";
import type { ExecutionNative, ExecutionRouteInfo } from "./execution-native.js";
import type { WorkerCard } from "./workers-types.js";
import { latestSpecTech, loadCardScopes } from "./scopes.js";

type Workspace = { path: string; hostId: string | null };
type HelperResult = { code: number | null; stdout: string; stderr: string };
type AdvanceCardResult = { ok: boolean; stdout: string; error: string | null };
type CliResult = { exitCode: number; stdout?: string; stderr?: string };
type CliContext = { threadId?: string | null; projectId?: string | null };
type PreparedAdvance = {
  route: ExecutionRouteInfo | null;
  note: string;
  evidence: string;
};

type AdvanceDeps = {
  errors: { cardNotFound: string; cardArchived: string; workspaceUnavailable: string };
  getCard: (cardId: string) => WorkerCard | undefined;
  getCardByWorkerThread: (threadId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  projectRoot: (projectId: string | null) => Promise<string | null>;
  stateDir: (card: WorkerCard, rootPath: string) => Promise<string | null>;
  ensureArtifacts: (rootPath: string, stateDir: string | null, requireOwnedState: boolean) => Promise<string | null>;
  questionGate: (card: WorkerCard, stateDir: string | null) => Promise<string | null>;
  runHelper: (args: string[], rootPath: string, stateDir?: string) => Promise<HelperResult>;
  native: ExecutionNative;
  reworkNote: (card: WorkerCard) => Promise<string>;
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  recordStageEvent: (cardId: string, stage: string) => void;
  recordExecutionEntry: (cardId: string, evidence: string, transition: "execution-refused" | "execution-entered") => void;
  getReliablePreset: (band: string, cardId: string) => { id: string } | null;
  getCardPresetId: (cardId: string) => string;
  respawn: (cardId: string, presetId: string) => Promise<unknown>;
  scheduleRespawn: (cardId: string, presetId: string) => void;
  requestGatePreReview: (cardId: string, stage: string) => Promise<void>;
  publishCard: (cardId: string) => void;
  isArchivedCard: (card: WorkerCard) => boolean;
};

export function createExecutionAdvance(deps: AdvanceDeps) {
  function recordExecution(
    cardId: string,
    evidence: string,
    transition: "execution-refused" | "execution-entered",
  ): void {
    try { deps.recordExecutionEntry(cardId, evidence, transition); }
    catch { /* trail never blocks a stage transition */ }
  }

  async function syncExecutionScopes(
    card: WorkerCard,
    rootPath: string,
    stateDir: string | null,
  ): Promise<{ syncedCount: number | null; refusal: string | null; note: string }> {
    let syncedCount: number | null = null;
    try {
      const sync = await deps.runHelper(["sync-scopes", "--json"], rootPath, stateDir ?? undefined);
      const parsed = JSON.parse(sync.stdout || "{}") as { synced?: unknown };
      if (typeof parsed.synced === "number") syncedCount = parsed.synced;
    } catch { /* best-effort; the gate below remains authoritative */ }
    if (card.kind !== "build") return { syncedCount, refusal: null, note: "" };
    const scopes = loadCardScopes(rootPath, card.id);
    const spec = latestSpecTech(rootPath, card.id)?.content ?? null;
    const registry = buildRegistry(scopes, { defaultKind: "scope" });
    const pending = scopes.filter((scope) => scope.status === "pending");
    const gate = advanceExecutionGates({
      kind: card.kind,
      stage: "execution",
      specContent: spec,
      syncedCount: scopes.length,
      cycles: dependencyCycles(registry),
      hasUnstartablePending: pending.length > 0
        && !pending.some((scope) => canStart(registry, scope.id, isDoneStatus)),
    });
    const syncNote = syncedCount !== null && syncedCount > 0
      ? `\n(sync-scopes: synced ${syncedCount} scopes)`
      : "";
    const note = `${syncNote}${gate.note ? `\n(${gate.note})` : ""}`;
    return { syncedCount, refusal: gate.refusal, note };
  }

  async function prepareAdvance(input: {
    card: WorkerCard;
    stage: string;
    rootPath: string;
    stateDir: string | null;
    dryRun: boolean;
    includeRework: boolean;
  }): Promise<PreparedAdvance | { error: string }> {
    if (input.dryRun) return { route: null, note: "", evidence: "" };
    let note = "";
    let syncedCount: number | null = null;
    if (input.stage === "execution") {
      const loopNote = input.includeRework ? await deps.reworkNote(input.card) : "";
      const scopes = await syncExecutionScopes(input.card, input.rootPath, input.stateDir);
      syncedCount = scopes.syncedCount;
      if (scopes.refusal) {
        recordExecution(input.card.id, scopes.refusal, "execution-refused");
        return { error: scopes.refusal };
      }
      note = `${scopes.note}${loopNote}`;
    }
    const route = await deps.native.resolveStageExecutionRoute(input.card, input.stage, input.rootPath);
    if (route?.route.mode === "refused") {
      return { error: route.route.redirect ?? route.route.reason ?? "Execution route refused." };
    }
    const evidence = input.stage === "execution"
      ? `${syncedCount ?? 0} synced scope(s)`
      : "execution preflight passed";
    return { route, note, evidence };
  }

  async function dispatchAdvance(input: {
    card: WorkerCard;
    stage: string;
    route: ExecutionRouteInfo | null;
    note: string;
    evidence: string;
  }): Promise<{ stdout: string; error: string | null }> {
    if (input.stage === "execution") {
      recordExecution(input.card.id, input.evidence || "execution preflight passed", "execution-entered");
    }
    if (input.route?.route.mode === "coordinator-sequential") {
      deps.native.recordCoordinatorSequentialRoute(
        input.card.id,
        input.stage,
        input.route.recipeId,
        input.route.route,
      );
      return { stdout: `${input.note}\n(coordinator-sequential fallback selected)`.trim(), error: null };
    }
    if (input.route?.route.mode === "native") {
      const started = await deps.native.startNativeStageForCard(
        input.card,
        input.route.recipeId,
        { prompt: input.card.prompt },
        input.stage,
      );
      if (started.run) {
        const dispatchNote = started.ok
          ? `\n(native run: ${started.run.runId})`
          : `\n(native execution deferred: ${started.error ?? "unavailable"})`;
        return { stdout: `${input.note}${dispatchNote}`.trim(), error: null };
      }
    }
    return { stdout: input.note, error: null };
  }

  async function applyBand(card: WorkerCard, stage: string, deferred: boolean): Promise<void> {
    const band = STAGE_TO_BAND[stage];
    if (!band) return;
    const preset = deps.getReliablePreset(band, card.id);
    const currentPresetId = card.worker_preset_id ?? deps.getCardPresetId(card.id);
    if (!preset || preset.id === currentPresetId) return;
    if (deferred) deps.scheduleRespawn(card.id, preset.id);
    else await deps.respawn(card.id, preset.id);
  }

  async function advanceCard({ cardId, stage }: { cardId: string; stage: string }): Promise<AdvanceCardResult> {
    const card = deps.getCard(cardId);
    if (!card) return { ok: false, stdout: "", error: deps.errors.cardNotFound };
    if (deps.isArchivedCard(card)) return { ok: false, stdout: "", error: deps.errors.cardArchived };
    if (card.kind === "research") {
      return { ok: false, stdout: "", error: "Research cards don't use stages — a completed index moves them to Done automatically." };
    }
    if (card.kind === "explore") {
      return { ok: false, stdout: "", error: "Explore cards don't use stages — a completed artifact moves them to Done automatically." };
    }
    const workspace = await deps.cardWorkspace(card);
    if (!workspace?.path) return { ok: false, stdout: "", error: deps.errors.workspaceUnavailable };
    const stateDir = card.dir_hash ? await deps.stateDir(card, workspace.path) : null;
    const guard = await deps.ensureArtifacts(workspace.path, stateDir, Boolean(card.dir_hash));
    if (guard) return { ok: false, stdout: "", error: guard };
    const questionGuard = await deps.questionGate(card, stateDir);
    if (questionGuard) return { ok: false, stdout: "", error: questionGuard };
    const prepared = await prepareAdvance({ card, stage, rootPath: workspace.path, stateDir, dryRun: false, includeRework: false });
    if ("error" in prepared) return { ok: false, stdout: "", error: prepared.error };
    const result = await deps.runHelper(["advance", stage], workspace.path, stateDir ?? undefined);
    if (result.code !== 0) return { ok: false, stdout: result.stdout, error: result.stderr || "stelow advance failed" };
    await applyBand(card, stage, false);
    deps.updateCard(cardId, { stage, status: stage === "triage" ? "draft" : "in-progress", activity: "running" });
    const dispatched = await dispatchAdvance({ card, stage, route: prepared.route, note: prepared.note, evidence: prepared.evidence });
    deps.publishCard(cardId);
    return { ok: true, stdout: result.stdout + dispatched.stdout, error: dispatched.error };
  }

  function parseCli(argv: string[], context: CliContext) {
    const args = argv.slice(1);
    const flag = (name: string) => {
      const index = args.indexOf(name);
      return index >= 0 ? args[index + 1] : undefined;
    };
    const projectId = flag("--project") ?? context.projectId ?? null;
    const dryRun = args.includes("--dry-run");
    const json = args.includes("--json");
    const stage = flag("--stage") ?? args.find((arg) => !arg.startsWith("--") && arg !== projectId);
    return { projectId, dryRun, json, stage };
  }

  async function advanceCli(argv: string[], context: CliContext): Promise<CliResult> {
    const parsed = parseCli(argv, context);
    if (!parsed.projectId || !parsed.stage) {
      return { exitCode: 2, stderr: "Usage: bb stelow advance [--project <proj_id>] [--dry-run] [--json] <stage>" };
    }
    const card = context.threadId ? deps.getCardByWorkerThread(context.threadId) : undefined;
    const workspace = card ? await deps.cardWorkspace(card) : null;
    const rootPath = workspace?.path ?? await deps.projectRoot(parsed.projectId);
    if (!rootPath) return { exitCode: 1, stderr: "Workspace path is unavailable." };
    const stateDir = card?.dir_hash ? await deps.stateDir(card, rootPath) : null;
    const guard = await deps.ensureArtifacts(rootPath, stateDir, Boolean(card?.dir_hash));
    if (guard) return { exitCode: 1, stderr: guard };
    if (!parsed.dryRun && card) {
      const questionGuard = await deps.questionGate(card, stateDir);
      if (questionGuard) return { exitCode: 1, stderr: questionGuard };
    }
    const prepared = card
      ? await prepareAdvance({
          card,
          stage: parsed.stage,
          rootPath,
          stateDir,
          dryRun: parsed.dryRun,
          includeRework: true,
        })
      : { route: null, note: "", evidence: "" };
    if (prepared && "error" in prepared) return { exitCode: 1, stderr: prepared.error };
    const helperArgs = ["advance", parsed.stage, ...(parsed.dryRun ? ["--dry-run"] : []), ...(parsed.json ? ["--json"] : [])];
    const result = await deps.runHelper(helperArgs, rootPath, stateDir ?? undefined);
    if (result.code !== 0) {
      return { exitCode: result.code ?? 1, stderr: result.stderr || "advance failed", stdout: result.stdout };
    }
    if (parsed.dryRun || !card) return { exitCode: 0, stdout: result.stdout };
    await applyBand(card, parsed.stage, true);
    deps.updateCard(card.id, { stage: parsed.stage, status: "in-progress", activity: "running", last_error: null });
    deps.recordStageEvent(card.id, parsed.stage);
    const dispatched = await dispatchAdvance({ card, stage: parsed.stage, route: prepared.route, note: prepared.note, evidence: prepared.evidence });
    void deps.requestGatePreReview(card.id, parsed.stage).catch(() => undefined);
    return { exitCode: 0, stdout: result.stdout + dispatched.stdout };
  }

  return { handlers: { advanceCard }, cli: advanceCli };
}

export type ExecutionAdvance = ReturnType<typeof createExecutionAdvance>;
