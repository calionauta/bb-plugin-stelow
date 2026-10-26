/**
 * The Inbox list's order, frozen for as long as the reader is looking at it.
 *
 * The panel reloads on `card-state` / `inbox-changed`, and the list is ordered
 * by severity then time — so a severity bump moves a row while somebody is
 * reading the row below, and every row carries actions. `lib/inbox-stable-order`
 * is the rule; this is the React half: remember the order, adopt a new one when
 * the reader asks for a different list (a filter change) or presses Show, and
 * report how many rows arrived or moved since.
 *
 * Extracted from `InboxPanel` rather than inlined: the panel renders rows, and
 * three state transitions inside its body would have pushed it past its
 * function budget without making any of them clearer.
 */
import { useEffect, useState } from "react";
import { stableInboxOrder } from "../../lib/inbox-stable-order.mjs";
import type { InboxNotification } from "./inbox-types";

export function useStableInboxOrder(entries: InboxNotification[], viewKey: string) {
  const [frozen, setFrozen] = useState<string[] | null>(null);
  const naturalIds = entries.map((entry) => entry.id);
  const naturalKey = naturalIds.join("|");

  // A different list is a list the reader asked for: adopt its order, then hold
  // that one. Without this, switching tabs reads as "everything arrived".
  useEffect(() => {
    setFrozen(null);
  }, [viewKey]);

  // The first draw of any list fixes the order it will keep.
  useEffect(() => {
    if (frozen === null) setFrozen(naturalIds);
  }, [frozen, naturalKey]);

  const view = stableInboxOrder(frozen, entries);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const shown = view.order
    .map((id) => byId.get(id))
    .filter((entry): entry is InboxNotification => entry !== undefined);
  return { shown, held: view.held, show: () => setFrozen(null) };
}
