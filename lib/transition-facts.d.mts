export type TransitionKind = "next" | "accept" | "reject" | "rework" | "annotate";
export interface TransitionRow { stage: string; present: boolean; raw: Record<string, unknown>; targets: Record<TransitionKind, string[]> }
export interface TransitionFinding { rule: string; stage: string; value: string }
export interface StageExit { exits: string[]; outward: string[] }
export const TRANSITION_KINDS: readonly TransitionKind[];
export const EXIT_VERBS: readonly string[];
export function stageExits(row: unknown): StageExit;
export function parseTransitionRows(content: unknown): Record<string, TransitionRow>;
export function declaredStages(rows: Record<string, TransitionRow>): string[];
export function auditTransitionTable(content: unknown, options?: { terminals?: readonly string[]; stages?: readonly string[] | null }): TransitionFinding[];
export function auditStageCatalog(stages: unknown, options?: { terminal?: string | null }): TransitionFinding[];
export function catalogApprovalGates(stages: unknown): string[];
export function approvalGates(content: unknown): string[];
