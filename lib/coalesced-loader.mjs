/**
 * One loader in flight at a time; at most one more queued behind it.
 *
 * Every panel load is a burst of host RPCs (`projects`, `listCards`,
 * `listPresets`, `listBandPresets`, `board`), and the board read walks each
 * workflow's state dir. Nothing stopped two from running: the initial mount, a
 * realtime burst and an `onChanged` callback all called `load` directly, so
 * opening a card while a poll landed started a second full sweep.
 *
 * In production that showed up as 12+ overlapping `cardDetail` calls for ONE
 * card in the same minute, each waiting on the others: the read was measured at
 * 33 s average and 69 s max, and the board at 57 s average, from contention on a
 * read that takes ~140 ms alone. A queue with no ceiling would have made the
 * pile deeper; coalescing keeps it at one plus one.
 *
 * A caller that arrives during a run is COALESCED, not replayed: it wants the
 * freshest state, and one follow-up pass satisfies every request that arrived
 * during the first. The returned promise is the pass that satisfies the caller —
 * the run it joined, or the follow-up it caused.
 */
export function createCoalescedLoader(load) {
  let current = null;
  let next = null;

  function run() {
    const pass = load();
    current = pass;
    const clear = () => {
      if (current === pass) current = null;
    };
    // Both outcomes clear the slot: a failed pass must not leave the loader
    // convinced it is still busy and silently drop every later request.
    pass.then(clear, clear);
    return pass;
  }

  function queue() {
    if (!next) {
      const start = () => {
        next = null;
        return run();
      };
      // `then(start, start)`: a rejected pass still gets its follow-up, because
      // the queued caller asked for fresh state, not for the first pass to win.
      next = current.then(start, start);
    }
    return next;
  }

  return function loadCoalesced() {
    return current ? queue() : run();
  };
}
