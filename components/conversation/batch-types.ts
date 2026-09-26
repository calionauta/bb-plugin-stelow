// The shapes a pending question is rendered from, and nothing else.
//
// They live apart from the rendering on purpose: the option rows
// (batch-options.tsx) and the stepper (question-batch.tsx) both need them, so
// declaring them in either component would make the two depend on each other
// for types alone. One declaration, imported by both.

export type AskArtifact = { path: string; display: string; absolutePath: string | null; hostId: string | null };
export type ArtifactViewerMode = "review" | "comment";
// The option's own label travels with the open request. A handler that took
// fewer parameters would be assignable, so a dropped label would typecheck and
// silently disable the section lookup — the reader would land on the shared
// brief's first line, which is the bug that lookup exists to fix. One named
// type, so no hop in the chain can quietly narrow it.
export type OpenArtifactHandler = (
  artifact: AskArtifact,
  mode: ArtifactViewerMode,
  optionLabel: string,
) => void;
export type QuestionStalenessNotice = { docRevised: boolean; docRemoved: boolean; checkoutMoved: boolean; commitCount: number; touchedPaths: string[] };
export type BatchOption = {
  label: string;
  description: string;
  preview: string | null;
  artifact: AskArtifact | null;
  // True when the document came from a sibling rather than this option.
  artifactInherited?: boolean;
};

export type BatchItem = {
  id: string;
  title: string;
  prompt: string;
  multiple: boolean;
  kind?: "standard" | "split";
  options: BatchOption[];
  staleness?: QuestionStalenessNotice | null;
};
// Structural view of a timed-out question: the section maps it into a
// BatchItem, so the card never imports the detail contract for this.
export type ExpiredQuestionItem = {
  id: string;
  question: string;
  multiple: boolean;
  kind?: "standard" | "split";
  options: BatchItem["options"];
  staleness?: QuestionStalenessNotice | null;
};
