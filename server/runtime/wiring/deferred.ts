/**
 * A value that is not built yet.
 *
 * The host layer builds the GitHub issue automation, and the board's status
 * column — a card read — asks for it. Those two are built in that order, so
 * the earlier one cannot hold the later one as a value. There is no import
 * cycle here to name: this is a construction order, and a module-level
 * variable would hide it behind a mutable global. This names it, and makes it
 * a value the reader can see — `undefined` until the binder runs.
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
