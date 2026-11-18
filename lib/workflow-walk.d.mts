export type RefusalKind = "missing-artifact" | "policy-skip" | "unknown-mode" | "off-route" | "artifact-invalid" | "other";
export interface RefusalDoor { kind: RefusalKind; door: string | string[] | null }
export const WALK_INTENTS: readonly string[];
export const WALK_MODES: readonly string[];
export const REFUSAL_KINDS: readonly RefusalKind[];
export function plannedRoute(options?: { intent?: unknown; reviewMode?: unknown; quality?: string; explorationCount?: number }): string[] | null;
export function forwardTarget(route: readonly string[], stage: string): string | null;
export function refusalKind(text: unknown): RefusalKind;
export function refusalDoor(text: unknown): RefusalDoor;
export function refusalNamesDoor(text: unknown): boolean;
