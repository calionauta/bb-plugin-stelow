import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { RESEARCH_STRATEGIES } from "../../lib/research-strategies.mjs";
import type { CardCreateInput } from "../cards-create.js";
import type { rpcContract } from "../rpc-contract.js";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type ResearchIndexOutput = z.infer<typeof rpcContract.researchIndex.output>;
export type ResearchIndexOpportunity =
  ResearchIndexOutput["opportunities"][number];
export type ResearchIndexRounds = ResearchIndexOutput["rounds"];
export type RoundHistory = Array<{ id: string; at: string; file: string }>;
export type CardWorkspace = { path: string; hostId: string | null };
export type IndexResolution =
  | { ok: true; content: string; absolute: string; display: string }
  | { ok: false; error: string };
export type CreatedCard = { cardId: string; title: string };
export type CreatedCardResult = { cardId: string; threadId: string | null };
// z.output, not z.input: the RPC layer hands handlers the parsed schema, so
// every field the card factory requires is present rather than optional.
export type ResearchCardInput = z.output<
  typeof rpcContract.createResearchCard.input
>;
export type ExploreCardInput = z.output<
  typeof rpcContract.createExploreCard.input
>;

/** Every research-track RPC reads and writes the card row and may spawn a
 * worker, so the composition root supplies the wiring once and every slice
 * declares the same contract instead of re-deriving its own. */
export type ResearchTrackDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<CardWorkspace | null>;
  createCard: (input: CardCreateInput) => Promise<CreatedCardResult>;
  readResearchIndex: (card: WorkerCard) => Promise<IndexResolution>;
  researchRoundFiles: (
    workspacePath: string | null,
    hostId: string | null,
    stateDir: string | null,
    history: RoundHistory,
    live: boolean,
  ) => Promise<{ rounds: ResearchIndexRounds }>;
  strategyRounds: (card: WorkerCard) => RoundHistory;
  strategyList: (card: WorkerCard) => string[];
  workflowStateDir: (
    rootPath: string,
    workflowId: string,
    dirHash: string,
  ) => Promise<string | null>;
  roundRelPath: (
    stateDirAbs: string,
    workspacePath: string,
    base: string,
  ) => string;
  ensureParent: (workspacePath: string, relPath: string) => Promise<void>;
  logCardComment: (
    cardId: string,
    target: string,
    targetId: string,
    author: "user" | "agent",
    body: string,
  ) => string;
  reliablePreset: (band: string, cardId: string) => { id: string };
  presetName: (presetId: string) => string | undefined;
  respawn: (
    cardId: string,
    presetId: string,
    reason: string,
    options: {
      strategyId?: string;
      flavor?: "restart" | "append";
      roundNo?: number;
      roundStamp?: string;
      roundFile?: string;
    },
  ) => Promise<{ ok: boolean; error?: string }>;
  errors: { cardNotFound: string; cardArchived: string };
};

/** Research-track refusals return their exit instead of throwing, so a card
 * whose state makes the action impossible still says why. */
export const AGENT_COMMENT_AUTHOR = "agent";
export const INDEX_PENDING = "Research results are still being prepared.";

/** Read lazily: the strategy catalog is spliced with any on-disk contract
 * overrides at plugin load, and every refusal must name the merged list. */
export function unknownStrategy(strategy: string): string {
  const ids = RESEARCH_STRATEGIES.map((entry) => entry.id).join(", ");
  return `Unknown research strategy "${strategy}". Pick one of: ${ids}.`;
}
