/**
 * When the held Inbox order should be adopted, and when it should hold.
 *
 * `lib/inbox-stable-order` answers "given a frozen order, where do these rows
 * go". This answers the question before it: **which order is frozen**. Two
 * things end a hold — the reader asking for a different list (a filter change is
 * a list they asked for), and the reader pressing Show (a list they asked to see
 * in its canonical order). Everything else keeps the order they are reading.
 *
 * It lives here, apart from the hook, because the hook had no test at all: the
 * two behaviours `FEATURES.md` advertises — Show and the filter reset — were
 * three state transitions buried in effects, and the only test imported was the
 * pure ordering fold. A reducer can be asserted; an effect can only be watched.
 *
 * Identity matters: `nextOrderState` returns the SAME object when nothing
 * changed, so React bails out of the render instead of re-rendering the list on
 * every realtime tick.
 */

/**
 * @typedef {{ viewKey: string, frozen: readonly string[] }} OrderState
 */

/**
 * The state for this render: the previous one kept, or a fresh snapshot.
 *
 * @param {OrderState | null | undefined} previous
 * @param {readonly string[]} naturalIds the canonical order right now
 * @param {string} viewKey identifies the list the reader asked for (filter + mode)
 * @returns {OrderState}
 */
export function nextOrderState(previous, naturalIds, viewKey) {
  const ids = [...naturalIds];
  if (!previous || previous.viewKey !== viewKey) return { viewKey, frozen: ids };
  // A frozen order always has ids; `frozen: null` is not a state this reducer
  // produces, it is only its input, so an empty list is still a snapshot.
  return previous;
}

/**
 * Show: adopt the canonical order as it stands now, and hold from there.
 *
 * @param {OrderState} state
 * @param {readonly string[]} naturalIds
 * @returns {OrderState}
 */
export function showRequested(state, naturalIds) {
  return { viewKey: state.viewKey, frozen: [...naturalIds] };
}
