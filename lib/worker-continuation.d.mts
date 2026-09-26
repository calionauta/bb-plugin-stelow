export type ContinueVisibility = "public" | "private";

export type ContinueInput = {
  type: "text";
  text: string;
  mentions: never[];
  visibility?: "agent-only";
};

export type AutoContinueNext = {
  count: number;
  stage: string;
};

export declare function buildContinueNudge(interfacePick: string): string;
export declare function buildContinueInput(
  text: string,
  visibility?: ContinueVisibility,
): ContinueInput[];
export declare function autoContinueFields(
  next: AutoContinueNext,
  lastOutput: string | null,
): {
  activity: "running";
  last_idle_at: null;
  last_error: null;
  auto_continue_count: number;
  auto_continue_stage: string;
  last_assistant_text?: string;
};
