import * as React from "react";

import { blurActiveKeyboardInputBeforeOverlayClose } from "../overlay-trigger.js";
import type { ResponsiveOverlayContextValue } from "../responsive-overlay-context.js";
import { useIsCompactViewport } from "./use-compact-viewport.js";

// ---------------------------------------------------------------------------
// Hook: manages open state, mobile detection, and breakpoint-cross close.
// One useMediaQuery subscription per Root (not two).
// ---------------------------------------------------------------------------

export function useResponsiveRoot(
  controlledOpen: boolean | undefined,
  controlledOnChange: ((open: boolean) => void) | undefined,
  defaultOpen: boolean = false,
): ResponsiveOverlayContextValue {
  const isCompactViewport = useIsCompactViewport();
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const onOpenChange = React.useCallback(
    (next: boolean) => {
      if (open && !next && isCompactViewport) {
        blurActiveKeyboardInputBeforeOverlayClose();
      }
      if (!isControlled) {
        setInternalOpen(next);
      }
      controlledOnChange?.(next);
    },
    [isCompactViewport, isControlled, controlledOnChange, open],
  );

  return React.useMemo(
    () => ({ isCompactViewport, open, onOpenChange }),
    [isCompactViewport, open, onOpenChange],
  );
}
