import { useState } from "react";
import { cn } from "../lib/utils";

/**
 * The one surface a section of the card is allowed to be.
 *
 * The open card used to draw its sections eight different ways — `border p-3`,
 * `border p-4`, `border bg-background/60`, `border bg-muted/20`, each written
 * into the component that needed it. Eight siblings that do not match do not
 * read as eight sections of one thing; they read as eight unrelated panels,
 * and the reader has to work out which ones matter from the decoration rather
 * than from the content. That is the consistency half of a type scale applied
 * to surfaces: if the card is a column of sections, the sections are boxes of
 * one shape and everything that makes one of them different is its TONE — it is
 * a blocker, or it is history, or it is a warning — not a different border.
 *
 * So this is a token and not a convention. A section that needs to stand out
 * asks for `tone`, which is a colour the reader already learned from the hero;
 * a section that does not gets the plain surface and recedes, which is the
 * entire visual hierarchy the card has.
 */
export const SECTION_SURFACE = "rounded-lg border bg-muted/20";

/**
 * The three disclosure families, named.
 *
 * The chevron was already shared — twelve components import it — which made the
 * leak easy to miss: eight of them were still hand-rolling the whole pattern
 * around it, each with its own summary padding. Seven different paddings for one
 * interaction is why the same accordion feels like a different control depending
 * on which card it is in, and it is invisible in review because each site looks
 * locally reasonable.
 *
 * There are exactly three shapes here, and they are genuinely different jobs, so
 * the fix is to name them rather than to force one:
 *
 * - SECTION — a labelled region of the card. That is `DisclosureSection`.
 * - ROW — a bordered thing with a header, like a scope or a diff file.
 * - LINK — an inline "show more" inside running text, the lightest of the three.
 *
 * A site picks its family and adds only what is genuinely its own. What it may
 * not do is re-spell the family's base, because that is how one constant ended
 * up duplicated under one name in two files with different contents.
 */
export const SUMMARY_BASE = [
  "flex cursor-pointer list-none items-center gap-1.5",
  "marker:hidden [&::-webkit-details-marker]:hidden",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
].join(" ");

/** A bordered row with a header: a scope, a file in a diff, a tool card. */
export const SUMMARY_ROW = `${SUMMARY_BASE} min-h-11 px-3 py-2`;

/**
 * An inline "show more" inside running text. `text-primary` because it is a
 * control, not a label — and one of the two files that used to carry its own
 * copy of this constant had forgotten the colour, so its "show more" read as
 * body text while its twin elsewhere read as a link.
 */
export const SUMMARY_LINK = `${SUMMARY_BASE} inline-flex min-h-11 text-xs font-medium text-primary hover:underline`;

/**
 * Whether a section starts open.
 *
 * Progressive disclosure earns its keep when the default is CLOSED and the
 * reader earns the opening. Two things are exempt, and only two: a section
 * holding something happening right now, and a section the reader is blocked
 * on. Everything else — the files you attached, the maps this workflow defines,
 * the gaps a past run recorded — is history, and history does not get to push
 * the page down before the reader has asked for it.
 */
export function startsOpen({ live = false, blocking = false }: { live?: boolean; blocking?: boolean } = {}) {
  return live || blocking;
}

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
  // Tracked in state, not left to the `group-open:` variant, and that is a bug fix
  // rather than a preference. The chevron below was rendered WITHOUT `open`, so its
  // rotation depended on CSS — and this file's own note records what that cost the last
  // time it was tried: "never CSS group-open hope, which froze arrows in place before".
  // `DetailsDisclosure`, eight lines up, has always done it this way.
  //
  // 23 callers render this section and only 3 pass `open`, so the other 20 all relied on
  // the variant. Reported from the live card as "the Machine receipts toggle is not
  // correct — it needs to rotate when clicked".
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = controlled ? open : uncontrolledOpen;
  return (
    <details
      open={isOpen}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        if (!controlled) setUncontrolledOpen(next);
        onToggle?.(next);
      }}
      className={`group ${SECTION_SURFACE}`}
    >
      <summary className={cn(
        SUMMARY_ROW,
        "text-sm font-medium",
        subtitle ? "min-h-12" : "min-h-11",
      )}>
        <DisclosureChevron className="mr-1.5" open={isOpen} />
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
