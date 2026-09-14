export declare const SPLIT_QUESTION_GUIDANCE: string;
export declare function isSplitQuestion(question: { kind?: "standard" | "split"; multiple?: boolean; options?: Array<{ label?: string }> } | null | undefined): boolean;
export declare function splitQuestionText(question: string | null | undefined, options?: Array<{ label?: string }> | null | undefined): string;
export declare function splitOptionDescription(description: string | null | undefined): string;
export declare function splitSelectionNotice(question: string | null | undefined, options: Array<{ label?: string }> | null | undefined, selected: string[] | null | undefined): { kind: "keep" | "archive" | "partial"; text: string } | null;
