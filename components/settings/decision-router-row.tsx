import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { DecisionRouterPoint, ManagerRpc, RouterPresetOption } from "./decision-api-types";
import { modeLabel } from "./preset-execution-values.mjs";

type RouterDraft = {
  mode: string;
  setMode: (value: string) => void;
  routeAt: string;
  setRouteAt: (value: string) => void;
  presetId: string;
  setPresetId: (value: string) => void;
};

type RouterNotice = { message: string; isError: boolean };

type RouterRowProps = {
  rpc: ManagerRpc;
  point: DecisionRouterPoint;
  presets: RouterPresetOption[];
  refresh: () => Promise<void>;
};

type SaveRouterInput = { mode?: string; presetId?: string | null; thresholds?: Record<string, number> };

function useRouterDraft(point: DecisionRouterPoint): RouterDraft {
  const [mode, setMode] = useState(point.mode);
  const [routeAt, setRouteAt] = useState(String(point.thresholds.routeAt ?? 0.6));
  const [presetId, setPresetId] = useState(point.presetId ?? "");

  useEffect(() => {
    setMode(point.mode);
    setRouteAt(String(point.thresholds.routeAt ?? 0.6));
    setPresetId(point.presetId ?? "");
  }, [point]);

  return { mode, setMode, routeAt, setRouteAt, presetId, setPresetId };
}

function useRouterSaves(props: RouterRowProps, draft: RouterDraft) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<RouterNotice>({ message: "", isError: false });

  function note(text: string, error: boolean) {
    setNotice({ message: text, isError: error });
  }

  async function runSave(input: SaveRouterInput) {
    setBusy(true);
    note("", false);
    try {
      const update = {
        point: props.point.id,
        mode: input.mode ?? props.point.mode,
        ...(input.presetId !== undefined ? { presetId: input.presetId } : {}),
        ...(input.thresholds ? { thresholds: input.thresholds } : {}),
      };
      const result = await props.rpc.call("setDecisionPoint", update);
      if (result.error) note(result.error, true);
      else {
        note("Saved.", false);
        await props.refresh();
      }
    } catch (err) {
      note(err instanceof Error ? err.message : "Save failed.", true);
    } finally {
      setBusy(false);
    }
  }

  function save(input: Omit<SaveRouterInput, "thresholds">) {
    return runSave(input);
  }

  function saveThreshold() {
    return runSave({
      mode: draft.mode,
      thresholds: { routeAt: Number(draft.routeAt) },
    });
  }

  return { busy, notice, note, save, saveThreshold };
}

type RouterControlProps = {
  point: DecisionRouterPoint;
  draft: RouterDraft;
  busy: boolean;
  save: (input: SaveRouterInput) => Promise<void>;
  note: (text: string, error: boolean) => void;
};

function RouterModeControls(props: RouterControlProps) {
  const { point, draft, busy, save, note } = props;
  const modeDirty = draft.mode !== point.mode;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate" title={point.description}>
        <span className="font-medium">{point.label}</span>
      </span>
      <select
        aria-label={`${point.label} mode`}
        className="cursor-pointer h-11 shrink-0 rounded-md border bg-background px-2 text-sm"
        value={draft.mode}
        disabled={busy}
        onChange={(event) => {
          draft.setMode(event.target.value);
          note("", false);
        }}
      >
        {point.modes.map((mode) => <option key={mode} value={mode}>{modeLabel(mode)}</option>)}
      </select>
      {modeDirty && draft.mode !== "preset" ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ mode: draft.mode })}>Save</Button>
      ) : null}
    </div>
  );
}

