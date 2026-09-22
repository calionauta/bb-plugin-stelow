// ---------------------------------------------------------------------------
// stripRadixContentProps: removes Radix positioning/behavior props from a
// props object so that only DOM-compatible props remain for mobile rendering.
// Derived from a single const to prevent interface/set drift.
// ---------------------------------------------------------------------------

const RADIX_CONTENT_PROP_NAMES = [
  "side",
  "sideOffset",
  "align",
  "alignOffset",
  "collisionPadding",
  "collisionBoundary",
  "arrowPadding",
  "sticky",
  "hideWhenDetached",
  "avoidCollisions",
  "onOpenAutoFocus",
  "onCloseAutoFocus",
  "onEscapeKeyDown",
  "onPointerDownOutside",
  "onFocusOutside",
  "onInteractOutside",
] as const;

type RadixContentPropName = (typeof RADIX_CONTENT_PROP_NAMES)[number];

const RADIX_CONTENT_KEYS: ReadonlySet<string> = new Set(
  RADIX_CONTENT_PROP_NAMES,
);

export function stripRadixContentProps<T extends Record<string, unknown>>(
  props: T,
): Omit<T, RadixContentPropName> {
  const result = {} as Record<string, unknown>;
  for (const key of Object.keys(props)) {
    if (!RADIX_CONTENT_KEYS.has(key)) {
      result[key] = props[key];
    }
  }
  return result as Omit<T, RadixContentPropName>;
}
