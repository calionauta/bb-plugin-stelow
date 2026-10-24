import type { CliDeps } from "./cli-deps.js";
import { trailerArtifactCount } from "../../../lib/artifact-manifest.mjs";

/** The one completion writer moved to `server/runtime/card-completion.ts` so
 * the research/explore polls can reach it without importing a CLI module. */
export { completeCard } from "../card-completion.js";
export type {
  CompletionDeps,
  CompletionOptions,
} from "../card-completion.js";

export type DoneBundle = {
  wrote: boolean;
  dir: string;
  trailer: string[];
};

/** Completion output: the headline plus the refreshed run bundle the worker
 * must commit with the work. "Nothing to bundle" is a fact about this export,
 * never about the card: when the registration names artifacts that could not
 * be copied, the trailer still goes out, derived from `state.md`. */
export function doneStdout(headline: string, bundle: DoneBundle): string {
  if (bundle.wrote)
    return [
      headline,
      `Run bundle refreshed at ${bundle.dir}/ — commit it with the work, then paste below the commit subject:`,
      ...bundle.trailer,
    ].join("\n");
  const registered = trailerArtifactCount(bundle.trailer);
  if (registered === 0) return `${headline} No registered artifacts — nothing to bundle.`;
  return [
    `${headline} Nothing readable to bundle yet (${registered} registered in state.md, none copied) — the commit trailer below still names every one:`,
    ...bundle.trailer,
  ].join("\n");
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
