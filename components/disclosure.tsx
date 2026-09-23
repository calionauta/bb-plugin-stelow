import { useState } from "react";

// One open/close affordance for every collapsible: a chevron that points
// right when closed and rotates down when open. Native <details>/<summary>
// drive it from explicit open state — never CSS group-open hope, which
// froze arrows in place before.
export function DisclosureChevron({ className = "", open }: { className?: string; open?: boolean }) {
  const rotation = open === undefined ? "group-open:rotate-90" : open ? "rotate-90" : "rotate-0";
  return <span aria-hidden className={`inline-flex size-5 shrink-0 items-center justify-center text-sm leading-none text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${rotation} ${className}`}>▶</span>;
}

// Convention for progressive disclosure: short visible line, details behind
// an explicit toggle. Use instead of ad-hoc <details> so every "learn more"
// reads and behaves the same.
export function DetailsDisclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <DisclosureChevron open={open} />{summary}
      </summary>
      <div className="space-y-1 pb-1 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </details>
  );
}

// Open-card building blocks: one contextual hero (heroFor) + one disclosure
// pattern (DisclosureSection) for secondary content. Previously every zone —
// banners, meta grid, timeline, preset, comments — used its own ad-hoc
// spacing and heading style.
// One open/close affordance for every collapsible in the panel: a chevron
// that points right when closed and rotates down when open. Native
// <details>/<summary> use the `group-open:` variant; controlled buttons pass
// `open` directly. Native controls already expose expanded state to assistive
// tech; this mirrors it visually for sighted, low-vision, and lay users.
export function DisclosureSection({ title, subtitle, hint, action, children, defaultOpen = false, open, onToggle }: { title: string; subtitle?: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; open?: boolean; onToggle?: (open: boolean) => void }) {
  const controlled = open !== undefined;
  return (
    <details
      open={controlled ? open : defaultOpen}
      onToggle={(event) => onToggle?.((event.currentTarget as HTMLDetailsElement).open)}
      className="group rounded-lg border bg-muted/20"
    >
      <summary className={`flex cursor-pointer list-none items-center px-3 py-2 text-sm font-medium marker:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden ${subtitle ? "min-h-12" : "min-h-11"}`}>
        <DisclosureChevron className="mr-1.5" />
        {/* A subtitle is how a section names its job; the Workflow map uses the
            same two-line shape, so the pair reads as one family. */}
        {subtitle ? (
          <span className="min-w-0">
            <span className="block font-semibold leading-5 text-foreground">{title}</span>
            <span className="block text-xs font-normal leading-5 text-muted-foreground">{subtitle}</span>
          </span>
        ) : <span>{title}</span>}
        {typeof hint === "string" ? (
          hint ? <span className="ml-2 truncate text-xs font-normal text-muted-foreground">{hint}</span> : null
        ) : (
          hint ? <span className="ml-auto inline-flex shrink-0 items-center overflow-visible pl-2 text-xs font-normal text-muted-foreground">{hint}</span> : null
        )}
        {action ? <span className="ml-auto inline-flex shrink-0 pl-2" onClick={(event) => event.stopPropagation()}>{action}</span> : null}
      </summary>
      <div className="space-y-3 px-3 pb-3">{children}</div>
    </details>
  );
}
