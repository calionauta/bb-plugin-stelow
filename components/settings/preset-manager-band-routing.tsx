import type { ManagerRpc } from "./decision-api-types";
import type {
  BandPresetEntry,
  PresetManagerPreset,
} from "./preset-manager-types";

type AssignedPreset = { id: string; name: string } | null;
type PresetManagerBandRoutingProps = {
  rpc: ManagerRpc;
  presets: PresetManagerPreset[];
  bands: BandPresetEntry[];
  reliablePreset: AssignedPreset;
  generationPreset: AssignedPreset;
  reviewerPreset: AssignedPreset;
  busy: boolean;
  onChanged: () => Promise<void>;
  onBandsChange: (bands: BandPresetEntry[]) => void;
  onMessage: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
  onReliableChange: (preset: AssignedPreset) => void;
  onGenerationChange: (preset: AssignedPreset) => void;
  onReviewerChange: (preset: AssignedPreset) => void;
};

const PHASE_GROUPS = [
  { track: "Research", bands: ["research"] },
  { track: "Explore", bands: ["explore"] },
  { track: "Build", bands: ["analysis", "planning", "execution", "review"] },
];
const KNOWN_BANDS = new Set(PHASE_GROUPS.flatMap((group) => group.bands));
const RELIABLE_DELEGATED_GUIDANCE =
  "Demanding delegated work — automation drafts, research fan-out, " +
  "any burst the worker keeps rewriting. Runs with tools: pick a strong preset.";
const GENERATION_DELEGATED_GUIDANCE =
  "Short disposable texts your card's worker requests mid-work — a " +
  "commit-message draft, a changelog line, a fresh card title. Text in, " +
  "text out; the worker judges every word before using it.";
const REVIEWER_DELEGATED_GUIDANCE =
  "A second pair of eyes from a different model family, read-only. Used " +
  "when a finished research, exploration, or document gets an independent " +
  "review before you trust it — later, the same independence can pre-check " +
  "gates and plans. Without a designation, reviews refuse instead of " +
  "borrowing a worker preset.";
type DelegatedMethod =
  | "assignReliablePreset"
  | "assignGenerationPreset"
  | "assignReviewPreset";
type DelegatedSelection = {
  method: DelegatedMethod;
  value: string | null;
  update: (preset: AssignedPreset) => void;
};
const DELEGATED_FAILURES: Record<DelegatedMethod, string> = {
  assignReliablePreset: "Failed to set reliable preset.",
  assignGenerationPreset: "Failed to set generation preset.",
  assignReviewPreset: "Failed to set reviewer preset.",
};

function PresetSelect({
  ariaLabel,
  value,
  presets,
  emptyLabel,
  onChange,
}: {
  ariaLabel?: string;
  value: string;
  presets: PresetManagerPreset[];
  emptyLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={ariaLabel}
      className="cursor-pointer h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
      value={value}
      onChange={(event) =>
        onChange(event.target.value || null ? event.target.value : "")
      }
    >
      <option value="">{emptyLabel}</option>
      {presets.map((preset) => (
        <option key={preset.id} value={preset.id}>
          {preset.name}
        </option>
      ))}
    </select>
  );
}

function BandRow({
  label,
  band,
  presets,
  onChange,
}: {
  label: string;
  band: BandPresetEntry;
  presets: PresetManagerPreset[];
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 shrink-0 capitalize">{label}</span>
      <PresetSelect
        value={band.presetId ?? ""}
        presets={presets}
        emptyLabel="Use card default"
        onChange={onChange}
      />
      <span
        className="w-28 shrink-0 truncate text-right text-[11px] text-muted-foreground"
        title={band.stages.join(", ")}
      >
        {band.stages.join(", ")}
      </span>
    </div>
  );
}

