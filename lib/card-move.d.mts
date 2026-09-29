export declare type CardMove =
  | { ok: true; move: { type: "status"; status: string } | { type: "phase"; phase: string } }
  | { ok: false; error: string };
/**
 * `stage` and `stagePhases` are the card's real position, and the policy needs
 * them to tell a one-phase advance from a drag that skips the phases producing
 * the target's artifacts. Both optional: a card whose position cannot be
 * resolved still moves, so the caller is not forced to know the vocabulary.
 * `phaseEntryStages` exists so a re-entry refusal can name the stage it would
 * land on rather than describing the cost in the abstract.
 */
export declare function resolveCardMove(
  kind: unknown,
  target: unknown,
  state?: {
    hasWorker?: boolean;
    stage?: string;
    stagePhases?: Record<string, string>;
    phaseEntryStages?: Record<string, string>;
  },
): CardMove;
