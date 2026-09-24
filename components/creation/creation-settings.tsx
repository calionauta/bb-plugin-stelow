import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DisclosureChevron } from "../disclosure";

// Shared creation-form controls: planning depth + review gates (every
// creation flow), the strategy/technique picker (research, explore,
// follow-up rounds), the agent-config block, the project select, and the
// persistent submit-failure alert. Third use before abstracting is met —
// build, research, and explore creation read the same controls, so they
// live in one home instead of three pasted copies.

const APPETITE_OPTIONS = [
  { value: "Lean", label: "Lean", description: "Smallest useful cycle: 1–2 scopes and one direct direction." },
  { value: "Core", label: "Core", description: "Standard cycle: main job, obvious edge cases, and 3–5 scopes." },
  { value: "Complete", label: "Complete", description: "Broad exploration and deeper validation across the whole request." },
] as const;

const REVIEW_GATE_OPTIONS = [
  { value: "spec", label: "Product spec", description: "Review the shaped product specification and assumptions." },
  { value: "interface", label: "Interface direction", description: "Pick the interface proposal after reviewing the alternatives." },
  { value: "scope", label: "Build scopes", description: "Confirm the planned build scopes (IN/OUT)." },
  { value: "tech", label: "Technical plan", description: "Review the technical plan before execution." },
  { value: "diff", label: "Code diff", description: "Review the final code diff." },
] as const;

const REVIEW_GATE_VALUES = REVIEW_GATE_OPTIONS.map((option) => option.value);

// One-click templates write into the same multi-select state — they are
// shortcuts, never a second model. The six legacy rungs plus named
// shortcuts for combinations the ladder could never express.
const REVIEW_GATE_PRESETS: ReadonlyArray<{ label: string; gates: ReviewGate[] }> = [
  { label: "Auto", gates: [] },
  { label: "Product Spec Gate", gates: ["spec"] },
  { label: "Product Spec + Interface Gates", gates: ["spec", "interface"] },
  { label: "Product Spec + Interface + Scopes", gates: ["spec", "interface", "scope"] },
  { label: "Product Spec + Interface + Tech Review", gates: ["spec", "interface", "scope", "tech"] },
  { label: "Product Spec + Interface + Tech Review + Code Diff", gates: ["spec", "interface", "scope", "tech", "diff"] },
  { label: "Interface only", gates: ["interface"] },
  { label: "Spec + tech plan", gates: ["spec", "tech"] },
];

export type Appetite = (typeof APPETITE_OPTIONS)[number]["value"];
export type ReviewGate = (typeof REVIEW_GATE_OPTIONS)[number]["value"];
export type ReviewGates = ReviewGate[];

export type ResearchStrategyOption = { id: string; label: string; skill: string; blurb: string; emoji: string; keywords: string[] };

export function sanitizeReviewGates(value: unknown): ReviewGates {
  if (!Array.isArray(value)) return [];
  const valid: ReadonlySet<string> = new Set(REVIEW_GATE_VALUES);
  const gates = value.filter((entry): entry is ReviewGate => typeof entry === "string" && valid.has(entry));
  return REVIEW_GATE_VALUES.filter((atom): atom is ReviewGate => gates.includes(atom));
}

function reviewGatesSummary(gates: string[]): string {
  if (gates.length === 0) return "Auto — the agent decides everything";
  return gates.map((gate) => REVIEW_GATE_OPTIONS.find((option) => option.value === gate)?.label ?? gate).join(", ");
}

// Persistent submit-failure alert for the create dialogs. A toast alone
// fades; this stays until the next submit or reopen, and the throw that
// preserves the composer draft (the SDK clears it only on resolve) keeps
// the dialog open so the cause can be fixed and retried in place.
export function CreateCardAlert({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5">
      <span aria-hidden className="text-amber-600 dark:text-amber-400">⚠</span>
      <div>
        <p className="font-medium text-foreground">Couldn’t start this card</p>
        <p className="text-muted-foreground">{message} Nothing was lost — fix it above and submit again.</p>
      </div>
    </div>
  );
}

