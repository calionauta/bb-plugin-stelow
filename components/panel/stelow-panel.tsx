import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { StelowTabBar } from "./stelow-tab-bar";
import { parseStelowSubPath, type ParsedStelowRoute, type StelowTrack, type StelowTrackCounts } from "./stelow-route.mjs";

const DEFAULT_TRACK: StelowTrack = "inbox";
const LAST_TAB_STORAGE_KEY = "stelow-tab-v1";

function isTrack(value: string | null): value is StelowTrack {
  return value === "inbox" || value === "build" || value === "research"
    || value === "explore" || value === "about";
}

function readLastTrack(): StelowTrack {
  if (typeof window === "undefined") return DEFAULT_TRACK;
  try {
    const value = window.localStorage.getItem(LAST_TAB_STORAGE_KEY);
    return isTrack(value) ? value : DEFAULT_TRACK;
  } catch {
    return DEFAULT_TRACK;
  }
}

function useRememberedTrack(route: ParsedStelowRoute, subPath: string): StelowTrack {
  const [lastTrack, setLastTrack] = useState<StelowTrack>(readLastTrack);
  useEffect(() => {
    if (route.kind !== "track") return;
    if (subPath.replace(/^\/+|\/+$/g, "") === "") return;
    setLastTrack(route.track);
    try {
      window.localStorage.setItem(LAST_TAB_STORAGE_KEY, route.track);
    } catch {
      // Storage is optional; explicit routes still control the active view.
    }
  }, [route, subPath]);
  return lastTrack;
}

function TrackPanels({ tab, renderTrack }: {
  tab: StelowTrack;
  renderTrack: (tab: StelowTrack) => ReactNode;
}) {
  const panels: StelowTrack[] = ["inbox", "build", "research", "explore", "about"];
  return panels.map((track) => (
    <div
      key={track}
      className={tab === track ? "min-h-0 flex-1" : "hidden"}
    >
      {renderTrack(track)}
    </div>
  ));
}

export function StelowPanel({ subPath, counts, aboutAlert, updateBadge, onSelectTrack, renderCard, renderTrack }: {
  subPath: string;
  counts: StelowTrackCounts;
  aboutAlert: boolean;
  updateBadge: ReactNode;
  onSelectTrack: (track: StelowTrack) => void;
  renderCard: (route: ParsedStelowRoute & { kind: "card" | "bare-card" }) => ReactNode;
  renderTrack: (tab: StelowTrack) => ReactNode;
}) {
  const route = useMemo(() => parseStelowSubPath(subPath), [subPath]);
  const lastTrack = useRememberedTrack(route, subPath);
  const selectTrack = useCallback((track: StelowTrack) => onSelectTrack(track), [onSelectTrack]);
  if (route.kind !== "track") return renderCard(route);
  const bare = subPath.replace(/^\/+|\/+$/g, "") === "";
  const tab = bare ? lastTrack : route.track;
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <StelowTabBar
        tab={tab}
        counts={counts}
        aboutAlert={aboutAlert}
        updateBadge={updateBadge}
        onSelect={selectTrack}
      />
      <TrackPanels tab={tab} renderTrack={renderTrack} />
    </div>
  );
}
