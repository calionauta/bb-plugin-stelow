/**
 * Human acceptance of a finished card.
 *
 * Done in Stelow certifies *verified finished work*, not accepted-and-shipped
 * work: the worker drives Done after the host verifies in code, and nothing
 * human-driven reaches it. Human review happens afterwards and is a read. So
 * acceptance is recorded as a **receipt**, the same way Interface Contrast
 * receipts distinguish agent-authored evidence from human authority — never as
 * a gate, which would either duplicate `diff-gate` or create a phantom wait.
 *
 * **Timestamp only, deliberately.** The host SDK exposes no operator identity:
 * `useRpc`, `bb.sdk.threads`, `bb.storage` — none of them answer "who is
 * signed in", and the only `displayName` fields in the SDK belong to projects
 * and presets. A name field here would therefore be free text that looks like
 * attribution and is not: two people on one bb instance would both write
 * whatever they typed, and the record would claim an authority the host never
 * checked. The honest receipt for a single-user host is "accepted, at this
 * time", and if bb ever exposes an operator identity this is the one place that
 * changes.
 *
 * The receipt never blocks: a card accepts its own acceptance being absent,
 * and `STELOW_*` settings do not reach it. It is a fact about a person, written
 * only when a person writes it.
 */

/** The card statuses that can carry an acceptance. */
const ACCEPTABLE_STATUSES = ["completed"];

/**
 * Why this card cannot be accepted, or null when it can.
 *
 * Fail-closed on both axes, and every refusal names its exit — a refusal
 * without one is a deadlock with a good error message.
 *
 * A card that has not reached Done has no finished result to accept, so
 * accepting it would record a human decision about work that does not exist
 * yet. An archived card is terminal to every automated path AND to this one:
 * its acceptance would be a receipt on a card nobody can open.
 */
export function acceptanceRefusal({ status, archived } = {}) {
  if (archived === true || status === "archived") {
    return "This card is archived — restore it before accepting the result.";
  }
  if (!ACCEPTABLE_STATUSES.includes(status)) {
    return "Acceptance records a finished result, and this card has not reached Done yet. Accept it once the worker completes and the audit evidence is ready.";
  }
  return null;
}

/**
 * Whether a card is accepted, from the one column that records it.
 *
 * A zero or absent stamp is "not accepted" rather than "accepted at the epoch":
 * a row that predates the column, or a cleared one, must not read as a receipt.
 */
export function isAccepted(acceptedAt) {
  return typeof acceptedAt === "number" && Number.isFinite(acceptedAt) && acceptedAt > 0;
}

/**
 * The disposition line a reader sees, or null when there is no receipt.
 *
 * It states what the record actually holds — that a person accepted this
 * result, and when — and nothing more. It does not claim the work was merged,
 * deployed, or correct: acceptance is a human disposition laid over a
 * machine-certified Done, and the two are different facts that the same card
 * carries.
 */
export function acceptanceLine(acceptedAt) {
  if (!isAccepted(acceptedAt)) return null;
  return `Accepted by you ${acceptedDate(acceptedAt)}. Done certifies the verification; this records your disposition of it.`;
}

/** The date half of the line, as a plain calendar date in UTC. */
export function acceptedDate(acceptedAt) {
  if (!isAccepted(acceptedAt)) return "";
  return new Date(acceptedAt).toISOString().slice(0, 10);
}
