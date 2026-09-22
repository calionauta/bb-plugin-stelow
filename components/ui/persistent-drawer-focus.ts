// ---------------------------------------------------------------------------
// Persistent drawer focus/keyboard stack: keeps keyboard focus inside the
// topmost open drawer and closes it on Escape. One document-level keydown
// listener per Document, shared by every open drawer on that document.
// ---------------------------------------------------------------------------

const PERSISTENT_DRAWER_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type PersistentDrawerStackEntry = {
  panel: () => HTMLElement | null;
  requestClose: () => void;
};

type PersistentDrawerStack = {
  entries: PersistentDrawerStackEntry[];
  handleKeyDown: (event: KeyboardEvent) => void;
};

const persistentDrawerStacks = new WeakMap<Document, PersistentDrawerStack>();

function getDrawerFocusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(PERSISTENT_DRAWER_FOCUSABLE_SELECTOR),
  ).filter(
    (element) => element.closest('[aria-hidden="true"], [inert]') === null,
  );
}

function activeElementIsInAnotherOverlay(
  activeElement: Element | null,
  panel: HTMLElement,
): boolean {
  const overlay = activeElement?.closest<HTMLElement>(
    "[data-bb-portaled-overlay]",
  );
  return overlay !== null && overlay !== undefined && overlay !== panel;
}

function handleDrawerTab(event: KeyboardEvent, panel: HTMLElement): void {
  const activeElement = panel.ownerDocument.activeElement;
  if (
    !panel.contains(activeElement) &&
    activeElementIsInAnotherOverlay(activeElement, panel)
  ) {
    return;
  }

  const focusable = getDrawerFocusableElements(panel);
  event.preventDefault();
  if (focusable.length === 0) {
    panel.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey) {
    if (
      !panel.contains(activeElement) ||
      activeElement === panel ||
      activeElement === first
    ) {
      last?.focus({ preventScroll: true });
      return;
    }
    const index = focusable.indexOf(activeElement as HTMLElement);
    focusable[Math.max(0, index - 1)]?.focus({ preventScroll: true });
    return;
  }

  if (
    !panel.contains(activeElement) ||
    activeElement === panel ||
    activeElement === last
  ) {
    first?.focus({ preventScroll: true });
    return;
  }
  const index = focusable.indexOf(activeElement as HTMLElement);
  focusable[Math.min(focusable.length - 1, index + 1)]?.focus({
    preventScroll: true,
  });
}

export function registerOpenDrawer(
  ownerDocument: Document,
  entry: PersistentDrawerStackEntry,
): () => void {
  let stack = persistentDrawerStacks.get(ownerDocument);
  if (stack === undefined) {
    const entries: PersistentDrawerStackEntry[] = [];
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const topEntry = entries[entries.length - 1];
      const panel = topEntry?.panel() ?? null;
      if (topEntry === undefined || panel === null) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        topEntry.requestClose();
      } else if (event.key === "Tab") {
        handleDrawerTab(event, panel);
      }
    };
    stack = { entries, handleKeyDown };
    persistentDrawerStacks.set(ownerDocument, stack);
    ownerDocument.addEventListener("keydown", handleKeyDown);
  }
  stack.entries.push(entry);

  return () => {
    const currentStack = persistentDrawerStacks.get(ownerDocument);
    if (currentStack === undefined) {
      return;
    }
    const index = currentStack.entries.indexOf(entry);
    if (index >= 0) {
      currentStack.entries.splice(index, 1);
    }
    if (currentStack.entries.length === 0) {
      ownerDocument.removeEventListener("keydown", currentStack.handleKeyDown);
      persistentDrawerStacks.delete(ownerDocument);
    }
  };
}
