import * as React from "react";
import { blurActiveKeyboardInputWithin } from "../overlay-trigger.js";
import { resetDrawerKeyboardStyles } from "../drawer-keyboard-styles.js";
import { registerOpenDrawer } from "../persistent-drawer-focus.js";

/**
 * The drawer shell's focus, close-request and settle bookkeeping.
 *
 * Extracted from `PersistentResponsiveDrawerShell` when the shell crossed the repository's
 * function budget — the body had reached 177 lines before this change and every further
 * branch made the panel markup harder to read. The three concerns here are the ones that
 * are invisible in a screenshot and easy to break silently:
 *
 *   - focus moves into the panel on open and returns to whatever had it on close, unless
 *     that element is gone or hidden by the time the drawer closes;
 *   - Escape and the backdrop both ask for a close through the same callback, which also
 *     clears the keyboard state the panel may have set;
 *   - the "settled" callback fires once per transition, and a timer covers the case where
 *     the browser never delivers a `transitionend` (a hidden tab, a reduced-motion setting).
 *
 * A hook rather than three effects inline, so the panel component reads as markup.
 */
/** Focus in on open, focus back on close, and the trap that keeps it inside. */
function useDrawerFocusTrap({
  open,
  panelRef,
  requestClose,
}: {
  open: boolean;
  panelRef: React.RefObject<HTMLDivElement | null>;
  requestClose: () => void;
}) {
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (panel === null) return;
    const ownerDocument = panel.ownerDocument;
    const previousFocus = ownerDocument.activeElement;
    returnFocusRef.current = previousFocus instanceof HTMLElement ? previousFocus : null;
    const unregister = registerOpenDrawer(ownerDocument, {
      panel: () => panelRef.current,
      requestClose,
    });
    panel.focus({ preventScroll: true });
    return () => unregister();
  }, [open, panelRef, requestClose]);

  const previousOpenRef = React.useRef(open);
  React.useLayoutEffect(() => {
    if (previousOpenRef.current && !open) {
      blurActiveKeyboardInputWithin(panelRef.current);
      resetDrawerKeyboardStyles(panelRef.current);
      const returnFocus = returnFocusRef.current;
      // Only if it is still there: the trigger can be gone (a menu that closed) or hidden
      // behind another overlay, and focusing either moves the reader somewhere odd.
      if (returnFocus?.isConnected && returnFocus.closest('[aria-hidden="true"], [inert]') === null) {
        returnFocus.focus({ preventScroll: true });
      }
      returnFocusRef.current = null;
    }
    previousOpenRef.current = open;
  }, [open, panelRef]);
}

/** The settle callback, fired once per transition with a timer as its floor. */
function useDrawerSettle({
  open,
  motionDurationMs,
  onContentAnimationEnd,
}: {
  open: boolean;
  motionDurationMs: number;
  onContentAnimationEnd?: (open: boolean) => void;
}) {
  const settledStateRef = React.useRef<boolean | null>(null);
  const reportSettled = React.useCallback(
    (settledOpen: boolean) => {
      if (settledStateRef.current === settledOpen) return;
      settledStateRef.current = settledOpen;
      onContentAnimationEnd?.(settledOpen);
    },
    [onContentAnimationEnd],
  );
  React.useEffect(() => {
    settledStateRef.current = null;
    // The timer is the fallback, not the mechanism: a `transitionend` may never arrive when
    // the tab is hidden or the user prefers reduced motion, and a callback that only fires on
    // an event leaves the drawer looking permanently mid-transition.
    const timeout = window.setTimeout(() => reportSettled(open), motionDurationMs + 50);
    return () => window.clearTimeout(timeout);
  }, [motionDurationMs, open, reportSettled]);
  return reportSettled;
}

export function useDrawerShellBehavior({
  open,
  onOpenChange,
  motionDurationMs,
  onContentAnimationEnd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  motionDurationMs: number;
  onContentAnimationEnd?: (open: boolean) => void;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const onOpenChangeRef = React.useRef(onOpenChange);
  React.useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  // One close path for Escape and the backdrop, and it clears the keyboard state the panel
  // may have set before it leaves. Two paths would let one of them skip that reset.
  const requestClose = React.useCallback(() => {
    blurActiveKeyboardInputWithin(panelRef.current);
    resetDrawerKeyboardStyles(panelRef.current);
    onOpenChangeRef.current(false);
  }, []);

  const reportSettled = useDrawerSettle({ open, motionDurationMs, onContentAnimationEnd });
  useDrawerFocusTrap({ open, panelRef, requestClose });

  return { panelRef, requestClose, reportSettled };
}