// Choice cards for planning depth + human review gates: every option visible
// with its description, real radio inputs (keyboard + screen-reader native),
// min-h-11 touch targets. Replaces a cramped native select whose gray micro
// copy failed lay users and low vision — same option values, new surface.
// labelHidden lets a collapsible wrapper own the visible heading so the
// legend is never announced twice.
function ChoiceCards<T extends string>({ label, hint, value, options, onChange, groupName, labelHidden = false }: { label: string; hint?: string; value: T; options: readonly { value: T; label: string; description: string }[]; onChange: (value: T) => void; groupName: string; labelHidden?: boolean }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      {labelHidden ? null : <legend className="text-sm font-medium text-foreground">{label}</legend>}
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
      <div className="grid gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label key={option.value} className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition focus-within:outline focus-within:outline-2 focus-within:outline-primary ${selected ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}>
              <input type="radio" name={groupName} value={option.value} checked={selected} onChange={() => onChange(option.value)} className="mt-0.5 size-4 shrink-0 accent-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-5 text-foreground">{option.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// A named visual boundary for configuration controls. It can wrap any
// settings content, so disclosures do not leave their revealed controls
// looking detached from the heading that opened them.
function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-md border bg-muted/20 p-3">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

// One preference category as a compact summary row: the title and the
// current value are always visible (so the setting is discoverable without
// scrolling), and one tap reveals the full ChoiceCards. Showing all nine
// radio cards at once pushed Pause for my review below the fold and read
// as a wall of text; a native select would hide the options again. This
// keeps both virtues: compact like a select, explicit like radio cards,
// reusing the same ChoiceCards instead of a second option renderer.
function CollapsibleChoiceCards<T extends string>({ label, hint, value, options, onChange, groupName }: { label: string; hint?: string; value: T; options: readonly { value: T; label: string; description: string }[]; onChange: (value: T) => void; groupName: string }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return (
    <div className="group rounded-md border bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`${label}: ${selected ? selected.label : "not set"}. ${open ? "Collapse" : "Change"}`}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <DisclosureChevron open={open} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-5 text-foreground">{label}</span>
          {selected ? <span className="block truncate text-xs leading-5 text-muted-foreground" title={selected.description}>{selected.label} — {selected.description}</span> : null}
        </span>
        <span className="shrink-0 text-xs font-medium text-primary">{open ? "Less" : "Change"}</span>
      </button>
      {open ? (
        <div className="border-t px-3 pb-3 pt-2">
          <ChoiceCards label={label} labelHidden hint={hint} value={value} options={options} onChange={onChange} groupName={groupName} />
        </div>
      ) : null}
    </div>
  );
}

export function WorkflowSettings({ appetite, reviewGates, onAppetiteChange, onReviewGatesChange, groupNamePrefix }: {
  appetite: Appetite;
  reviewGates: ReviewGates;
  onAppetiteChange: (value: Appetite) => void;
  onReviewGatesChange: (value: ReviewGates) => void;
  groupNamePrefix: string;
}) {
  return (
    <SettingsSection title="Workflow preferences" description="Planning depth sets how much the agent plans before building; review checkpoints are where it stops and waits for your decision. These are the board defaults — kept for every new card until you change them.">
      <CollapsibleChoiceCards label="Planning depth" hint="Deeper planning takes longer up front but means fewer surprises during execution." value={appetite} options={APPETITE_OPTIONS} onChange={onAppetiteChange} groupName={`${groupNamePrefix}-appetite`} />
      <ReviewGatePicker label="Pause for my review" hint="The agent stops at each checkpoint you pick and waits — nothing advances until you answer. Nothing picked means Auto: the agent decides everything itself." value={reviewGates} onChange={onReviewGatesChange} groupName={`${groupNamePrefix}-review`} />
    </SettingsSection>
  );
}

// Bulk selection for the checkpoint multi-select: all or nothing, writing
// into the same state as the individual checkboxes — never a second model.
function ReviewGateBulkActions({ onChange }: { onChange: (value: ReviewGates) => void }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => onChange([...REVIEW_GATE_VALUES])} className="min-h-11 cursor-pointer rounded-md border px-3 text-xs font-medium hover:bg-muted">Select all</button>
      <button type="button" onClick={() => onChange([])} className="min-h-11 cursor-pointer rounded-md border px-3 text-xs font-medium hover:bg-muted">Clear</button>
    </div>
  );
}

