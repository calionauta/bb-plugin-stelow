export interface ActionKind {
  readonly layer: "intent" | "decision" | "effect" | "environment";
  readonly surface: "rpc" | "cli" | "tick" | "hook" | "watcher" | "system";
}
export declare const ACTION_KINDS: Readonly<Record<string, ActionKind>>;
export declare const ACTION_LAYERS: ReadonlyArray<"intent" | "decision" | "effect" | "environment">;
export declare const ACTION_SURFACES: ReadonlyArray<"rpc" | "cli" | "tick" | "hook" | "watcher" | "system">;
export declare const ACTION_OUTCOMES: ReadonlyArray<"ok" | "refused" | "error" | "skipped" | "partial">;
export declare const ACTION_ACTORS: ReadonlyArray<"client" | "agent" | "plugin">;
export declare function isActionKind(value: unknown): value is string;
export declare function isActionOutcome(value: unknown): value is "ok" | "refused" | "error" | "skipped" | "partial";
export declare function isActionLayer(value: unknown): value is "intent" | "decision" | "effect" | "environment";
export declare function isActionCause(value: unknown): value is string;
export declare function actionLayerOf(kind: unknown): ActionKind["layer"] | null;
export declare function actionSurfaceOf(kind: unknown): ActionKind["surface"] | null;
