/**
 * A preset's environment kind, as the composer seed it produces.
 *
 * The stored value is not the wire value, and the two layers spell the same
 * words in opposite ways:
 *
 * - Stelow's `project-default` means THE SHARED PROJECT CHECKOUT
 *   (`server/workers.ts` returns `host / unmanaged / path` for it).
 * - bb's `{ type: "project-default" }` means A MANAGED WORKTREE when git
 *   permits. The plugin's `new-worktree` path works only through that
 *   inversion.
 *
 * So neither stored value can be forwarded verbatim. The worktree is **stated**
 * as `host / managed-worktree`, which bb cannot redefine underneath us; the
 * checkout is **not seeded at all**, because the SDK documents that
 * `{ type: "project-default" }` "seeds nothing" and passing it would render a
 * control that appears to do something and does not.
 *
 * `undefined` therefore means "seed nothing, and let BB resolve its own
 * default" — the behaviour that exists today, and the reason this mapping is
 * total rather than throwing on a kind it does not recognise.
 *
 * The returned objects are module-level frozen constants, never fresh
 * literals. The SDK value-compares its `default*` props every render and
 * re-seeds when one changes (`bb-plugin-sdk-app.d.ts`, `defaultEnvironment`),
 * so a fresh object each render would be a new value each render.
 */

/** A worktree seeded on the project's base branch, stated rather than delegated. */
const MANAGED_WORKTREE_SEED = Object.freeze({
  type: "host",
  workspace: Object.freeze({
    type: "managed-worktree",
    baseBranch: Object.freeze({ kind: "default" }),
  }),
});

/**
 * Total by design: an unrecognised stored kind degrades to today's behaviour
 * (no seed) rather than throwing, because a value the schema never produced
 * must not be able to block a card from being created.
 */
export function presetEnvironmentSeed(environmentKind) {
  return environmentKind === "new-worktree" ? MANAGED_WORKTREE_SEED : undefined;
}

/**
 * The capture rule behind "reopening re-reads the preset", as a pure function.
 *
 * The host re-seeds a composer's whole selection whenever any `default*` prop
 * changes after mount, including selections the person already touched. The
 * composer's environment seed is read once per *visit* rather than once per
 * render, so nothing happening underneath a live dialog can overwrite a pick.
 *
 * Pure, so the property is executable rather than asserted about source text:
 * a second call with the same `open` returns the first reference even when the
 * preset changed underneath it, and a call with a different `open` re-reads.
 * `current` is the previous capture or `null`; the return value replaces it.
 */
export function captureEnvironmentSeed(current, open, environmentKind) {
  if (current && current.open === open) return current;
  return { open, seed: presetEnvironmentSeed(environmentKind) };
}