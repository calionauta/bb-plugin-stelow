export function boundaryIdFromQuestion(question: unknown): string | null;
export function boundaryQuestionShape(
  kind: unknown,
  authored?: { hasOptions?: boolean },
): { kind: "reaction" | "confirmation"; showOptions: boolean; heading: string; notice: string | null } | null;
