export interface GateInstrument { readonly id: string; readonly label: string; readonly command: readonly string[]; readonly network: boolean }
export interface GateResult { id: string; label: string; code: number; status: "pass" | "fail" }
export interface GateSummary { ok: boolean; passed: string[]; failed: string[]; skipped: string[] }
export const GATE_INSTRUMENTS: readonly GateInstrument[];
export function planGate(options?: { offline?: boolean }): { planned: GateInstrument[]; skipped: string[] };
export function instrumentResult(instrument: { id: string; label: string }, code: unknown): GateResult;
export function summarize(results: readonly unknown[] | null | undefined, options?: { skipped?: string[] }): GateSummary;
export function exitCodeFor(summary: GateSummary | null | undefined): 0 | 1;
export function renderLine(result: GateResult): string;
export function renderSummary(summary: GateSummary | null | undefined): string;
