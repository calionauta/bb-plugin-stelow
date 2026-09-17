import type { QuestionContract } from "./question-contracts.mjs";

export type AdvanceReceipt = { path: string; content: string; modifiedAtMs: number | null };
export function checkAdvanceContracts(input?: {
  stage?: string;
  enteredAt?: number;
  contracts?: Array<Pick<QuestionContract, "id" | "kind" | "receipt">>;
  receipts?: AdvanceReceipt[];
  answered?: boolean;
}): string | null;
