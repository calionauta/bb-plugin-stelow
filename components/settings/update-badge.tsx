export function UpdateBadge({ label = "Plugin update available" }: { label?: string | null }) {
  return (
    <span
      {...(label === null ? { "aria-hidden": true } : { "aria-label": label, title: label })}
      className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-2xs font-medium text-amber-700 dark:text-amber-300"
    >
      ↑
    </span>
  );
}
