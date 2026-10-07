import * as React from "react";
import { createPortal } from "react-dom";

import { usePortalScopeProps } from "../../lib/portal-scope.js";
import { cn } from "../../lib/utils.js";
import { usePersistentDrawerDrag } from "./hooks/use-persistent-drawer-drag.js";
import { useDrawerShellBehavior } from "./hooks/use-drawer-shell-behavior.js";
import { drawerClosedTransform, drawerHasGrabBar, drawerPanelClass } from "../../lib/drawer-side.mjs";

// ---------------------------------------------------------------------------
// PersistentResponsiveDrawerShell: a bottom drawer for a large, persistent
// panel. Unlike Radix/Vaul, this shell does not apply modal attributes to the
// app root. Those attributes make WebKit resolve styles for the full chat tree
// on each open. The backdrop blocks pointer input, while the key handler keeps
// keyboard focus inside the drawer.
// ---------------------------------------------------------------------------

/**
 * Which edge the panel enters from.
 *
 * `bottom` is the floating sheet the app already used, and stays the default so every
 * existing caller is untouched. `right` is a full-height side panel, added for the flow
 * drawer: a bottom sheet over a board covers the cards it is describing, and the board is
 * itself a scrolling surface, so the panel has to take the side rather than the floor.
 *
 * The two differ in three places and share everything else — the portal, the focus trap,
 * the drag-to-dismiss gesture and the settle animation are the same mechanism, which is why
 * this is a prop and not a second component. A copy would drift from the focus handling,
 * and the focus handling is the part nobody notices breaking.
 */
type DrawerSide = "bottom" | "right";

interface PersistentResponsiveDrawerShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which edge to enter from. Defaults to `bottom`. */
  side?: DrawerSide;
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
  side = "bottom",
  srLabel,
  labelledBy,
  describedBy,
  contentClassName,
  motionDurationMs = 220,
  onContentAnimationEnd,
  children,
}: PersistentResponsiveDrawerShellProps) {
  const labelId = React.useId();
  const portalScopeProps = usePortalScopeProps();
  const transition = `transform ${motionDurationMs}ms ${PERSISTENT_DRAWER_EASING}`;
  const backdropTransition = `opacity ${motionDurationMs}ms ${PERSISTENT_DRAWER_EASING}`;
  // Focus, close-request and settle bookkeeping live in one hook: they are the parts a
  // screenshot cannot show and a refactor breaks silently. See its own file for why each
  // exists. The backdrop ref stays here because only the drag gesture uses it.
  const { panelRef, requestClose, reportSettled } = useDrawerShellBehavior({
    open,
    onOpenChange,
    motionDurationMs,
    onContentAnimationEnd,
  });
  const backdropRef = React.useRef<HTMLDivElement>(null);

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
          // A bottom sheet is a floating card with visible margins on every side; a right
          // panel is edge-to-edge on the vertical axis. The class strings live above so the
          // difference between the two is read in one place.
          drawerPanelClass(side),
          contentClassName,
        )}
        style={{
          transform: open ? "translate3d(0, 0, 0)" : drawerClosedTransform(side),
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
        {/* The grab bar belongs to the bottom sheet, where a downward drag dismisses. A
            right panel is dismissed by the backdrop or Escape, so it renders no handle —
            one would advertise a gesture that does nothing. */}
        {drawerHasGrabBar(side) ? (
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
        ) : null}
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