function DelegatedSelect({
  label,
  hint,
  description,
  emptyLabel,
  ariaLabel,
  value,
  presets,
  onChange,
}: {
  label: string;
  hint: string;
  description: string;
  emptyLabel: string;
  ariaLabel?: string;
  value: string;
  presets: PresetManagerPreset[];
  onChange: (value: string | null) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        <span className="w-24 shrink-0">{label}</span>
        <PresetSelect
          ariaLabel={ariaLabel}
          value={value}
          presets={presets}
          emptyLabel={emptyLabel}
          onChange={onChange}
        />
        <span
          className="w-28 shrink-0 truncate text-right text-[11px] text-muted-foreground"
          title={hint}
        >
          {hint}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

export function PresetManagerBandRouting(props: PresetManagerBandRoutingProps) {
  const {
    rpc,
    presets,
    bands,
    onChanged,
    onBandsChange,
    onMessage,
    onBusyChange,
  } = props;
  const setBand = (bandName: string, presetId: string | null) => {
    onBusyChange(true);
    void rpc
      .call("setBandPreset", { band: bandName, presetId })
      .then(() => {
        void onChanged();
        void rpc
          .call("listBandPresets", {})
          .then((result) => onBandsChange(result.bands))
          .catch(() => onBandsChange([]));
      })
      .catch(() => onMessage("Failed to set phase preset."))
      .finally(() => onBusyChange(false));
  };
  const extra = bands.filter((entry) => !KNOWN_BANDS.has(entry.band));
  return (
    <>
      <div className="grid gap-3">
        {PHASE_GROUPS.map((group) => (
          <div key={group.track} className="space-y-2">
            <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group.track}
            </h5>
            {group.bands.map((bandName) => {
              const band = bands.find((entry) => entry.band === bandName);
              if (!band) return null;
              return (
                <BandRow
                  key={band.band}
                  label={group.track === "Build" ? band.band : "preset"}
                  band={band}
                  presets={presets}
                  onChange={(value) => setBand(band.band, value)}
                />
              );
            })}
          </div>
        ))}
        {extra.length > 0 ? (
          <div className="space-y-2">
            <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Other
            </h5>
            {extra.map((band) => (
              <BandRow
                key={band.band}
                label={band.band}
                band={band}
                presets={presets}
                onChange={(value) => setBand(band.band, value)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

function assignDelegatedPreset(
  rpc: ManagerRpc,
  selection: DelegatedSelection,
  actions: Pick<
    PresetManagerBandRoutingProps,
    "onChanged" | "onMessage" | "onBusyChange"
  >,
) {
  const { method, value, update } = selection;
  actions.onBusyChange(true);
  void rpc
    .call(method, { presetId: value })
    .then(() => {
      void actions.onChanged();
      if (method === "assignReliablePreset")
        void rpc
          .call("getReliablePreset", {})
          .then((result) => update(result.preset))
          .catch(() => update(null));
      if (method === "assignGenerationPreset")
        void rpc
          .call("getGenerationPreset", {})
          .then((result) => update(result.preset))
          .catch(() => update(null));
      if (method === "assignReviewPreset")
        void rpc
          .call("getReviewPreset", {})
          .then((result) => update(result.preset))
          .catch(() => update(null));
    })
    .catch(() => actions.onMessage(DELEGATED_FAILURES[method]))
    .finally(() => actions.onBusyChange(false));
}

export function PresetManagerDelegatedWork(
  props: PresetManagerBandRoutingProps,
) {
  const {
    rpc,
    presets,
    reliablePreset,
    generationPreset,
    reviewerPreset,
    onReliableChange,
    onGenerationChange,
    onReviewerChange,
  } = props;
  return (
    <>
      <div className="grid gap-3">
        <DelegatedSelect
          label="✓ Reliable"
          hint="reliable tier"
          description={RELIABLE_DELEGATED_GUIDANCE}
          emptyLabel="Use band preset"
          value={reliablePreset?.id ?? ""}
          presets={presets}
          onChange={(value) =>
            assignDelegatedPreset(
              rpc,
              {
                method: "assignReliablePreset",
                value,
                update: onReliableChange,
              },
              props,
            )
          }
        />
        <DelegatedSelect
          label="⚡ Generation"
          hint="draft bursts"
          description={GENERATION_DELEGATED_GUIDANCE}
          emptyLabel="Use band preset"
          value={generationPreset?.id ?? ""}
          presets={presets}
          onChange={(value) =>
            assignDelegatedPreset(
              rpc,
              {
                method: "assignGenerationPreset",
                value,
                update: onGenerationChange,
              },
              props,
            )
          }
        />
        <p className="text-[11px] leading-5 text-muted-foreground">
          Rule of thumb: when the worker rewrites over 20% of a burst&apos;s
          output, that call site belongs back on Reliable.
        </p>
      </div>
      <div className="mt-3 border-t border-border/70 pt-3">
        <DelegatedSelect
          label="◎ Independent review"
          hint="independent review"
          description={REVIEWER_DELEGATED_GUIDANCE}
          emptyLabel="No reviewer"
          ariaLabel="Artifact reviewer preset"
          value={reviewerPreset?.id ?? ""}
          presets={presets}
          onChange={(value) =>
            assignDelegatedPreset(
              rpc,
              {
                method: "assignReviewPreset",
                value,
                update: onReviewerChange,
              },
              props,
            )
          }
        />
      </div>
    </>
  );
}
