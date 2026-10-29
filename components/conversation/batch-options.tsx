import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { MermaidDiagram } from "../detail/mermaid-diagram";
import { DisclosureChevron } from "../disclosure";
import { EmbeddedBrief, embeddedBriefFor } from "./embedded-brief";
import { artifactViewerModeForOption } from "../../lib/question-presentation.mjs";
import { previewShape } from "../../lib/question-preview.mjs";
import { splitOptionDescription } from "../../lib/question-presentation.mjs";
import type {
  AskArtifact,
  BatchItem,
  OpenArtifactHandler,
} from "./batch-types";

// The options of the current question: one row per option, and the list that
// maps them. Split out of the stepper because the row is the widest thing in
// the conversation and the stepper's own budget is the conversation's, not the
// row's.

// Per-option evidence: the document opens from inside the option row
// (right side), the preview sits at the END of the same option. The artifact
// opens in the viewer where a file opener exists (card), and degrades to a
// plain filename where it doesn't (thread) — never a dead button pretending to
// open, never one shared button after the options.
//
// The preview is evidence the reader judges the option BY, but a long one is
// not the row: four wireframes open at once made the question taller than the
// screen and pushed the options apart. The pattern is a peek plus an explicit
// control — the first lines stay visible with a fade, and one labelled button
// (shared chevron, aria-expanded) reveals the rest. A diagram has no useful
// partial state, so it starts behind "Show diagram" and draws whole. Short
// text (under five lines) is already a glance and renders with no control at
// all; a control that reveals nothing is a control that does nothing.

// The select control of a row: the label and its full description are the whole
// target, so it carries the 44px minimum and the shared focus ring. It fills
// the row's text line; the preview below it is a sibling, never a descendant —
// a preview nested inside the pick control is invalid markup and clicking it
// would pick.
const PICK_CONTROL_CLASS = [
  "flex min-h-11 w-full cursor-pointer items-start gap-3",
  "p-3 text-left text-sm text-foreground",
  "focus-visible:outline focus-visible:outline-2",
  "focus-visible:outline-primary",
].join(" ");

// The preview sits at the END of the option, inside its own frame, indented to
// the label (12px padding + 20px mark + 12px gap). It reads as part of the
// option it explains rather than as a control floating below it.
const INSIDE_OPTION = "border-t border-border/50 pl-11 pr-2 pb-2";

// A preview deeper than this is a document, not a glance. Five lines is about
// the height of the option's own description; 360 characters catches a wide
// wireframe whose line count is small but whose box would still dominate.
const TEXT_PEEK_LINES = 5;
const TEXT_PEEK_CHARS = 360;
const PREVIEW_BUTTON_CLASS = [
  "mt-1 flex min-h-11 w-full cursor-pointer items-center justify-start gap-1.5",
  "rounded-md px-1 text-xs font-medium text-foreground hover:bg-muted/60",
].join(" ");

function PreviewToggle({ open, panelId, label, onToggle }: {
  open: boolean;
  panelId: string;
  label: string;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
      className={PREVIEW_BUTTON_CLASS}
    >
      <DisclosureChevron open={open} />
      {open ? `Hide ${label}` : `Show ${label}`}
    </Button>
  );
}

function TextPreview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const needsDisclosure = text.split("\n").length > TEXT_PEEK_LINES || text.length > TEXT_PEEK_CHARS;
  if (!needsDisclosure) {
    return (
      <pre className="whitespace-pre rounded-md border bg-background/60 p-2 font-mono text-[13px] leading-relaxed">
        {text}
      </pre>
    );
  }
  return (
    <div>
      <div className="relative">
        <pre
          id={panelId}
          className={`whitespace-pre rounded-md border bg-background/60 p-2 font-mono text-[13px] leading-relaxed ${
            open ? "" : "max-h-[8.5rem] overflow-hidden"
          }`}
        >
          {text}
        </pre>
        {open ? null : (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background via-background/85 to-transparent"
          />
        )}
      </div>
      <PreviewToggle
        open={open}
        panelId={panelId}
        label="preview"
        onToggle={() => setOpen((value) => !value)}
      />
    </div>
  );
}

function DiagramPreview({ source, prose }: { source: string; prose: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!open) {
    return (
      <div id={panelId}>
        <p className="mb-1 text-xs text-muted-foreground">
          A diagram is the clearest preview here; it opens whole rather than cut off.
        </p>
        <PreviewToggle open={false} panelId={panelId} label="diagram" onToggle={() => setOpen(true)} />
      </div>
    );
  }
  return (
    <div id={panelId} className="space-y-2">
      {prose ? (
        <p className="whitespace-pre-line break-words text-sm leading-6 text-muted-foreground">{prose}</p>
      ) : null}
      <MermaidDiagram source={source} title="Option preview diagram" />
      <PreviewToggle open panelId={panelId} label="diagram" onToggle={() => setOpen(false)} />
    </div>
  );
}

function OptionPreview({ preview }: { preview: string | null }) {
  const shape = previewShape(preview);
  if (!shape) return null;
  return (
    <figure className={INSIDE_OPTION}>
      <figcaption className="mb-1 pt-2 text-[13px] font-semibold text-muted-foreground">
        What this looks like
      </figcaption>
      {shape.kind === "mermaid"
        ? <DiagramPreview source={shape.source} prose={shape.prose} />
        : <TextPreview text={shape.text} />}
    </figure>
  );
}

