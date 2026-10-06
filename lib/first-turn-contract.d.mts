export const FIRST_STAGE: string;

export interface SkillRead {
  skill: string;
  tool: string | null;
  bulk: boolean;
}

export interface FirstTurnVerdict {
  advanced: boolean;
  readsBeforeAdvance: Array<{ skill: string; bulk: boolean }>;
  readsTotal: number;
  skillsReadBeforeWork: number;
  violated: boolean;
}

export function skillReads(events: unknown): SkillRead[];
export function advancedFrom(events: unknown): boolean;
export function firstTurnVerdict(events: unknown): FirstTurnVerdict;
export function firstTurnTrailLine(
  verdict: FirstTurnVerdict | null | undefined,
  input?: { estimatedTokens?: number | null },
): string | null;
