import { dirname, join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  buildCardNamePrompt,
  buildDraftPrompt,
  resolveDraftPreset,
  validateCardName,
  validateDraftOutput,
} from "../lib/draft-burst.mjs";
import { bandForCardKindStage } from "../lib/preset-staleness.mjs";
import { workerEnvironment } from "./workers.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];
type ThreadEnvironment = SpawnArgs["environment"];

type DraftingPreset = {
  id: string;
  name: string;
  provider_id: string;
  model_id: string;
  reasoning_level: string;
  permission_mode: string;
  environment_kind: string;
  machine_id: string | null;
};

type DraftingParams = {
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: string;
  environmentKind: string;
  machineId: string | null;
};

type DraftingCard = WorkerCard;
type Workspace = { path: string; hostId: string | null };
type CliResult = { exitCode: number; stdout?: string; stderr?: string };
type DraftRequest = { cardId: string; brief: string; json: boolean };
type PresetResolution = { preset: DraftingPreset; source: "board" | "band" | null };

type DraftingDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  timestamp: () => string;
  getCard: (cardId: string) => DraftingCard | undefined;
  getCardByWorkerThread: (threadId: string) => DraftingCard | undefined;
  isArchivedCard: (card: DraftingCard) => boolean;
  cardWorkspace: (card: DraftingCard) => Promise<Workspace | null>;
  continuingEnvironment: (card: DraftingCard, fallback: ThreadEnvironment) => Promise<ThreadEnvironment>;
  getPreset: (presetId: string) => DraftingPreset | null;
  getPresetForBand: (band: string, cardId: string) => DraftingPreset;
  getGenerationPresetId: () => string | null;
  presetParams: (preset: DraftingPreset) => DraftingParams;
  spawnDisposable: (args: SpawnArgs, site: string) => Promise<{ id: string }>;
  stopThread: (threadId: string) => Promise<void>;
  comment: (cardId: string, body: string) => void;
  publish: (event: string, payload: { cardId: string }) => void;
  stateDir: (card: DraftingCard, workspace: Workspace) => Promise<string | null>;
  workspaceRelative: (rootPath: string, path: string) => string | null;
  sleep?: (delayMs: number) => Promise<void>;
};

const DRAFT_POLL_MS = 5_000;
const DRAFT_POLLS = 36;
const TITLE_POLL_MS = 5_000;
const TITLE_POLLS = 12;

