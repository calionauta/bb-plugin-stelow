export interface PinVerdict { state: "released" | "unreleased" | "unknown"; detail: string }
export function classifyPinProvenance(payload: unknown, pin: string): PinVerdict;
export function describePinProvenance(verdict: PinVerdict, version?: string | null): string;
