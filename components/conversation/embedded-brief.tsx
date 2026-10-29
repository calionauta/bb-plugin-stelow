import { Button } from "@/components/ui/button";
import { artifactViewerModeForOption, sharedQuestionArtifact } from "../../lib/question-presentation.mjs";
import type { AskArtifact, BatchItem, OpenArtifactHandler } from "./batch-types";

// The one brief behind the current question, as a door into the viewer.
//
// Gate approvals attach the same document to every option, so per-row Open
// buttons repeat one file N times. When every option carries the same
// document this renders one brief above the rows instead; genuinely different
// documents keep their per-row buttons (see sharedQuestionArtifact for the
// rule).
//
// It is one button, not a disclosure. The brief is Markdown with diagrams and
// section anchors, and the reader's job is to OPEN it — an accordion rendered
// the same document inside the conversation, with its own scroll box, its own
// truncated excerpt, and an underlined summary that read as decoration. The
// viewer is the only place that can render diagrams, follow links between the
// stage's files, and quote a passage back to the agent, so the row says what
// the click does: read the brief.
export function EmbeddedBrief({ file, onExpand }: {
  file: AskArtifact;
  onExpand: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onExpand}
      aria-label={`Open the brief ${file.display} in the viewer`}
      className="mb-1 flex min-h-11 w-full cursor-pointer items-center justify-start gap-2 px-3 py-2 text-left"
    >
      <span aria-hidden className="text-sm text-muted-foreground">▤</span>
      <span className="text-sm font-medium text-foreground">Read the brief</span>
      <span className="min-w-0 truncate text-xs text-muted-foreground">{file.display}</span>
      <span className="ml-auto shrink-0 text-xs font-medium text-foreground">Open ↗</span>
    </Button>
  );
}

// The embedded brief plus whether the rows keep their own Open buttons.
// One decision point so the reader and the rows can never disagree: the
// rows hide their buttons exactly when the brief renders above them.
export function embeddedBriefFor(question: BatchItem, onOpenArtifact: OpenArtifactHandler | undefined): {
  file: AskArtifact;
  hideOptionDocuments: true;
  onExpand: () => void;
} | null {
  if (!onOpenArtifact) return null;
  const file = sharedQuestionArtifact(question.options);
  if (!file) return null;
  const firstLabel = question.options[0]?.label ?? "";
  return {
    file,
    hideOptionDocuments: true,
    onExpand: () => onOpenArtifact(file, artifactViewerModeForOption(firstLabel), firstLabel),
  };
}
