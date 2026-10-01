import { listExecutionRuns } from "../../lib/execution-run-ledger.mjs";
import type { NativeRunRef } from "../../lib/native-run.mjs";
import { stageLabel } from "../../lib/workflow-vocabulary.mjs";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/**
 * The card's native runs, as the liveness rule reads them.
 *
 * The stage label travels with each run because the recipe id alone made the
 * run list unreadable: the card said "Tech Planning" and the run said
 * "planning-research", and nothing on screen said they were the same stage. The
 * rule derives its sentence from this record, so resolving the label here is
 * what lets that sentence speak the card's own vocabulary.
 *
 * A read that throws reads as no runs — the same asymmetry `worker-hold.ts`
 * keeps, and for the same reason. A card that cannot be asked about its runs
 * falls back to the thread's own state, which is bounded by the auto-continue
 * budget and repairs itself. Inventing a phantom run would be the worse
 * failure: the card would claim work nobody is doing.
 */
export function cardLiveRuns(db: Db, cardId: string): NativeRunRef[] {
  try {
    return listExecutionRuns(db, cardId).map((run) => ({
      id: run.id,
      normalizedStatus: run.normalizedStatus,
      recipeId: run.recipeId,
      stage: run.stage,
      stageLabel: stageLabel(run.stage),
    }));
  } catch {
    return [];
  }
}
