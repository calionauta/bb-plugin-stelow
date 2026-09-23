import { useEffect, useRef, useState } from "react";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport.js";
import type { ResearchStrategyOption } from "./creation-settings";

// Visual strategy picker shared by the creation modal and the follow-up
// round dialog: search field over emoji radio-cards, single select, no
// preselected default. RunIds (follow-up) only badge already-run rows.
// Shell composes search, count, and results; filtering, attention flash,
// and rows are one-responsibility units below.

// Search field over the option list: desktop autofocuses (mobile skips it
// so the keyboard never covers the list on open), with an inline clear
// that returns focus to the field.
function StrategySearchField({ query, onQuery, onClear, searchRef, noun, disabled, compact }: {
  query: string; onQuery: (value: string) => void; onClear: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>; noun: string; disabled?: boolean; compact: boolean;
}) {
  return (
    <div className="relative">
      <input
        ref={searchRef}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder={`Search ${noun}…`}
        autoFocus={!compact}
        disabled={disabled}
        aria-label={`Search ${noun}`}
        className="h-11 w-full rounded-md border bg-background pr-9 pl-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      />
      {query.length > 0 ? (
        <button onClick={onClear} aria-label="Clear search" className="cursor-pointer absolute top-1/2 right-1 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">×</button>
      ) : null}
    </div>
  );
}

// Live count over the list: loading, filtered, or full — announced politely.
function StrategyCountLine({ strategies, visible, needle, noun }: {
  strategies: ResearchStrategyOption[]; visible: ResearchStrategyOption[]; needle: string; noun: string;
}) {
  return (
    <p className="text-xs text-muted-foreground" aria-live="polite">
      {strategies.length === 0
        ? `Loading ${noun}…`
        : needle.length > 0
          ? `${visible.length} of ${strategies.length} ${noun}`
          : `${strategies.length} ${noun}`}
    </p>
  );
}

// Empty search: names the miss and offers the way back (clear + refocus).
function StrategyEmptyState({ noun, query, onClear }: { noun: string; query: string; onClear: () => void }) {
  return (
    <div className="rounded-md border border-dashed p-4 text-center">
      <p className="text-sm text-muted-foreground">No {noun} match “{query.trim()}”.</p>
      <button onClick={onClear} className="cursor-pointer mt-2 min-h-11 rounded-md border px-3 text-sm font-medium hover:bg-muted">Clear search</button>
    </div>
  );
}

// One strategy as an emoji radio-card: single select, already-ran badge,
// blurb truncated with full text on hover.
function StrategyOptionRow({ entry, selected, ran, disabled, groupName, onPick }: {
  entry: ResearchStrategyOption; selected: boolean; ran: boolean; disabled?: boolean; groupName: string; onPick: (id: string) => void;
}) {
  return (
    <label
      className={`flex min-w-0 items-start gap-2.5 rounded-md border p-3 focus-within:outline focus-within:outline-2 focus-within:outline-primary ${disabled ? "opacity-60" : "cursor-pointer"} ${selected ? "border-primary bg-primary/5" : disabled ? "" : "hover:bg-muted/50"}`}
    >
      <input
        type="radio"
        name={groupName}
        checked={selected}
        onChange={() => onPick(entry.id)}
        disabled={disabled}
        className="sr-only"
        aria-label={`${entry.label}${ran ? " (already ran)" : ""}`}
      />
      <span aria-hidden className="text-xl leading-none">{entry.emoji}</span>
      <span className="min-w-0 flex-1">
        <span className={`flex flex-wrap items-center gap-2 text-sm ${selected ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
          {entry.label}
          {ran ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">already ran — runs again</span> : null}
          {selected ? <span aria-hidden className="text-primary">✓</span> : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={entry.blurb}>{entry.blurb}</span>
      </span>
    </label>
  );
}

// Results: the empty state, or the capped scroll list of radio-cards.
function StrategyResults({ visible, strategies, noun, query, legend, flash, value, runIds, disabled, groupName, onPick, onClearSearch }: {
  visible: ResearchStrategyOption[]; strategies: ResearchStrategyOption[]; noun: string; query: string; legend: string; flash: boolean;
  value: string | null; runIds: string[]; disabled?: boolean; groupName: string; onPick: (id: string) => void; onClearSearch: () => void;
}) {
  if (visible.length === 0 && strategies.length > 0) {
    return <StrategyEmptyState noun={noun} query={query} onClear={onClearSearch} />;
  }
  return (
    <div className={`relative max-h-72 min-w-0 overflow-y-auto overscroll-contain p-1 ${flash ? "rounded-md ring-2 ring-destructive/60" : ""}`}>
      <fieldset className="grid gap-2">
      <legend className="sr-only">{legend}</legend>
      {visible.map((entry) => (
        <StrategyOptionRow key={entry.id} entry={entry} selected={value === entry.id} ran={runIds.includes(entry.id)} disabled={disabled} groupName={groupName} onPick={onPick} />
      ))}
      </fieldset>
    </div>
  );
}

// Attention flash: search focus plus a transient ring when the caller
// increments the signal (submit blocked for want of a selection).
function useAttentionFlash(signal: number, searchRef: React.RefObject<HTMLInputElement | null>): boolean {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (signal === 0) return;
    searchRef.current?.focus();
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 1800);
    return () => window.clearTimeout(timer);
  }, [signal]);
  return flash;
}

export function StrategyPicker({ strategies, value, onChange, runIds = [], groupName, disabled = false, attentionSignal = 0, noun = "strategies", legend = "Research strategy" }: {
  strategies: ResearchStrategyOption[];
  value: string | null;
  onChange: (id: string) => void;
  runIds?: string[];
  groupName: string;
  disabled?: boolean;
  // Increment to draw attention to the picker (focus search + transient
  // ring). Used when submit is blocked for want of a selection.
  attentionSignal?: number;
  noun?: string;
  legend?: string;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  // Compact (mobile): the list keeps its ~4-row cap with inner scroll on
  // every viewport — capped over expanded, per explicit preference.
  // Autofocus is desktop-only so the keyboard doesn't cover the list on open.
  const compact = useIsCompactViewport();
  const flash = useAttentionFlash(attentionSignal, searchRef);
  const needle = query.trim().toLowerCase();
  const visible = needle.length === 0
    ? strategies
    : strategies.filter((entry) => [entry.id, entry.label, entry.blurb, ...entry.keywords].join(" ").toLowerCase().includes(needle));
  function clearSearch() {
    setQuery("");
    searchRef.current?.focus();
  }
  return (
    <div
      className="grid gap-2"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (event.key === "/" && target && !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
          event.preventDefault();
          searchRef.current?.focus();
        }
      }}
    >
      <StrategySearchField query={query} onQuery={setQuery} onClear={clearSearch} searchRef={searchRef} noun={noun} disabled={disabled} compact={compact} />
      <StrategyCountLine strategies={strategies} visible={visible} needle={needle} noun={noun} />
      <StrategyResults visible={visible} strategies={strategies} noun={noun} query={query} legend={legend} flash={flash} value={value} runIds={runIds} disabled={disabled} groupName={groupName} onPick={onChange} onClearSearch={clearSearch} />
    </div>
  );
}
