import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * The one header every track panel renders: title, the sentence that explains
 * the track, the attention count, and the actions.
 *
 * Build, Explore and Research had three copies of the same shape, and the copy
 * was `flex-col` on a phone that turned into `flex-row` at `sm` — 640px. That
 * breakpoint is where the header stopped fitting rather than where it started
 * fitting: the explanation (up to 42rem of prose) and the action grid (two
 * columns of full-width buttons) shared one row on a tablet, so the sentence
 * that explains the board was the member that gave up its width and wrapped
 * into a tall, narrow column of text. Reported as "o texto de explicação do
 * board fica espremido e longo e tudo quebra" on tablet and mobile.
 *
 * The header is a column until `lg`, which is the first width where prose plus
 * a row of buttons genuinely fits side by side; below it the explanation owns
 * the full width and the actions sit under it. This is a layout decision, not a
 * cosmetic one: a header that collapses its own explanation is a header that
 * taught the reader to skip it.
 *
 * The actions grid is two columns of full-width buttons on a phone (a thumb
 * reaches both without aiming), and a wrapping row from `sm` up — a wrapping
 * row never squeezes the title, because it has no column to be forced into.
 */
export function PanelHeader({
  title,
  blurb,
  attentionCount,
  onAttention,
  actions,
}: {
  title: string;
  blurb: ReactNode;
  attentionCount?: number;
  onAttention?: () => void;
  actions: ReactNode;
}) {
  const showAttention = Boolean(attentionCount && attentionCount > 0);
  return (
    <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 max-w-prose text-pretty text-sm leading-5 text-muted-foreground">
          {blurb}
        </p>
        {showAttention && onAttention ? (
          <button
            type="button"
            onClick={onAttention}
            className={cn(
              "mt-0.5 inline-flex min-h-11 cursor-pointer items-center text-xs text-amber-700 underline-offset-4",
              "hover:underline focus-visible:outline focus-visible:outline-2",
              "focus-visible:outline-primary dark:text-amber-300",
            )}
            aria-label={`Show the ${attentionCount} ${
              attentionCount === 1 ? "card" : "cards"
            } that need attention`}
          >
            {attentionCount} {attentionCount === 1 ? "item needs" : "items need"}{" "}
            your attention
          </button>
        ) : null}
      </div>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2 lg:mt-0.5 lg:w-auto lg:flex-nowrap lg:justify-end">
        {actions}
      </div>
    </header>
  );
}

/**
 * The line that teaches a reader how the board scrolls, per input device
 * rather than per screen size.
 *
 * The old copy switched at `sm`: a 768px tablet was told "Use Shift + scroll",
 * which is an instruction only a keyboard can follow. Touch is the thing that
 * decides the gesture, so the swipe line runs to `lg` and the keyboard line
 * starts there.
 */
export function BoardScrollHint() {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="lg:hidden">Swipe sideways to view every stage.</span>
      <span className="hidden lg:inline">
        Use Shift + scroll to move across stages.
      </span>
    </p>
  );
}
