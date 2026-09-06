export declare const QUESTION_ACTIVITY: "awaiting-answer";
export declare function questionWaitUpdates(lastOutput: string | null): { activity: "awaiting-answer"; last_assistant_text: string | null };
export declare function askFinishedUpdates(): { activity: "running" };
export declare function researchColumnForStatus(status: unknown): "todo" | "doing" | "done" | "archived";
