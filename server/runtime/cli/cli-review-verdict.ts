import { dirname, join } from "node:path";
import { reviewSummary } from "../../../lib/review-verdict.mjs";
import { roundTimestamp } from "../../../lib/research-rounds.mjs";
import type { CliResult } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { ReviewSubject } from "./cli-review-subject.js";
export type { ReviewSubject };
import { workspaceRelative } from "../card-files.js";
import type { WorkerCard } from "../../workers-types.js";
import { parseReviewOutput } from "../../../lib/review-verdict.mjs";

export type ReviewVerdictInput = {
  threadId: string;
  presetName: string;
  stamp: string;
  subject: ReviewSubject;
  parsed: ReturnType<typeof parseReviewOutput>;
};

/** Records the verdict on the card: a durable file in the card's own state dir
 * (so a later review, a done, and a human reader see the same evidence), then
 * the agent comment and the worker-facing stdout. A file write failure never
 * loses the verdict — the comment and stdout still carry it. */
export async function recordVerdict(
  deps: CliDeps,
  card: WorkerCard,
  threadId: string,
  presetName: string,
  subject: ReviewSubject,
  output: string,
  permissionNote: string,
): Promise<CliResult> {
  const verdict: ReviewVerdictInput = {
    threadId,
    presetName,
    stamp: roundTimestamp(),
    subject,
    parsed: parseReviewOutput(output, subject.artifactText),
  };
  const reviewPath = await writeVerdictFile(deps, card, verdict);
  const summary = `${reviewSummary(verdict.parsed)}${reviewPath ? ` Record: ${reviewPath}.` : ""}${permissionNote}`;
  deps.logCardComment(card.id, "card", card.id, "agent", summary);
  return {
    exitCode: 0,
    stdout: `${summary}\nReviewer thread: ${threadId}`,
  };
}

/** The durable record on the card: header, verdict summary, and the
 * machine-readable JSON block a later review or a human reads the same way. */
function reviewDocument(
  card: WorkerCard,
  verdict: ReviewVerdictInput,
  verdictJson: string,
): string {
  const name = card.display_name ?? card.name;
  const status = verdict.parsed.status;
  const fingerprint = verdict.subject.fingerprint ?? "none";
  const summary = reviewSummary(verdict.parsed);
  return [
    `# Review ${verdict.stamp}`,
    `Card: ${name}`,
    `Reviewer thread: ${verdict.threadId}`,
    `Preset: ${verdict.presetName}`,
    `Status: ${status}`,
    `Fingerprint: ${fingerprint}`,
    "",
    summary,
    "",
    "## Verdict",
    "",
    "```json",
    verdictJson,
    "```",
    "",
  ].join("\n");
}

/** The verdict is durable on the card: it is written to the card's state dir
 * so a later review, a done, and a human reader all see the same file. A
 * write failure never loses the verdict — the comment and stdout carry it. */
async function writeVerdictFile(
  deps: CliDeps,
  card: WorkerCard,
  verdict: ReviewVerdictInput,
): Promise<string | null> {
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path || !card.dir_hash) return null;
  const stateDir = await deps
    .workflowStateDir(workspace.path, card.id, card.dir_hash)
    .catch(() => null);
  if (!stateDir) return null;
  const full = join(stateDir, `reviews/review-${verdict.stamp}.md`);
  try {
    await deps.bb.sdk.files.mkdir({
      path: dirname(full),
      rootPath: workspace.path,
      recursive: true,
    });
    const verdictJson = JSON.stringify(
      { status: verdict.parsed.status, findings: verdict.parsed.findings },
      null,
      2,
    );
    await deps.bb.sdk.files.write({
      path: full,
      content: reviewDocument(card, verdict, verdictJson),
    });
    return (
      workspaceRelative(workspace.path, full) ??
      `reviews/review-${verdict.stamp}.md`
    );
  } catch {
    /* verdict still reported via comment + stdout */
    return null;
  }
}
