import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/**
 * The door to multi-select.
 *
 * Selection was a checkbox painted on every tile, which is why it cost a fifth
 * of a narrow card's content width in a state where nobody was selecting. It
 * is a mode now, and this is the one control that opens it: quiet (a secondary
 * affordance beside the view toggle, never a CTA), and labelled for a screen
 * reader even though it shows only an icon.
 *
 * Leaving the mode is the same button, and it says so — `aria-pressed` plus the
 * label toggle. The alternative (a separate "Done") would be a second control
 * that says the same thing, which is the duplication the board keeps re-learning.
 * (The bar does supply its own `Done` as well, because a reader who has scrolled
 * away from the header is looking at the bar, not at this.)
 *
 * It is the shared `Button`, not a raw element: this file is in `components/`,
 * where the repo's own rule is that a named affordance is imported rather than
 * re-spelled — the debt ledger counts raw buttons precisely because each new one
 * is a chance to drift a focus ring or a touch target away from the rest.
 */
export function SelectModeToggle({ active, count, onEnter, onExit }: {
  active: boolean;
  count: number;
  onEnter: () => void;
  onExit: () => void;
}) {
  const title = active ? "Leave selection mode" : "Select cards for a bulk action";
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={active ? onExit : onEnter}
      aria-pressed={active}
      title={title}
      aria-label={title}
      className={[
        "min-h-11 min-w-11 shrink-0 cursor-pointer gap-1.5 px-2",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      ].join(" ")}
    >
      <Icon name="ListTodo" className="h-4 w-4" aria-hidden />
      {/* The count rides the button only while there is one: a permanent `0`
          would read as a badge that failed to load. */}
      {active && count > 0 ? <span className="text-xs font-medium tabular-nums">{count}</span> : null}
    </Button>
  );
}
