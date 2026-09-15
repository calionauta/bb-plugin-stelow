export declare const CONTEXT_STAGE: string;
export declare const CONTEXT_SKIP_INTENTS: string[];
export declare function contextAskGate(input: {
  kind: unknown;
  intent: unknown;
  stage: unknown;
  tag: unknown;
  forced: unknown;
}): { allowed: boolean; error: string | null };
