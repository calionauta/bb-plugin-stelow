import { resetAutoContinue } from "../../lib/auto-continue.mjs";

/**
 * The completion write, in one place for every track.
 *
 * `completeCard` used to take the whole `CliDeps`, which meant only the CLI
 * could call it — so the research and explore polls grew a second writer
 * (`completionFields` in research-track-sync.ts) that wrote `status`,
 * `activity` and the idle stamp but forgot `last_error`, the auto-continue
 * reset and the board column. That is exactly the drift the docstring here
 * claimed was impossible, and it is why the type below is narrow: the two
 * seams are all a completion needs, so a poll holding its own smaller deps can
 * reach the one writer instead of re-deriving the column set.
 */
export type CompletionDeps = {
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  recordStageEvent: (cardId: string, stage: string) => void;
};

export type CompletionOptions = {
  /** The stage the card finished at, when the caller knows it (build). */
  stage?: string;
  /** The turn's text, when completion came from a poll rather than a worker's
   * explicit `done`. Omitted means "leave the column alone". */
  lastAssistantText?: string | null;
  /** The settled idle stamp, so the attention clock measures "idle this long"
   * rather than "idle since this poll". Omitted means "leave it alone". */
  idleAt?: number;
};

/** Completes the card: auto-continue counter reset, board columns, and the
 * stage ledger row. Every track writes through this one writer, so the
 * completion columns cannot drift between build, research, and explore. */
export function completeCard(
  deps: CompletionDeps,
  cardId: string,
  options: CompletionOptions = {},
): void {
  const reset = resetAutoContinue();
  deps.updateCard(cardId, {
    status: "completed",
    activity: "idle",
    last_error: null,
    ...(options.stage ? { stage: options.stage } : {}),
    ...(options.lastAssistantText !== undefined
      ? { last_assistant_text: options.lastAssistantText }
      : {}),
    ...(options.idleAt !== undefined ? { last_idle_at: options.idleAt } : {}),
    auto_continue_count: reset.count,
    auto_continue_stage: reset.stage,
  });
  deps.recordStageEvent(cardId, "done");
}
