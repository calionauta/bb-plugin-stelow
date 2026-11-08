export declare interface QuestionShape {
  id: string;
  question: string;
  multiple: boolean;
  options: string[];
}
export declare interface Answer {
  questionId: string;
  answers: string[];
}
export declare type GroupedAnswer =
  | { kind: "single"; answers: string[] }
  | { kind: "batch"; answers: string[][] };
export declare interface ExpiredRow {
  id: string;
  question: string;
  multiple: unknown;
  options?: unknown;
}
export declare function exclusivePickError(
  questions: QuestionShape[],
  answers: Answer[],
): string | null;
export declare function liveQuestionShapes(
  asks: Array<{ id: string; payload?: { title?: string } }>,
): Map<string, Omit<QuestionShape, "id">>;
export declare function slotsOf(
  interactionId: string,
  value: GroupedAnswer,
  shapes: Map<string, Omit<QuestionShape, "id">>,
): QuestionShape[];
export declare function answersFor(interactionId: string, value: GroupedAnswer): Answer[];
export declare function expiredAnswerRefusal(openRows: ExpiredRow[], answers: Answer[]): string | null;
