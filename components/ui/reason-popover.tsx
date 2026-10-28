import { useCallback, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ErrorChip } from "../dashboard/build-status-pills";
import { COARSE_POINTER_TEXT_SM_CLASS } from "./coarse-pointer-sizing";
import { useDismissMenu } from "./use-dismiss-menu";
import { usePortalScopeProps } from "../../lib/portal-scope";

/**
 * Whether a click on the failure chip should open the reason panel.
 *
 * ONE predicate over the click alone, so the behaviour is unit-testable with no
 * DOM. A tap (`pointerType: "touch"` or `"pen"`) opens; a keyboard-activated
 * click (`detail: 0` — no pointer fired one) opens; a mouse click (real pointer,
 * `detail >= 1`) does NOT, because hover already serves that channel through the
 * chip's native `title=` and a panel on top of the tooltip would double-display.
 */
export function shouldOpenReasonPanel(signal: { pointerType?: string; detail: number }): boolean {
  if (signal.detail === 0) return true;
  return signal.pointerType === "touch" || signal.pointerType === "pen";
}

/**
 * Where the panel lands: below the trigger when it fits, above it when it does
 * not, pinned 8px inside the viewport horizontally. Pure, so the clamping is
 * unit-testable with no DOM. The 320px width mirrors the panel's `w-80`; the
 * 160px height is the budget a one-to-three-line reason fits inside.
 */
export function clampReasonPanel(
  rect: { top: number; bottom: number; left: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const margin = 8;
  const width = 320;
  const height = 160;
  const gap = 6;
  const top = rect.bottom + gap + height <= viewport.height - margin
    ? rect.bottom + gap
    : Math.max(margin, rect.top - gap - height);
  const left = Math.max(margin, Math.min(rect.left, viewport.width - width - margin));
  return { top, left };
}

/**
 * The floating reason itself: portaled to `document.body` because the tile clips
 * in-place content, carrying the plugin scope props so the stylesheet reaches it.
 * Reason-only — the label is already visible on the chip that opened this.
 */
function ReasonPanel({ panelId, anchor, detail }: {
  panelId: string;
  anchor: { top: number; left: number };
  detail: string;
}) {
  const scopeProps = usePortalScopeProps();
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      id={panelId}
      {...scopeProps}
      style={{ top: anchor.top, left: anchor.left }}
      className={`fixed z-50 w-80 max-w-[calc(100vw-1rem)] rounded-md border bg-popover p-3 shadow-md ${COARSE_POINTER_TEXT_SM_CLASS}`}
    >
      {detail}
    </div>,
    document.body,
  );
}

/**
 * The failure chip's tap-and-keyboard channel.
 *
 * A real button element wrapping `ErrorChip` — the chip is a bare span with no focus
 * target of its own, and touch browsers never surface its `title=`, so without
 * this a sighted person on a touchscreen could see the badge and never the
 * reason. Hover stays the native tooltip (no bespoke tooltip component, no
 * double-display on desktop); tap or keyboard opens a small portaled panel with
 * the reason and nothing else — the label is already visible on the chip, so
 * repeating it inside would elaborate on what is already shown.
 *
 * Portaled, not in-place: `BOARD_CARD_CLASS` carries `overflow-hidden`, so an
 * absolute panel inside the tile is clipped by the tile edge. Clicks never reach
 * the card root (`stopPropagation`, the `BoardCardSelect` precedent), so opening
 * the reason never opens the card. Dismissal is the shared `useDismissMenu`
 * contract: outside press or Escape closes, both returning focus to the trigger.
 *
 * The panel's content is presentational to assistive tech — the card root is
 * `role="button"`, which removes descendants from the accessibility tree — so
 * the reason ALSO lives in the card's own `aria-label`. The board names; the
 * detail explains.
 */
export function ReasonPopover({ label, detail }: { label: string; detail: string }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const panelId = useId();
  const close = useCallback(() => {
    setOpen(false);
    setAnchor(null);
  }, []);
  const { rootRef, triggerRef } = useDismissMenu(open, close);
  const lastPointerType = useRef<string | undefined>(undefined);
  return (
    <div ref={rootRef} className="inline-flex min-w-0">
      <button
        ref={triggerRef}
        type="button"
        className={"inline-flex min-h-11 min-w-0 cursor-pointer items-center rounded-full "
          + "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"}
        aria-expanded={open}
        aria-controls={panelId}
        onPointerDown={(event) => {
          lastPointerType.current = event.pointerType;
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (open) {
            close();
            return;
          }
          const signal = { pointerType: lastPointerType.current, detail: event.detail };
          if (!shouldOpenReasonPanel(signal)) return;
          const rect = triggerRef.current?.getBoundingClientRect();
          if (!rect) return;
          const viewport = { width: window.innerWidth, height: window.innerHeight };
          setAnchor(clampReasonPanel(rect, viewport));
          setOpen(true);
        }}
      >
        <ErrorChip label={label} detail={detail} />
      </button>
      {open && anchor ? <ReasonPanel panelId={panelId} anchor={anchor} detail={detail} /> : null}
    </div>
  );
}
