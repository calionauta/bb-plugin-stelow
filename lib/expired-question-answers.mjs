// Convert a COMPLETE BatchStepper response into the durable timed-out-question
// RPC shape. Timed-out questions are still one blocking decision: sending a
// subset could resume work before the remaining answers change its direction.
export function expiredAnswerPayload(questions, answerGroups) {
  if (!Array.isArray(questions) || !Array.isArray(answerGroups)) return [];
  const payload = questions.map((question, index) => {
    const answers = cleanAnswerList(answerGroups[index]);
    return answers.length > 0 && typeof question?.id === "string" ? { questionId: question.id, answers } : null;
  });
  return payload.every((item) => item !== null) ? payload : [];
}

/**
 * Clean one answer list: trim, drop empties and non-strings. Used both when
 * building the recovery payload and when the host re-cleans submitted
 * answers at the RPC boundary — the server never trusts client cleaning.
 */
export function cleanAnswerList(answers) {
  if (!Array.isArray(answers)) return [];
  return answers
    .filter((answer) => typeof answer === "string" && answer.trim())
    .map((answer) => answer.trim());
}