function RouterThresholdControls(props: {
  draft: RouterDraft;
  point: DecisionRouterPoint;
  busy: boolean;
  save: () => Promise<void>;
}) {
  const { draft, point, busy, save } = props;
  const dirty = Number(draft.routeAt) !== (point.thresholds.routeAt ?? 0.6);
  const valid = draft.routeAt.trim() !== ""
    && Number.isFinite(Number(draft.routeAt))
    && Number(draft.routeAt) >= 0
    && Number(draft.routeAt) <= 1;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <label className="flex flex-1 items-center gap-2">
        <span className="shrink-0">Act at confidence ≥</span>
        <Input
          type="number"
          min="0"
          max="1"
          step="0.05"
          className="h-11"
          value={draft.routeAt}
          onChange={(event) => draft.setRouteAt(event.target.value)}
        />
      </label>
      <Button size="sm" variant="outline" disabled={busy || !dirty || !valid} onClick={() => void save()}>Save</Button>
    </div>
  );
}

function PresetPicker(props: Pick<RouterControlProps, "point" | "draft" | "busy" | "save" | "note"> & {
  presets: RouterPresetOption[];
}) {
  const { point, presets, draft, busy, save, note } = props;
  return (
    <div className="flex items-center gap-2">
      <select
        aria-label={`${point.label} judge preset`}
        className="cursor-pointer h-11 flex-1 rounded-md border bg-background px-2 text-sm text-foreground"
        value={draft.presetId}
        disabled={busy}
        onChange={(event) => {
          draft.setPresetId(event.target.value);
          note("", false);
        }}
      >
        <option value="">Pick a preset…</option>
        {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || draft.presetId.trim() === ""}
        onClick={() => void save({ mode: "preset", presetId: draft.presetId.trim() })}
      >
        Save preset
      </Button>
    </div>
  );
}

function PresetJudgeControls(props: RouterControlProps & { presets: RouterPresetOption[] }) {
  const { point, presets } = props;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p className="text-[11px]">
        Preset judge asks one of your provider presets to answer this judgment in a hidden thread — one thread per judgment, archived right after.
        {" "}Pick this when you trust one of your own models more than the shared endpoint above. Any preset works, including one no workflow stage uses.
        {" "}Each judgment costs a provider turn; failures fall back to built-in rules.
      </p>
      {presets.length === 0 ? (
        <p className="text-[11px]" role="status">No presets yet — create one under Agent Presets, then pick it here.</p>
      ) : null}
      <PresetPicker {...props} presets={presets} />
      {point.mode === "preset" && point.presetId ? (
        <p className="text-[11px]">Judging on {presets.find((preset) => preset.id === point.presetId)?.name ?? point.presetId}.</p>
      ) : null}
    </div>
  );
}

export function DecisionRouterRow(props: RouterRowProps) {
  const draft = useRouterDraft(props.point);
  const saves = useRouterSaves(props, draft);
  const showThreshold = draft.mode === "api" || draft.mode === "preset";
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2">
      <RouterModeControls
        point={props.point}
        draft={draft}
        busy={saves.busy}
        save={saves.save}
        note={saves.note}
      />
      <p className="text-[11px] text-muted-foreground">{props.point.description}</p>
      {props.point.mode === "rules" && draft.mode === "rules" ? (
        <p className="text-[11px] text-muted-foreground">Built-in rules: {props.point.rules}</p>
      ) : null}
      {props.point.requires ? <p className="text-[11px] text-muted-foreground">Needs: {props.point.requires}</p> : null}
      {showThreshold ? (
        <RouterThresholdControls
          draft={draft}
          point={props.point}
          busy={saves.busy}
          save={saves.saveThreshold}
        />
      ) : null}
      {draft.mode === "preset" ? (
        <PresetJudgeControls
          point={props.point}
          presets={props.presets}
          draft={draft}
          busy={saves.busy}
          save={saves.save}
          note={saves.note}
        />
      ) : null}
      {saves.notice.message ? (
        <p
          className="text-[11px] text-destructive"
          role={saves.notice.isError ? "alert" : "status"}
        >
          {saves.notice.message}
        </p>
      ) : null}
    </div>
  );
}
