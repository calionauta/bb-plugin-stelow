import type { NewThreadComposerProps } from "@get-bb/plugin-sdk/app";

/** The two kinds the preset schema can store. */
export declare const ENVIRONMENT_KINDS: readonly ["project-default", "new-worktree"];

/** The kind a non-worktree preset stores, and what a new preset starts on. */
export declare const DEFAULT_ENVIRONMENT_KIND: string;

/** The kind that means "open a worktree of its own". */
export declare const WORKTREE_ENVIRONMENT_KIND: string;

/** Whether a stored kind is one the schema can hold. */
export declare function isKnownEnvironmentKind(value: unknown): boolean;

/**
 * The kind a path with no form to refuse in should write: the preset's own
 * when the schema could hold it, and the default otherwise.
 */
export declare function storableEnvironmentKind(value: unknown): string;

/**
 * The composer's environment seed. Indexed rather than named because
 * `CreateThreadEnvironmentArgs` is a local alias over an unexported zod schema
 * in the SDK, while `NewThreadComposerProps` is exported — so this is the only
 * spelling that typechecks.
 */
export type PresetEnvironmentSeed = NonNullable<NewThreadComposerProps["defaultEnvironment"]>;

/**
 * The seed a preset's environment kind produces, or `undefined` when there is
 * nothing to seed and BB resolves its own default.
 *
 * Total: any kind other than `new-worktree` returns `undefined`, so an
 * unrecognised stored value degrades to today's behaviour instead of throwing.
 */
export function presetEnvironmentSeed(environmentKind: string | null | undefined): PresetEnvironmentSeed | undefined;

/** One capture: the `open` visit it belongs to, and the seed frozen for it. */
export type PresetEnvironmentCapture = {
  open: boolean;
  seed: PresetEnvironmentSeed | undefined;
};

/**
 * Keep the current capture while the same dialog visit is open; re-read the
 * preset when the visit changes.
 *
 * `open` is the reset key and it has to be: the hook is called ABOVE `<Dialog>`,
 * and Radix unmounts `DialogContent` on close — not the component holding the
 * hook. A mount-once capture would survive a close and a reopen and keep
 * showing the preset as it was the first time the panel mounted.
 */
export function captureEnvironmentSeed(
  current: PresetEnvironmentCapture | null,
  open: boolean,
  environmentKind: string | null | undefined,
): PresetEnvironmentCapture;
