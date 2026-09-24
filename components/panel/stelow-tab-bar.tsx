import type { ReactNode } from "react";
import { Icon } from "../ui/icon";
import { STELOW_TRACKS, type StelowTrack, type StelowTrackCounts, type StelowTrackEntry } from "./stelow-route.mjs";

function TrackNavButton({ entry, active, count, aboutAlert, updateBadge, onSelect }: {
  entry: StelowTrackEntry;
  active: boolean;
  count: number;
  aboutAlert: boolean;
  updateBadge: ReactNode;
  onSelect: (track: StelowTrack) => void;
}) {
  const countClass = active
    ? "bg-background/20 text-background"
    : "bg-muted text-muted-foreground";
  const className = [
    "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5",
    "text-[13px] font-medium focus-visible:outline focus-visible:outline-2",
    "focus-visible:outline-primary sm:px-3 sm:text-sm",
    active
      ? "bg-foreground text-background shadow-sm"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  ].join(" ");
  return (
    <button
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(entry.key)}
      title={entry.description}
      className={className}
    >
      <Icon name={entry.icon} className="h-4 w-4" aria-hidden />
      <span>{entry.title}</span>
      {entry.key === "about" ? (aboutAlert ? updateBadge : null) : (
        <span className={`rounded-full px-1.5 py-0.5 text-2xs font-medium tabular-nums ${countClass}`}>
          {count}
        </span>
      )}
    </button>
  );
}

export function StelowTabBar({ tab, counts, aboutAlert, updateBadge, onSelect }: {
  tab: StelowTrack;
  counts: StelowTrackCounts;
  aboutAlert: boolean;
  updateBadge: ReactNode;
  onSelect: (track: StelowTrack) => void;
}) {
  // These are routes, not tabpanels: aria-current and normal navigation are
  // the honest contract because BB does not mount arrow-key tab behavior here.
  return (
    <nav
      aria-label="Stelow tracks"
      className="flex max-w-full shrink-0 items-center gap-1 overflow-x-auto border-b bg-card/80 px-2 py-1.5 sm:px-3"
    >
      {STELOW_TRACKS.map((entry) => (
        <TrackNavButton
          key={entry.key}
          entry={entry}
          active={tab === entry.key}
          count={counts[entry.key]}
          aboutAlert={aboutAlert}
          updateBadge={updateBadge}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}
