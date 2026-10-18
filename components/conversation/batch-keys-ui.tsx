import { useCallback, useEffect, useRef, useState } from "react";
import { BATCH_KEY_LEGEND, BATCH_KEY_LIST, batchKeyDecision } from "../../lib/batch-keys.mjs";

import type { BatchItem } from "./batch-types";

/**
 * Mount the batch's keyboard accelerator and its two pieces of on-screen
 * evidence: the terse legend that is always visible, and the complete list
 * behind `?`.
 *
 * Why a hook rather than a component: the listener must be bound to the
 * questions CONTAINER, never to `document`. The card renders in three hosts,
 * one of which is a thread tab beside a live worker terminal — a global
 * listener would take keys away from a running turn, which is worse than no
 * accelerator at all. `containerRef` is that boundary.
 *
 * The legend is deliberately NOT hidden behind `?`. Revealing the whole key set
 * only on demand is a discoverability cost; the terse line pays most of it back
 * by staying on screen, and `?` exists for the complete list.
 */

export type BatchKeyHandlers = {
  /** Pick option N of the current question. */
  onPick: (optionIndex: number) => void;
  /** Move to another question in the batch. */
  onMove: (toIndex: number) => void;
  /** Focus the free-text note. */
  onFocusNote: () => void;
  /** Toggle skip for the current question. */
  onToggleSkip: () => void;
  /** Open the current question's option document. */
  onOpenDocument: () => void;
  /** Submit the batch. */
  onSubmit: () => void;
};

/**
 * Bind one `keydown` listener to the container, reading the latest values
 * through a ref so a render never re-attaches the listener and no keydown is
 * missed mid-render.
 *
 * The ref-and-effect dance is extracted so `useBatchKeys` reads as the binding
 * it is. The listener is on the CONTAINER, never `document`: the card can sit
 * beside a live worker terminal, and a global listener would take that
 * terminal's keys.
 */
function useContainerKeyListener({ containerRef, questions, index, optionCount, canSkip, hasDocument, handlers, setIndex, toggleKeys }: {
  containerRef: { current: HTMLDivElement | null };
  questions: BatchItem[];
  index: number;
  optionCount: number;
  canSkip: boolean;
  hasDocument: boolean;
  handlers: BatchKeyHandlers;
  setIndex: (index: number) => void;
  toggleKeys: () => void;
}) {
  const latest = useRef({ questions, index, optionCount, canSkip, hasDocument, handlers, setIndex, toggleKeys });
  latest.current = { questions, index, optionCount, canSkip, hasDocument, handlers, setIndex, toggleKeys };
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const state = latest.current;
      const decision = batchKeyDecision(event, {
        questionIndex: state.index,
        questionCount: state.questions.length,
        optionCount: state.optionCount,
        canSkip: state.canSkip,
        hasDocument: state.hasDocument,
      });
      // A key the accelerator did not claim is left alone on purpose: it must
      // reach the browser, the field, or the worker terminal beside this card.
      if (!decision) return;
      event.preventDefault();
      applyDecision(decision, state.handlers, state.setIndex, state.toggleKeys);
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [containerRef]);
}

/**
 * Apply one decision to the batch. At module scope so `useBatchKeys` stays a
 * binding function rather than a switch statement with a ref around it.
 */
function applyDecision(
  decision: NonNullable<ReturnType<typeof batchKeyDecision>>,
  handlers: BatchKeyHandlers,
  setIndex: (index: number) => void,
  toggleKeys: () => void,
): void {
  switch (decision.type) {
    case "pick": handlers.onPick(decision.optionIndex); break;
    case "move": setIndex(decision.toIndex); break;
    case "focus-note": handlers.onFocusNote(); break;
    case "toggle-skip": handlers.onToggleSkip(); break;
    case "open-document": handlers.onOpenDocument(); break;
    case "submit": handlers.onSubmit(); break;
    case "show-keys": toggleKeys(); break;
    default: break;
  }
}

export function useBatchKeys({
  questions,
  index,
  setIndex,
  canSkip,
  hasDocument,
  optionCount,
  handlers,
}: {
  questions: BatchItem[];
  index: number;
  setIndex: (index: number) => void;
  canSkip: boolean;
  hasDocument: boolean;
  /**
   * How many options the reader can SEE. Passed in rather than derived from
   * `current.options`, because a boundary question can render none of them —
   * the digit bound and the visible list have to be the same list.
   */
  optionCount: number;
  handlers: BatchKeyHandlers;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const toggleKeys = useCallback(() => setShowKeys((open) => !open), []);

  useContainerKeyListener({ containerRef, questions, index, optionCount, canSkip, hasDocument, handlers, setIndex, toggleKeys });

  const closeKeys = useCallback(() => setShowKeys(false), []);
  // `focusNote` walks down from the container's own ref, so no caller has to
  // know where the note sits or thread a second ref through the tree.
  const focusNote = useCallback(() => {
    containerRef.current?.querySelector<HTMLElement>("[data-batch-note]")?.focus();
  }, []);
  return { containerRef, showKeys, closeKeys, setShowKeys, focusNote };
}

/**
 * The terse hint line, narrowed to the keys that actually DO something here.
 *
 * A legend that advertises a key with no effect — `← →` on a single question,
 * `s` on the recovered batch, which offers no skip — is worse than no legend: it
 * teaches a key that does nothing and the reader concludes the keyboard layer is
 * broken. So the line is filtered by the same facts the router uses, which is
 * the "one list, one truth" rule applied to the hint as well as the keys.
 *
 * `TEXT_META`-sized and muted: it is orientation, not a status, so it must
 * never compete with the question or the submit.
 */
export function BatchKeyLegend({ multiQuestion, canSkip }: { multiQuestion: boolean; canSkip: boolean }) {
  const available = (keys: string): boolean => {
    if (keys === "← →") return multiQuestion;
    if (keys === "s") return canSkip;
    return true;
  };
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs leading-5 text-muted-foreground">
      {BATCH_KEY_LEGEND.filter((entry) => available(entry.keys)).map((entry) => (
        <span key={entry.keys} className="inline-flex items-baseline gap-1">
          <kbd className="rounded border border-border bg-muted/60 px-1 font-mono text-xs leading-4 text-foreground">
            {entry.keys}
          </kbd>
          <span>{entry.label}</span>
        </span>
      ))}
    </p>
  );
}

/** The complete key list, opened with `?` and dismissed with Escape. */
export function BatchKeyOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="rounded-md border border-border bg-muted/40 p-2">
      <p className="text-xs font-medium text-foreground">Keyboard shortcuts</p>
      <ul className="mt-1 space-y-0.5">
        {BATCH_KEY_LIST.map((entry) => (
          <li key={entry.keys} className="flex items-baseline gap-2 text-xs text-muted-foreground">
            <kbd className="min-w-14 rounded border border-border bg-background px-1 font-mono text-xs text-foreground">
              {entry.keys}
            </kbd>
            <span>{entry.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">
        Digits and letters type normally while the note is focused. Escape closes this list.
      </p>
    </div>
  );
}