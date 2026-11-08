/**
 * A provider rate limit is not a worker failure, and no card action clears it.
 *
 * Reported from the live board, on two cards a probe run had just created:
 *
 *   Server requested 20174s retry delay (max: 90s). 429 Rate limit exceeded. Please
 *   try again later.
 *
 * The plugin handled it correctly on the way IN — it is not a retryable spawn error, so
 * the card went to `activity=error` with an inbox event and a trail comment rather than
 * being respawned into the same limit. What it got wrong was the ADVICE. The hero note
 * ended with "Answering below resumes the worker", which is false for this cause: there
 * is no question pending, the provider is refusing requests for the next several hours,
 * and the reader would answer into a box whose answer goes nowhere.
 *
 * This is the same defect `isOwnershipRefusal` was written for, one cause over, and the
 * same reasoning applies: the sentence must name the action that actually clears it.
 * Here that is a different provider or model (the composer's advanced picker), or waiting
 * out the window — and explicitly NOT retrying immediately, which re-hits the limit and
 * teaches the reader that Retry is the cheap thing to try twice.
 *
 * A plain module rather than runtime-core, for the reason its sibling records: it is read
 * by both the server and the client, and threading one string through a deps bag costs
 * three wiring files.
 */

/** The window the provider asked for, when it named one. Captured so the sentence can
 * say "about 5 hours" instead of repeating a raw second count. */
export function retryWindowFromError(message) {
  if (typeof message !== "string") return null;
  const match = message.match(/requested\s+(\d+)\s*s(?:econd)?s?\s+retry delay/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return { seconds, hours: seconds / 3600 };
}

/**
 * Whether this failure is a provider rate limit rather than a broken quota.
 *
 * Matched on the status code the provider sent, not on the word "limit": a card's own
 * `explorationCount` limit or a file-claim limit also contain that word, and telling a
 * reader to switch providers for one of those would send them to the wrong door.
 *
 * `provider.quota` is the one shape that LOOKS like a rate limit and is not: it carries
 * "Insufficient account funds" wrapped in a message that also says "Rate limit exceeded",
 * so it matched here and the hero told the reader to wait a while — advice that never
 * clears an unfunded account. It is refused by name, and `quotaAdvice` names the fix.
 */
export function isRateLimitFailure(message) {
  if (typeof message !== "string") return false;
  if (isQuotaFailure(message)) return false;
  return /\b429\b/.test(message) || /rate limit exceeded/i.test(message);
}

/** A provider refusing on account balance, which no clock and no Retry clears. */
export function isQuotaFailure(message) {
  if (typeof message !== "string") return false;
  return /provider\.quota/i.test(message) || /insufficient (account )?funds/i.test(message);
}

/**
 * The closing sentence for an account-balance refusal.
 *
 * Separate from the rate-limit sentence because the two failures share a message and
 * not a cure: waiting is meaningless here, and "switch provider or model" is the only
 * card-side action.
 */
export function quotaAdvice(message) {
  if (!isQuotaFailure(message)) return null;
  return "This is the provider's account balance, not a rate limit and not a broken worker — "
    + "waiting will not clear it. Top up the provider account, or switch this card's provider "
    + "or model in the card actions menu, then Retry worker.";
}

/**
 * The closing sentence the hero note should show for this failure.
 *
 * `null` when this is not a rate limit, so a caller can fall through to the existing
 * advice rather than restating it here — one fact, one home.
 */
export function rateLimitAdvice(message) {
  if (!isRateLimitFailure(message)) return null;
  const window = retryWindowFromError(message);
  const wait = window
    ? `about ${window.hours >= 2 ? `${Math.round(window.hours)} hours` : `${Math.round(window.seconds / 60)} minutes`}`
    : "a while";
  return `This is a provider rate limit, not a broken worker — nothing on the card is waiting for an `
    + `answer. Retrying now re-hits the same limit. Switch this card's provider or model in the card `
    + `actions menu, or wait ${wait} and then Retry worker.`;
}
