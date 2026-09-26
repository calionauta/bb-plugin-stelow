import { roundFileName, roundTimestamp } from "../../lib/research-rounds.mjs";
import { researchStrategyById } from "../../lib/research-strategies.mjs";
import type { WorkerCard } from "../workers-types.js";
import {
  AGENT_COMMENT_AUTHOR,
  unknownStrategy,
  type ResearchTrackDeps,
} from "./research-track-deps.js";

type StrategyRound = {
  presetId: string;
  no: number;
  stamp: string;
  at: string;
  file: string;
};

export function createResearchStrategyRoundHandler(deps: ResearchTrackDeps) {
  return (input: { cardId: string; strategy: string }) =>
    runResearchStrategy(deps, input);
}

function strategyRefusal(error: string) {
  return { ok: false as const, strategy: null, error };
}

// Composite research: run another strategy round on the same card. Spawns a
// fresh worker on the new playbook that APPENDS a new ### section to the index
// — existing items are never rewritten. The previous worker retires only after
// the new one is live (same safe order as every respawn).
async function runResearchStrategy(
  deps: ResearchTrackDeps,
  { cardId, strategy }: { cardId: string; strategy: string },
) {
  const card = deps.getCard(cardId);
  if (!card) return strategyRefusal(deps.errors.cardNotFound);
  if (card.kind !== "research")
    return strategyRefusal(
      "Only research cards run strategies. Build cards advance stages instead.",
    );
  if (card.status === "archived")
    return strategyRefusal(deps.errors.cardArchived);
  const picked = researchStrategyById(strategy);
  if (!picked) return strategyRefusal(unknownStrategy(strategy));
  const round = await strategyRound(deps, card, cardId, picked.id);
  const result = await deps.respawn(cardId, round.presetId, "strategy-add", {
    strategyId: picked.id,
    flavor: "append",
    roundNo: round.no,
    roundStamp: round.stamp,
    roundFile: round.file,
  });
  // The round is only recorded once its worker is live: a failed respawn must
  // leave the history and the index untouched so a retry is the same round.
  if (!result.ok)
    return strategyRefusal(result.error ?? "Could not start the strategy round.");
  recordStrategyRound(deps, card, cardId, round, picked.id);
  deps.logCardComment(
    cardId,
    "card",
    cardId,
    AGENT_COMMENT_AUTHOR,
    strategyTrail(deps, picked.label, round.presetId),
  );
  deps.bb.realtime.publish("card-state", { cardId });
  return { ok: true, strategy: picked.id, error: null };
}

async function strategyRound(
  deps: ResearchTrackDeps,
  card: WorkerCard,
  cardId: string,
  strategyId: string,
): Promise<StrategyRound> {
  const effective = deps.reliablePreset("research", cardId);
  const no = deps.strategyList(card).length + 1;
  const stamp = roundTimestamp();
  const at = new Date(deps.now()).toISOString();
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  const stateDir =
    card.dir_hash && workspace?.path
      ? await deps.workflowStateDir(
          workspace.path,
          card.id,
          card.dir_hash,
        ).catch(() => null)
      : null;
  const file =
    stateDir && workspace?.path
      ? deps.roundRelPath(
          stateDir,
          workspace.path,
          roundFileName(strategyId, no, stamp),
        )
      : "";
  if (file && workspace?.path) await deps.ensureParent(workspace.path, file);
  return { presetId: effective.id, no, stamp, at, file };
}

function recordStrategyRound(
  deps: ResearchTrackDeps,
  card: WorkerCard,
  cardId: string,
  round: StrategyRound,
  strategyId: string,
): void {
  const history = [
    ...deps.strategyRounds(card),
    { id: strategyId, at: round.at, file: round.file },
  ];
  deps.db
    .prepare(
      "UPDATE cards SET research_strategies = ?, updated_at = ? WHERE id = ?",
    )
    .run(JSON.stringify(history), deps.now(), cardId);
}

function strategyTrail(
  deps: ResearchTrackDeps,
  label: string,
  presetId: string,
): string {
  const presetName = deps.presetName(presetId) ?? presetId;
  return `Started a ${label} research round on preset "${presetName}". Results will be added to this card. Previous worker archived.`;
}
