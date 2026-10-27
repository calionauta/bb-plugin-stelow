/**
 * The card's narrative: every recorded fact about one card, in one order.
 *
 * Six tables already knew part of what a card lived through — the action log,
 * its comments, its stage events, its execution runs, its verifications and its
 * publications — and answering "what happened to this card?" meant joining
 * them by hand, by timestamp, in a shell. The join is mechanical and the
 * ordering is the whole point, so it lives here, where a test can assert the
 * order without a database.
 *
 * This module does not read anything. Callers hand it the rows they already
 * have, normalized to `{ at, source, summary }`, and it returns one timeline.
 * That keeps the merge honest: a source that was not collected cannot be
 * invented by the formatter.
 */

/** Newest-first? No. A replay is read downward, like a story. */
export function replayTimeline(sources, options = {}) {
  const rows = [];
  for (const [source, entries] of Object.entries(sources ?? {})) {
    for (const entry of entries ?? []) {
      if (!entry || !Number.isFinite(entry.at)) continue;
      const summary = typeof entry.summary === "string" ? entry.summary.trim() : "";
      if (!summary) continue;
      rows.push({ at: entry.at, source, summary, ref: entry.ref ?? null });
    }
  }
  rows.sort((left, right) => left.at - right.at || left.source.localeCompare(right.source));
  const since = Number.isFinite(options.since) ? options.since : null;
  const limit = Number.isFinite(options.limit) && options.limit > 0
    ? Math.round(options.limit)
    : rows.length;
  const kept = since === null ? rows : rows.filter((row) => row.at >= since);
  return kept.slice(-limit);
}

/** `2026-10-27 08:12:04`, UTC. The log is read across machines and timezones;
 * a local timestamp would make two machines' rows incomparable. */
export function formatActionTime(at) {
  if (!Number.isFinite(at)) return "???????????????????";
  return new Date(at).toISOString().replace("T", " ").slice(0, 19);
}

/** One line per row, aligned for reading and greppable for a `--json`-free
 * pipe. `detail` is never pasted whole: it is the row's evidence, not its
 * subject, and a 2 KB blob on one line hides every row after it. */
export function formatActionRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "No recorded actions.";
  const lines = rows.map((row) => {
    const count = row.occurrences > 1 ? ` x${row.occurrences}` : "";
    const cause = row.cause ? ` ${row.cause}` : "";
    const card = row.cardId ? ` ${row.cardId}` : "";
    const duration = Number.isFinite(row.durationMs) ? ` ${row.durationMs}ms` : "";
    const detail = summarizeDetail(row.detail);
    return `${formatActionTime(row.at)}  ${row.outcome.padEnd(7)}${count}  ${row.kind}${cause}${card}${duration}${detail}`;
  });
  return lines.join("\n");
}

/** A detail is a JSON object; this prints at most the first three scalar
 * fields, because a row is a pointer and the reader who needs the payload
 * asks for `--json`. */
export function summarizeDetail(detail, limit = 3) {
  let value = detail;
  if (typeof detail === "string") {
    try {
      value = JSON.parse(detail);
    } catch {
      return "";
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const parts = [];
  for (const [key, raw] of Object.entries(value)) {
    if (parts.length >= limit) break;
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "object") {
      if (key === "fields" && Array.isArray(raw)) {
        parts.push(`${key}=${raw.slice(0, 4).join(",")}`);
      }
      continue;
    }
    const text = String(raw);
    parts.push(`${key}=${text.length > 40 ? `${text.slice(0, 40)}…` : text}`);
  }
  return parts.length > 0 ? `  ${parts.join(" ")}` : "";
}
