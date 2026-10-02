/**
 * The card-briefing spawn: deterministic facts first, phrasing optional.
 *
 * The ordering is the design, not an optimisation. The facts come from
 * `lib/card-catch-up.mjs` and are computed before any model is considered; the
 * model then receives them as text and is allowed only to phrase them. Every
 * failure path — disabled, no preset, spawn failure, timeout, empty output —
 * degrades to the deterministic list, which already answers the question. There
 * is no path here that reports something the rows do not contain.
 *
 * It rides the generation tier through the same disposable spawner as draft
 * bursts: hidden, read-only, no writes, and it dies with the card's worker. The
 * caller gets facts and prose back; nothing is persisted and nothing advances.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  briefingResult,
  buildBriefingPrompt,
  commsDisabled,
  validateBriefingOutput,
  wireFacts,
} from "../../lib/card-briefing.mjs";
import { catchUpAnchor, catchUpFacts, catchUpSummary } from "../../lib/card-catch-up.mjs";
import { workerEnvironment } from "../workers.js";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];
type ThreadEnvironment = SpawnArgs["environment"];

type BriefingPreset = {
  id: string;
  name: string;
  provider_id: string;
  model_id: string;
  reasoning_level: string;
  permission_mode: string;
};

type BriefingParams = {
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: string;
  environmentKind: string;
  machineId: string | null;
};

type BriefingDeps = {
  db: Db;
  bb: BbPluginApi;
  getCard: (cardId: string) => WorkerCard | undefined;
  isArchivedCard: (card: WorkerCard) => boolean;
  getPreset: (presetId: string) => BriefingPreset | null;
  getPresetForBand: (band: string, cardId: string) => BriefingPreset;
  getGenerationPresetId: () => string | null;
  presetParams: (preset: BriefingPreset) => BriefingParams;
  bandForCard: (card: WorkerCard) => string;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string; hostId: string | null } | null>;
  continuingEnvironment: (card: WorkerCard, fallback: ThreadEnvironment) => Promise<ThreadEnvironment>;
  spawnDisposable: (args: SpawnArgs, site: string) => Promise<{ id: string }>;
  stopThread: (threadId: string) => Promise<void>;
  sleep?: (delayMs: number) => Promise<void>;
  /** Read the env at call time so a test (and an operator) can flip the switch
   * without rebuilding the plugin. */
  env?: () => NodeJS.ProcessEnv;
};

const POLL_MS = 5_000;
const POLLS = 24;

/** The two sources this card's delta comes from, and nothing else. */
function readFacts(deps: BriefingDeps, card: WorkerCard) {
  const reads = deps.db.prepare(
    "SELECT read_at FROM inbox_events WHERE card_id = ? AND read_at IS NOT NULL",
  ).all(card.id) as Array<{ read_at: number }>;
  const anchor = catchUpAnchor({
    readAts: reads.map((row) => row.read_at),
    createdAt: card.created_at,
  });
  const stageEvents = deps.db.prepare(
    "SELECT stage, entered_at FROM card_stage_events WHERE card_id = ? ORDER BY entered_at ASC, id ASC",
  ).all(card.id) as Array<{ stage: string; entered_at: number }>;
  const inboxEvents = deps.db.prepare(
    "SELECT kind, summary, occurred_at, resolved_at FROM inbox_events WHERE card_id = ?",
  ).all(card.id) as Array<{ kind: string; summary: string; occurred_at: number; resolved_at: number | null }>;
  const facts = catchUpFacts({ since: anchor.since, stageEvents, inboxEvents });
  return { anchor, facts };
}

/** The generation preset the site rides: designated, else band, else band. */
function resolvePreset(deps: BriefingDeps, card: WorkerCard): BriefingPreset {
  const designated = deps.getGenerationPresetId();
  const preset = designated ? deps.getPreset(designated) : null;
  if (preset) return preset;
  return deps.getPresetForBand(deps.bandForCard(card), card.id);
}

function spawnBriefing(
  deps: BriefingDeps,
  card: WorkerCard,
  params: BriefingParams,
  environment: ThreadEnvironment,
  prompt: string,
) {
  return deps.spawnDisposable({
    projectId: card.project_id,
    environment,
    visibility: "hidden",
    ...(card.worker_thread_id ? { lifecycleOwnerThreadId: card.worker_thread_id } : {}),
    title: `Stelow briefing: ${card.display_name ?? card.name}`,
    providerId: params.providerId,
    model: params.modelId,
    reasoningLevel: params.reasoningLevel as "low" | "medium" | "high" | "xhigh" | "max" | "none",
    permissionMode: (params.permissionMode === "full" ? "accept-edits" : params.permissionMode) as
      | "accept-edits" | "auto" | "full",
    prompt,
  }, "card-briefing");
}