function parseDraftArgs(args: string[], contextCardId?: string): DraftRequest | CliResult | null {
  if (args[0] !== "draft") return null;
  const rest = args.slice(1);
  let cardId = contextCardId;
  let brief: string | null = null;
  for (let index = 0; index < rest.length; index++) {
    if (rest[index] === "--prompt") {
      brief = rest[index + 1] ?? null;
      index++;
      continue;
    }
    if (rest[index] === "--card") {
      cardId = rest[index + 1];
      index++;
      continue;
    }
    if (rest[index] === "--json") continue;
    return { exitCode: 2, stderr: "Usage: bb stelow draft --prompt <brief> [--json] [--card <card_id>]" };
  }
  if (!cardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
  if (!brief?.trim()) return { exitCode: 2, stderr: "Pass --prompt <brief>: one disposable draft request (prose only, never protocol work)." };
  return { cardId, brief, json: rest.includes("--json") };
}

function permissionNote(params: DraftingParams): string {
  return params.permissionMode === "full"
    ? " (preset permission coerced full → accept-edits: drafts read, never write)"
    : "";
}

function executionArgs(params: DraftingParams, includeInputSources = false) {
  return {
    providerId: params.providerId,
    model: params.modelId,
    reasoningLevel: params.reasoningLevel as "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
    permissionMode: (params.permissionMode === "full" ? "accept-edits" : params.permissionMode) as "accept-edits" | "auto" | "full",
    ...(includeInputSources ? {
      executionInputSources: {
        providerId: "explicit" as const,
        model: "explicit" as const,
        reasoningLevel: "explicit" as const,
        permissionMode: "explicit" as const,
      },
    } : {}),
  };
}

function titleOf(card: DraftingCard): string {
  return card.display_name ?? card.name;
}

function resolveGenerationPreset(deps: DraftingDeps, card: DraftingCard): PresetResolution {
  const generationId = deps.getGenerationPresetId();
  const generation = generationId ? deps.getPreset(generationId) : null;
  const band = deps.getPresetForBand(bandForCardKindStage(card.kind, card.stage), card.id);
  const resolved = resolveDraftPreset({
    cardPin: null,
    boardDefault: generation?.id ?? null,
    bandFallback: band.id,
  });
  return {
    preset: resolved.presetId ? deps.getPreset(resolved.presetId) ?? band : band,
    source: resolved.presetId === generation?.id ? "board" : resolved.presetId ? "band" : null,
  };
}

async function environmentFor(
  deps: DraftingDeps,
  card: DraftingCard,
  workspace: Workspace,
  params: DraftingParams,
): Promise<ThreadEnvironment> {
  const source = workspace.hostId ? { path: workspace.path, hostId: workspace.hostId } : null;
  const fallback = source
    ? workerEnvironment(source, params, card.workspace_kind === "exploratory")
    : { type: "project-default" as const };
  return deps.continuingEnvironment(card, fallback);
}

async function waitForThread(
  deps: DraftingDeps,
  sleep: (delayMs: number) => Promise<void>,
  threadId: string,
  polls: number,
  pollMs: number,
): Promise<{ status: string; timedOut: boolean }> {
  for (let poll = 0; poll < polls; poll++) {
    await sleep(pollMs);
    const thread = await deps.bb.sdk.threads.get({ threadId }).catch(() => null);
    const status = (thread as { status?: unknown } | null)?.status;
    if (status === "idle" || status === "stopping" || status === "archived" || status === "deleted") {
      return { status: String(status), timedOut: false };
    }
    if (status === "failed" || status === "error" || poll === polls - 1) {
      return { status: String(status), timedOut: poll === polls - 1 };
    }
  }
  return { status: "timeout", timedOut: true };
}

async function readOutput(deps: DraftingDeps, threadId: string): Promise<string> {
  return deps.bb.sdk.threads.output({ threadId })
    .then((result) => result.output ?? "")
    .catch(() => "");
}

async function saveDraft(
  deps: DraftingDeps,
  card: DraftingCard,
  workspace: Workspace,
  resolution: PresetResolution,
  threadId: string,
  text: string,
): Promise<string | null> {
  const stamp = deps.timestamp();
  const stateDir = card.dir_hash ? await deps.stateDir(card, workspace).catch(() => null) : null;
  if (!stateDir) return null;
  const full = join(stateDir, `drafts/draft-${stamp}.md`);
  try {
    await deps.bb.sdk.files.mkdir({ path: dirname(full), rootPath: workspace.path, recursive: true });
    await deps.bb.sdk.files.write({
      path: full,
      content: `# Draft ${stamp} (${resolution.source})\n\nCard: ${titleOf(card)}\nThread: ${threadId}\nPreset: ${resolution.preset.name}\n\n${text}\n`,
    });
    return deps.workspaceRelative(workspace.path, full) ?? `drafts/draft-${stamp}.md`;
  } catch {
    return null;
  }
}

async function spawnDraft(
  deps: DraftingDeps,
  card: DraftingCard,
  environment: ThreadEnvironment,
  params: DraftingParams,
  brief: string,
): Promise<{ id: string }> {
  return deps.spawnDisposable({
    projectId: card.project_id,
    environment,
    visibility: "hidden",
    ...(card.worker_thread_id ? { lifecycleOwnerThreadId: card.worker_thread_id } : {}),
    title: `Stelow draft: ${titleOf(card)}`,
    ...executionArgs(params, true),
    prompt: buildDraftPrompt({ cardName: titleOf(card), brief }),
  }, "draft-burst");
}

async function finishDraft(
  deps: DraftingDeps,
  request: DraftRequest,
  card: DraftingCard,
  workspace: Workspace,
  resolution: PresetResolution,
  params: DraftingParams,
  thread: { id: string },
  output: string,
): Promise<CliResult> {
  const validated = validateDraftOutput(output);
  if (!validated.ok) return { exitCode: 1, stderr: validated.error ?? "Empty draft." };
  const draftPath = await saveDraft(deps, card, workspace, resolution, thread.id, validated.text);
  const fallbackNote = resolution.source === "band" ? " (generation preset unset — ran on the band preset)" : "";
  const recordNote = draftPath ? ` Record: ${draftPath}.` : "";
  const comment = `Draft burst (${resolution.preset.name}${fallbackNote}) — judge every word before using it.`
    + `${recordNote}${permissionNote(params)}`;
  deps.comment(card.id, comment);
  if (!request.json) return { exitCode: 0, stdout: validated.text };
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      draft: validated.text,
      truncated: validated.truncated ?? false,
      threadId: thread.id,
      path: draftPath,
      source: resolution.source,
    }, null, 2),
  };
}

