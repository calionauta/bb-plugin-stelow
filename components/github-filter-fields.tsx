import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Shared GitHub filter fields for the Import and Auto-import tabs. Both
// tabs filter the same issue universe (labels AND project, optional
// assignee/authors), so they share one visual language: visible labels,
// h-11 controls, chips for multi-value label sets. Local useState only —
// every change notifies the parent, which owns fetching.
export function LabelChipsField({ labels, onChange, suggestions, listId, label, hint }: {
  labels: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  listId: string;
  label: string;
  hint: string;
}) {
  const [draft, setDraft] = useState("");
  function add(raw: string) {
    const clean = raw.trim();
    if (!clean || labels.includes(clean)) return;
    onChange([...labels, clean].slice(0, 10));
    setDraft("");
  }
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5" aria-label={`${label} values`}>
        {labels.map((entry) => (
          <span key={entry} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-primary/10 px-2.5 text-xs font-medium text-primary">{entry}<button onClick={() => onChange(labels.filter((item) => item !== entry))} className="cursor-pointer rounded-full px-1 hover:bg-primary/20" aria-label={`Remove label ${entry}`}>×</button></span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(draft); } }} placeholder="stelow-work" aria-label={`Add ${label.toLowerCase()}`} className="h-11 flex-1" list={listId} autoComplete="off" />
        <datalist id={listId}>
          {suggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>
        <Button variant="outline" className="h-11" onClick={() => add(draft)}>Add</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

export function ProjectFilterSelect({ projects, value, onChange, label, allowAll, extraOptions }: {
  projects: Array<{ id: string; name: string }>;
  value: string;
  onChange: (next: string) => void;
  label: string;
  allowAll: boolean;
  extraOptions?: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground"><span>{label}</span>
      <select
        aria-label={label}
        className="h-11 w-full cursor-pointer rounded-md border bg-background px-2 text-sm font-normal text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {allowAll ? null : <option value="">Pick a project…</option>}
        {allowAll ? <option value="all">All projects</option> : null}
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        {(extraOptions ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
