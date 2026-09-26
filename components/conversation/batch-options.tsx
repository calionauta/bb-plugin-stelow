import { Button } from "@/components/ui/button";
import { DisclosureChevron } from "../disclosure";
import { splitOptionDescription } from "../../lib/split-question-presentation.mjs";
import type {
  AskArtifact,
  ArtifactViewerMode,
  BatchItem,
  OpenArtifactHandler,
} from "./batch-types";

// The options of the current question: one row per option, and the list that
// maps them. Split out of the stepper because the row is the widest thing in
// the conversation and the stepper's own budget is the conversation's, not the
// row's.

function artifactViewerModeForOption(label: string): ArtifactViewerMode {
  // An approval is a decision after reading, not a request to alter the
  // document. All other choices — especially Request/Review changes — keep
  // the full quote-and-comment path to communicate precise feedback.
  return /\b(approve|accept|proceed)\b/i.test(label) ? "review" : "comment";
}

// Per-option evidence: the document opens from inside the option row
// (right side), the inline glance expands below. The artifact opens in the
// viewer where a file opener exists (card), and degrades to a plain
// filename where it doesn't (thread) — never a dead button pretending
// to open, never one shared button after the options.
// A preview exists so the reader can judge an option WITHOUT opening
// anything. Hiding it behind a disclosure defeats that: on a real card the
// previews were 27-104 characters, so clicking "Preview" revealed two lines
// that said no more than the label beside it — two clicks for less
// information. A preview short enough to read at a glance is shown; only a
// genuinely long one earns a disclosure.
const AUTO_REVEAL_PREVIEW_CHARS = 280;

// A preview short enough to read at a glance is shown; only a genuinely long
// one earns a disclosure. Its summary carries the same 44px target and focus
// ring as every other disclosure in the conversation, so a keyboard reader
// meets the same affordance wherever one appears.
const DISCLOSURE_SUMMARY_CLASS = [
  "inline-flex min-h-11 cursor-pointer items-center gap-1.5",
  "text-xs font-medium text-primary hover:underline",
  "focus-visible:outline focus-visible:outline-2",
  "focus-visible:outline-primary",
].join(" ");

// The select control of a row: the whole left half of the row is the target,
// so it carries the same 44px minimum and focus ring as every other control.
const PICK_CONTROL_CLASS = [
  "flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3",
  "p-3 text-left text-sm text-foreground",
  "focus-visible:outline focus-visible:outline-2",
  "focus-visible:outline-primary",
].join(" ");

function OptionPreview({ preview }: { preview: string | null }) {
  if (!preview) return null;
  const text = preview.trim();
  const body = <pre className="whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{text}</pre>;
  if (text.length <= AUTO_REVEAL_PREVIEW_CHARS) {
    return (
      <div className="ml-1 border-l-2 border-muted pl-2">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">What this looks like</p>
        {body}
      </div>
    );
  }
  return (
    <div className="ml-1 space-y-1 border-l-2 border-muted pl-2">
      <details className="group">
        <summary className={DISCLOSURE_SUMMARY_CLASS}>
          <DisclosureChevron />
          Preview
        </summary>
        {body}
      </details>
    </div>
  );
}

