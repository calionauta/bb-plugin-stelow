import { useEffect, useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { rpcContract } from "../../server";

type Props = {
  card: {
    id: string;
    displayName: string;
    prompt: string;
    projectId: string;
    status: string;
    workerThreadId: string | null;
  };
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

type SheetRpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type ParkedCard = Props["card"];

type PresetOption = {
  id: string;
  name: string;
  provider_id: string | null;
  model_id: string | null;
  reasoning_level: string | null;
  permission_mode: string | null;
};

// The form state, reset whenever a different card arrives. The sheet stays
// mounted across cards, so without the reset it would show the last card's
// edits on the next one.
function useParkedCardFields(card: ParkedCard) {
  const [title, setTitle] = useState(card.displayName);
  const [prompt, setPrompt] = useState(card.prompt);
  const [projectId, setProjectId] = useState(card.projectId);
  const [presetId, setPresetId] = useState<string>("");
  useEffect(() => {
    setTitle(card.displayName);
    setPrompt(card.prompt);
    setProjectId(card.projectId);
  }, [card]);
  return { title, setTitle, prompt, setPrompt, projectId, setProjectId, presetId, setPresetId };
}

type ParkedCardFields = ReturnType<typeof useParkedCardFields>;

// Projects and presets load only while the sheet is open: both lists change
// on a human timescale, and loading them for a closed sheet is a request
// nobody asked for.
function useProjectPresetOptions(rpc: SheetRpc, open: boolean) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [presets, setPresets] = useState<PresetOption[]>([]);
  useEffect(() => {
    if (!open) return;
    void rpc
      .call("projects", {})
      .then((res) => setProjects(res.projects ?? []))
      .catch(() => undefined);
    void rpc
      .call("listPresets" as never, {} as never)
      .then((res) =>
        setPresets(
          ((res as { presets?: PresetOption[] }).presets ?? []) as PresetOption[],
        ),
      )
      .catch(() => undefined);
  }, [open, rpc]);
  return { projects, presets };
}

// One save across four independent mutations: rename, prompt, project move,
// preset. Sequential and all-or-nothing per field — a failed rename must not
// silently keep going, and the first failure names itself.
async function saveParkedCard({ rpc, card, fields, onSaved, onClose, setSaving }: {
  rpc: SheetRpc;
  card: ParkedCard;
  fields: ParkedCardFields;
  onSaved: () => void;
  onClose: () => void;
  setSaving: (saving: boolean) => void;
}) {
  setSaving(true);
  try {
    const trimmed = fields.title.trim();
    if (trimmed !== card.displayName) {
      const res = await rpc.call("renameCard", {
        cardId: card.id,
        name: trimmed,
      });
      if (!res.ok) throw new Error(res.error ?? "Rename failed");
    }
    if (fields.prompt.trim() !== card.prompt) {
      const res = await rpc.call("updateCardPrompt", {
        cardId: card.id,
        prompt: fields.prompt,
      });
      if (!res.ok) throw new Error(res.error ?? "Prompt update failed");
    }
    if (fields.projectId !== card.projectId) {
      const res = (await rpc.call(
        "updateCardWorkspace" as never,
        { cardId: card.id, projectId: fields.projectId } as never,
      )) as { ok: boolean; error: string | null };
      if (!res.ok) throw new Error(res.error ?? "Project move failed");
    }
    if (fields.presetId) {
      const res = (await rpc.call(
        "assignPreset" as never,
        { cardId: card.id, presetId: fields.presetId } as never,
      )) as { ok: boolean; error: string | null };
      if (!res.ok) throw new Error(res.error ?? "Preset assign failed");
    }
    toast.success("Saved");
    onSaved();
    onClose();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Save failed");
  } finally {
    setSaving(false);
  }
}

// One labeled row: the control plus the lock note a started card earns.
// Started cards render the same rows disabled with the reason attached,
// never a missing field that reads as "this card has no project".
function FieldShell({ label, lockedNote, children }: {
  label: string;
  lockedNote: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
      {lockedNote ? (
        <span className="text-xs text-amber-700">{lockedNote}</span>
      ) : null}
    </label>
  );
}

export function EditParkedSheet({ card, open, onClose, onSaved }: Props) {
  const rpc = useRpc<typeof rpcContract>();
  const fields = useParkedCardFields(card);
  const { projects, presets } = useProjectPresetOptions(rpc, open);
  const [saving, setSaving] = useState(false);
  const parked =
    !card.workerThreadId &&
    (card.status === "draft" || card.status === "pending");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit parked card</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <ParkedTextFields fields={fields} parked={parked} />
          <ParkedSelectFields fields={fields} projects={projects} presets={presets} parked={parked} />
          <ParkedCardActions
            saving={saving}
            onSave={() => void saveParkedCard({ rpc, card, fields, onSaved, onClose, setSaving })}
            onClose={onClose}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Title plus description: the free-text half of the form. Started cards read
 * the same rows disabled with the reason attached.
 */
function ParkedTextFields({ fields, parked }: { fields: ParkedCardFields; parked: boolean }) {
  return (
    <>
      <FieldShell label="Title" lockedNote={null}>
        <input
          value={fields.title}
          onChange={(e) => fields.setTitle(e.target.value)}
          className="mt-1 w-full rounded-md border px-2 py-2 text-sm"
          maxLength={120}
        />
      </FieldShell>
      <FieldShell
        label="Description"
        lockedNote={parked ? null : "Locked — card already started/completed/archived"}
      >
        <textarea
          value={fields.prompt}
          onChange={(e) => fields.setPrompt(e.target.value)}
          className="mt-1 w-full rounded-md border px-2 py-2 text-sm"
          rows={4}
          disabled={!parked}
        />
      </FieldShell>
    </>
  );
}

/**
 * Project plus preset: the picker half. Both lists load only while open,
 * and both stay disabled with their reason on a started card.
 */
function ParkedSelectFields({ fields, projects, presets, parked }: {
  fields: ParkedCardFields;
  projects: Array<{ id: string; name: string }>;
  presets: PresetOption[];
  parked: boolean;
}) {
  return (
    <>
      <FieldShell
        label="Project"
        lockedNote={parked ? null : "Move requires empty parked card"}
      >
        <select
          value={fields.projectId}
          onChange={(e) => fields.setProjectId(e.target.value)}
          disabled={!parked}
          className="mt-1 w-full rounded-md border px-2 py-2 text-sm"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </FieldShell>
      <FieldShell
        label="Preset (provider / model / thinking / permission)"
        lockedNote={parked ? null : "Preset change applies on next start"}
      >
        <select
          value={fields.presetId}
          onChange={(e) => fields.setPresetId(e.target.value)}
          disabled={!parked}
          className="mt-1 w-full rounded-md border px-2 py-2 text-sm"
        >
          <option value="">Keep current</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.provider_id}/{p.model_id} {p.reasoning_level}{" "}
              {p.permission_mode}
            </option>
          ))}
        </select>
      </FieldShell>
    </>
  );
}

/**
 * Save plus Cancel. Apart because the sheet's decision — what the rows say —
 * and its exit — how they are kept or dropped — are different concerns, and
 * the exit never changes when a fifth row arrives.
 */
function ParkedCardActions({ saving, onSave, onClose }: {
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex gap-2">
      <Button
        className="min-h-11 cursor-pointer"
        onClick={onSave}
        disabled={saving}
      >
        {saving ? "Saving…" : "Save"}
      </Button>
      <Button
        variant="outline"
        className="min-h-11 cursor-pointer"
        onClick={onClose}
      >
        Cancel
      </Button>
    </div>
  );
}
