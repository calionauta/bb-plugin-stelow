/**
 * A value that is not built yet.
 *
 * Two surfaces genuinely depend on each other: the board's GitHub status
 * column reads the issue automation, and the issue automation imports cards
 * the card server creates. Breaking that with a module-level variable would
 * hide the cycle; this names it, and makes it a value the reader can see.
 */
export type Deferred<T> = {
  /** The value, or undefined while it is still being built. */
  read: () => T | undefined;
  /** Bind the value. Binding twice is a wiring mistake, not a no-op. */
  bind: (value: T) => void;
};

export function deferred<T>(): Deferred<T> {
  let bound: T | undefined;
  return {
    read: () => bound,
    bind: (value: T) => {
      if (bound !== undefined) {
        throw new Error("This wiring seam is already bound.");
      }
      bound = value;
    },
  };
}