// The option's own document, rendered inside the row: not a second decision.
// It sits within the row instead of forming a slab beside it, and borrows the
// shared outline treatment so it harmonizes with the amber decision section and
// the primary accents instead of introducing a third color.
//
// The label names the FILE with one verb everywhere. "Open document" alone
// made the reader guess what they were about to open, and a filename buried
// in a hover-only title is not a label. When the document was inherited from
// a sibling it carries a small Shared chip instead of a second verb, because
// the same brief on four rows otherwise reads as four pieces of evidence
// about four different options — while two verbs ("Open" vs "Shared brief")
// for one action read as two different actions. Where no viewer exists (a
// thread) it degrades to the bare filename, never to a dead button
// pretending to open.
function OptionDocument({ artifact, optionLabel, artifactInherited, onOpenArtifact }: {
  artifact: AskArtifact;
  optionLabel: string;
  artifactInherited: boolean;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  if (!onOpenArtifact) {
    return (
      <span
        className="inline-flex shrink-0 items-center self-center px-2 text-xs text-muted-foreground"
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
        Open: {artifact.display}
      </span>
      {artifactInherited ? (
        <span
          className="shrink-0 rounded border px-1 text-xs font-medium text-muted-foreground"
          title="The brief shared by every option, not this option's own document"
        >
          Shared
        </span>
      ) : null}
      <span aria-hidden>↗</span>
    </Button>
  );
}

// The select control: the mark, the label, and the description. It is the
// whole decision left of the document button — the document sits beside it, not
// inside it, so picking never opens anything by accident.
function OptionPickControl({ label, description, active, multiple, isKeepOption, needsNote, onPick }: {
  label: string;
  description: string;
  active: boolean;
  multiple: boolean;
  isKeepOption: boolean;
  needsNote: boolean;
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
        <span className="block text-[15px] font-medium leading-6">
          {label}
          {needsNote ? (
            <span
              className="ml-2 rounded border border-amber-500/40 px-1.5 py-0.5 align-middle text-xs font-medium text-amber-700 dark:text-amber-300"
              title="This pick needs a note — say what should change in the note box below, then submit"
            >
              Needs a note
            </span>
          ) : null}
        </span>
        {description ? (
          <span className="mt-1 block whitespace-pre-line break-words text-sm leading-6 text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

// One option row: the select control, the per-option document, and the
// option's own preview — inside the same frame, at the end. The description is
// rendered whole: the row is where the reader judges the trade-off, and a
// truncated first sentence with a disclosure repeating it was two copies of one
// description with the useful half hidden. Descriptions are bounded at
// generation time (the ask contract asks for one to three sentences), so the
// card does not need a second truncation rule.
function BatchOptionRow({ option, active, multiple, isKeepOption, description, hideDocument, needsNote, onPick, onOpenArtifact }: {
  option: BatchItem["options"][number];
  active: boolean;
  multiple: boolean;
  isKeepOption: boolean;
  description: string;
  hideDocument: boolean;
  needsNote: boolean;
  onPick: () => void;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  const artifact = option.artifact;
  // The frame is a COLUMN: the pick line (control + document) first, then the
  // option's own preview at the end, across the row. A border that stopped at
  // the text column made the preview look like a footnote to the option rather
  // than its last part.
  const rowFrame = `overflow-hidden rounded-md border ${
    active ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/50"
  }`;
  return (
    <div className={`${rowFrame} ${isKeepOption ? "mt-2" : ""}`}>
      <div className="flex min-h-11 items-stretch">
        <OptionPickControl
          label={option.label}
          description={description}
          active={active}
          multiple={multiple}
          isKeepOption={isKeepOption}
          needsNote={needsNote}
          onPick={onPick}
        />
        {artifact && !hideDocument ? (
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
// descriptions resolved per row. When every option carries the same
// document the rows hide their buttons and one embedded reader above them
// carries the brief instead (see embedded-brief.tsx).
export function BatchOptionList({ cardId, current, isSplitProposal, splitKeepLabel, selected, onPick, onOpenArtifact }: {
  cardId?: string;
  current: BatchItem;
  isSplitProposal: boolean;
  splitKeepLabel: string;
  selected: Record<string, string[]>;
  onPick: (question: BatchItem, label: string) => void;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  const brief = cardId ? embeddedBriefFor(current, onOpenArtifact) : null;
  return (
    // The group's name is the question it answers. A live batch often carries
    // no separate title, and the old `aria-label={current.title}` shipped an
    // EMPTY accessible name — a radiogroup a screen reader announces as
    // "group" with no question in it.
    <div
      className="grid gap-1"
      role={current.multiple ? "group" : "radiogroup"}
      aria-label={current.title || current.prompt}
    >
      {brief ? <EmbeddedBrief file={brief.file} onExpand={brief.onExpand} /> : null}
      {current.options.map((option) => {
        const active = (selected[current.id] ?? []).includes(option.label);
        const isKeepOption = isSplitProposal && option.label === splitKeepLabel;
        // Split proposals render no note box, so a conditional marker there
        // would advertise a requirement with nowhere to satisfy it — the
        // gate refuses --needs-note on split asks, and the row stays quiet.
        const showNeedsNote = !isSplitProposal && option.needsNote === true;
        return (
          <BatchOptionRow
            key={option.label}
            option={option}
            active={active}
            multiple={current.multiple}
            isKeepOption={isKeepOption}
            description={isSplitProposal ? splitOptionDescription(option.description) : option.description}
            hideDocument={brief !== null}
            needsNote={showNeedsNote}
            onPick={() => onPick(current, option.label)}
            onOpenArtifact={onOpenArtifact}
          />
        );
      })}
    </div>
  );
}
