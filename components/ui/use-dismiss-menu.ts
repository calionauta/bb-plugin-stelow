import { useEffect, useRef } from "react";

/**
 * Dismiss-anywhere for anchored popovers: an outside press or Escape closes and
 * returns focus to the trigger. The close callback should be stable so
 * listeners attach once per open.
 *
 * Promoted out of `components/manage/card-actions-menu.tsx` so ONE owner serves
 * both importers. The copy that used to live beside the card menu was a second
 * owner of the same listener contract, in a file the design-token test walks —
 * and the card menu's own version had a defect the docstring above denied:
 * `closeOnOutsidePress` called `onClose()` without restoring focus, so "an outside
 * press or Escape closes and returns focus to the trigger" was true for Escape only.
 * Both paths restore focus now, which is what the sentence has always claimed.
 */
export function useDismissMenu(open: boolean, onClose: () => void) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      onClose();
      triggerRef.current?.focus();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);
  return { rootRef, triggerRef };
}
