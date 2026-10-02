import assert from "node:assert/strict";
import { renderStatusLine } from "../lib/status-question-state.mjs";

// Regression pin for card_48uuhus1: a worker had no read-only way to ask
// "is a question already pending?", so it fired `--question "ping"` at a human
// to find out. `status` is the verb it already runs; this makes the answer
// visible there. Every row fails if the count stops rendering.

const line = { name: "card-detail-ia", status: "active", stage: "verification" };

// Absent or zero counts render exactly as before — a board that reports no
// questions must not change shape for everyone else.
assert.equal(renderStatusLine(line), "card-detail-ia\tactive\tverification", "no counts renders the original line");
assert.equal(
  renderStatusLine({ ...line, questions: null }),
  "card-detail-ia\tactive\tverification",
  "a null count renders the original line",
);
assert.equal(
  renderStatusLine({ ...line, questions: { expired: 0, live: 0 } }),
  "card-detail-ia\tactive\tverification",
  "zero open questions renders the original line",
);

// Open counts are visible, and the two sources are summed.
assert.equal(
  renderStatusLine({ ...line, questions: { expired: 1, live: 0 } }),
  "card-detail-ia\tactive\tverification\topen-questions=1",
  "one answerable recovery row is reported",
);
assert.equal(
  renderStatusLine({ ...line, questions: { expired: 0, live: 2 } }),
  "card-detail-ia\tactive\tverification\topen-questions=2",
  "live interactions are reported",
);
assert.equal(
  renderStatusLine({ ...line, questions: { expired: 1, live: 2 } }),
  "card-detail-ia\tactive\tverification\topen-questions=3",
  "both sources sum into one number",
);

// A negative count is nonsense from a read; it must never read as "open".
assert.equal(
  renderStatusLine({ ...line, questions: { expired: -1, live: -1 } }),
  "card-detail-ia\tactive\tverification",
  "a negative count is treated as nothing to report",
);

// The tab is injectable so the JSON-ish/other renderers can match house style.
assert.equal(
  renderStatusLine({ ...line, questions: { expired: 1, live: 0 } }, "|"),
  "card-detail-ia|active|verification|open-questions=1",
  "the separator is the caller's to choose",
);

console.log("status question state test ok: open question counts render, absent counts do not");