/**
 * The briefing thread's environment: the card's own, like every other
 * disposable, so it dies with the card's worker. Without a workspace there is
 * still a briefing to give — the facts need none — so the project default is
 * the fallback rather than a refusal.
 *
 * The shape comes from `workerEnvironment`, the same builder draft bursts and
 * reviews use. Hand-rolling a second one here is how two spawns that should be
 * identical drift into different environments.
 */
async function briefingEnvironment(
  deps: BriefingDeps,
  card: WorkerCard,
  params: BriefingParams,
): Promise<ThreadEnvironment> {
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  const source = workspace?.path && workspace.hostId
    ? { path: workspace.path, hostId: workspace.hostId }
    : null;
  const fallback = source
    ? workerEnvironment(source, params, card.workspace_kind === "exploratory")
    : { type: "project-default" as const };
  return deps.continuingEnvironment(card, fallback);
}

async function awaitBriefing(
  deps: BriefingDeps,
  sleep: (delayMs: number) => Promise<void>,
  threadId: string,
): Promise<string | null> {
  for (let poll = 0; poll < POLLS; poll++) {
    await sleep(POLL_MS);
    const thread = await deps.bb.sdk.threads.get({ threadId }).catch(() => null);
    const status = (thread as { status?: unknown } | null)?.status;
    if (status === "failed" || status === "error") return null;
    if (status === "idle" || status === "stopping" || status === "archived" || status === "deleted") {
      const output = await deps.bb.sdk.threads.output({ threadId })
        .then((result) => result.output ?? "")
        .catch(() => "");
      return output || null;
    }
  }
  // Out of polls with the thread still working. Reading a running thread's
  // partial output would report a sentence the model had not finished writing
  // as if it had — a timeout is a timeout, and the facts already answer.
  return null;
}

/**
 * Phrase the facts with a generation-tier model, or return null.
 *
 * Null is not an error state: it means the deterministic list is the whole
 * answer, which is a complete answer. Every door out of here is a null rather
 * than a throw, because a briefing that fails loudly would make the reader wait
 * on a summary of a card they could already read.
 */
async function phraseFacts(
  deps: BriefingDeps,
  sleep: (delayMs: number) => Promise<void>,
  card: WorkerCard,
  summary: string,
  facts: unknown[],
): Promise<{ prose: string | null; source: string }> {
  if (commsDisabled((deps.env ?? (() => process.env))())) return { prose: null, source: "disabled" };
  let preset: BriefingPreset;
  try {
    preset = resolvePreset(deps, card);
  } catch {
    return { prose: null, source: "no-preset" };
  }
  const params = deps.presetParams(preset);
  let thread: { id: string };
  try {
    const environment = await briefingEnvironment(deps, card, params);
    thread = await spawnBriefing(deps, card, params, environment, buildBriefingPrompt({
      cardName: card.display_name ?? card.name,
      summary,
      facts,
    }));
  } catch {
    return { prose: null, source: "spawn-failed" };
  }
  const output = await awaitBriefing(deps, sleep, thread.id);
  await deps.stopThread(thread.id).catch(() => undefined);
  if (output === null) return { prose: null, source: "no-output" };
  return validateBriefingOutput(output).ok
    ? { prose: output, source: "generation" }
    : { prose: null, source: "no-output" };
}

export function createBriefingRuntime(deps: BriefingDeps) {
  const sleep = deps.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  return {
    /**
     * What changed on this card since the reader last looked.
     *
     * The facts are computed before the model is considered, so a refusal, an
     * outage or a disabled switch all still return the list. Every field is
     * always present — a refusal answers the same shape with `ok: false`,
     * because a partial answer is what the wire contract refuses and a client
     * that has to branch on missing keys is a client that will render one
     * undefined eventually.
     */
    catchUp: async (cardId: string) => {
      const card = deps.getCard(cardId);
      if (!card) return refusal("Card not found.");
      if (deps.isArchivedCard(card)) return refusal("This card is archived.");
      const { anchor, facts } = readFacts(deps, card);
      const summary = catchUpSummary(facts, { basis: anchor.basis });
      const phrased = await phraseFacts(deps, sleep, card, summary, facts);
      return {
        ok: true as const,
        error: null,
        anchor: anchor.basis,
        since: anchor.since,
        ...briefingResult({ prose: phrased.prose, facts: wireFacts(facts), summary, source: phrased.source }),
      };
    },
  };
}

/** The refusal shape: the contract's fields, all empty, with the reason. */
function refusal(error: string) {
  return {
    ok: false as const,
    error,
    anchor: null,
    since: null,
    summary: null,
    facts: [],
    prose: null,
    source: null,
  };
}

export type BriefingRuntime = ReturnType<typeof createBriefingRuntime>;
