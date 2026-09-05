export declare const QUESTION_ID_SEP: string;
export declare function parseAskGroups(argv: string[]): { groups: Array<{ question: string; multiple: boolean; options: string[] }>; error?: undefined } | { groups?: undefined; error: string };
export declare function isBatchPayload(data: unknown): boolean;
export declare function expandInteractionQuestions(interaction: { id: string; title?: string; payload?: unknown }): Array<{ questionId: string; interactionId: string; index: number; title: string; question: string; multiple: boolean; options: Array<{ label: string; description: string }> }>;
export declare function splitQuestionId(questionId: string): { interactionId: string; index: number };
export declare function groupBatchAnswers(items: Array<{ questionId: string; answers: string[] }>): Map<string, { kind: "single"; answers: string[] } | { kind: "batch"; answers: string[][] }>;
export declare function formatBatchContinuation(decisions: Array<{ question: string; answers: string[] }>): string;
