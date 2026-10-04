import { useEffect, useState } from "react";
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

export function EditParkedSheet({ card, open, onClose, onSaved }: Props) {
  const rpc = useRpc<typeof rpcContract>();
  const [title, setTitle] = useState(card.displayName);
  const [prompt, setPrompt] = useState(card.prompt);
  const [projectId, setProjectId] = useState(card.projectId);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [presets, setPresets] = useState<
    Array<{
      id: string;
      name: string;
      provider_id: string | null;
      model_id: string | null;
      reasoning_level: string | null;
      permission_mode: string | null;
    }>
  >([]);
  const [presetId, setPresetId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(card.displayName);
    setPrompt(card.prompt);
    setProjectId(card.projectId);
  }, [card]);

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
          ((res as { presets?: typeof presets }).presets ??
            []) as typeof presets,
        ),
      )
      .catch(() => undefined);
  }, [open, rpc]);

  async function save() {
    setSaving(true);
    try {
      const trimmed = title.trim();
      if (trimmed !== card.displayName) {
        const res = await rpc.call("renameCard", {
          cardId: card.id,
          name: trimmed,
        });
        if (!res.ok) throw new Error(res.error ?? "Rename failed");
      }
      if (prompt.trim() !== card.prompt) {
        const res = await rpc.call("updateCardPrompt", {
          cardId: card.id,
          prompt,
        });
        if (!res.ok) throw new Error(res.error ?? "Prompt update failed");
      }
      if (projectId !== card.projectId) {
        const res = (await rpc.call(
          "updateCardWorkspace" as never,
          { cardId: card.id, projectId } as never,
        )) as { ok: boolean; error: string | null };
        if (!res.ok) throw new Error(res.error ?? "Project move failed");
      }
      if (presetId) {
        const res = (await rpc.call(
          "assignPreset" as never,
          { cardId: card.id, presetId } as never,
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
          <label className="block text-sm">
            <span className="text-muted-foreground">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-2 text-sm"
              maxLength={120}
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Description</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-2 text-sm"
              rows={4}
              disabled={!parked}
            />
            {!parked ? (
              <span className="text-xs text-amber-700">
                Locked — card already started/completed/archived
              </span>
            ) : null}
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Project</span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={!parked}
              className="mt-1 w-full rounded-md border px-2 py-2 text-sm"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {!parked ? (
              <span className="text-xs text-amber-700">
                Move requires empty parked card
              </span>
            ) : null}
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">
              Preset (provider / model / thinking / permission)
            </span>
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
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
            {!parked ? (
              <span className="text-xs text-amber-700">
                Preset change applies on next start
              </span>
            ) : null}
          </label>
          <div className="flex gap-2">
            <Button
              className="min-h-11 cursor-pointer"
              onClick={() => void save()}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
