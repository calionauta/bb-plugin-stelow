export function resetDrawerKeyboardStyles(
  drawerElement: HTMLElement | null,
): void {
  if (drawerElement === null) return;

  drawerElement.style.height = "";
  drawerElement.style.bottom = "";
}
