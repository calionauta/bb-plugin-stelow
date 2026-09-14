// Convert the BatchStepper's answer slots into the durable timed-out-question
// RPC shape. A multiple-choice timeout must retain every selected option.
export function expiredAnswerPayload(questions, answerGroups) {
  if (!Array.isArray(questions) || !Array.isArray(answerGroups)) return [];
  return questions.flatMap((question, index) => {
    const answers = Array.isArray(answerGroups[index])
      ? answerGroups[index].filter((answer) => typeof answer === "string" && answer.trim()).map((answer) => answer.trim())
      : [];
    return answers.length > 0 && typeof question?.id === "string" ? [{ questionId: question.id, answers }] : [];
  });
}
