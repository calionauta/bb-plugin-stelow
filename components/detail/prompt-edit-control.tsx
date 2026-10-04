import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export const PROMPT_MAX_CHARS = 20_000;

const PENCIL_CLASS = "inline-flex min-h-8 min-w-8 cursor-pointer items-center justify-center "
  + "rounded-md text-muted-foreground hover:bg-muted hover:text-foreground "
  + "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
const TEXTAREA_CLASS = "max-h-64 min-h-24 w-full overflow-y-auto rounded-md border border-input "
  + "bg-background px-3 py-2 text-[15px] leading-relaxed text-foreground "
  + "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60";

export function isPromptEditable(workerThreadId: string | null, status: string): boolean {
  return workerThreadId == null && (status === "draft" || status === "pending");
}

async function savePromptEdit({ rpc, cardId, draft, onSaved, setEditing, setError, setSaving }: {
  rpc: { call: (method: "updateCardPrompt", input: { cardId: string; prompt: string }) => Promise<{ ok: boolean; error: string | null }> };
  cardId: string;
  draft: string;
  onSaved: () => void;
  setEditing: (value: boolean) => void;
  setError: (value: string | null) => void;
  setSaving: (value: boolean) => void;
}): Promise<void> {
  const trimmed = draft.trim();
  if (trimmed.length === 0 || trimmed.length > PROMPT_MAX_CHARS) {
    setError(trimmed.length === 0 ? "The description is empty." : "The description is too long.");
    return;
  }
  setSaving(true);
  setError(null);
  try {
    const result = await rpc.call("updateCardPrompt", { cardId, prompt: draft });
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    setEditing(false);
    toast.success(`Description saved ${new Date().toLocaleTimeString()}`);
    onSaved();
  } catch (thrown) {
    setError(thrown instanceof Error ? thrown.message : "Could not save.");
  } finally {
    setSaving(false);
  }
}

function PromptRead({ prompt, editable, onEdit }: {
  prompt: string;
  editable: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start gap-1 pt-1">
      <p className="min-w-0 flex-1 text-[15px] leading-relaxed text-foreground">{prompt}</p>
      {editable ? (
        <button
          type="button"
          onClick={onEdit}
          title="Edit description"
          aria-label="Edit description"
          className={PENCIL_CLASS}
        >
          <Icon name="Edit" className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function EditorActions({ saving, invalid, count, onSave, onCancel }: {
  saving: boolean;
  invalid: boolean;
  count: number;
  onSave: () => void;
  onCancel: () => void;
}) {
  const tooLong = count > PROMPT_MAX_CHARS;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={saving || invalid} onClick={onSave} className="min-h-11 cursor-pointer">
        {saving ? "Saving…" : "Save"}
      </Button>
      <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel} className="min-h-11 cursor-pointer">
        Cancel
      </Button>
      <span className={`ml-auto text-xs tabular-nums ${tooLong ? "font-medium text-destructive" : "text-muted-foreground"}`} aria-live="polite">
        {count.toLocaleString()} / {PROMPT_MAX_CHARS.toLocaleString()}
      </span>
    </div>
  );
}

function PromptEditor({ draft, saving, error, onDraft, onSave, onCancel }: {
  draft: string;
  saving: boolean;
  error: string | null;
  onDraft: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const trimmed = draft.trim();
  return (
    <div className="space-y-2 pt-1">
      <textarea
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") onSave();
          if (event.key === "Escape") onCancel();
        }}
        aria-label="Card description"
        rows={4}
        disabled={saving}
        autoFocus
        className={TEXTAREA_CLASS}
      />
      <EditorActions
        saving={saving}
        invalid={trimmed.length === 0 || trimmed.length > PROMPT_MAX_CHARS}
        count={trimmed.length}
        onSave={onSave}
        onCancel={onCancel}
      />
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <p className="text-[11px] text-muted-foreground">Enter adds a line · Ctrl+Enter saves · Esc discards</p>
    </div>
  );
}

// One shared prompt editor for the build, research, and explore detail
// heroes. Rendered in place of the static prompt paragraph: pencil affordance
// when parked, textarea with Save/Cancel while editing, static text otherwise.
// Editability mirrors the server gate (worker-less pre-start statuses); the
// server remains the gate, this only decides what to offer.
export function PromptEdit({ cardId, prompt, workerThreadId, status, onSaved }: {
  cardId: string;
  prompt: string;
  workerThreadId: string | null;
  status: string;
  onSaved: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editable = isPromptEditable(workerThreadId, status);

  if (!editing) {
    return <PromptRead prompt={prompt} editable={editable} onEdit={() => { setDraft(prompt); setError(null); setEditing(true); }} />;
  }

  function save() {
    if (saving) return;
    void savePromptEdit({ rpc, cardId, draft, onSaved, setEditing, setError, setSaving });
  }

  return (
    <PromptEditor
      draft={draft}
      saving={saving}
      error={error}
      onDraft={setDraft}
      onSave={save}
      onCancel={() => { setEditing(false); setError(null); }}
    />
  );
}
