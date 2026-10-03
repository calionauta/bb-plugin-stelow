/**
 * Documented-debt expiry (pure, no I/O).
 *
 * A documented gap may ride `expires: YYYY-MM-DD` with an `owner:` — the
 * waiver pattern: settled until the date, open after it. Only documented
 * rows age; an escalation or inline fix is worked or scoped, never aging.
 * Split out of gap-registry.mjs: debt dates are a different capability
 * from parsing the registry, with a different reason to change.
 */

/** YAML null spellings read as absent: an empty value, `null`, `~`, or
 * `none` (any case) means "not set", never a value to validate. The skill
 * template writes `expires: null` for undated debt, so the literal string
 * the template teaches must parse as absent, not fail the row. */
export function isAbsentValue(value) {
  if (value === undefined || value === null) return true;
  const text = String(value).trim().toLowerCase();
  return text === "" || text === "null" || text === "~" || text === "none" || text === "-";
}

/** Strict calendar dates for debt expiry: `YYYY-MM-DD` that exists on the
 * calendar (month 13 and February 30 fail). Lexicographic comparison works
 * because the format is zero-padded — `expires < today` is a string compare. */
export function parseGapDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { date: null, error: `expires must be YYYY-MM-DD — found ${value}` };
  const [year, month, day] = text.split("-").map(Number);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) {
    return { date: null, error: `expires must be a real calendar date — found ${value}` };
  }
  return { date: text, error: null };
}

/** True only for a valid past date: malformed and absent read false, never
 * throw — the format failure is reported by validation, not smuggled into
 * the expiry verdict. Compares dates, not instants: debt due today is due,
 * not overdue. */
export function isDebtExpired(expires, nowMs) {
  const { date } = parseGapDate(expires);
  if (!date) return false;
  const today = new Date(nowMs).toISOString().slice(0, 10);
  return date < today;
}

/**
 * Documented debt past its date. Only `documented` rows qualify: expiry is
 * debt metadata, and an escalation or inline fix is worked or scoped, never
 * aging. Returns the rows a gate must refuse on, with owner attached so the
 * refusal can name who re-dates rather than just what expired.
 */
export function expiredDebts(rows, nowMs) {
  const list = Array.isArray(rows) ? rows : [];
  const expired = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    if (String(row.resolution ?? "").trim().toLowerCase() !== "documented") continue;
    const expires = String(row.expires ?? "").trim();
    if (!isDebtExpired(expires, nowMs)) continue;
    const description = String(row.description ?? "").trim();
    if (!description) continue;
    const owner = String(row.owner ?? "").trim();
    expired.push({ description, expires, owner: isAbsentValue(owner) ? null : owner });
  }
  return expired;
}

/** Debt-expiry format: checked whenever present, on any resolution (cheap
 * teaching), enforced only for documented rows downstream. Reported
 * alongside the other dimensions — downstream compares strings, so a
 * malformed date must never pass silently. */
export function validateDebtExpiry(gap, label) {
  if (isAbsentValue(gap.expires)) return null;
  const raw = String(gap.expires).trim();
  const { error } = parseGapDate(raw);
  if (!error) return null;
  return {
    code: "gap-incomplete-row",
    expected: `${label}: expires YYYY-MM-DD on documented debt`,
    found: `${label}: expires ${gap.expires}`,
    detail: `${label} sets debt expiry that does not parse — ${error}`,
  };
}
