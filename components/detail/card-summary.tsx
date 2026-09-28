import { cardSummary } from "../../lib/card-summary.mjs";
import { stageLabel } from "../../lib/workflow-vocabulary.mjs";
import type { BuildDetailView } from "./build-detail-view";

type Card = NonNullable<BuildDetailView["card"]>;
type Detail = NonNullable<BuildDetailView["detail"]>;

const TONE: Record<string, string> = {
  destructive: "text-destructive",
  warning: "text-amber-700 dark:text-amber-200",
  success: "text-emerald-700 dark:text-emerald-300",
  default: "text-foreground",
  muted: "text-muted-foreground",
};

/**
 * The card's own account of itself, in one strip, directly under the hero.
 *
 * This exists because the facts were already on the card and not on the card's
 * surface. The stage lived in the hero, the run outcomes in a list, the file
 * count inside a collapsed section, the scope count inside another one —
 * answering "what did this produce and what still needs me" took four visits
 * and a memory. The summary does not add information; it stops hiding
 * information that was already loaded.
 *
 * It renders nothing at all when it would have nothing to say. A card with no
 * runs, no artifacts, no scopes and no blocker is described better by the
 * sections below than by an empty strip that looks like a bug.
 */
export function CardSummary({
  card,
  detail,
  runs,
}: {
  card: Card;
  detail: Detail | null;
  runs: BuildDetailView["execution"]["runs"];
}) {
  const summary = cardSummary({
    heroKind: heroKindOf(card, detail),
    activity: card.activity,
    status: card.status,
    stage: card.stage,
    runs,
    artifacts: detail?.artifacts ?? [],
    scopes: detail?.scopes ?? [],
    pendingQuestions: detail?.pendingQuestions?.length ?? 0,
    expiredQuestions: detail?.expiredQuestions?.length ?? 0,
    stageLabel,
  });
  if (!summary) return null;
  return (
    <section aria-label="Card summary" className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {summary.blocker ? (
          <span
            role="status"
            className={`font-semibold ${summary.blocker.kind === "error" ? "text-destructive" : "text-amber-800 dark:text-amber-200"}`}
          >
            {summary.blocker.text}
          </span>
        ) : null}
        {summary.stage ? <span className="text-muted-foreground">at {summary.stage}</span> : null}
        {summary.files !== null ? <span className="text-muted-foreground">{summary.files} files</span> : null}
        {summary.scoped ? <span className="text-muted-foreground">{summary.scoped}</span> : null}
        {summary.run?.map((part: { tone: string; text: string }, index: number) => (
          <span key={part.text} className={TONE[part.tone] ?? TONE.default}>
            {index === 0 && summary.blocker ? "· " : ""}
            {part.text}
          </span>
        ))}
      </div>
    </section>
  );
}

/**
 * Which hero the card is showing, so the summary agrees with it.
 *
 * The hero is the card's authoritative one-line state; if the summary
 * computed its own it could contradict the banner directly above it. This
 * reads the same question the hero answers, rather than re-deciding it.
 */
function heroKindOf(card: Card, detail: Detail | null): string | null {
  if (card.status === "archived") return "archived";
  const pending = (detail?.pendingQuestions?.length ?? 0) + (detail?.expiredQuestions?.length ?? 0);
  if (pending > 0) return "decision";
  if (card.activity === "error") return "error";
  if (["completed", "done"].includes(card.status)) return "completed";
  if (card.activity === "idle" && card.workerThreadId != null && detail?.card.needsAttention) return "paused";
  return null;
}
