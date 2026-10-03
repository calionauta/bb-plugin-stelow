/**
 * Which failures mean "the handle died", as opposed to "the query was wrong".
 *
 * `better-sqlite3` throws `TypeError: The database connection is not open`
 * when any statement runs against a closed handle. That is the shape a plugin
 * sees after its load is replaced: the old load's captured handle is closed
 * with it, and a timer or an in-flight pass from that load still holds it.
 * A missing table, a constraint violation, or a syntax error is a bug in the
 * caller and must keep throwing — catching everything would trade a crash for
 * silence.
 */
const CLOSED_CONNECTION = [
  /database connection is not open/i,
  /database connection (?:is|has been) closed/i,
  /database is closed/i,
];

/** True when the failure is a dead handle, never when it is a bad query. */
export function isDatabaseClosedError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return CLOSED_CONNECTION.some((pattern) => pattern.test(message));
}
