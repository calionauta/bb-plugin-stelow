/**
 * Human-readable card copy derived from host state.
 *
 * Both copy rules live here because both are shown to a person deciding what
 * to do next: the continue nudge a stalled card worker receives, and the
 * short status label the GitHub completion summary reports.
 */
import { buildContinueNudge } from "../../lib/worker-continuation.mjs";
import type { WorkerCard } from "../workers.js";

/**
 * What a resumed worker is told to do next. The research and explore tracks
 * get their own track-specific wording (no stages, index or stage artifact
 * first); a Build card gets the shared continue nudge for the band it is in.
 */
export function recoveryNudge(card: WorkerCard, interfacePick: string): string {
  if (card.kind === "research") {
    return `Continue the Stelow research now. Re-read your research-index.md first, then keep researching with the strategy playbook. If a \
question is already pending on the card, do NOT re-ask it — the answer arrives here on its own. But if you genuinely need NEW input from the \
user that was never asked, ask it now via bb stelow ask; silence is not progress. NEVER run \`bb stelow advance\` — research has no stages. When \
the index is complete with ranked opportunities, STOP and end your turn. If a \`bb stelow\` command fails, read its stderr once and continue \
— do NOT spend the turn debugging the CLI; report the exact error and move on.`;
  }
  if (card.kind === "explore") {
    return `Continue the Stelow explore task now. Re-read your explore artifact and the stage skill, then keep working on the stage deliverable. \
If a question \
is already pending on the card, do NOT re-ask it — the answer arrives here on its own. But if the stage genuinely needs NEW input from the user \
that was never asked, ask it now via bb stelow ask; silence is not progress. NEVER run \`bb stelow advance\` — explore has no stages. When the \
stage deliverable is complete, STOP and end your turn. If a \`bb stelow\` command fails, read its stderr once and continue — do NOT spend the \
turn debugging the CLI; report the exact error and move on.`;
  }
  return buildContinueNudge(interfacePick);
}

/** Short human status for the GitHub completion summary (English). */
export function statusLabelForSummary(status: string): string {
  if (status === "in-progress") return "in progress";
  if (status === "done" || status === "completed") return "done";
  return status;
}
