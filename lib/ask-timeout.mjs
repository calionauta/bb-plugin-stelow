/**
 * The card question timeout: one label-to-milliseconds table for the setting,
 * the CLI call, and the recovery rows it writes.
 *
 * The timeout used to be an undeclared `STELOW_ASK_TIMEOUT_MS` read with
 * `Number()`, so a malformed value became `NaN` and the recovery row was
 * stamped with a timestamp that could not be read. The setting is now the
 * product surface; the environment variable stays as a test/ops override and
 * an unreadable override falls back instead of disabling the wait.
 */

export const ASK_TIMEOUT_OPTIONS = Object.freeze({
  "30 minutes": 30 * 60 * 1000,
  "1 hour": 60 * 60 * 1000,
  "4 hours": 4 * 60 * 60 * 1000,
  "8 hours": 8 * 60 * 60 * 1000,
  "24 hours": 24 * 60 * 60 * 1000,
  "3 days": 3 * 24 * 60 * 60 * 1000,
  "7 days": 7 * 24 * 60 * 60 * 1000,
});

export const DEFAULT_ASK_TIMEOUT = "1 hour";
export const DEFAULT_ASK_TIMEOUT_MS = ASK_TIMEOUT_OPTIONS[DEFAULT_ASK_TIMEOUT];

/**
 * Resolve the configured label and the test/ops override to milliseconds.
 * The override wins only when it is a finite positive number: a typo must
 * leave the configured wait in place, never collapse it to zero or NaN.
 */
export function resolveAskTimeoutMs(configured, envValue) {
  const override = typeof envValue === "number"
    ? envValue
    : typeof envValue === "string" && envValue.trim() !== ""
      ? Number(envValue)
      : Number.NaN;
  if (Number.isFinite(override) && override > 0) return override;
  return ASK_TIMEOUT_OPTIONS[configured] ?? DEFAULT_ASK_TIMEOUT_MS;
}
