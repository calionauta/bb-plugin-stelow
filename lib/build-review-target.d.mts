type ReviewArtifact = {
  role: string;
  stage: string;
  absolutePath?: string | null;
  display?: string | null;
  path?: string | null;
  hostId?: string | null;
};

type ReviewQuestionArtifact = Pick<ReviewArtifact, "absolutePath" | "display" | "path" | "hostId">;
type ReviewQuestion = { options?: Array<{ artifact?: ReviewQuestionArtifact | null } | null> | null };

type ReviewInput = {
  detail: {
    pendingQuestions: ReviewQuestion[];
    expiredQuestions: ReviewQuestion[];
    artifacts: ReviewArtifact[];
  } | null;
  card: { stage: string } | null;
  heroKind: string | null;
};

export function selectBuildReviewArtifact(input: ReviewInput): ReviewArtifact | null;
