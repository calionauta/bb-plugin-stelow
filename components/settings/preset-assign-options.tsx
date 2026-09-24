import { useEffect, useRef, useState, type ReactNode } from "react";
import { PresetExecutionPicker } from "./preset-execution-picker";

export type PresetSummary = {
  id: string;
  name: string;
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: string;
  environmentKind: string;
  isDefault: boolean;
};

export type ProviderCatalog = {
  providers: Array<{
    id: string;
    displayName: string;
    modelsAvailable: boolean;
  }>;
  models: Array<{
    providerId: string;
    model: string;
    displayName: string;
  }>;
};

export type PresetExecutionValue = {
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: "accept-edits" | "auto" | "full";
};

type PresetAssignOptionsProps = {
  open: boolean;
  presets: PresetSummary[];
  catalog: ProviderCatalog;
  selected: string | null;
  customValue: PresetExecutionValue;
  onCustomChange: (value: PresetExecutionValue) => void;
  onSelect: (value: string) => void;
};

function PresetOptionText({
  title,
  subtitle,
}: {
  title: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium">{title}</span>
      {subtitle ? (
        <span className="block truncate font-mono text-[11px] text-muted-foreground">
          {subtitle}
        </span>
      ) : null}
    </span>
  );
}

function PresetOptionRow({
  selected,
  value,
  title,
  subtitle,
  onSelect,
}: {
  selected: string | null;
  value: string;
  title: React.ReactNode;
  subtitle?: string;
  onSelect: (value: string) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${
        selected === value ? "border-primary bg-primary/10" : "border-border"
      }`}
    >
      <input
        type="radio"
        name="card-preset"
        checked={selected === value}
        onChange={() => onSelect(value)}
        className="accent-primary"
      />
      <PresetOptionText title={title} subtitle={subtitle} />
    </label>
  );
}

function CustomPresetOption({
  selected,
  value,
  onChange,
  onSelect,
}: {
  selected: boolean;
  value: PresetExecutionValue;
  onChange: (value: PresetExecutionValue) => void;
  onSelect: () => void;
}) {
  return (
    <div>
      <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Custom provider + model
      </p>
      <label
        className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm ${
          selected ? "border-primary bg-primary/10" : "border-border"
        }`}
      >
        <input
          type="radio"
          name="card-preset"
          checked={selected}
          onChange={onSelect}
          className="accent-primary mt-1"
        />
        <span className="min-w-0 flex-1" onClick={(event) => event.stopPropagation()}>
          <PresetExecutionPicker value={value} onChange={onChange} />
        </span>
      </label>
    </div>
  );
}

function ProviderPresetOptions({
  catalog,
  selected,
  onSelect,
}: {
  catalog: ProviderCatalog;
  selected: string | null;
  onSelect: (value: string) => void;
}) {
  return catalog.providers.map((provider) => {
    const providerModels = catalog.models.filter(
      (model) => model.providerId === provider.id,
    );
    return (
      <div key={provider.id} className="pt-1">
        <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {provider.displayName} · {providerModels.length}
        </p>
        <div className="space-y-1">
          {providerModels.map((model) => (
            <PresetOptionRow
              key={`${provider.id}/${model.model}`}
              selected={selected}
              value={`model:${provider.id}/${model.model}`}
              title={model.displayName}
              subtitle={`${provider.id}/${model.model}`}
              onSelect={onSelect}
            />
          ))}
          {providerModels.length === 0 ? (
            <p className="px-1 text-[11px] text-muted-foreground">
              {provider.modelsAvailable
                ? "No models listed for this provider."
                : "Couldn't load models — use Custom below."}
            </p>
          ) : null}
        </div>
      </div>
    );
  });
}

function useScrollFade(
  open: boolean,
  presets: PresetSummary[],
  catalog: ProviderCatalog,
) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const updateFade = () => {
    const element = listRef.current;
    if (element) {
      const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
      setCanScrollDown(remaining > 8);
    }
  };
  useEffect(() => {
    updateFade();
  }, [open, presets, catalog]);
  return { listRef, canScrollDown, updateFade };
}

function PresetOptionList({
  open,
  presets,
  catalog,
  children,
}: {
  open: boolean;
  presets: PresetSummary[];
  catalog: ProviderCatalog;
  children: ReactNode;
}) {
  const { listRef, canScrollDown, updateFade } = useScrollFade(open, presets, catalog);
  return (
    <div className="relative">
      <div
        ref={listRef}
        onScroll={updateFade}
        className="max-h-64 space-y-1 overflow-auto"
      >
        {children}
      </div>
      {canScrollDown ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent"
        />
      ) : null}
    </div>
  );
}

export function PresetAssignOptions({
  open,
  presets,
  catalog,
  selected,
  customValue,
  onCustomChange,
  onSelect,
}: PresetAssignOptionsProps) {
  const defaultPreset = presets.find((preset) => preset.isDefault) ?? null;
  const customPresets = presets.filter((preset) => !preset.isDefault);
  const optionCount = customPresets.length + catalog.models.length + 2;
  return (
    <>
      <p className="text-[11px] text-muted-foreground">
        {optionCount} options · {catalog.providers.length} providers — scroll for more below.
      </p>
      <PresetOptionList open={open} presets={presets} catalog={catalog}>
        <CustomPresetOption
          selected={selected === "custom"}
          value={customValue}
          onChange={onCustomChange}
          onSelect={() => onSelect("custom")}
        />
        <PresetOptionRow
          selected={selected}
          value="default"
          title={<>Board default{defaultPreset ? ` · ${defaultPreset.name}` : ""}</>}
          subtitle={defaultPreset ? `${defaultPreset.providerId}/${defaultPreset.modelId}` : undefined}
          onSelect={onSelect}
        />
        {customPresets.map((preset) => (
          <PresetOptionRow
            key={preset.id}
            selected={selected}
            value={`preset:${preset.id}`}
            title={preset.name}
            subtitle={`${preset.providerId}/${preset.modelId}`}
            onSelect={onSelect}
          />
        ))}
        <ProviderPresetOptions catalog={catalog} selected={selected} onSelect={onSelect} />
        {presets.length === 0 && catalog.providers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No presets or providers available.</p>
        ) : null}
      </PresetOptionList>
    </>
  );
}
