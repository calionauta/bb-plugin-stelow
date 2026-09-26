/**
 * Projections of a research card's own bookkeeping.
 *
 * Strategy history, round timestamps, the reseed config read, and the poll
 * that marks a lightweight track running: all of them read what the card
 * already records, and all of them must agree on the same convention — a
 * waiting question is activity, never board position, and every agent output
 * lands as a card comment.
 */
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { parseStrategyList } from "../../lib/research-strategies.mjs";
import { normalizeHistory } from "../../lib/research-rounds.mjs";
import { parseWorkflowConfig } from "../../lib/workflow-config.mjs";
import { questionWaitUpdates } from "../../lib/card-question-state.mjs";
import type { WorkerCard } from "../workers-types.js";
import { stripMessageDirectives } from "./message-text.js";
import { join } from "./root-paths.js";
import { workflowStateDir } from "./workflow-state.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type TrackProjectionDeps = {
  bb: BbPluginApi;
  db: Db;
  now: () => number;
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  logCardComment: (
    cardId: string,
    target: string,
    targetId: string,
    author: "user" | "agent",
    body: string,
  ) => string;
  cardWorkspace: (
    card: WorkerCard,
  ) => Promise<{ path: string; hostId: string | null } | null>;
  syncOpenQuestionInbox: (
    card: WorkerCard,
  ) => Promise<string[] | null>;
};

/** Ordered strategy history for a research card (first = primary). */
export function strategyList(
  row: Pick<WorkerCard, "research_strategies" | "research_strategy">,
): string[] {
  return parseStrategyList(row.research_strategies);
}

/** Round history with timestamps (newest bookkeeping, oldest first). */
export function strategyRounds(
  row: Pick<WorkerCard, "research_strategies" | "research_strategy">,
): Array<{ id: string; at: string; file: string }> {
  return normalizeHistory(row.research_strategies);
}

async function readReseedConfig(
  deps: TrackProjectionDeps,
  card: WorkerCard,
  rootPath: string,
): Promise<ReturnType<typeof parseWorkflowConfig> | null> {
  if (!card.dir_hash) return null;
  try {
    const stateDir = await workflowStateDir(
      deps.bb,
      rootPath,
      card.id,
      card.dir_hash,
    );
    if (!stateDir) return null;
    const content = await deps.bb.sdk.files
      .read({ path: join(stateDir, "state.md") })
      .then((file) => file.content)
      .catch(() => null);
    return typeof content === "string" ? parseWorkflowConfig(content) : null;
  } catch {
    return null;
  }
}
async function markThreadRunning(
  deps: TrackProjectionDeps,
  card: WorkerCard,
  lastOutput: string | null,
): Promise<void> {
  const questionIds = await deps.syncOpenQuestionInbox(card);
  if (questionIds === null) return;
  if (questionIds.length > 0) {
    // Waiting is activity, never board position: the card stays in its
    // column (Doing) while the question waits.
    deps.updateCard(card.id, questionWaitUpdates(lastOutput));
  } else {
    const updates: Record<string, unknown> = {
      activity: "running" as const,
      last_assistant_text: lastOutput,
    };
    if (card.status === "pending") updates.status = "in-progress";
    deps.updateCard(card.id, updates);
  }
}
function noteAgentOutput(
  deps: TrackProjectionDeps,
  card: WorkerCard,
  lastOutput: string | null,
): void {
  if (lastOutput && lastOutput !== card.last_assistant_text) {
    deps.logCardComment(
      card.id,
      "card",
      card.id,
      "agent",
      stripMessageDirectives(lastOutput),
    );
  }
}

export function createTrackProjection(deps: TrackProjectionDeps) {
  return {
    readReseedConfig: readReseedConfig.bind(null, deps),
    markThreadRunning: markThreadRunning.bind(null, deps),
    noteAgentOutput: noteAgentOutput.bind(null, deps),
  };
}

export type TrackProjection = ReturnType<typeof createTrackProjection>;
