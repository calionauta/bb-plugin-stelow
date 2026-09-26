import { resetAutoContinue } from "../../../lib/auto-continue.mjs";
import type { CliDeps } from "./cli-deps.js";

export type DoneBundle = {
  wrote: boolean;
  dir: string;
  trailer: string[];
};

/** Completes the card: auto-continue counter reset, board columns, and the
 * stage ledger row. Every track writes through this one writer, so the
 * completion columns cannot drift between build, research, and explore. */
export function completeCard(
  deps: CliDeps,
  cardId: string,
  options: { stage?: string } = {},
): void {
  const reset = resetAutoContinue();
  deps.updateCard(cardId, {
    status: "completed",
    activity: "idle",
    last_error: null,
    ...(options.stage ? { stage: options.stage } : {}),
    auto_continue_count: reset.count,
    auto_continue_stage: reset.stage,
  });
  deps.recordStageEvent(cardId, "done");
}

/** Completion output: the headline plus the refreshed run bundle the worker
 * must commit with the work. A card with no registered artifacts says so
 * instead of pretending it bundled something. */
export function doneStdout(headline: string, bundle: DoneBundle): string {
  return bundle.wrote
    ? [
        headline,
        `Run bundle refreshed at ${bundle.dir}/ — commit it with the work, then paste below the commit subject:`,
        ...bundle.trailer,
      ].join("\n")
    : `${headline} No registered artifacts — nothing to bundle.`;
}

/** A required review policy means the deliverable must have a passing review
 * covering the current fingerprint. */
export async function reviewPolicyRefusal(
  deps: CliDeps,
  card: Parameters<CliDeps["passingReviewCovers"]>[0],
  fingerprint: string | null,
  what: string,
): Promise<string | null> {
  if (deps.reviewPolicy().mode !== "required") return null;
  const covered = await deps.passingReviewCovers(card, fingerprint).catch(() => false);
  if (covered) return null;
  return `Review policy is required: no passing review covers the current ${what} — run \`bb stelow review\`, then run done again. (Enable only \
with a reviewer you trust on adversarial spot-checks; see docs/phase6-independent-review-plan.md.)`;
}

/** The completion event is read from the card as it stands now (the row
 * changed a moment ago), and its dedupe key carries the fingerprint so a
 * re-run with the same evidence never doubles the inbox row. */
export function announceCompletion(
  deps: CliDeps,
  cardId: string,
  completion: { inbox: string; dedupeKey: string },
): void {
  const current = deps.getCard(cardId);
  if (!current) return;
  deps.recordInboxEvent(
    current,
    "completed",
    completion.inbox,
    completion.dedupeKey,
    deps.now(),
  );
}
