import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { stageLabel } from "../../lib/workflow-vocabulary.mjs";

type FilterOption = { value: string; label: string };
type FilterFacet = {
  label: string;
  values: string[];
  options: FilterOption[];
  onToggle: (value: string) => void;
};

type FiltersBarProps = {
  projects: Array<{ id: string; name: string }>;
  filterProjectIds: string[];
  filterAttention: boolean;
  onProjectToggle: (value: string) => void;
  onAttention: (value: boolean) => void;
  onReset: () => void;
  stageOptions?: string[];
  filterStages?: string[];
  onStageToggle?: (value: string) => void;
  intentOptions?: FilterOption[];
  filterIntents?: string[];
  onIntentToggle?: (value: string) => void;
  statusOptions?: FilterOption[];
  filterStatuses?: string[];
  onStatusToggle?: (value: string) => void;
  activityOptions?: FilterOption[];
  filterActivities?: string[];
  onActivityToggle?: (value: string) => void;
};

function useFiltersDismissal(open: boolean, close: () => void) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (wrapRef.current && !wrapRef.current.contains(target)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);
  return wrapRef;
}

export function FilterMultiSelect({
  label,
  values,
  options,
  onToggle,
}: {
  label: string;
  values: string[];
  options: FilterOption[];
  onToggle: (value: string) => void;
}) {
  const active = values.length > 0;
  return (
    <fieldset className="min-w-0">
      <legend className="text-xs text-muted-foreground">
        {label}{active ? ` (${values.length})` : ""}
      </legend>
      <div
        className={[
          "mt-1 max-h-56 space-y-0.5 overflow-auto rounded-md border px-2 py-1",
          active ? "border-primary bg-primary/10" : "border-border bg-background",
        ].join(" ")}
      >
        {options.length === 0 ? <p className="px-1 py-1 text-xs text-muted-foreground">No options.</p> : null}
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-foreground hover:bg-muted/60"
          >
            <input
              type="checkbox"
              checked={values.includes(option.value)}
              onChange={() => onToggle(option.value)}
              className="size-4 shrink-0 cursor-pointer accent-primary"
            />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function FilterPill({ facet, value }: { facet: FilterFacet; value: string }) {
  const option = facet.options.find((entry) => entry.value === value);
  const label = option?.label ?? value;
  return (
    <button
      type="button"
      onClick={() => facet.onToggle(value)}
      className={[
        "inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-primary",
        "bg-primary/10 px-3 text-xs font-medium text-foreground hover:text-foreground",
      ].join(" ")}
      aria-label={`Remove ${facet.label} filter ${label}`}
    >
      <span>{label}</span>
      <span aria-hidden className="ml-1">×</span>
    </button>
  );
}

function FilterSummary({
  facets,
  attention,
  onAttention,
  onReset,
}: {
  facets: FilterFacet[];
  attention: boolean;
  onAttention: (value: boolean) => void;
  onReset: () => void;
}) {
  const activeCount = facets.reduce((total, facet) => total + facet.values.length, 0) + (attention ? 1 : 0);
  return (
    <>
      {facets.flatMap((facet) => facet.values.map((value) => (
        <FilterPill key={`${facet.label}:${value}`} facet={facet} value={value} />
      )))}
      {attention ? (
        <button
          type="button"
          onClick={() => onAttention(!attention)}
          className={[
            "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-amber-500",
            "bg-amber-500/15 px-3 text-xs font-medium text-amber-700 dark:text-amber-300",
          ].join(" ")}
          aria-label="Remove attention filter"
          aria-pressed="true"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
          Needs attention
          <span aria-hidden className="ml-1">×</span>
        </button>
      ) : null}
      {activeCount > 0 ? (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-7 cursor-pointer items-center rounded-full border bg-background px-3 text-xs text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      ) : null}
    </>
  );
}

function FilterPanel({ facets, attention, onAttention, onReset, onDone }: {
  facets: FilterFacet[];
  attention: boolean;
  onAttention: (value: boolean) => void;
  onReset: () => void;
  onDone: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Filters"
      className="absolute left-0 top-10 z-20 w-[min(36rem,calc(100vw-2rem))] rounded-md border bg-card p-3 shadow-lg"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {facets.map((facet) => (
          <FilterMultiSelect key={facet.label} {...facet} />
        ))}
        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={attention}
            onChange={(event) => onAttention(event.target.checked)}
            aria-label="Needs attention"
          />
          <span className="text-xs text-muted-foreground">Needs attention</span>
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onReset}>Reset</Button>
        <Button size="sm" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

function FilterTrigger({ open, activeCount, onToggle }: {
  open: boolean;
  activeCount: number;
  onToggle: () => void;
}) {
  const tone = activeCount > 0
    ? "border-primary bg-primary/10 text-foreground"
    : "border-border bg-background text-muted-foreground hover:text-foreground";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition ${tone}`}
    >
      <span aria-hidden>⚙</span>
      <span>Filters</span>
      {activeCount > 0 ? (
        <span
          className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground"
          aria-label={`${activeCount} active filter${activeCount === 1 ? "" : "s"}`}
        >
          {activeCount}
        </span>
      ) : null}
    </button>
  );
}

export function FiltersBar(props: FiltersBarProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const wrapRef = useFiltersDismissal(open, close);
  const projectOptions = useMemo(
    () => props.projects.map((project) => ({ value: project.id, label: project.name })),
    [props.projects],
  );
  const stageOptions = useMemo(
    () => (props.stageOptions ?? []).map((stage) => ({ value: stage, label: stageLabel(stage) })),
    [props.stageOptions],
  );
  const facets = optionalFacets(props, projectOptions, stageOptions);
  const activeCount = facets.reduce((total, facet) => total + facet.values.length, 0)
    + (props.filterAttention ? 1 : 0);
  return (
    <div ref={wrapRef} className="relative flex flex-wrap items-center gap-2">
      <FilterTrigger
        open={open}
        activeCount={activeCount}
        onToggle={() => setOpen((value) => !value)}
      />
      <FilterSummary
        facets={facets}
        attention={props.filterAttention}
        onAttention={props.onAttention}
        onReset={props.onReset}
      />
      {open ? (
        <FilterPanel
          facets={facets}
          attention={props.filterAttention}
          onAttention={props.onAttention}
          onReset={props.onReset}
          onDone={close}
        />
      ) : null}
    </div>
  );
}

function optionalFacets(
  props: FiltersBarProps,
  projectOptions: FilterOption[],
  stageOptions: FilterOption[],
): FilterFacet[] {
  return [
    { label: "Project", values: props.filterProjectIds, options: projectOptions, onToggle: props.onProjectToggle },
    optionalFacet("Type", props.intentOptions, props.filterIntents, props.onIntentToggle),
    optionalFacet("Status", props.statusOptions, props.filterStatuses, props.onStatusToggle),
    optionalFacet("Stage", stageOptions, props.filterStages, props.onStageToggle),
    optionalFacet("Activity", props.activityOptions, props.filterActivities, props.onActivityToggle),
  ].filter((facet): facet is FilterFacet => facet !== null);
}

function optionalFacet(
  label: string,
  options: FilterOption[] | undefined,
  values: string[] | undefined,
  onToggle: ((value: string) => void) | undefined,
): FilterFacet | null {
  if (!options || !values || !onToggle) return null;
  return { label, options, values, onToggle };
}
