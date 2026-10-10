import { ArtifactContent, useArtifactContent } from "../detail/artifact-viewer-dialog";
import { artifactViewerModeForOption, sharedQuestionArtifact } from "../../lib/question-presentation.mjs";
import type { AskArtifact, BatchItem, OpenArtifactHandler } from "./batch-types";

// The one brief behind the current question, read inline.
//
// Gate approvals attach the same document to every option, so per-row Open
// buttons repeat one file N times. When every option carries the same
// document this renders one reader above the rows instead; genuinely
// different documents keep their per-row buttons (see sharedQuestionArtifact
// for the rule). The full viewer stays one click away for quoting passages
// and commenting — this is the read path, not the discuss path.
export function EmbeddedBrief({ cardId, file, onExpand }: {
  cardId: string;
  file: AskArtifact;
  onExpand: () => void;
}) {
  const { content, truncated, loadError, loading } = useArtifactContent(true, cardId, file);
  return (
    <div className="rounded-md border bg-muted/20">
      <div className="flex min-h-11 items-center gap-2 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          Brief for this question: {file.display}
        </span>
        <button
          type="button"
          onClick={onExpand}
          className="shrink-0 cursor-pointer text-xs font-medium text-primary hover:underline"
        >
          Open full viewer ↗
        </button>
      </div>
      <div className="px-3 pb-3">
        <ArtifactContent file={file} content={content} truncated={truncated} loadError={loadError} loading={loading} />
      </div>
    </div>
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
