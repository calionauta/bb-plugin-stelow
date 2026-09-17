// Convert a COMPLETE BatchStepper response into the durable timed-out-question
// RPC shape. Timed-out questions are still one blocking decision: sending a
// subset could resume work before the remaining answers change its direction.
export function expiredAnswerPayload(questions, answerGroups) {
  if (!Array.isArray(questions) || !Array.isArray(answerGroups)) return [];
  const payload = questions.map((question, index) => {
    const answers = Array.isArray(answerGroups[index])
      ? answerGroups[index].filter((answer) => typeof answer === "string" && answer.trim()).map((answer) => answer.trim())
      : [];
    return answers.length > 0 && typeof question?.id === "string" ? { questionId: question.id, answers } : null;
  });
  return payload.every((item) => item !== null) ? payload : [];
}
