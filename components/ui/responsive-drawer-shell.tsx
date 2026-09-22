import * as React from "react";

import { useResponsiveDrawerRealization } from "./hooks/use-responsive-drawer-realization.js";
import { PersistentResponsiveDrawerShell } from "./persistent-responsive-drawer-shell.js";

// ---------------------------------------------------------------------------
// ResponsiveDrawerShell: shared scaffold for compact menus, popovers, and
// dialogs. It uses the persistent shell so opening an overlay never applies
// modal attributes to the app tree. It also lets the transform start before
// it mounts the overlay body, then retains that body for later opens.
// ---------------------------------------------------------------------------

interface ResponsiveDrawerShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Sr-only label announced when the drawer opens. Omit if the caller
   * renders its own labeled heading inside children (e.g. DialogTitle).
   */
  srLabel?: string;
  /** Existing visible title used to label a dialog body. */
  labelledBy?: string;
  /** Existing visible description for a dialog body. */
  describedBy?: string;
  /** Class name on the drawer panel. */
  contentClassName?: string;
  /** Called when the drawer transform completes. */
  onContentAnimationEnd?: (open: boolean) => void;
  children: React.ReactNode;
}

export function ResponsiveDrawerShell({
  open,
  onOpenChange,
  srLabel,
  labelledBy,
  describedBy,
  contentClassName,
  onContentAnimationEnd,
  children,
}: ResponsiveDrawerShellProps) {
  const { isContentRealized } = useResponsiveDrawerRealization({ open });

  if (!open && !isContentRealized) {
    return null;
  }

  return (
    <PersistentResponsiveDrawerShell
      open={open}
      onOpenChange={onOpenChange}
      srLabel={srLabel}
      labelledBy={labelledBy}
      describedBy={describedBy}
      contentClassName={contentClassName}
      onContentAnimationEnd={onContentAnimationEnd}
    >
      {isContentRealized ? (
        children
      ) : (
        <div
          aria-hidden="true"
          className="min-h-32"
          data-responsive-drawer-placeholder=""
        />
      )}
    </PersistentResponsiveDrawerShell>
  );
}
