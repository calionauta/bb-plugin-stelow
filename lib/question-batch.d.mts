export declare const QUESTION_ID_SEP: string;
export declare const MAX_DESC_CHARS: number;
export declare const MAX_PREVIEW_CHARS: number;
export declare const MAX_ARTIFACT_CHARS: number;
export declare interface AskOption {
  label: string;
  description: string;
  preview: string | null;
  artifact: { path: string; display?: string } | null;
}
export declare function parseAskGroups(argv: string[]): { groups: Array<{ question: string; multiple: boolean; options: AskOption[] }>; error?: undefined } | { groups?: undefined; error: string };
export declare function cleanOptions(raw: unknown): AskOption[];
export declare function normalizeAskArtifactPath(raw: unknown): { path: string; display: string } | null;
export declare function isBatchPayload(data: unknown): boolean;
export declare function expandInteractionQuestions(interaction: { id: string; title?: string; payload?: unknown }): Array<{ questionId: string; interactionId: string; index: number; title: string; question: string; multiple: boolean; options: AskOption[] }>;
export declare function splitQuestionId(questionId: string): { interactionId: string; index: number };
export declare function groupBatchAnswers(items: Array<{ questionId: string; answers: string[] }>): Map<string, { kind: "single"; answers: string[] } | { kind: "batch"; answers: string[][] }>;
export declare function formatBatchContinuation(decisions: Array<{ question: string; answers: string[] }>): string;
