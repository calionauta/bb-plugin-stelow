// ---------------------------------------------------------------------------
// Shared context value for responsive overlays (dropdown menus, popovers)
// ---------------------------------------------------------------------------

export interface ResponsiveOverlayContextValue {
  isCompactViewport: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
