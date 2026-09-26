/**
 * `bb stelow answer`: the card's two answering doors, from a shell.
 *
 * Why a verb: the needs-input path is the one place a card can deadlock, and
 * until this existed the only way through it was a browser. A scripted answer
 * under the SAME rules as the card form is what makes that path testable and
 * automatable.
 *
 * The verb owns no recording rule and no refusal. It parses argv (in `lib/`,
 * where it is unit-testable without a host), splits the payload into the live
 * and the recovery door, and calls the same two door implementations the RPC
 * contract calls. A second copy of the recording rule is exactly how the two
 * doors drifted before this verb existed.
 */
import {
  buildAnswerPayload,
  expiredQuestionRowId,
  parseAnswerArgs,
} from "../../../lib/question-answer-recording.mjs";
import type { WorkerCard } from "../../workers-types.js";
import type { CliCommandFn, CliResult } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";

type AnswerResult = { ok: boolean; answered: number; error: string | null };
type AnswerInput = { cardId: string; answers: Array<{ questionId: string; answers: string[] }> };
type Door = "live" | "expired";

/** The same two doors the RPC contract calls — not a second implementation. */
export type AnswerDoors = {
  answerQuestions: (input: AnswerInput) => Promise<AnswerResult>;
  answerExpiredQuestions: (input: AnswerInput) => Promise<AnswerResult>;
};

export function createAnswerCommand(deps: CliDeps, doors: AnswerDoors): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "answer") return null;
    const parsed = parseAnswerArgs(argv.slice(1));
    if (parsed.error) return { exitCode: 2, stderr: parsed.error };
    const { live, expired } = buildAnswerPayload(parsed.pairs);
    if (live.length > 0 && expired.length > 0) {
      return {
        exitCode: 2,
        stderr: "Answer live and recovery questions in separate calls; each door answers its own set atomically.",
      };
    }
    const door: Door = live.length > 0 ? "live" : "expired";
    if (door === "expired" && expired.length === 0) {
      return { exitCode: 2, stderr: "Nothing to answer: name a live interaction id or an `expired:<id>` recovery id." };
    }
    const card = answerCard(deps, argv, ctx.threadId ?? null);
    if (!card) return { exitCode: 2, stderr: MISSING_CARD };
    return answerThrough(doors, card.id, door, door === "live" ? live : expired, parsed.json === true);
  };
}

const MISSING_CARD =
  "Missing --card <card_id>. Answer must name the card whose questions it answers.";

/**
 * The card the answer is about. `--card` wins; otherwise the verb runs in the
 * card's own worker thread, which is how a worker answers its own question from
 * a shell. No card, no answer: naming one is the refusal, not a guess.
 */
function answerCard(
  deps: CliDeps,
  argv: string[],
  threadId: string | null,
): WorkerCard | undefined {
  const cardFlagIndex = argv.indexOf("--card");
  const namedCard = cardFlagIndex >= 0 ? argv[cardFlagIndex + 1] : undefined;
  if (namedCard) return deps.getCard(namedCard);
  return threadId ? deps.getCardByWorkerThread(threadId) : undefined;
}

/** One call, one door. The recovery ids lose their prefix on the way in. */
async function answerThrough(
  doors: AnswerDoors,
  cardId: string,
  door: Door,
  answers: AnswerInput["answers"],
  asJson: boolean,
): Promise<CliResult> {
  const result = door === "live"
    ? await doors.answerQuestions({ cardId, answers })
    : await doors.answerExpiredQuestions({
      cardId,
      answers: answers.map((entry) => ({
        questionId: expiredQuestionRowId(entry.questionId),
        answers: entry.answers,
      })),
    });
  if (!result?.ok) {
    return { exitCode: 1, stdout: "", stderr: result?.error ?? "Could not answer the questions." };
  }
  const stdout = asJson
    ? JSON.stringify({ cardId, answered: result.answered, door })
    : `Answered ${result.answered} question(s) on card ${cardId}.`;
  return { exitCode: 0, stdout, stderr: "" };
}
