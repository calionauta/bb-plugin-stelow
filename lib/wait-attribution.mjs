/**
 * Where a card's wall-clock actually went.
 *
 * `cycleMs` is one number carrying three different meanings, and the difference
 * is the whole point: time the card could not move because a person owed an
 * answer is not time lost to a stalled worker, and neither is time nobody has
 * measured. This module splits the same interval into disjoint parts by cause.
 *
 * It is a UNION of half-open intervals, never a sum. The windows overlap in
 * reality — a question supersedes an open pause (`syncQuestionInboxEvents`
 * resolves paused/error rows as `superseded` when a question arrives) — so
 * summing them can exceed the interval they sit in and report a share above
 * 100%. A share above 100% is not a rounding problem; it is the measurement
 * saying something false about time.
 *
 * The residual is reported as `unattributed` and never as "working". Stage
 * events and inbox events have different writers and can gap; the data cannot
 * prove the remainder was productive work, and this repo refuses to claim what
 * the data does not show (cf. "a percentile of nothing is not zero"). Host-caused
 * stalls are absent by the same rule, not by oversight: `lib/host-read-streak.mjs`
 * deliberately never writes a transport fault to the card, so there is no row
 * here to count and the metric must not imply one.
 *
 * This module is pure and has no database in its signature, which is what makes
 * every property below checkable from a unit test with no wiring harness.
 */

/** A question is a person's turn: the card is blocked on a human answer. */
const HUMAN_KINDS = new Set(["question"]);

/** A stall or a failure is the machine's turn: worker, lock, or system. */
const SYSTEM_KINDS = new Set(["paused", "error"]);

/** Half-open [start, end), clipped to the interval being attributed. An open
 * window (`end == null`) is charged to the end of that interval, never to a
 * clock this function cannot see. */
function clampWindow(window, startAt, endAt) {
  if (!window || typeof window !== "object") return null;
  const start = Math.max(startAt, Number(window.start));
  const rawEnd = window.end == null ? endAt : Number(window.end);
  const end = Math.min(endAt, rawEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end, kind: window.kind };
}

/** Sorted, disjoint cover of a set of intervals. */
function mergeIntervals(intervals) {
  const sorted = intervals.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
      continue;
    }
    merged.push({ start: interval.start, end: interval.end });
  }
  return merged;
}

/** Total time covered by a set of intervals, counted once each. */
export function unionLengthMs(intervals) {
  return mergeIntervals(Array.isArray(intervals) ? intervals : [])
    .reduce((sum, interval) => sum + (interval.end - interval.start), 0);
}

/**
 * Split `[startAt, endAt)` into human wait, system wait, and an honest residual.
 *
 * `windows` is `[{ kind, start, end }]` from the card's own inbox rows; `end`
 * null means the window is still open. Overlap resolves in favour of the human:
 * when a question and a pause cover the same minutes, those minutes are the
 * person's, because that is what the card was waiting for. So
 * `systemMs = |H ∪ S| − |H|` — exact, disjoint by construction, and never
 * double-counted.
 */
export function splitWaitWindows({ windows, startAt, endAt }) {
  const from = Number(startAt);
  const to = Number(endAt);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return {
      totalMs: 0,
      humanMs: 0,
      systemMs: 0,
      attributedMs: 0,
      unattributedMs: 0,
      humanShare: 0,
      systemShare: 0,
      unattributedShare: 0,
    };
  }
  const human = [];
  const system = [];
  for (const raw of Array.isArray(windows) ? windows : []) {
    const window = clampWindow(raw, from, to);
    if (!window) continue;
    if (HUMAN_KINDS.has(window.kind)) human.push(window);
    else if (SYSTEM_KINDS.has(window.kind)) system.push(window);
    // Any other kind is not a wait cause and is ignored rather than guessed at.
  }
  const totalMs = to - from;
  const humanMs = unionLengthMs(human);
  const attributedMs = unionLengthMs([...human, ...system]);
  const systemMs = attributedMs - humanMs;
  const unattributedMs = totalMs - attributedMs;
  return {
    totalMs,
    humanMs,
    systemMs,
    attributedMs,
    unattributedMs,
    humanShare: shareOf(humanMs, totalMs),
    systemShare: shareOf(systemMs, totalMs),
    unattributedShare: shareOf(unattributedMs, totalMs),
  };
}

/** A part of the whole, as a 0–1 fraction. Zero total has no parts. */
export function shareOf(partMs, totalMs) {
  if (!Number.isFinite(partMs) || !Number.isFinite(totalMs) || totalMs <= 0) return 0;
  return Math.min(1, Math.max(0, partMs / totalMs));
}

/**
 * Attribute `[startAt, endAt)` for one card from its own inbox rows.
 *
 * `end` null on a row means the window is still open, and it is charged to
 * `endAt` — the caller's interval, not `Date.now()`, so a caller measuring a
 * finished card gets a closed answer.
 *
 * `completed` rows are deliberately not windows. A completion is a review
 * request, not a wait the card sat in: the card had already finished, and what
 * happened afterwards is `reviewWaitMs` — a different fact about a different
 * interval.
 */
export function attributeCardWait(db, { cardId, startAt, endAt }) {
  const rows = db.prepare(
    "SELECT kind, occurred_at, resolved_at FROM inbox_events"
    + " WHERE card_id = ? AND kind IN ('question', 'paused', 'error')",
  ).all(cardId);
  return splitWaitWindows({
    startAt,
    endAt,
    windows: rows.map((row) => ({
      kind: row.kind,
      start: row.occurred_at,
      end: row.resolved_at ?? null,
    })),
  });
}

/**
 * How long a finished card has sat unread, or null when nobody is waiting.
 *
 * A completion that was opened, resolved or archived is not a pending review —
 * this asks `hasPendingReview`'s question (lib/inbox-events.mjs) and reads the
 * same row for its duration instead of its existence, so the two can never
 * disagree about which completion counts. The newest such row is the clock: a
 * card cannot be waiting on a review it already had.
 */
export function reviewWaitMs(db, { cardId, nowMs }) {
  const row = db.prepare(
    "SELECT occurred_at FROM inbox_events WHERE card_id = ? AND kind = 'completed'"
    + " AND read_at IS NULL AND resolved_at IS NULL AND archived_at IS NULL"
    + " ORDER BY occurred_at DESC LIMIT 1",
  ).get(cardId);
  if (!row) return null;
  const wait = Number(nowMs) - Number(row.occurred_at);
  return Number.isFinite(wait) && wait > 0 ? wait : 0;
}
