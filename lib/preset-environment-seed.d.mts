import type { NewThreadComposerProps } from "@get-bb/plugin-sdk/app";

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