async function runDraft(
  deps: DraftingDeps,
  sleep: (delayMs: number) => Promise<void>,
  request: DraftRequest,
): Promise<CliResult> {
  const card = deps.getCard(request.cardId);
  if (!card) return { exitCode: 2, stderr: `Unknown card "${request.cardId}".` };
  if (deps.isArchivedCard(card)) return { exitCode: 1, stderr: "This card is archived." };
  const resolution = resolveGenerationPreset(deps, card);
  const params = deps.presetParams(resolution.preset);
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path) return { exitCode: 1, stderr: "Workspace is unavailable." };
  const environment = await environmentFor(deps, card, workspace, params);
  let thread: { id: string };
  try {
    thread = await spawnDraft(deps, card, environment, params, request.brief);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { exitCode: 1, stderr: `Draft spawn failed: ${message}.${permissionNote(params)}` };
  }
  const completion = await waitForThread(deps, sleep, thread.id, DRAFT_POLLS, DRAFT_POLL_MS);
  if (completion.status === "failed" || completion.status === "error" || completion.timedOut) {
    await deps.stopThread(thread.id).catch(() => undefined);
    const outcome = completion.timedOut
      ? "still running after 3 minutes — stopped; do the draft yourself."
      : `ended with status ${completion.status} — do the draft yourself.`;
    return { exitCode: 1, stderr: `Draft thread ${thread.id} ${outcome}` };
  }
  const output = await readOutput(deps, thread.id);
  await deps.stopThread(thread.id).catch(() => undefined);
  return finishDraft(deps, request, card, workspace, resolution, params, thread, output);
}

async function spawnTitle(
  deps: DraftingDeps,
  card: DraftingCard,
  params: DraftingParams,
): Promise<{ id: string }> {
  return deps.spawnDisposable({
    projectId: card.project_id,
    environment: { type: "project-default" },
    visibility: "hidden",
    title: `Stelow title: ${titleOf(card)}`,
    ...executionArgs(params),
    input: [{
      type: "text",
      mentions: [],
      text: buildCardNamePrompt({ prompt: card.prompt, kind: card.kind }),
    }],
  }, "card-title");
}

async function suggestCardName(
  deps: DraftingDeps,
  sleep: (delayMs: number) => Promise<void>,
  cardId: string,
): Promise<void> {
  try {
    const card = deps.getCard(cardId);
    if (!card) return;
    const resolution = resolveGenerationPreset(deps, card);
    const params = deps.presetParams(resolution.preset);
    let thread: { id: string };
    try {
      thread = await spawnTitle(deps, card, params);
    } catch {
      return;
    }
    const completion = await waitForThread(deps, sleep, thread.id, TITLE_POLLS, TITLE_POLL_MS);
    if (completion.status === "failed" || completion.status === "error" || completion.timedOut) {
      await deps.stopThread(thread.id).catch(() => undefined);
      return;
    }
    const output = await readOutput(deps, thread.id);
    await deps.stopThread(thread.id).catch(() => undefined);
    const validated = validateCardName(output);
    const live = deps.getCard(cardId);
    if (!validated.ok || !validated.name || !live || titleOf(live) !== titleOf(card)) return;
    deps.db
      .prepare("UPDATE cards SET display_name = ?, updated_at = ? WHERE id = ?")
      .run(validated.name, deps.now(), cardId);
    deps.publish("card-state", { cardId });
  } catch {
    // Card creation already succeeded; title suggestion is always advisory.
  }
}

async function command(
  deps: DraftingDeps,
  sleep: (delayMs: number) => Promise<void>,
  args: string[],
  threadId?: string,
): Promise<CliResult | null> {
  const contextCard = threadId ? deps.getCardByWorkerThread(threadId) : undefined;
  const parsed = parseDraftArgs(args, contextCard?.id);
  if (!parsed) return null;
  if ("exitCode" in parsed) return parsed;
  return runDraft(deps, sleep, parsed);
}

export function createDraftingServer(deps: DraftingDeps) {
  const sleep = deps.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  return {
    command: (args: string[], threadId?: string) => command(deps, sleep, args, threadId),
    suggestCardName: (cardId: string) => suggestCardName(deps, sleep, cardId),
    draftDoneComment: async (cardId: string): Promise<{ ok: boolean; draft: string | null; error: string | null }> => {
      const card = deps.getCard(cardId);
      if (!card) return { ok: false, draft: null, error: "Card not found." };
      if (deps.isArchivedCard(card)) return { ok: false, draft: null, error: "This card is archived." };
      const result = await runDraft(deps, sleep, {
        cardId,
        brief: `Draft a concise, factual GitHub completion note for the card "${titleOf(card)}". State what was delivered and mention the card's outcome. Do not invent work or evidence.`,
        json: true,
      });
      if (result.exitCode !== 0 || !result.stdout) return { ok: false, draft: null, error: result.stderr ?? "Draft failed." };
      try {
        const parsed = JSON.parse(result.stdout) as { draft?: unknown };
        return typeof parsed.draft === "string" && parsed.draft.trim()
          ? { ok: true, draft: parsed.draft, error: null }
          : { ok: false, draft: null, error: "Draft returned no text." };
      } catch {
        return { ok: false, draft: null, error: "Draft returned invalid output." };
      }
    },
  };
}
