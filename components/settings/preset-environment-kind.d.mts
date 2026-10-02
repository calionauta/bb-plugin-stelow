export declare const ENVIRONMENT_KINDS: readonly ["project-default", "new-worktree"];
export declare const DEFAULT_ENVIRONMENT_KIND: string;
export declare const WORKTREE_ENVIRONMENT_KIND: string;

/** Whether a stored kind is one the schema can hold. */
export declare function isKnownEnvironmentKind(value: unknown): boolean;

/**
 * Whether the form is editing a built-in preset, whose environment is protected.
 * A new preset (`formId` null) is not a built-in edit.
 */
export declare function isBuiltInPresetEdit(
  presets: ReadonlyArray<{ id: string; builtIn: boolean }>,
  formId: string | null,
): boolean;

/** The single help sentence for the control's current state. */
export declare function environmentKindExplanation(state: {
  kind: string;
  builtIn: boolean;
}): string;

/** Whether the control accepts input right now. */
export declare function isEnvironmentKindEditable(state: {
  busy: boolean;
  builtIn: boolean;
}): boolean;
