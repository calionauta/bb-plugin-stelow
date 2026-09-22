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
