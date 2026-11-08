// The Inbox list's order, held still while the reader is looking at it.
//
// The list is ordered by severity and then by time (`lib/inbox-events.mjs`), and
// the panel reloads on `card-state` / `inbox-changed`. So a severity bump — an
// error repeating, a stall crossing 72h, a model judgement promoting an item —
// moves a row, and it moves it while somebody is reading the row below. The
// worst case is not cosmetic: every row carries actions, so a click aimed at
// "Mark as read" can land on a row that just arrived above it.
//
// Plannotator holds the whole list back behind "N new" while a thread is open.
// This is the smaller half of that rule and the half that fixes the mis-click:
// the ORDER stops moving, the rows do not. A row that gains severity keeps its
// place and changes its own content; a row that did not exist yet joins at the
// end; Show puts everything where it belongs. Nothing is ever hidden — a held
// list that hid an arriving wait would be the phantom-wait bug wearing a
// stability argument.

/**
 * @param {readonly string[] | null} previous the ids as they were last drawn,
 *   or null/empty for "no opinion" (adopt the natural order)
 * @param {readonly { id: string }[]} entries the natural order, freshest first
 * @returns {{ order: string[], held: number }}
 *   `order` is the ids to draw; `held` counts how many entries arrived or moved,
 *   which is what the "N updates" control names. Zero means the list is already
 *   the truth and the reader is looking at it.
 */
export function stableInboxOrder(previous, entries) {
  const natural = (Array.isArray(entries) ? entries : [])
    .map((entry) => entry?.id)
    .filter((id) => typeof id === "string");
  if (!Array.isArray(previous) || previous.length === 0) {
    return { order: natural, held: 0 };
  }
  const present = new Set(natural);
  const known = new Set(previous);
  // A row that is gone stays gone: a resolved or filtered-out item must not be
  // resurrected from a stale snapshot of the list.
  const kept = previous.filter((id) => present.has(id));
  const added = natural.filter((id) => !known.has(id));
  const order = [...kept, ...added];
  // A row that vanished and returned is reported as arrived only if a previous
  // snapshot no longer held it; a snapshot that still holds it says nothing,
  // because the reader never saw it leave.
  //
  // What counts is a row out of place RELATIVE TO THE OTHER KEPT ROWS, not an
  // absolute index: an arriving row shifts every index below it, and counting
  // that would report "5 updates" for one new row. Two rows that swapped are
  // two rows the reader sees out of order, and that is what gets counted.
  const keptNatural = natural.filter((id) => known.has(id));
  const moved = kept.filter((id, index) => keptNatural[index] !== id).length;
  return { order, held: moved + added.length };
}
