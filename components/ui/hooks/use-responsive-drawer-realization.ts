import * as React from "react";

const RESPONSIVE_DRAWER_REALIZE_FALLBACK_MS = 120;

export function useResponsiveDrawerRealization({
  open,
  enabled = true,
}: {
  open: boolean;
  enabled?: boolean;
}): { isContentRealized: boolean; realizeContent: () => void } {
  const [isContentRealized, setIsContentRealized] = React.useState(false);
  const realizeContent = React.useCallback(
    () => setIsContentRealized(true),
    [],
  );

  React.useEffect(() => {
    if (!enabled || !open || isContentRealized) {
      return;
    }

    let firstFrame: number | null = null;
    let secondFrame: number | null = null;
    firstFrame = window.requestAnimationFrame(() => {
      firstFrame = null;
      secondFrame = window.requestAnimationFrame(() => {
        secondFrame = null;
        realizeContent();
      });
    });
    const fallback = window.setTimeout(
      realizeContent,
      RESPONSIVE_DRAWER_REALIZE_FALLBACK_MS,
    );

    return () => {
      if (firstFrame !== null) {
        window.cancelAnimationFrame(firstFrame);
      }
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame);
      }
      window.clearTimeout(fallback);
    };
  }, [enabled, isContentRealized, open, realizeContent]);

  return {
    isContentRealized: enabled && isContentRealized,
    realizeContent,
  };
}
