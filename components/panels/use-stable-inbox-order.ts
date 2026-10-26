/**
 * The Inbox list's order, frozen for as long as the reader is looking at it.
 *
 * The panel reloads on `card-state` / `inbox-changed`, and the list is ordered
 * by severity then time — so a severity bump moves a row while somebody is
 * reading the row below, and every row carries actions. `lib/inbox-stable-order`
 * decides where a frozen order puts each row; `lib/inbox-order-state` decides
 * which order is frozen (this list, or a new one the reader asked for). This
 * hook is the React wrapper: one state, one effect.
 *
 * Extracted from `InboxPanel` rather than inlined: three transitions inside the
 * panel's body would have pushed it past its function budget without making any
 * of them clearer, and none of them would have been testable.
 */
import { useState } from "react";
import { stableInboxOrder } from "../../lib/inbox-stable-order.mjs";
import { nextOrderState, showRequested } from "../../lib/inbox-order-state.mjs";
import type { OrderState } from "../../lib/inbox-order-state.d.mts";
import type { InboxNotification } from "./inbox-types";

export function useStableInboxOrder(entries: InboxNotification[], viewKey: string) {
  const naturalIds = entries.map((entry) => entry.id);
  const [state, setState] = useState<OrderState>(() => nextOrderState(null, naturalIds, viewKey));

  // A different list is one the reader asked for. Adjusting state during render
  // (React's own pattern for state derived from props) settles it before the
  // commit, so there is no effect and no dependency array to get wrong: a review
  // showed a mutation that emptied the deps array left every suite green, because
  // the wiring below the reducer had no test to fail. Now there is nothing to
  // remember — the reset cannot be forgotten.
  if (state.viewKey !== viewKey) setState(nextOrderState(state, naturalIds, viewKey));

  const view = stableInboxOrder(state.frozen, entries);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const shown = view.order
    .map((id) => byId.get(id))
    .filter((entry): entry is InboxNotification => entry !== undefined);
  return {
    shown,
    held: view.held,
    show: () => setState((previous) => showRequested(previous, naturalIds)),
  };
}