// One-click templates write into the same multi-select state — they are
// shortcuts, never a second model.
function ReviewGateTemplates({ onPick }: { onPick: (gates: ReviewGate[]) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">Start from a template:</p>
      <div className="flex flex-wrap gap-1.5">
        {REVIEW_GATE_PRESETS.map((preset) => (
          <button key={preset.label} type="button" onClick={() => onPick([...preset.gates])} title={preset.gates.length === 0 ? "Auto" : preset.gates.join(", ")} className="min-h-11 cursor-pointer rounded-md border px-2.5 text-xs font-medium hover:bg-muted">{preset.label}</button>
        ))}
      </div>
    </div>
  );
}

// One checkpoint checkbox row: the option's label plus its description,
// selected through the picker's toggle.
function ReviewGateOptionRow({ option, selected, groupName, onToggle }: { option: { value: ReviewGate; label: string; description: string }; selected: boolean; groupName: string; onToggle: (atom: ReviewGate) => void }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition focus-within:outline focus-within:outline-2 focus-within:outline-primary ${selected ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}>
      <input type="checkbox" name={groupName} value={option.value} checked={selected} onChange={() => onToggle(option.value)} className="mt-0.5 size-4 shrink-0 accent-primary" />
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-5 text-foreground">{option.label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{option.description}</span>
      </span>
    </label>
  );
}

// Review checkpoints as a pure multi-select: real checkboxes (keyboard +
// screen-reader native), Select all / Clear, and one-click preset
// templates that write into the same state. Empty ≡ Auto.
function ReviewGatePicker({ label, hint, value, onChange, groupName }: { label: string; hint?: string; value: ReviewGates; onChange: (value: ReviewGates) => void; groupName: string }) {
  const [open, setOpen] = useState(false);
  const summary = reviewGatesSummary(value);
  function toggle(atom: ReviewGate) {
    onChange(value.includes(atom) ? value.filter((entry) => entry !== atom) : [...value, atom].sort((a, b) => REVIEW_GATE_VALUES.indexOf(a) - REVIEW_GATE_VALUES.indexOf(b)));
  }
  return (
    <div className="group rounded-md border bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`${label}: ${summary}. ${open ? "Collapse" : "Change"}`}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <DisclosureChevron open={open} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-5 text-foreground">{label}</span>
          <span className="block truncate text-xs leading-5 text-muted-foreground" title={summary}>{summary}</span>
        </span>
        <span className="shrink-0 text-xs font-medium text-primary">{open ? "Less" : "Change"}</span>
      </button>
      {open ? (
        <div className="grid gap-2 border-t px-3 pb-3 pt-2">
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="sr-only">{label}</legend>
            {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
            <ReviewGateBulkActions onChange={onChange} />
            <div className="grid gap-2">
              {REVIEW_GATE_OPTIONS.map((option) => (
                <ReviewGateOptionRow key={option.value} option={option} selected={value.includes(option.value)} groupName={groupName} onToggle={toggle} />
              ))}
            </div>
          </fieldset>
          <ReviewGateTemplates onPick={onChange} />
        </div>
      ) : null}
    </div>
  );
}

// Agent configuration as its own block (not inline muted text): which
// agent runs, with a Configure entry point. Shared by the Build settings
// and the research creation dialog so it reads as one configuration.
export function AgentConfigBox({ lines, onConfigure }: { lines: string[]; onConfigure: () => void }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">Agent configuration</span>
        <Button size="sm" variant="outline" className="shrink-0" onClick={onConfigure}>Configure presets</Button>
      </div>
      <ul className="mt-0.5 space-y-0.5">
        {lines.map((line) => (
          <li key={line} className="text-xs text-muted-foreground">{line}</li>
        ))}
      </ul>
    </div>
  );
}