// The option's own document, rendered inside the row: not a second decision.
// It sits within the row instead of forming a slab beside it, and borrows the
// shared outline treatment so it harmonizes with the amber panel and the
// primary accents instead of introducing a third color.
//
// The label names the FILE. "Open document" alone made the reader guess what
// they were about to open, and a filename buried in a hover-only title is not
// a label. When the document was inherited from a sibling it says so, because
// the same brief on four rows otherwise reads as four pieces of evidence about
// four different options. Where no viewer exists (a thread) it degrades to the
// bare filename, never to a dead button pretending to open.
function OptionDocument({ artifact, optionLabel, artifactInherited, onOpenArtifact }: {
  artifact: AskArtifact;
  optionLabel: string;
  artifactInherited: boolean;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  if (!onOpenArtifact) {
    return (
      <span
        className="inline-flex shrink-0 items-center self-center px-1 text-[11px] text-muted-foreground"
        title={artifact.path}
      >
        {artifact.display}
      </span>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => onOpenArtifact(artifact, artifactViewerModeForOption(optionLabel), optionLabel)}
      title={artifactInherited
        ? `${artifact.display} — the brief shared by every option, not this option's own document`
        : `${artifact.display} — this option's own document`}
      aria-label={artifactInherited
        ? `Open the shared brief ${artifact.display}, the same document every option links to`
        : `Open this option's document ${artifact.display}`}
      className="mr-2 min-h-11 max-w-[16rem] shrink-0 gap-1 self-center"
    >
      <span className="truncate">
        {artifactInherited ? "Shared brief" : "Open"}: {artifact.display}
      </span>
      <span aria-hidden>↗</span>
    </Button>
  );
}

// The select control: the mark, the label, and the description. It is the
// left half of a row and the whole decision — the document sits beside it, not
// inside it, so picking never opens anything by accident.
function OptionPickControl({ label, description, active, multiple, isKeepOption, onPick }: {
  label: string;
  description: string;
  active: boolean;
  multiple: boolean;
  isKeepOption: boolean;
  onPick: () => void;
}) {
  const pickShape = multiple && !isKeepOption ? "rounded-sm" : "rounded-full";
  const pickFrame = active
    ? "border-primary bg-primary text-primary-foreground"
    : "border-muted-foreground/70 bg-background";
  return (
    <button
      role={multiple ? "checkbox" : "radio"}
      aria-checked={active}
      onClick={onPick}
      className={PICK_CONTROL_CLASS}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center border-2 text-xs font-bold ${pickShape} ${pickFrame}`}
      >
        {active ? "✓" : ""}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {description ? (
          <span className="mt-1 block whitespace-pre-line text-xs leading-5 text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

// One option row: the select control, the label, the per-option document,
// and the inline preview glance.
function BatchOptionRow({ option, active, multiple, isKeepOption, description, onPick, onOpenArtifact }: {
  option: BatchItem["options"][number];
  active: boolean;
  multiple: boolean;
  isKeepOption: boolean;
  description: string;
  onPick: () => void;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  const artifact = option.artifact;
  const rowFrame = `flex min-h-11 items-stretch overflow-hidden rounded-md border ${
    active ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/50"
  }`;
  return (
    <div className={`space-y-1 ${isKeepOption ? "mt-2 border-t border-amber-500/30 pt-2" : ""}`}>
      <div className={rowFrame}>
        <OptionPickControl
          label={option.label}
          description={description}
          active={active}
          multiple={multiple}
          isKeepOption={isKeepOption}
          onPick={onPick}
        />
        {artifact ? (
          <OptionDocument
            artifact={artifact}
            optionLabel={option.label}
            artifactInherited={option.artifactInherited === true}
            onOpenArtifact={onOpenArtifact}
          />
        ) : null}
      </div>
      <OptionPreview preview={option.preview} />
    </div>
  );
}

// Option list: one row per option of the current question, with split
// descriptions resolved per row.
export function BatchOptionList({ current, isSplitProposal, splitKeepLabel, selected, onPick, onOpenArtifact }: {
  current: BatchItem;
  isSplitProposal: boolean;
  splitKeepLabel: string;
  selected: Record<string, string[]>;
  onPick: (question: BatchItem, label: string) => void;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  return (
    <div className="grid gap-1" role={current.multiple ? "group" : "radiogroup"} aria-label={current.title}>
      {current.options.map((option) => {
        const active = (selected[current.id] ?? []).includes(option.label);
        const isKeepOption = isSplitProposal && option.label === splitKeepLabel;
        return (
          <BatchOptionRow
            key={option.label}
            option={option}
            active={active}
            multiple={current.multiple}
            isKeepOption={isKeepOption}
            description={isSplitProposal ? splitOptionDescription(option.description) : option.description}
            onPick={() => onPick(current, option.label)}
            onOpenArtifact={onOpenArtifact}
          />
        );
      })}
    </div>
  );
}
