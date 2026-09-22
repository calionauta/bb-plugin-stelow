import * as React from "react";
import { createPortal } from "react-dom";

import { blurActiveKeyboardInputWithin } from "./overlay-trigger.js";
import { usePortalScopeProps } from "../../lib/portal-scope.js";
import { cn } from "../../lib/utils.js";
import { resetDrawerKeyboardStyles } from "./drawer-keyboard-styles.js";
import { registerOpenDrawer } from "./persistent-drawer-focus.js";
import { usePersistentDrawerDrag } from "./hooks/use-persistent-drawer-drag.js";

// ---------------------------------------------------------------------------
// PersistentResponsiveDrawerShell: a bottom drawer for a large, persistent
// panel. Unlike Radix/Vaul, this shell does not apply modal attributes to the
// app root. Those attributes make WebKit resolve styles for the full chat tree
// on each open. The backdrop blocks pointer input, while the key handler keeps
// keyboard focus inside the drawer.
// ---------------------------------------------------------------------------

interface PersistentResponsiveDrawerShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  srLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  contentClassName?: string;
  motionDurationMs?: number;
  onContentAnimationEnd?: (open: boolean) => void;
  children: React.ReactNode;
}

const PERSISTENT_DRAWER_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

export function PersistentResponsiveDrawerShell({
  open,
  onOpenChange,
  srLabel,
  labelledBy,
  describedBy,
  contentClassName,
  motionDurationMs = 220,
  onContentAnimationEnd,
  children,
}: PersistentResponsiveDrawerShellProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const backdropRef = React.useRef<HTMLDivElement>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  const settledStateRef = React.useRef<boolean | null>(null);
  const labelId = React.useId();
  const portalScopeProps = usePortalScopeProps();
  const transition = `transform ${motionDurationMs}ms ${PERSISTENT_DRAWER_EASING}`;
  const backdropTransition = `opacity ${motionDurationMs}ms ${PERSISTENT_DRAWER_EASING}`;
  const onOpenChangeRef = React.useRef(onOpenChange);
  React.useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  const requestClose = React.useCallback(() => {
    blurActiveKeyboardInputWithin(panelRef.current);
    resetDrawerKeyboardStyles(panelRef.current);
    onOpenChangeRef.current(false);
  }, []);

  const reportSettled = React.useCallback(
    (settledOpen: boolean) => {
      if (settledStateRef.current === settledOpen) {
        return;
      }
      settledStateRef.current = settledOpen;
      onContentAnimationEnd?.(settledOpen);
    },
    [onContentAnimationEnd],
  );

  React.useEffect(() => {
    settledStateRef.current = null;
    const timeout = window.setTimeout(
      () => reportSettled(open),
      motionDurationMs + 50,
    );
    return () => window.clearTimeout(timeout);
  }, [motionDurationMs, open, reportSettled]);

  React.useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const ownerDocument = panel.ownerDocument;
    const previousFocus = ownerDocument.activeElement;
    returnFocusRef.current =
      previousFocus instanceof HTMLElement ? previousFocus : null;
    const unregister = registerOpenDrawer(ownerDocument, {
      panel: () => panelRef.current,
      requestClose,
    });
    panel.focus({ preventScroll: true });

    return () => {
      unregister();
    };
  }, [open, requestClose]);

  const previousOpenRef = React.useRef(open);
  React.useLayoutEffect(() => {
    if (previousOpenRef.current && !open) {
      blurActiveKeyboardInputWithin(panelRef.current);
      resetDrawerKeyboardStyles(panelRef.current);
      const returnFocus = returnFocusRef.current;
      if (
        returnFocus?.isConnected &&
        returnFocus.closest('[aria-hidden="true"], [inert]') === null
      ) {
        returnFocus.focus({ preventScroll: true });
      }
      returnFocusRef.current = null;
    }
    previousOpenRef.current = open;
  }, [open]);

  const { handleDragStart, handleDragMove, finishDrag } =
    usePersistentDrawerDrag({
      open,
      panelRef,
      backdropRef,
      transition,
      backdropTransition,
      requestClose,
    });

  const portalTarget = typeof document === "undefined" ? null : document.body;
  if (portalTarget === null) {
    return null;
  }

  return createPortal(
    <>
      <div
        ref={backdropRef}
        {...portalScopeProps}
        aria-hidden="true"
        data-persistent-drawer-backdrop=""
        data-state={open ? "open" : "closed"}
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]"
        style={{
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: backdropTransition,
        }}
        onClick={requestClose}
        onTouchMove={(event) => event.preventDefault()}
      />
      <div
        ref={panelRef}
        {...portalScopeProps}
        aria-hidden={!open}
        aria-labelledby={
          labelledBy ?? (srLabel === undefined ? undefined : labelId)
        }
        aria-describedby={describedBy}
        aria-modal={open || undefined}
        data-bb-portaled-overlay=""
        data-persistent-drawer-content=""
        data-state={open ? "open" : "closed"}
        inert={!open}
        role="dialog"
        tabIndex={-1}
        className={cn(
          // Floating sheet: visible backdrop margins on every side, not an
          // edge-to-edge panel. Applies to all compact dialogs/menus at once.
          "fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex max-h-[92dvh] flex-col rounded-2xl border bg-background shadow-xl outline-none",
          contentClassName,
        )}
        style={{
          transform: open ? "translate3d(0, 0, 0)" : "translate3d(0, 100%, 0)",
          transition,
          willChange: open ? "transform" : undefined,
        }}
        onTransitionEnd={(event) => {
          if (
            event.currentTarget === event.target &&
            event.propertyName === "transform"
          ) {
            reportSettled(open);
          }
        }}
      >
        <div
          data-persistent-drawer-handle=""
          className="mx-auto flex h-8 w-16 shrink-0 touch-none cursor-grab items-center justify-center active:cursor-grabbing"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={(event) => finishDrag(event, false)}
          onPointerCancel={(event) => finishDrag(event, true)}
        >
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        {srLabel === undefined ? null : (
          <h2 id={labelId} className="sr-only">
            {srLabel}
          </h2>
        )}
        {children}
      </div>
    </>,
    portalTarget,
  );
}
